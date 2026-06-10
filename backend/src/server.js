// src/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const app = express();

// ===== MIDDLEWARE =====
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 200,
  message: { error: 'طلبات كثيرة، حاول مرة أخرى لاحقاً' }
});
app.use('/api/', limiter);

// ===== ROUTES =====
app.use('/api/auth',         require('./routes/auth'));
app.use('/api/workflows',    require('./routes/workflows'));
app.use('/api/integrations', require('./routes/integrations'));
app.use('/api/employees',    require('./routes/employees'));
app.use('/api/attendance',   require('./routes/attendance'));
app.use('/api/payroll',      require('./routes/payroll'));
app.use('/api/leave',        require('./routes/leave'));
app.use('/api/orders',       require('./routes/orders'));
app.use('/api/customers',    require('./routes/customers'));
app.use('/api/products',     require('./routes/products'));
app.use('/api/invoices',     require('./routes/invoices'));
app.use('/api/notifications',require('./routes/notifications'));
app.use('/api/reports',      require('./routes/reports'));
app.use('/api/webhooks',     require('./routes/webhooks'));
app.use('/api/admin',        require('./routes/admin'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', time: new Date() });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'المسار غير موجود' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'خطأ داخلي في الخادم',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// ===== START =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 أوتوفلو يعمل على المنفذ ${PORT}`);
  // Start workflow scheduler
  require('./jobs/scheduler');
});

module.exports = app;
