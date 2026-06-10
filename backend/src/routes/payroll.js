// src/routes/payroll.js
const router = require('express').Router();
const db = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate);

// ===== GET PAYROLL LIST =====
router.get('/', async (req, res) => {
  try {
    const { month, year } = req.query;
    const currentDate = new Date();
    const m = month || currentDate.getMonth() + 1;
    const y = year || currentDate.getFullYear();

    const result = await db.query(
      `SELECT p.*, e.name as employee_name, e.department, e.position, e.bank_iban, e.bank_name
       FROM payroll p
       JOIN employees e ON e.id = p.employee_id
       WHERE p.tenant_id = $1 AND p.month = $2 AND p.year = $3
       ORDER BY e.name`,
      [req.tenantId, m, y]
    );
    res.json({ payroll: result.rows, month: m, year: y });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في جلب كشف الرواتب' });
  }
});

// ===== CALCULATE PAYROLL (from attendance) =====
router.post('/calculate', requireRole('owner','admin','finance'), async (req, res) => {
  const { month, year } = req.body;
  if (!month || !year) return res.status(400).json({ error: 'الشهر والسنة مطلوبان' });

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Get all active employees
    const employees = await client.query(
      'SELECT * FROM employees WHERE tenant_id = $1 AND status = $2',
      [req.tenantId, 'active']
    );

    const results = [];

    for (const emp of employees.rows) {
      // Get attendance for this month
      const attendanceResult = await client.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'present') as present_days,
           COUNT(*) FILTER (WHERE status = 'absent') as absent_days,
           SUM(late_minutes) as total_late_minutes,
           SUM(overtime_hours) as total_overtime
         FROM attendance
         WHERE employee_id = $1
           AND EXTRACT(MONTH FROM date) = $2
           AND EXTRACT(YEAR FROM date) = $3`,
        [emp.id, month, year]
      );

      const att = attendanceResult.rows[0];
      const workingDays = 22; // average working days per month
      const presentDays = parseInt(att.present_days) || 0;
      const absentDays = parseInt(att.absent_days) || 0;
      const lateMinutes = parseInt(att.total_late_minutes) || 0;
      const overtimeHours = parseFloat(att.total_overtime) || 0;

      const dailySalary = emp.basic_salary / workingDays;
      const hourlyRate = emp.basic_salary / (workingDays * 8);

      // Calculations
      const absenceDeduction = dailySalary * absentDays;
      const lateDeduction = (lateMinutes / 60) * hourlyRate;
      const overtimePay = overtimeHours * hourlyRate * 1.5; // 150% for overtime

      // GOSI (9.75% employee, 11.75% employer for Saudis)
      const gosiEmployee = emp.basic_salary * 0.0975;
      const gosiEmployer = emp.basic_salary * 0.1175;

      const grossSalary = emp.basic_salary + emp.housing_allowance +
                          emp.transport_allowance + emp.other_allowances + overtimePay;
      const totalDeductions = absenceDeduction + lateDeduction + gosiEmployee;
      const netSalary = grossSalary - totalDeductions;

      // Upsert payroll record
      await client.query(
        `INSERT INTO payroll
           (tenant_id, employee_id, month, year, basic_salary, housing_allowance,
            transport_allowance, other_allowances, overtime_pay,
            absence_deductions, late_deductions, gosi_employee, gosi_employer,
            gross_salary, net_salary, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'draft')
         ON CONFLICT (tenant_id, employee_id, month, year)
         DO UPDATE SET
           overtime_pay=$9, absence_deductions=$10, late_deductions=$11,
           gosi_employee=$12, gross_salary=$14, net_salary=$15`,
        [req.tenantId, emp.id, month, year, emp.basic_salary,
         emp.housing_allowance, emp.transport_allowance, emp.other_allowances,
         overtimePay, absenceDeduction, lateDeduction, gosiEmployee, gosiEmployer,
         grossSalary, netSalary]
      );

      results.push({
        employee: emp.name,
        net_salary: netSalary.toFixed(2),
        deductions: totalDeductions.toFixed(2)
      });
    }

    await client.query('COMMIT');
    res.json({
      message: `تم حساب رواتب ${results.length} موظف بنجاح`,
      month, year, results
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'خطأ في حساب الرواتب' });
  } finally {
    client.release();
  }
});

// ===== APPROVE PAYROLL =====
router.post('/approve', requireRole('owner', 'admin', 'finance'), async (req, res) => {
  const { month, year } = req.body;
  try {
    await db.query(
      `UPDATE payroll SET status = 'approved'
       WHERE tenant_id = $1 AND month = $2 AND year = $3 AND status = 'draft'`,
      [req.tenantId, month, year]
    );
    res.json({ message: 'تم اعتماد كشف الرواتب' });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في الاعتماد' });
  }
});

// ===== DISTRIBUTE PAYROLL (mark as paid) =====
router.post('/distribute', requireRole('owner', 'admin', 'finance'), async (req, res) => {
  const { month, year, payment_reference } = req.body;
  try {
    const result = await db.query(
      `UPDATE payroll SET status = 'paid', payment_date = CURRENT_DATE,
              payment_reference = $1
       WHERE tenant_id = $2 AND month = $3 AND year = $4 AND status = 'approved'
       RETURNING employee_id, net_salary`,
      [payment_reference, req.tenantId, month, year]
    );

    // Log notification for each employee
    const notifService = require('../services/notificationService');
    for (const row of result.rows) {
      const emp = await db.query('SELECT * FROM employees WHERE id = $1', [row.employee_id]);
      if (emp.rows[0]?.phone) {
        await notifService.sendWhatsapp(
          emp.rows[0].phone,
          `مرحباً ${emp.rows[0].name}، تم تحويل راتبك لشهر ${month}/${year} بمبلغ ${row.net_salary} ريال ✅`
        );
      }
    }

    res.json({
      message: `تم صرف رواتب ${result.rowCount} موظف`,
      count: result.rowCount
    });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في صرف الرواتب' });
  }
});

// ===== PAYSLIP =====
router.get('/:employeeId/:month/:year', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT p.*, e.name, e.department, e.position, e.bank_name, e.bank_iban,
              t.name as company_name
       FROM payroll p
       JOIN employees e ON e.id = p.employee_id
       JOIN tenants t ON t.id = p.tenant_id
       WHERE p.employee_id = $1 AND p.month = $2 AND p.year = $3 AND p.tenant_id = $4`,
      [req.params.employeeId, req.params.month, req.params.year, req.tenantId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'قسيمة الراتب غير موجودة' });
    res.json({ payslip: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'خطأ' });
  }
});

module.exports = router;
