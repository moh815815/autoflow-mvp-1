// src/routes/integrations.js
const router = require('express').Router();
const db = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const integrationService = require('../services/integrationService');

router.use(authenticate);

// GET all integrations
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, type, base_url, auth_type, is_active,
              last_tested_at, last_test_status, metadata, created_at
       FROM integrations WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [req.tenantId]
    );
    res.json({ integrations: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في جلب التكاملات' });
  }
});

// CREATE integration
router.post('/', requireRole('owner', 'admin'), async (req, res) => {
  const { name, type, base_url, auth_type, credentials, headers, metadata } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'الاسم والنوع مطلوبان' });

  try {
    // Encrypt credentials before storing
    const encryptedCreds = credentials
      ? integrationService.encrypt(JSON.stringify(credentials))
      : '{}';

    const result = await db.query(
      `INSERT INTO integrations
         (tenant_id, name, type, base_url, auth_type, credentials, headers, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, name, type, is_active, created_at`,
      [req.tenantId, name, type, base_url, auth_type || 'api_key',
       encryptedCreds, JSON.stringify(headers || {}), JSON.stringify(metadata || {})]
    );
    res.status(201).json({ integration: result.rows[0], message: 'تم إضافة التكامل' });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في إضافة التكامل' });
  }
});

// UPDATE integration
router.put('/:id', requireRole('owner', 'admin'), async (req, res) => {
  const { name, base_url, auth_type, credentials, headers, metadata, is_active } = req.body;
  try {
    const encryptedCreds = credentials
      ? integrationService.encrypt(JSON.stringify(credentials))
      : undefined;

    const updates = [];
    const values = [];
    let i = 1;

    if (name)            { updates.push(`name=$${i++}`);          values.push(name); }
    if (base_url)        { updates.push(`base_url=$${i++}`);      values.push(base_url); }
    if (auth_type)       { updates.push(`auth_type=$${i++}`);     values.push(auth_type); }
    if (encryptedCreds)  { updates.push(`credentials=$${i++}`);   values.push(encryptedCreds); }
    if (headers)         { updates.push(`headers=$${i++}`);        values.push(JSON.stringify(headers)); }
    if (metadata)        { updates.push(`metadata=$${i++}`);       values.push(JSON.stringify(metadata)); }
    if (is_active !== undefined) { updates.push(`is_active=$${i++}`); values.push(is_active); }

    if (!updates.length) return res.status(400).json({ error: 'لا توجد بيانات للتحديث' });

    values.push(req.params.id, req.tenantId);
    await db.query(
      `UPDATE integrations SET ${updates.join(',')} WHERE id=$${i++} AND tenant_id=$${i}`,
      values
    );
    res.json({ message: 'تم تحديث التكامل' });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في التحديث' });
  }
});

// DELETE integration
router.delete('/:id', requireRole('owner', 'admin'), async (req, res) => {
  try {
    await db.query(
      'DELETE FROM integrations WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.tenantId]
    );
    res.json({ message: 'تم حذف التكامل' });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في الحذف' });
  }
});

// TEST integration
router.post('/:id/test', async (req, res) => {
  try {
    const result = await integrationService.test(req.tenantId, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
