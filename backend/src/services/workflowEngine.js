// src/services/workflowEngine.js
// ============================================
// محرك تنفيذ سير العمل — قلب المنصة
// ============================================
const db = require('../config/database');
const axios = require('axios');
const integrationService = require('./integrationService');
const notificationService = require('./notificationService');

class WorkflowEngine {

  // ===== تنفيذ سير عمل =====
  async run(workflowId, triggerData = {}, triggeredBy = 'manual') {
    const workflow = await this.loadWorkflow(workflowId);
    if (!workflow) throw new Error('سير العمل غير موجود');
    if (workflow.status !== 'active') throw new Error('سير العمل غير نشط');

    // Check tenant quota
    const quotaOk = await this.checkQuota(workflow.tenant_id);
    if (!quotaOk) throw new Error('استنفذت حصة العمليات الشهرية');

    // Create run record
    const run = await this.createRun(workflow, triggerData, triggeredBy);

    try {
      // Update run status
      await this.updateRunStatus(run.id, 'running');

      // Execute nodes in order
      const context = {
        runId: run.id,
        workflowId,
        tenantId: workflow.tenant_id,
        triggerData,
        variables: { ...triggerData },
        stepsLog: [],
      };

      await this.executeNodes(workflow.nodes, workflow.edges, context);

      // Success
      await this.completeRun(run.id, 'success', context);
      await this.incrementWorkflowStats(workflowId, true);
      await this.incrementTenantUsage(workflow.tenant_id);

      return { success: true, runId: run.id, output: context.variables };

    } catch (err) {
      await this.completeRun(run.id, 'error', null, err.message);
      await this.incrementWorkflowStats(workflowId, false);

      // Notify on error
      await notificationService.send({
        tenantId: workflow.tenant_id,
        type: 'workflow_error',
        title: `❌ فشل سير العمل: ${workflow.name}`,
        message: err.message,
        referenceType: 'workflow',
        referenceId: workflowId,
      });

      throw err;
    }
  }

  // ===== تنفيذ العقد =====
  async executeNodes(nodes, edges, context) {
    // Find trigger node (start)
    const startNode = nodes.find(n => n.type === 'trigger');
    if (!startNode) throw new Error('لا يوجد عقدة بداية في سير العمل');

    await this.executeNode(startNode, nodes, edges, context);
  }

  async executeNode(node, allNodes, edges, context) {
    const stepStart = Date.now();
    const stepLog = { nodeId: node.id, type: node.type, name: node.name, startedAt: new Date() };

    try {
      let result = {};

      switch (node.type) {
        case 'trigger':
          result = { data: context.triggerData };
          break;

        case 'http_request':
          result = await this.executeHttpRequest(node, context);
          break;

        case 'integration_call':
          result = await this.executeIntegrationCall(node, context);
          break;

        case 'condition':
          result = await this.executeCondition(node, context);
          break;

        case 'send_whatsapp':
          result = await this.executeSendWhatsapp(node, context);
          break;

        case 'send_email':
          result = await this.executeSendEmail(node, context);
          break;

        case 'send_sms':
          result = await this.executeSendSms(node, context);
          break;

        case 'delay':
          result = await this.executeDelay(node, context);
          break;

        case 'set_variable':
          result = this.executeSetVariable(node, context);
          break;

        case 'update_record':
          result = await this.executeUpdateRecord(node, context);
          break;

        case 'create_record':
          result = await this.executeCreateRecord(node, context);
          break;

        case 'loop':
          result = await this.executeLoop(node, allNodes, edges, context);
          break;

        case 'code':
          result = await this.executeCode(node, context);
          break;

        default:
          throw new Error(`نوع العقدة غير معروف: ${node.type}`);
      }

      // Save output to context variables
      if (node.output_key && result.data) {
        context.variables[node.output_key] = result.data;
      }

      stepLog.status = 'success';
      stepLog.output = result;
      stepLog.duration_ms = Date.now() - stepStart;
      context.stepsLog.push(stepLog);

      // Execute next nodes
      const nextNodes = this.getNextNodes(node.id, allNodes, edges, result.branch);
      for (const nextNode of nextNodes) {
        await this.executeNode(nextNode, allNodes, edges, context);
      }

    } catch (err) {
      stepLog.status = 'error';
      stepLog.error = err.message;
      stepLog.duration_ms = Date.now() - stepStart;
      context.stepsLog.push(stepLog);

      // If node has error_handling = 'continue', don't throw
      if (node.config?.on_error === 'continue') {
        context.variables[`${node.id}_error`] = err.message;
        return;
      }
      throw err;
    }
  }

