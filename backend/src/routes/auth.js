// src/routes/auth.js
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const Joi = require('joi');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');

const generateToken = (userId) =>
  jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

// ===== REGISTER (إنشاء شركة جديدة) =====
router.post('/register', async (req, res) => {
  const schema = Joi.object({
    company_name: Joi.string().min(2).max(255).required(),
    name: Joi.string().min(2).max(255).required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(8).required(),
    phone: Joi.string().optional(),
    country: Joi.string().default('SA'),
  });

  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Check email exists
    const existing = await client.query(
      'SELECT id FROM users WHERE email = $1', [value.email]
    );
    if (existing.rows.length) {
      return res.status(409).json({ error: 'البريد الإلكتروني مستخدم بالفعل' });
    }

    // Create slug from company name
    const slug = value.company_name
      .toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06FF]/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 50) + '-' + Date.now().toString().slice(-4);

    // Create tenant
    const tenant = await client.query(
      `INSERT INTO tenants (name, slug, email, phone, country, plan, plan_expires_at, monthly_operations_limit)
       VALUES ($1, $2, $3, $4, $5, 'starter', NOW() + INTERVAL '14 days', 500)
       RETURNING *`,
      [value.company_name, slug, value.email, value.phone, value.country]
    );

    // Create owner user
    const passwordHash = await bcrypt.hash(value.password, 12);
    const user = await client.query(
      `INSERT INTO users (tenant_id, name, email, password_hash, role, email_verified_at)
       VALUES ($1, $2, $3, $4, 'owner', NOW())
       RETURNING id, name, email, role, tenant_id`,
      [tenant.rows[0].id, value.name, value.email, passwordHash]
    );

    await client.query('COMMIT');

    const token = generateToken(user.rows[0].id);

    res.status(201).json({
      message: 'تم إنشاء الحساب بنجاح! تجربة مجانية 14 يوم',
      token,
      user: user.rows[0],
      tenant: { id: tenant.rows[0].id, name: tenant.rows[0].name, plan: tenant.rows[0].plan }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'خطأ في إنشاء الحساب' });
  } finally {
    client.release();
  }
});

// ===== LOGIN =====
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'البريد الإلكتروني وكلمة المرور مطلوبان' });
  }

  try {
    const result = await db.query(
      `SELECT u.*, t.name as tenant_name, t.plan, t.is_active as tenant_active,
              t.monthly_operations_used, t.monthly_operations_limit
       FROM users u JOIN tenants t ON t.id = u.tenant_id
       WHERE u.email = $1 AND u.is_active = true`,
      [email.toLowerCase()]
    );

    if (!result.rows.length) {
      return res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
    }

    if (!user.tenant_active) {
      return res.status(403).json({ error: 'الحساب موقوف. تواصل مع الدعم.' });
    }

    // Update last login
    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    const token = generateToken(user.id);

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        tenant_id: user.tenant_id,
        tenant_name: user.tenant_name,
        plan: user.plan,
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في تسجيل الدخول' });
  }
});

// ===== GET CURRENT USER =====
router.get('/me', authenticate, async (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      tenant_id: req.user.tenant_id,
      tenant_name: req.user.tenant_name,
      plan: req.user.plan,
      monthly_operations_used: req.user.monthly_operations_used,
      monthly_operations_limit: req.user.monthly_operations_limit,
    }
  });
});

// ===== CHANGE PASSWORD =====
router.put('/change-password', authenticate, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'كلمة المرور الحالية والجديدة مطلوبتان' });
  }
  if (new_password.length < 8) {
    return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل' });
  }

  try {
    const user = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const valid = await bcrypt.compare(current_password, user.rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة' });

    const newHash = await bcrypt.hash(new_password, 12);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.user.id]);

    res.json({ message: 'تم تغيير كلمة المرور بنجاح' });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في تغيير كلمة المرور' });
  }
});

// ===== LOGOUT =====
router.post('/logout', authenticate, (req, res) => {
  // Client should delete the token
  res.json({ message: 'تم تسجيل الخروج بنجاح' });
});

module.exports = router;
