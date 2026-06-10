const router = require('express').Router();
const db = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
router.use(authenticate);
router.get('/', async (req,res) => {
  const r = await db.query('SELECT i.*,c.name as customer_name FROM invoices i LEFT JOIN customers c ON c.id=i.customer_id WHERE i.tenant_id=$1 ORDER BY i.created_at DESC',[req.tenantId]);
  res.json({ invoices: r.rows });
});
router.post('/', requireRole('owner','admin','finance'), async (req,res) => {
  const { customer_id,invoice_number,items,subtotal,tax_rate,due_date,notes } = req.body;
  const tax = (subtotal * (tax_rate||15)) / 100;
  const total = subtotal + tax;
  const r = await db.query(`INSERT INTO invoices (tenant_id,customer_id,invoice_number,items,subtotal,tax_rate,tax_amount,total,due_date,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[req.tenantId,customer_id,invoice_number,JSON.stringify(items||[]),subtotal,tax_rate||15,tax,total,due_date,notes]);
  res.status(201).json({ invoice: r.rows[0] });
});
router.patch('/:id/mark-paid', requireRole('owner','admin','finance'), async (req,res) => {
  await db.query(`UPDATE invoices SET status='paid', paid_at=NOW(), paid_amount=total WHERE id=$1 AND tenant_id=$2`,[req.params.id,req.tenantId]);
  res.json({ message: 'تم تسجيل الدفع' });
});
module.exports = router;
