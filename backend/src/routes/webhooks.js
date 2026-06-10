// src/routes/webhooks.js
// ============================================
// استقبال Webhooks من الأنظمة الخارجية
// ============================================
const router = require('express').Router();
const db = require('../config/database');
const workflowEngine = require('../services/workflowEngine');
const crypto = require('crypto');

// ===== INCOMING WEBHOOK (no auth - uses secret key) =====
router.post('/:tenantSlug/:webhookKey', async (req, res) => {
  try {
    const { tenantSlug, webhookKey } = req.params;

    // Find tenant
    const tenant = await db.query(
      'SELECT * FROM tenants WHERE slug = $1 AND is_active = true',
      [tenantSlug]
    );
    if (!tenant.rows.length) return res.status(404).json({ error: 'Tenant not found' });

    // Find matching workflow
    const workflow = await db.query(
      `SELECT * FROM workflows
       WHERE tenant_id = $1
         AND status = 'active'
         AND trigger_type = 'webhook'
         AND trigger_config->>'webhook_key' = $2`,
      [tenant.rows[0].id, webhookKey]
    );

    if (!workflow.rows.length) {
      return res.status(404).json({ error: 'No active workflow for this webhook' });
    }

    // Validate signature if configured
    const wf = workflow.rows[0];
    if (wf.trigger_config?.webhook_secret) {
      const signature = req.headers['x-signature'];
      const expected = crypto
        .createHmac('sha256', wf.trigger_config.webhook_secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== `sha256=${expected}`) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    // Run async (don't wait)
    workflowEngine.run(wf.id, req.body, 'webhook')
      .catch(err => console.error(`Webhook workflow error: ${err.message}`));

    res.json({ received: true, message: 'Workflow triggered' });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ===== ORDER WEBHOOK (from Salla, Zid, WooCommerce) =====
router.post('/orders/:tenantSlug', async (req, res) => {
  try {
    const tenant = await db.query(
      'SELECT * FROM tenants WHERE slug = $1 AND is_active = true',
      [req.params.tenantSlug]
    );
    if (!tenant.rows.length) return res.status(404).end();

    const orderData = req.body;

    // Save order
    await db.query(
      `INSERT INTO orders
         (tenant_id, order_number, status, items, total, shipping_address)
       VALUES ($1,$2,'new',$3,$4,$5)
       ON CONFLICT (order_number) DO NOTHING`,
      [
        tenant.rows[0].id,
        orderData.order_id || orderData.id || `ORD-${Date.now()}`,
        JSON.stringify(orderData.items || []),
        orderData.total || 0,
        JSON.stringify(orderData.shipping_address || {})
      ]
    );

    // Trigger order workflows
    const workflows = await db.query(
      `SELECT id FROM workflows
       WHERE tenant_id = $1 AND status = 'active'
         AND trigger_type = 'event'
         AND trigger_config->>'event' = 'new_order'`,
      [tenant.rows[0].id]
    );

    for (const wf of workflows.rows) {
      workflowEngine.run(wf.id, orderData, 'webhook')
        .catch(err => console.error(err.message));
    }

    res.json({ received: true });
  } catch (err) {
    res.status(500).json({ error: 'Error processing order webhook' });
  }
});

// ===== FINGERPRINT ATTENDANCE WEBHOOK =====
router.post('/attendance/:tenantSlug', async (req, res) => {
  try {
    const tenant = await db.query(
      'SELECT * FROM tenants WHERE slug = $1', [req.params.tenantSlug]
    );
    if (!tenant.rows.length) return res.status(404).end();

    const { employee_fingerprint_id, timestamp, type } = req.body; // type: checkin|checkout

    const employee = await db.query(
      'SELECT * FROM employees WHERE fingerprint_id = $1 AND tenant_id = $2',
      [employee_fingerprint_id, tenant.rows[0].id]
    );
    if (!employee.rows.length) return res.status(404).json({ error: 'Employee not found' });

    const emp = employee.rows[0];
    const date = new Date(timestamp).toISOString().split('T')[0];

    if (type === 'checkin') {
      await db.query(
        `INSERT INTO attendance (tenant_id, employee_id, date, check_in, status, source)
         VALUES ($1,$2,$3,$4,'present','fingerprint')
         ON CONFLICT (tenant_id, employee_id, date) DO UPDATE SET check_in = $4`,
        [tenant.rows[0].id, emp.id, date, timestamp]
      );
    } else if (type === 'checkout') {
      await db.query(
        `UPDATE attendance
         SET check_out = $1,
             hours_worked = EXTRACT(EPOCH FROM ($1::timestamptz - check_in)) / 3600
         WHERE tenant_id = $2 AND employee_id = $3 AND date = $4`,
        [timestamp, tenant.rows[0].id, emp.id, date]
      );
    }

    res.json({ received: true });
  } catch (err) {
    res.status(500).json({ error: 'Attendance webhook error' });
  }
});

module.exports = router;
