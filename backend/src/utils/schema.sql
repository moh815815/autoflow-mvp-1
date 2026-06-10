-- ============================================
-- أوتوفلو — قاعدة البيانات الكاملة
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- TENANTS (الشركات)
-- ============================================
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(50),
  country VARCHAR(10) DEFAULT 'SA',
  city VARCHAR(100),
  commercial_registration VARCHAR(100),
  tax_number VARCHAR(100),
  plan VARCHAR(50) DEFAULT 'starter' CHECK (plan IN ('starter','pro','enterprise')),
  plan_expires_at TIMESTAMPTZ,
  monthly_operations_used INTEGER DEFAULT 0,
  monthly_operations_limit INTEGER DEFAULT 500,
  is_active BOOLEAN DEFAULT true,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- USERS (المستخدمون)
-- ============================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'member' CHECK (role IN ('owner','admin','manager','hr','finance','sales','viewer')),
  avatar_url TEXT,
  is_active BOOLEAN DEFAULT true,
  last_login_at TIMESTAMPTZ,
  email_verified_at TIMESTAMPTZ,
  reset_token VARCHAR(255),
  reset_token_expires TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, email)
);

-- ============================================
-- INTEGRATIONS (التكاملات)
-- ============================================
CREATE TABLE integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(100) NOT NULL, -- erp, fingerprint, whatsapp, bank, aramex, zatca, custom
  base_url TEXT,
  auth_type VARCHAR(50) DEFAULT 'api_key' CHECK (auth_type IN ('api_key','oauth2','basic','bearer','none')),
  credentials JSONB DEFAULT '{}', -- encrypted in application layer
  headers JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  last_tested_at TIMESTAMPTZ,
  last_test_status VARCHAR(50),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- WORKFLOWS (سير العمل)
-- ============================================
CREATE TABLE workflows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100), -- sales, hr, finance, inventory, support
  status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft','active','paused','archived')),
  trigger_type VARCHAR(100) NOT NULL, -- webhook, schedule, manual, event
  trigger_config JSONB DEFAULT '{}',
  nodes JSONB DEFAULT '[]', -- array of workflow nodes
  edges JSONB DEFAULT '[]', -- connections between nodes
  version INTEGER DEFAULT 1,
  run_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  last_run_at TIMESTAMPTZ,
  last_run_status VARCHAR(50),
  tags TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- WORKFLOW RUNS (تشغيل سير العمل)
-- ============================================
CREATE TABLE workflow_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  triggered_by VARCHAR(100), -- schedule, webhook, manual, user_id
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending','running','success','error','cancelled')),
  input_data JSONB DEFAULT '{}',
  output_data JSONB DEFAULT '{}',
  error_message TEXT,
  error_node_id VARCHAR(255),
  steps_log JSONB DEFAULT '[]',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- WORKFLOW TEMPLATES (القوالب)
-- ============================================
CREATE TABLE workflow_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  name_ar VARCHAR(255),
  description TEXT,
  description_ar TEXT,
  category VARCHAR(100),
  icon VARCHAR(10),
  nodes JSONB DEFAULT '[]',
  edges JSONB DEFAULT '[]',
  required_integrations TEXT[],
  tags TEXT[],
  use_count INTEGER DEFAULT 0,
  is_featured BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- EMPLOYEES (الموظفون)
-- ============================================
CREATE TABLE employees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_number VARCHAR(100),
  name VARCHAR(255) NOT NULL,
  name_en VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(50),
  department VARCHAR(100),
  position VARCHAR(100),
  manager_id UUID REFERENCES employees(id),
  hire_date DATE,
  birth_date DATE,
  national_id VARCHAR(100),
  iqama_number VARCHAR(100),
  iqama_expiry DATE,
  basic_salary DECIMAL(12,2),
  housing_allowance DECIMAL(12,2) DEFAULT 0,
  transport_allowance DECIMAL(12,2) DEFAULT 0,
  other_allowances DECIMAL(12,2) DEFAULT 0,
  bank_name VARCHAR(100),
  bank_iban VARCHAR(50),
  status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active','on_leave','terminated','suspended')),
  fingerprint_id VARCHAR(100),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- ATTENDANCE (الحضور والانصراف)
