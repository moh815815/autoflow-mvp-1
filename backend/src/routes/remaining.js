// ============================================
// src/routes/employees.js
// ============================================
const employeeRouter = require('express').Router();
const db = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');

employeeRouter.use(authenticate);

employeeRouter.get('/', async (req, res) => {
  const { department, status, search } = req.query;
  let q = `SELECT * FROM employees WHERE tenant_id=$1`;
  const params = [req.tenantId];
  if (department) { q += ` AND department=$${params.length+1}`; params.push(department); }
  if (status) { q += ` AND status=$${params.length+1}`; params.push(status); }
  if (search) { q += ` AND name ILIKE $${params.length+1}`; params.push(`%${search}%`); }
  q += ' ORDER BY name';
  const result = await db.query(q, params);
  res.json({ employees: result.rows });
});

employeeRouter.get('/:id', async (req, res) => {
  const r = await db.query('SELECT * FROM employees WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenantId]);
  if (!r.rows.length) return res.status(404).json({ error: 'الموظف غير موجود' });
  res.json({ employee: r.rows[0] });
});

employeeRouter.post('/', requireRole('owner','admin','hr'), async (req, res) => {
  const { name, email, phone, department, position, basic_salary, housing_allowance,
          transport_allowance, hire_date, national_id, bank_iban, bank_name, fingerprint_id } = req.body;
  if (!name) return res.status(400).json({ error: 'اسم الموظف مطلوب' });
  const r = await db.query(
    `INSERT INTO employees (tenant_id,name,email,phone,department,position,basic_salary,
      housing_allowance,transport_allowance,hire_date,national_id,bank_iban,bank_name,fingerprint_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [req.tenantId,name,email,phone,department,position,basic_salary,
     housing_allowance||0,transport_allowance||0,hire_date,national_id,bank_iban,bank_name,fingerprint_id]
  );
  res.status(201).json({ employee: r.rows[0] });
});

employeeRouter.put('/:id', requireRole('owner','admin','hr'), async (req, res) => {
  const fields = ['name','email','phone','department','position','basic_salary',
                  'housing_allowance','transport_allowance','status','bank_iban','bank_name'];
  const updates = []; const values = []; let i=1;
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f}=$${i++}`); values.push(req.body[f]); }
  }
  if (!updates.length) return res.status(400).json({ error: 'لا بيانات' });
  values.push(req.params.id, req.tenantId);
  await db.query(`UPDATE employees SET ${updates.join(',')} WHERE id=$${i++} AND tenant_id=$${i}`, values);
  res.json({ message: 'تم التحديث' });
});

module.exports = { employeeRouter };

// ============================================
// src/routes/attendance.js
// ============================================
const attendanceRouter = require('express').Router();
attendanceRouter.use(authenticate);

attendanceRouter.get('/', async (req, res) => {
  const { date, employee_id } = req.query;
  const today = date || new Date().toISOString().split('T')[0];
  let q = `SELECT a.*, e.name as employee_name, e.department
           FROM attendance a JOIN employees e ON e.id=a.employee_id
           WHERE a.tenant_id=$1 AND a.date=$2`;
  const p = [req.tenantId, today];
  if (employee_id) { q += ` AND a.employee_id=$3`; p.push(employee_id); }
  q += ' ORDER BY e.name';
  const r = await db.query(q, p);
  res.json({ attendance: r.rows, date: today });
});

attendanceRouter.post('/manual', requireRole('owner','admin','hr'), async (req, res) => {
  const { employee_id, date, check_in, check_out, status, notes } = req.body;
  const r = await db.query(
    `INSERT INTO attendance (tenant_id,employee_id,date,check_in,check_out,status,notes,source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'manual')
     ON CONFLICT (tenant_id,employee_id,date)
     DO UPDATE SET check_in=$4, check_out=$5, status=$6, notes=$7
     RETURNING *`,
    [req.tenantId,employee_id,date,check_in,check_out,status||'present',notes]
  );
  res.json({ attendance: r.rows[0] });
});

module.exports.attendanceRouter = attendanceRouter;

// ============================================
// src/routes/leave.js
// ============================================
const leaveRouter = require('express').Router();
leaveRouter.use(authenticate);