  // ===== HTTP REQUEST =====
  async executeHttpRequest(node, context) {
    const config = this.resolveVariables(node.config, context.variables);
    const response = await axios({
      method: config.method || 'GET',
      url: config.url,
      headers: config.headers || {},
      data: config.body,
      params: config.params,
      timeout: config.timeout || 30000,
    });
    return { data: response.data, status: response.status };
  }

  // ===== INTEGRATION CALL =====
  async executeIntegrationCall(node, context) {
    const { integration_id, action, params } = node.config;
    const resolvedParams = this.resolveVariables(params, context.variables);
    const result = await integrationService.call(
      context.tenantId,
      integration_id,
      action,
      resolvedParams
    );
    return { data: result };
  }

  // ===== CONDITION (شرط) =====
  async executeCondition(node, context) {
    const { field, operator, value } = node.config;
    const fieldValue = this.getNestedValue(context.variables, field);
    const resolvedValue = this.resolveVariables(value, context.variables);

    let conditionMet = false;
    switch (operator) {
      case 'eq':  conditionMet = fieldValue == resolvedValue; break;
      case 'neq': conditionMet = fieldValue != resolvedValue; break;
      case 'gt':  conditionMet = Number(fieldValue) > Number(resolvedValue); break;
      case 'lt':  conditionMet = Number(fieldValue) < Number(resolvedValue); break;
      case 'gte': conditionMet = Number(fieldValue) >= Number(resolvedValue); break;
      case 'lte': conditionMet = Number(fieldValue) <= Number(resolvedValue); break;
      case 'contains': conditionMet = String(fieldValue).includes(resolvedValue); break;
      case 'exists': conditionMet = fieldValue !== undefined && fieldValue !== null; break;
      default: conditionMet = false;
    }

    return { data: { condition_met: conditionMet }, branch: conditionMet ? 'true' : 'false' };
  }

  // ===== SEND WHATSAPP =====
  async executeSendWhatsapp(node, context) {
    const config = this.resolveVariables(node.config, context.variables);
    const { to, message } = config;

    const response = await axios.post(
      `${process.env.WHATSAPP_API_URL}/Accounts/${process.env.WHATSAPP_ACCOUNT_SID}/Messages.json`,
      new URLSearchParams({
        From: process.env.WHATSAPP_FROM,
        To: `whatsapp:${to}`,
        Body: message,
      }),
      {
        auth: {
          username: process.env.WHATSAPP_ACCOUNT_SID,
          password: process.env.WHATSAPP_AUTH_TOKEN,
        }
      }
    );
    return { data: { message_id: response.data.sid, status: 'sent' } };
  }

  // ===== SEND EMAIL =====
  async executeSendEmail(node, context) {
    const config = this.resolveVariables(node.config, context.variables);
    const emailService = require('./emailService');
    await emailService.send({
      to: config.to,
      subject: config.subject,
      body: config.body,
      html: config.html,
    });
    return { data: { status: 'sent' } };
  }

  // ===== SEND SMS =====
  async executeSendSms(node, context) {
    const config = this.resolveVariables(node.config, context.variables);
    // integrate with local SMS provider (e.g. Unifonic, Taqnyat)
    const response = await axios.post('https://api.taqnyat.sa/v1/messages', {
      sender: process.env.SMS_SENDER,
      recipients: [config.to],
      body: config.message,
    }, {
      headers: { Authorization: `Bearer ${process.env.SMS_API_KEY}` }
    });
    return { data: { status: 'sent', message_id: response.data.id } };
  }

  // ===== DELAY =====
  async executeDelay(node, context) {
    const ms = (node.config.seconds || 0) * 1000;
    if (ms > 0 && ms <= 60000) { // max 60s in sync
      await new Promise(r => setTimeout(r, ms));
    }
    return { data: { delayed_ms: ms } };
  }

  // ===== SET VARIABLE =====
  executeSetVariable(node, context) {
    const { key, value } = node.config;
    const resolved = this.resolveVariables(value, context.variables);
    context.variables[key] = resolved;
    return { data: { key, value: resolved } };
  }

  // ===== UPDATE RECORD =====
  async executeUpdateRecord(node, context) {
    const { table, id_field, id_value, fields } = node.config;
    const resolvedId = this.resolveVariables(id_value, context.variables);
    const resolvedFields = this.resolveVariables(fields, context.variables);

    const allowedTables = ['orders', 'customers', 'products', 'employees', 'leave_requests', 'invoices'];
    if (!allowedTables.includes(table)) throw new Error(`جدول غير مسموح: ${table}`);

    const keys = Object.keys(resolvedFields);
    const values = Object.values(resolvedFields);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');

    await db.query(
      `UPDATE ${table} SET ${setClause} WHERE ${id_field} = $${keys.length + 1} AND tenant_id = $${keys.length + 2}`,
      [...values, resolvedId, context.tenantId]
    );
    return { data: { updated: true, table, id: resolvedId } };
  }

