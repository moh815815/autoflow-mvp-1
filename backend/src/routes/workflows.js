// src/routes/workflows.js
const router = require('express').Router();
const db = require('../config/database');
const { authenticate, requireRole, checkQuota } = require('../middleware/auth');
const workflowEngine = require('../services/workflowEngine');

// All routes require auth
router.use(authenticate);

// ===== GET ALL WORKFLOWS =====
router.get('/', async (req, res) => {
  try {
    const { status, category, search } = req.query;
    let query = `
      SELECT w.*, u.name as created_by_name
      FROM workflows w
      LEFT JOIN users u ON u.id = w.created_by
      WHERE w.tenant_id = $1
    `;
    const params = [req.tenantId];

    if (status) { query += ` AND w.status = $${params.length + 1}`; params.push(status); }
    if (category) { query += ` AND w.category = $${params.length + 1}`; params.push(category); }
    if (search) { query += ` AND w.name ILIKE $${params.length + 1}`; params.push(`%${search}%`); }
    query += ' ORDER BY w.updated_at DESC';

    const result = await db.query(query, params);
    res.json({ workflows: result.rows, total: result.rowCount });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في جلب سير العمل' });
  }
});

// ===== GET ONE WORKFLOW =====
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM workflows WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.tenantId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'سير العمل غير موجود' });
    res.json({ workflow: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في جلب سير العمل' });
  }
});

// ===== CREATE WORKFLOW =====
router.post('/', requireRole('owner', 'admin', 'manager'), async (req, res) => {
  const { name, description, category, trigger_type, trigger_config, nodes, edges, tags } = req.body;
  if (!name || !trigger_type) {
    return res.status(400).json({ error: 'الاسم ونوع المحفّز مطلوبان' });
  }
  try {
    const result = await db.query(
      `INSERT INTO workflows
         (tenant_id, created_by, name, description, category, trigger_type, trigger_config, nodes, edges, tags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [req.tenantId, req.user.id, name, description, category,
       trigger_type, JSON.stringify(trigger_config || {}),
       JSON.stringify(nodes || []), JSON.stringify(edges || []), tags || []]
    );
    res.status(201).json({ workflow: result.rows[0], message: 'تم إنشاء سير العمل' });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في إنشاء سير العمل' });
  }
});

// ===== UPDATE WORKFLOW =====
router.put('/:id', requireRole('owner', 'admin', 'manager'), async (req, res) => {
  const { name, description, category, status, trigger_type, trigger_config, nodes, edges, tags } = req.body;
  try {
    const result = await db.query(
      `UPDATE workflows SET
         name=$1, description=$2, category=$3, status=$4,
         trigger_type=$5, trigger_config=$6, nodes=$7, edges=$8, tags=$9,
         version = version + 1
       WHERE id=$10 AND tenant_id=$11
       RETURNING *`,
      [name, description, category, status, trigger_type,
       JSON.stringify(trigger_config), JSON.stringify(nodes),
       JSON.stringify(edges), tags, req.params.id, req.tenantId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'سير العمل غير موجود' });
    res.json({ workflow: result.rows[0], message: 'تم تحديث سير العمل' });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في تحديث سير العمل' });
  }
});

// ===== DELETE WORKFLOW =====
router.delete('/:id', requireRole('owner', 'admin'), async (req, res) => {
  try {
    await db.query(
      'UPDATE workflows SET status = $1 WHERE id = $2 AND tenant_id = $3',
      ['archived', req.params.id, req.tenantId]
    );
    res.json({ message: 'تم أرشفة سير العمل' });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في الحذف' });
  }
});

// ===== RUN WORKFLOW (manual trigger) =====
router.post('/:id/run', checkQuota, async (req, res) => {
  try {
    const result = await workflowEngine.run(
      req.params.id,
      req.body.input_data || {},
      req.user.id
    );
    res.json({ message: 'تم تشغيل سير العمل بنجاح', ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===== TOGGLE STATUS =====
router.patch('/:id/toggle', requireRole('owner', 'admin', 'manager'), async (req, res) => {
  try {
    const current = await db.query(
      'SELECT status FROM workflows WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.tenantId]
    );
    if (!current.rows.length) return res.status(404).json({ error: 'غير موجود' });

    const newStatus = current.rows[0].status === 'active' ? 'paused' : 'active';
    await db.query(
      'UPDATE workflows SET status = $1 WHERE id = $2 AND tenant_id = $3',
      [newStatus, req.params.id, req.tenantId]
    );
    res.json({ status: newStatus, message: newStatus === 'active' ? 'تم تفعيل سير العمل' : 'تم إيقاف سير العمل' });
  } catch (err) {
    res.status(500).json({ error: 'خطأ' });
  }
});

// ===== GET RUN LOGS =====
router.get('/:id/runs', async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    const result = await db.query(
      `SELECT id, triggered_by, status, started_at, completed_at,
              duration_ms, error_message
       FROM workflow_runs
       WHERE workflow_id = $1 AND tenant_id = $2
       ORDER BY started_at DESC
       LIMIT $3 OFFSET $4`,
      [req.params.id, req.tenantId, limit, offset]
    );
    res.json({ runs: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في جلب السجلات' });
  }
});

// ===== GET SINGLE RUN DETAIL =====
router.get('/:id/runs/:runId', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM workflow_runs WHERE id = $1 AND tenant_id = $2',
      [req.params.runId, req.tenantId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'السجل غير موجود' });
    res.json({ run: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'خطأ' });
  }
});

// ===== GET TEMPLATES =====
router.get('/templates/all', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM workflow_templates ORDER BY is_featured DESC, use_count DESC'
    );
    res.json({ templates: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في جلب القوالب' });
  }
});

// ===== CREATE FROM TEMPLATE =====
router.post('/templates/:templateId/use', requireRole('owner','admin','manager'), async (req, res) => {
  try {
    const tmpl = await db.query(
      'SELECT * FROM workflow_templates WHERE id = $1', [req.params.templateId]
    );
    if (!tmpl.rows.length) return res.status(404).json({ error: 'القالب غير موجود' });

    const t = tmpl.rows[0];
    const result = await db.query(
      `INSERT INTO workflows
         (tenant_id, created_by, name, description, category, trigger_type, nodes, edges, tags)
       VALUES ($1,$2,$3,$4,$5,'manual',$6,$7,$8)
       RETURNING *`,
      [req.tenantId, req.user.id,
       req.body.name || t.name_ar || t.name,
       t.description_ar || t.description,
       t.category, JSON.stringify(t.nodes), JSON.stringify(t.edges), t.tags || []]
    );

    // Increment template usage
    await db.query(
      'UPDATE workflow_templates SET use_count = use_count + 1 WHERE id = $1',
      [req.params.templateId]
    );

    res.status(201).json({ workflow: result.rows[0], message: 'تم إنشاء سير العمل من القالب' });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في استخدام القالب' });
  }
});

module.exports = router;