leaveRouter.get('/', async (req, res) => {
  const { status } = req.query;
  let q = `SELECT l.*,e.name as employee_name FROM leave_requests l
           JOIN employees e ON e.id=l.employee_id WHERE l.tenant_id=$1`;
  const p = [req.tenantId];
  if (status) { q += ` AND l.status=$2`; p.push(status); }
  q += ' ORDER BY l.created_at DESC';
  const r = await db.query(q, p);
  res.json({ requests: r.rows });
});

leaveRouter.post('/', async (req, res) => {
  const { employee_id, type, start_date, end_date, reason } = req.body;
  const days = Math.ceil((new Date(end_date) - new Date(start_date)) / (1000*60*60*24)) + 1;
  const r = await db.query(
    `INSERT INTO leave_requests (tenant_id,employee_id,type,start_date,end_date,days_count,reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.tenantId,employee_id,type,start_date,end_date,days,reason]
  );
  res.status(201).json({ request: r.rows[0] });
});

leaveRouter.patch('/:id/approve', requireRole('owner','admin','hr','manager'), async (req, res) => {
  await db.query(
    `UPDATE leave_requests SET status='approved', approved_by=$1, approved_at=NOW()
     WHERE id=$2 AND tenant_id=$3`,
    [req.user.id, req.params.id, req.tenantId]
  );
  res.json({ message: 'تمت الموافقة على الإجازة' });
});

leaveRouter.patch('/:id/reject', requireRole('owner','admin','hr','manager'), async (req, res) => {
  await db.query(
    `UPDATE leave_requests SET status='rejected', approved_by=$1, approved_at=NOW(), rejection_reason=$2
     WHERE id=$3 AND tenant_id=$4`,
    [req.user.id, req.body.reason, req.params.id, req.tenantId]
  );
  res.json({ message: 'تم رفض الإجازة' });
});

module.exports.leaveRouter = leaveRouter;

// ============================================
// src/routes/orders.js
// ============================================
const ordersRouter = require('express').Router();
ordersRouter.use(authenticate);

ordersRouter.get('/', async (req, res) => {
  const { status, limit=50, offset=0 } = req.query;
  let q = `SELECT o.*,c.name as customer_name FROM orders o
           LEFT JOIN customers c ON c.id=o.customer_id WHERE o.tenant_id=$1`;
  const p = [req.tenantId];
  if (status) { q += ` AND o.status=$2`; p.push(status); }
  q += ` ORDER BY o.created_at DESC LIMIT $${p.length+1} OFFSET $${p.length+2}`;
  p.push(limit, offset);
  const r = await db.query(q, p);
  res.json({ orders: r.rows });
});

ordersRouter.patch('/:id/status', async (req, res) => {
  const { status, tracking_number, shipping_company } = req.body;
  await db.query(
    `UPDATE orders SET status=$1, tracking_number=$2, shipping_company=$3
     WHERE id=$4 AND tenant_id=$5`,
    [status, tracking_number, shipping_company, req.params.id, req.tenantId]
  );
  res.json({ message: 'تم تحديث حالة الطلب' });
});

module.exports.ordersRouter = ordersRouter;

// ============================================
// src/routes/customers.js
// ============================================
const customersRouter = require('express').Router();
customersRouter.use(authenticate);

customersRouter.get('/', async (req, res) => {
  const { stage, search } = req.query;
  let q = `SELECT * FROM customers WHERE tenant_id=$1`;
  const p = [req.tenantId];
  if (stage) { q += ` AND pipeline_stage=$${p.length+1}`; p.push(stage); }
  if (search) { q += ` AND (name ILIKE $${p.length+1} OR company ILIKE $${p.length+1})`; p.push(`%${search}%`); }
  q += ' ORDER BY created_at DESC';
  const r = await db.query(q, p);
  res.json({ customers: r.rows });
});

customersRouter.post('/', async (req, res) => {
  const { name,company,email,phone,whatsapp,city,pipeline_stage,assigned_to,notes } = req.body;
  if (!name) return res.status(400).json({ error: 'اسم العميل مطلوب' });
  const r = await db.query(
    `INSERT INTO customers (tenant_id,name,company,email,phone,whatsapp,city,pipeline_stage,assigned_to,notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [req.tenantId,name,company,email,phone,whatsapp,city,pipeline_stage||'lead',assigned_to,notes]
  );
  res.status(201).json({ customer: r.rows[0] });
});

customersRouter.patch('/:id/stage', async (req, res) => {
  await db.query(
    'UPDATE customers SET pipeline_stage=$1, last_contact_at=NOW() WHERE id=$2 AND tenant_id=$3',
    [req.body.stage, req.params.id, req.tenantId]
  );
  res.json({ message: 'تم تحديث مرحلة العميل' });
});

module.exports.customersRouter = customersRouter;

// ============================================
// src/routes/products.js
// ============================================
const productsRouter = require('express').Router();
productsRouter.use(authenticate);

productsRouter.get('/', async (req, res) => {
  const { low_stock, category } = req.query;
  let q = `SELECT * FROM products WHERE tenant_id=$1 AND is_active=true`;
  const p = [req.tenantId];
  if (category) { q += ` AND category=$${p.length+1}`; p.push(category); }
  if (low_stock === 'true') { q += ` AND quantity <= min_quantity`; }
  q += ' ORDER BY name';
  const r = await db.query(q, p);
  res.json({ products: r.rows });
});

productsRouter.post('/', requireRole('owner','admin','manager'), async (req, res) => {
  const { name,sku,category,cost_price,selling_price,quantity,min_quantity,auto_reorder } = req.body;
  const r = await db.query(
    `INSERT INTO products (tenant_id,name,sku,category,cost_price,selling_price,quantity,min_quantity,auto_reorder)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [req.tenantId,name,sku,category,cost_price,selling_price,quantity||0,min_quantity||0,auto_reorder||false]
  );
  res.status(201).json({ product: r.rows[0] });
});

productsRouter.patch('/:id/quantity', async (req, res) => {
  const { change, type } = req.body; // change: number, type: 'add'|'subtract'|'set'
  let q;
  if (type === 'add') q = `UPDATE products SET quantity=quantity+$1 WHERE id=$2 AND tenant_id=$3`;
  else if (type === 'subtract') q = `UPDATE products SET quantity=quantity-$1 WHERE id=$2 AND tenant_id=$3`;
  else q = `UPDATE products SET quantity=$1 WHERE id=$2 AND tenant_id=$3`;
  await db.query(q, [change, req.params.id, req.tenantId]);
  res.json({ message: 'تم تحديث الكمية' });
});

module.exports.productsRouter = productsRouter;

// ============================================
// src/routes/notifications.js
// ============================================
const notifRouter = require('express').Router();
notifRouter.use(authenticate);

notifRouter.get('/', async (req, res) => {
  const r = await db.query(
    `SELECT * FROM notifications WHERE user_id=$1 OR tenant_id=$2
     ORDER BY sent_at DESC LIMIT 50`,
    [req.user.id, req.tenantId]
  );
  res.json({ notifications: r.rows });
});

notifRouter.patch('/read-all', async (req, res) => {
  await db.query(
    `UPDATE notifications SET status='read', read_at=NOW()
     WHERE (user_id=$1 OR tenant_id=$2) AND status='unread'`,
    [req.user.id, req.tenantId]
  );
  res.json({ message: 'تم تحديد كل الإشعارات كمقروءة' });
});

notifRouter.patch('/:id/read', async (req, res) => {
  await db.query(
    `UPDATE notifications SET status='read', read_at=NOW() WHERE id=$1`,
    [req.params.id]
  );
  res.json({ message: 'تم' });
});

module.exports.notifRouter = notifRouter;

// ============================================
// src/routes/admin.js (super admin only)
// ============================================
const adminRouter = require('express').Router();
adminRouter.use(authenticate);
adminRouter.use(requireRole('owner'));

adminRouter.get('/stats', async (req, res) => {
  const [tenants, users, wfRuns] = await Promise.all([
    db.query('SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE plan=\'pro\') as pro FROM tenants'),
    db.query('SELECT COUNT(*) as total FROM users'),
    db.query('SELECT COUNT(*) as total FROM workflow_runs WHERE started_at >= date_trunc(\'month\', NOW())'),
  ]);
  res.json({ tenants: tenants.rows[0], users: users.rows[0], runs: wfRuns.rows[0] });
});

module.exports.adminRouter = adminRouter;