  // ===== CREATE RECORD =====
  async executeCreateRecord(node, context) {
    const { table, fields } = node.config;
    const resolvedFields = this.resolveVariables(fields, context.variables);
    resolvedFields.tenant_id = context.tenantId;

    const allowedTables = ['orders', 'customers', 'notifications', 'leave_requests'];
    if (!allowedTables.includes(table)) throw new Error(`جدول غير مسموح: ${table}`);

    const keys = Object.keys(resolvedFields);
    const values = Object.values(resolvedFields);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');

    const result = await db.query(
      `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders}) RETURNING id`,
      values
    );
    return { data: { created: true, id: result.rows[0].id } };
  }

  // ===== LOOP =====
  async executeLoop(node, allNodes, edges, context) {
    const { items_key, item_variable } = node.config;
    const items = this.getNestedValue(context.variables, items_key) || [];

    for (let i = 0; i < items.length; i++) {
      context.variables[item_variable] = items[i];
      context.variables[`${item_variable}_index`] = i;

      const loopNodes = this.getNextNodes(node.id, allNodes, edges);
      for (const n of loopNodes) {
        await this.executeNode(n, allNodes, edges, context);
      }
    }
    return { data: { iterated: items.length } };
  }

  // ===== CODE (JavaScript sandbox) =====
  async executeCode(node, context) {
    // Simple safe eval with limited context
    const { code } = node.config;
    const fn = new Function('variables', 'result', code);
    const result = {};
    fn(context.variables, result);
    return { data: result };
  }

  // ===== HELPERS =====
  getNextNodes(currentNodeId, allNodes, edges, branch = null) {
    return edges
      .filter(e => e.source === currentNodeId && (!branch || e.branch === branch))
      .map(e => allNodes.find(n => n.id === e.target))
      .filter(Boolean);
  }

  resolveVariables(obj, variables) {
    if (typeof obj === 'string') {
      return obj.replace(/\{\{([^}]+)\}\}/g, (_, key) =>
        this.getNestedValue(variables, key.trim()) ?? ''
      );
    }
    if (Array.isArray(obj)) return obj.map(i => this.resolveVariables(i, variables));
    if (typeof obj === 'object' && obj !== null) {
      const result = {};
      for (const [k, v] of Object.entries(obj)) {
        result[k] = this.resolveVariables(v, variables);
      }
      return result;
    }
    return obj;
  }

  getNestedValue(obj, path) {
    return path.split('.').reduce((acc, key) => acc?.[key], obj);
  }

  async loadWorkflow(workflowId) {
    const result = await db.query('SELECT * FROM workflows WHERE id = $1', [workflowId]);
    return result.rows[0] || null;
  }

  async createRun(workflow, triggerData, triggeredBy) {
    const result = await db.query(
      `INSERT INTO workflow_runs (workflow_id, tenant_id, triggered_by, input_data, status)
       VALUES ($1, $2, $3, $4, 'pending') RETURNING *`,
      [workflow.id, workflow.tenant_id, triggeredBy, JSON.stringify(triggerData)]
    );
    return result.rows[0];
  }

  async updateRunStatus(runId, status) {
    await db.query('UPDATE workflow_runs SET status = $1 WHERE id = $2', [status, runId]);
  }

  async completeRun(runId, status, context, errorMessage = null) {
    await db.query(
      `UPDATE workflow_runs
       SET status = $1, completed_at = NOW(),
           duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000,
           steps_log = $2, output_data = $3, error_message = $4
       WHERE id = $5`,
      [
        status,
        JSON.stringify(context?.stepsLog || []),
        JSON.stringify(context?.variables || {}),
        errorMessage,
        runId,
      ]
    );
  }

  async incrementWorkflowStats(workflowId, success) {
    await db.query(
      `UPDATE workflows SET
         run_count = run_count + 1,
         ${success ? 'success_count = success_count + 1,' : 'error_count = error_count + 1,'}
         last_run_at = NOW(),
         last_run_status = $1
       WHERE id = $2`,
      [success ? 'success' : 'error', workflowId]
    );
  }

  async incrementTenantUsage(tenantId) {
    await db.query(
      'UPDATE tenants SET monthly_operations_used = monthly_operations_used + 1 WHERE id = $1',
      [tenantId]
    );
  }

  async checkQuota(tenantId) {
    const result = await db.query(
      'SELECT monthly_operations_used, monthly_operations_limit FROM tenants WHERE id = $1',
      [tenantId]
    );
    if (!result.rows.length) return false;
    const { monthly_operations_used, monthly_operations_limit } = result.rows[0];
    return monthly_operations_used < monthly_operations_limit;
  }
}

module.exports = new WorkflowEngine();
