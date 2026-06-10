// src/jobs/scheduler.js
// ============================================
// جدولة سير العمل التلقائية
// ============================================
const cron = require('node-cron');
const db = require('../config/database');
const workflowEngine = require('../services/workflowEngine');

console.log('⏰ بدء خدمة الجدولة...');

// ===== تشغيل سير العمل المجدولة =====
// Every minute - check scheduled workflows
cron.schedule('* * * * *', async () => {
  try {
    const result = await db.query(
      `SELECT * FROM workflows
       WHERE status = 'active'
         AND trigger_type = 'schedule'
         AND (last_run_at IS NULL OR last_run_at < NOW() - (trigger_config->>'interval_minutes')::int * INTERVAL '1 minute')`,
    );

    for (const workflow of result.rows) {
      try {
        await workflowEngine.run(workflow.id, {}, 'schedule');
        console.log(`✅ تم تشغيل: ${workflow.name}`);
      } catch (err) {
        console.error(`❌ فشل تشغيل ${workflow.name}:`, err.message);
      }
    }
  } catch (err) {
    console.error('خطأ في جدولة سير العمل:', err.message);
  }
});

// ===== إعادة تصفير عداد العمليات الشهرية =====
// First day of every month at midnight
cron.schedule('0 0 1 * *', async () => {
  try {
    await db.query('UPDATE tenants SET monthly_operations_used = 0');
    console.log('🔄 تم إعادة تصفير عداد العمليات الشهرية');
  } catch (err) {
    console.error('خطأ في إعادة التصفير:', err.message);
  }
});

// ===== تنبيه انتهاء اشتراك الشركات =====
// Daily at 9 AM
cron.schedule('0 9 * * *', async () => {
  try {
    const expiring = await db.query(
      `SELECT id, name, email, plan_expires_at
       FROM tenants
       WHERE plan_expires_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'
         AND is_active = true`
    );

    for (const tenant of expiring.rows) {
      const daysLeft = Math.ceil((new Date(tenant.plan_expires_at) - new Date()) / (1000 * 60 * 60 * 24));
      console.log(`⚠️ اشتراك ${tenant.name} ينتهي خلال ${daysLeft} أيام`);
      // TODO: Send renewal email
    }
  } catch (err) {
    console.error('خطأ في فحص الاشتراكات:', err.message);
  }
});

// ===== تنبيه انخفاض المخزون =====
// Every 6 hours
cron.schedule('0 */6 * * *', async () => {
  try {
    const lowStock = await db.query(
      `SELECT p.*, t.id as tenant_id
       FROM products p
       JOIN tenants t ON t.id = p.tenant_id
       WHERE p.quantity <= p.min_quantity
         AND p.is_active = true
         AND p.min_quantity > 0`
    );

    // Group by tenant
    const byTenant = {};
    for (const product of lowStock.rows) {
      if (!byTenant[product.tenant_id]) byTenant[product.tenant_id] = [];
      byTenant[product.tenant_id].push(product);
    }

    // Trigger inventory workflows for each tenant
    for (const [tenantId, products] of Object.entries(byTenant)) {
      const workflows = await db.query(
        `SELECT id FROM workflows
         WHERE tenant_id = $1 AND status = 'active'
           AND trigger_type = 'event'
           AND trigger_config->>'event' = 'low_stock'`,
        [tenantId]
      );

      for (const wf of workflows.rows) {
        await workflowEngine.run(wf.id, { low_stock_products: products }, 'schedule');
      }
    }
  } catch (err) {
    console.error('خطأ في فحص المخزون:', err.message);
  }
});

// ===== تذكير متابعة العملاء (CRM) =====
// Daily at 8 AM
cron.schedule('0 8 * * *', async () => {
  try {
    const staleCustomers = await db.query(
      `SELECT c.*, t.id as tenant_id
       FROM customers c
       JOIN tenants t ON t.id = c.tenant_id
       WHERE c.last_contact_at < NOW() - INTERVAL '7 days'
         AND c.pipeline_stage NOT IN ('won','lost')`
    );

    const byTenant = {};
    for (const c of staleCustomers.rows) {
      if (!byTenant[c.tenant_id]) byTenant[c.tenant_id] = [];
      byTenant[c.tenant_id].push(c);
    }

    for (const [tenantId, customers] of Object.entries(byTenant)) {
      const workflows = await db.query(
        `SELECT id FROM workflows
         WHERE tenant_id = $1 AND status = 'active'
           AND trigger_type = 'event'
           AND trigger_config->>'event' = 'customer_followup'`,
        [tenantId]
      );

      for (const wf of workflows.rows) {
        await workflowEngine.run(wf.id, { stale_customers: customers }, 'schedule');
      }
    }
  } catch (err) {
    console.error('خطأ في تذكير العملاء:', err.message);
  }
});

module.exports = {};
