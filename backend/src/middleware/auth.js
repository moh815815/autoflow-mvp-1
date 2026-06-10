// src/middleware/auth.js
const jwt = require('jsonwebtoken');
const db = require('../config/database');

// ===== VERIFY JWT =====
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'يجب تسجيل الدخول أولاً' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Load user + tenant
    const result = await db.query(
      `SELECT u.*, t.plan, t.monthly_operations_used, t.monthly_operations_limit,
              t.is_active as tenant_active, t.name as tenant_name
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = $1 AND u.is_active = true`,
      [decoded.userId]
    );

    if (!result.rows.length) {
      return res.status(401).json({ error: 'المستخدم غير موجود' });
    }

    const user = result.rows[0];

    if (!user.tenant_active) {
      return res.status(403).json({ error: 'الحساب موقوف. تواصل مع الدعم.' });
    }

    req.user = user;
    req.tenantId = user.tenant_id;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'انتهت صلاحية الجلسة، سجّل الدخول مجدداً' });
    }
    return res.status(401).json({ error: 'رمز مصادقة غير صالح' });
  }
};

// ===== ROLE CHECK =====
const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'ليس لديك صلاحية لهذا الإجراء' });
  }
  next();
};

// ===== CHECK OPERATIONS QUOTA =====
const checkQuota = async (req, res, next) => {
  if (req.user.monthly_operations_used >= req.user.monthly_operations_limit) {
    return res.status(429).json({
      error: 'استنفذت حصتك الشهرية من العمليات',
      used: req.user.monthly_operations_used,
      limit: req.user.monthly_operations_limit,
      upgrade_url: '/pricing'
    });
  }
  next();
};

module.exports = { authenticate, requireRole, checkQuota };