-- ============================================
CREATE TABLE attendance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  check_in TIMESTAMPTZ,
  check_out TIMESTAMPTZ,
  hours_worked DECIMAL(5,2),
  overtime_hours DECIMAL(5,2) DEFAULT 0,
  late_minutes INTEGER DEFAULT 0,
  status VARCHAR(50) DEFAULT 'present' CHECK (status IN ('present','absent','late','half_day','holiday','weekend')),
  source VARCHAR(50) DEFAULT 'fingerprint', -- fingerprint, manual, mobile
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, employee_id, date)
);

-- ============================================
-- LEAVE REQUESTS (طلبات الإجازة)
-- ============================================
CREATE TABLE leave_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL CHECK (type IN ('annual','sick','emergency','unpaid','maternity','paternity')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days_count INTEGER,
  reason TEXT,
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  approved_by UUID REFERENCES employees(id),
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- PAYROLL (الرواتب)
-- ============================================
CREATE TABLE payroll (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year INTEGER NOT NULL,
  basic_salary DECIMAL(12,2),
  housing_allowance DECIMAL(12,2) DEFAULT 0,
  transport_allowance DECIMAL(12,2) DEFAULT 0,
  other_allowances DECIMAL(12,2) DEFAULT 0,
  overtime_pay DECIMAL(12,2) DEFAULT 0,
  deductions DECIMAL(12,2) DEFAULT 0,
  gosi_employee DECIMAL(12,2) DEFAULT 0,
  gosi_employer DECIMAL(12,2) DEFAULT 0,
  late_deductions DECIMAL(12,2) DEFAULT 0,
  absence_deductions DECIMAL(12,2) DEFAULT 0,
  gross_salary DECIMAL(12,2),
  net_salary DECIMAL(12,2),
  status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft','approved','paid','cancelled')),
  payment_date DATE,
  payment_reference VARCHAR(255),
  bank_transfer_id VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, employee_id, month, year)
);

-- ============================================
-- CUSTOMERS (العملاء)
-- ============================================
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  company VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(50),
  whatsapp VARCHAR(50),
  city VARCHAR(100),
  country VARCHAR(10) DEFAULT 'SA',
  address TEXT,
  tax_number VARCHAR(100),
  pipeline_stage VARCHAR(100) DEFAULT 'lead' CHECK (pipeline_stage IN ('lead','qualified','proposal','negotiation','won','lost')),
  assigned_to UUID REFERENCES users(id),
  total_value DECIMAL(12,2) DEFAULT 0,
  tags TEXT[],
  notes TEXT,
  last_contact_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- ORDERS (الطلبات)
-- ============================================
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id),
  order_number VARCHAR(100) UNIQUE NOT NULL,
  status VARCHAR(100) DEFAULT 'new' CHECK (status IN ('new','confirmed','processing','shipped','delivered','cancelled','returned')),
  items JSONB DEFAULT '[]',
  subtotal DECIMAL(12,2),
  tax DECIMAL(12,2) DEFAULT 0,
  shipping_fee DECIMAL(12,2) DEFAULT 0,
  discount DECIMAL(12,2) DEFAULT 0,
  total DECIMAL(12,2),
  shipping_address JSONB,
  shipping_company VARCHAR(100),
  tracking_number VARCHAR(255),
  shipping_status VARCHAR(100),
  estimated_delivery DATE,
  notes TEXT,
  workflow_run_id UUID REFERENCES workflow_runs(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- PRODUCTS / INVENTORY (المنتجات)
-- ============================================
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sku VARCHAR(100),
  name VARCHAR(255) NOT NULL,
  name_en VARCHAR(255),
  category VARCHAR(100),
  unit VARCHAR(50) DEFAULT 'piece',
  cost_price DECIMAL(12,2),
  selling_price DECIMAL(12,2),
  quantity INTEGER DEFAULT 0,
  min_quantity INTEGER DEFAULT 0,
  max_quantity INTEGER,
  reorder_quantity INTEGER DEFAULT 0,
  auto_reorder BOOLEAN DEFAULT false,
  supplier_id UUID,
  location VARCHAR(255),
  barcode VARCHAR(255),
  image_url TEXT,
  is_active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, sku)
);

