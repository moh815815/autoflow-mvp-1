// src/routes/reports.js
const router = require('express').Router();
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// ===== DASHBOARD STATS =====
router.get('/dashboard', async (req, res) => {
  try {
    const [workflows, runs, employees, orders] = await Promise.all([
      db.query(`SELECT COUNT(*) as total,
                  COUNT(*) FILTER (WHERE status='active') as active
                FROM workflows WHERE tenant_id=$1`, [req.tenantId]),
      db.query(`SELECT COUNT(*) as total,
                  COUNT(*) FILTER (WHERE status='success') as success,
                  COUNT(*) FILTER (WHERE status='error') as errors,
                  ROUND(AVG(duration_ms)) as avg_duration
                FROM workflow_runs WHERE tenant_id=$1
                  AND started_at >= date_trunc('month', NOW())`, [req.tenantId]),
      db.query(`SELECT COUNT(*) as total,
                  COUNT(*) FILTER (WHERE status='active') as active
                FROM employees WHERE tenant_id=$1`, [req.tenantId]),
      db.query(`SELECT COUNT(*) as total,
                  COALESCE(SUM(total),0) as revenue
                FROM orders WHERE tenant_id=$1
                  AND created_at >= date_trunc('month', NOW())`, [req.tenantId]),
    ]);

    const runsData = runs.rows[0];
    const total = parseInt(runsData.total) || 0;
    const success = parseInt(runsData.success) || 0;
    const successRate = total > 0 ? ((success / total) * 100).toFixed(1) : 100;

    res.json({
      workflows: workflows.rows[0],
      runs: {
        ...runsData,
        success_rate: successRate,
        time_saved_hours: Math.round(total * 1.5 / 60), // estimate 1.5min saved per operation
      },
      employees: employees.rows[0],
      orders: orders.rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في جلب إحصائيات لوحة التحكم' });
  }
});

// ===== DAILY RUNS CHART (last 30 days) =====
router.get('/runs-chart', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT DATE(started_at) as date,
              COUNT(*) as total,
              COUNT(*) FILTER (WHERE status='success') as success,
              COUNT(*) FILTER (WHERE status='error') as errors
       FROM workflow_runs
       WHERE tenant_id=$1
         AND started_at >= NOW() - INTERVAL '30 days'
       GROUP BY DATE(started_at)
       ORDER BY date`,
      [req.tenantId]
    );
    res.json({ chart: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في جلب بيانات الرسم البياني' });
  }
});

// ===== TOP WORKFLOWS =====
router.get('/top-workflows', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, category, run_count, success_count, error_count, last_run_at
       FROM workflows
       WHERE tenant_id=$1 AND run_count > 0
       ORDER BY run_count DESC LIMIT 10`,
      [req.tenantId]
    );
    res.json({ workflows: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'خطأ' });
  }
});

// ===== HR REPORT =====
router.get('/hr', async (req, res) => {
  const { month, year } = req.query;
  const m = month || new Date().getMonth() + 1;
  const y = year || new Date().getFullYear();
  try {
    const [attendance, leaves, payroll] = await Promise.all([
      db.query(
        `SELECT
           COUNT(DISTINCT employee_id) as employees_tracked,
           ROUND(AVG(hours_worked),2) as avg_hours,
           COUNT(*) FILTER (WHERE status='late') as late_count,
           COUNT(*) FILTER (WHERE status='absent') as absent_count
         FROM attendance
         WHERE tenant_id=$1
           AND EXTRACT(MONTH FROM date)=$2
           AND EXTRACT(YEAR FROM date)=$3`,
        [req.tenantId, m, y]
      ),
      db.query(
        `SELECT type, COUNT(*) as count, status
         FROM leave_requests
         WHERE tenant_id=$1
           AND EXTRACT(MONTH FROM created_at)=$2
           AND EXTRACT(YEAR FROM created_at)=$3
         GROUP BY type, status`,
        [req.tenantId, m, y]
      ),
      db.query(
        `SELECT
           COUNT(*) as employee_count,
           SUM(gross_salary) as total_gross,
           SUM(net_salary) as total_net,
           SUM(gosi_employer) as total_gosi
         FROM payroll
         WHERE tenant_id=$1 AND month=$2 AND year=$3`,
        [req.tenantId, m, y]
      ),
    ]);

    res.json({
      month: m, year: y,
      attendance: attendance.rows[0],
      leaves: leaves.rows,
      payroll: payroll.rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في تقرير الموارد البشرية' });
  }
});

// ===== FINANCE REPORT =====
router.get('/finance', async (req, res) => {
  const { month, year } = req.query;
  const m = month || new Date().getMonth() + 1;
  const y = year || new Date().getFullYear();
  try {
    const [invoices, orders, payroll] = await Promise.all([
      db.query(
        `SELECT
           COUNT(*) as total_invoices,
           COUNT(*) FILTER (WHERE status='paid') as paid,
           COUNT(*) FILTER (WHERE status='overdue') as overdue,
           COALESCE(SUM(total) FILTER (WHERE status='paid'),0) as collected,
           COALESCE(SUM(total) FILTER (WHERE status='sent'),0) as pending
         FROM invoices WHERE tenant_id=$1
           AND EXTRACT(MONTH FROM issue_date)=$2
           AND EXTRACT(YEAR FROM issue_date)=$3`,
        [req.tenantId, m, y]
      ),
      db.query(
        `SELECT COUNT(*) as orders, COALESCE(SUM(total),0) as revenue
         FROM orders WHERE tenant_id=$1
           AND EXTRACT(MONTH FROM created_at)=$2
           AND EXTRACT(YEAR FROM created_at)=$3
           AND status NOT IN ('cancelled')`,
        [req.tenantId, m, y]
      ),
      db.query(
        `SELECT COALESCE(SUM(net_salary),0) as payroll_total,
                COALESCE(SUM(gosi_employer),0) as gosi_total
         FROM payroll WHERE tenant_id=$1 AND month=$2 AND year=$3`,
        [req.tenantId, m, y]
      ),
    ]);

    res.json({
      month: m, year: y,
      invoices: invoices.rows[0],
      orders: orders.rows[0],
      payroll: payroll.rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في التقرير المالي' });
  }
});

module.exports = router;