-- ============================================
-- INVOICES (الفواتير)
-- ============================================
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id),
  invoice_number VARCHAR(100) NOT NULL,
  order_id UUID REFERENCES orders(id),
  issue_date DATE DEFAULT CURRENT_DATE,
  due_date DATE,
  items JSONB DEFAULT '[]',
  subtotal DECIMAL(12,2),
  tax_rate DECIMAL(5,2) DEFAULT 15,
  tax_amount DECIMAL(12,2),
  total DECIMAL(12,2),
  paid_amount DECIMAL(12,2) DEFAULT 0,
  status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft','sent','paid','partial','overdue','cancelled')),
  zatca_uuid VARCHAR(255),
  zatca_hash VARCHAR(255),
  zatca_qr TEXT,
  payment_method VARCHAR(100),
  notes TEXT,
  sent_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, invoice_number)
);

-- ============================================
-- NOTIFICATIONS LOG (سجل الإشعارات)
-- ============================================
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  type VARCHAR(100) NOT NULL, -- workflow_error, salary_sent, low_stock, etc.
  title VARCHAR(255) NOT NULL,
  message TEXT,
  channel VARCHAR(50) DEFAULT 'in_app' CHECK (channel IN ('in_app','email','whatsapp','sms')),
  status VARCHAR(50) DEFAULT 'unread' CHECK (status IN ('unread','read','archived')),
  reference_type VARCHAR(100), -- workflow, order, employee, etc.
  reference_id UUID,
  metadata JSONB DEFAULT '{}',
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  read_at TIMESTAMPTZ
);

-- ============================================
-- AUDIT LOG (سجل التدقيق)
-- ============================================
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  action VARCHAR(100) NOT NULL, -- create, update, delete, login, run_workflow
  resource_type VARCHAR(100) NOT NULL,
  resource_id UUID,
  old_values JSONB,
  new_values JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES (للأداء)
-- ============================================
CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_workflows_tenant ON workflows(tenant_id);
CREATE INDEX idx_workflows_status ON workflows(status);
CREATE INDEX idx_workflow_runs_workflow ON workflow_runs(workflow_id);
CREATE INDEX idx_workflow_runs_tenant ON workflow_runs(tenant_id);
CREATE INDEX idx_workflow_runs_status ON workflow_runs(status);
CREATE INDEX idx_attendance_employee_date ON attendance(employee_id, date);
CREATE INDEX idx_attendance_tenant_date ON attendance(tenant_id, date);
CREATE INDEX idx_payroll_tenant_period ON payroll(tenant_id, year, month);
CREATE INDEX idx_orders_tenant ON orders(tenant_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_customers_tenant ON customers(tenant_id);
CREATE INDEX idx_products_tenant ON products(tenant_id);
CREATE INDEX idx_notifications_user ON notifications(user_id, status);
CREATE INDEX idx_audit_logs_tenant ON audit_logs(tenant_id);
CREATE INDEX idx_integrations_tenant ON integrations(tenant_id);

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ language 'plpgsql';

CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_workflows_updated_at BEFORE UPDATE ON workflows FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_employees_updated_at BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_payroll_updated_at BEFORE UPDATE ON payroll FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_leave_requests_updated_at BEFORE UPDATE ON leave_requests FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_integrations_updated_at BEFORE UPDATE ON integrations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
