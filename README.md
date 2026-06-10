# ⚡ أوتوفلو — منصة الأتمتة للشركات العربية

منصة SaaS عربية كاملة لأتمتة عمليات الشركات — من الطلبات والشحن، إلى الرواتب والموارد البشرية.

---

## 🏗️ هيكل المشروع

```
autoflow/
├── backend/
│   ├── src/
│   │   ├── server.js              # نقطة الدخول الرئيسية
│   │   ├── config/
│   │   │   └── database.js        # اتصال PostgreSQL
│   │   ├── middleware/
│   │   │   └── auth.js            # JWT + صلاحيات + حصة الاستخدام
│   │   ├── routes/
│   │   │   ├── auth.js            # تسجيل / دخول / مستخدم
│   │   │   ├── workflows.js       # سير العمل (CRUD + تشغيل)
│   │   │   ├── integrations.js    # التكاملات والـ API
│   │   │   ├── employees.js       # الموظفون
│   │   │   ├── attendance.js      # الحضور والانصراف
│   │   │   ├── payroll.js         # الرواتب (حساب + صرف)
│   │   │   ├── leave.js           # الإجازات
│   │   │   ├── orders.js          # الطلبات
│   │   │   ├── customers.js       # العملاء / CRM
│   │   │   ├── products.js        # المخزون
│   │   │   ├── invoices.js        # الفواتير
│   │   │   ├── notifications.js   # الإشعارات
│   │   │   ├── reports.js         # التقارير والإحصائيات
│   │   │   ├── webhooks.js        # استقبال أحداث خارجية
│   │   │   └── admin.js           # إدارة المنصة
│   │   ├── services/
│   │   │   ├── workflowEngine.js  # ⚡ محرك تنفيذ سير العمل
│   │   │   ├── integrationService.js  # Aramex, ZATCA, Custom APIs
│   │   │   ├── notificationService.js # WhatsApp, Email, SMS
│   │   │   └── emailService.js
│   │   ├── jobs/
│   │   │   └── scheduler.js       # جدولة سير العمل التلقائية
│   │   └── utils/
│   │       └── schema.sql         # قاعدة البيانات الكاملة
│   ├── .env.example
│   └── package.json
└── frontend/                      # واجهة المستخدم (HTML/React)
```

---

## 🚀 خطوات التشغيل

### 1. المتطلبات
- Node.js 18+
- PostgreSQL 15+
- Redis 7+

### 2. إعداد قاعدة البيانات
```bash
createdb autoflow
psql autoflow < backend/src/utils/schema.sql
```

### 3. إعداد المتغيرات البيئية
```bash
cd backend
cp .env.example .env
# عدّل .env بإضافة بياناتك
```

### 4. تثبيت الحزم وتشغيل الخادم
```bash
cd backend
npm install
npm run dev
```

الخادم يعمل على: `http://localhost:3000`

---

## 🔌 API Endpoints

### المصادقة
| Method | Endpoint | الوصف |
|--------|----------|-------|
| POST | /api/auth/register | إنشاء حساب شركة جديدة |
| POST | /api/auth/login | تسجيل الدخول |
| GET  | /api/auth/me | بيانات المستخدم الحالي |
| PUT  | /api/auth/change-password | تغيير كلمة المرور |

### سير العمل
| Method | Endpoint | الوصف |
|--------|----------|-------|
| GET  | /api/workflows | قائمة سير العمل |
| POST | /api/workflows | إنشاء سير عمل جديد |
| PUT  | /api/workflows/:id | تحديث سير العمل |
| POST | /api/workflows/:id/run | تشغيل يدوي |
| PATCH| /api/workflows/:id/toggle | تفعيل / إيقاف |
| GET  | /api/workflows/:id/runs | سجل التشغيل |
| GET  | /api/workflows/templates/all | القوالب الجاهزة |

### الرواتب
| Method | Endpoint | الوصف |
|--------|----------|-------|
| GET  | /api/payroll | كشف الرواتب |
| POST | /api/payroll/calculate | حساب تلقائي من الحضور |
| POST | /api/payroll/approve | اعتماد الرواتب |
| POST | /api/payroll/distribute | صرف + إشعار الموظفين |

### Webhooks
| Method | Endpoint | الوصف |
|--------|----------|-------|
| POST | /api/webhooks/:slug/:key | تشغيل سير عمل من نظام خارجي |
| POST | /api/webhooks/orders/:slug | استقبال طلبات (Salla/Zid) |
| POST | /api/webhooks/attendance/:slug | استقبال بيانات البصمة |

---

## ⚡ محرك سير العمل — أنواع العقد

| النوع | الوصف |
|-------|-------|
| `trigger` | بداية سير العمل |
| `http_request` | استدعاء API خارجي |
| `integration_call` | تكامل محدد (أرامكس، زاتكا...) |
| `condition` | شرط (if/else) |
| `send_whatsapp` | إرسال رسالة واتساب |
| `send_email` | إرسال بريد إلكتروني |
| `send_sms` | إرسال SMS |
| `delay` | انتظار |
| `set_variable` | تعيين متغير |
| `update_record` | تحديث سجل في قاعدة البيانات |
| `create_record` | إنشاء سجل جديد |
| `loop` | تكرار على قائمة |
| `code` | تنفيذ كود JavaScript |

---

## 🔗 التكاملات المدعومة

- **أرامكس** — إنشاء شحنة، تتبع
- **زاتكا** — الفوترة الإلكترونية
- **واتساب بيزنس** — إشعارات العملاء
- **جهاز البصمة** — حضور وانصراف (Webhook)
- **Salla / Zid** — استقبال الطلبات (Webhook)
- **أي API مخصص** — Basic, Bearer, API Key, OAuth2

---

## 🏢 Multi-tenancy

كل شركة (Tenant) معزولة تماماً — جميع الجداول تحتوي على `tenant_id`.
لا يمكن لشركة الوصول لبيانات شركة أخرى.

---

## 💎 خطط الاشتراك

| الخطة | العمليات/شهر | الحد |
|-------|-------------|------|
| Starter | 500 | 5 سير عمل |
| Pro | 5,000 | 20 سير عمل |
| Enterprise | غير محدود | غير محدود |

---

## 🛠️ التقنيات المستخدمة

- **Backend:** Node.js + Express
- **Database:** PostgreSQL
- **Queue:** Bull + Redis
- **Auth:** JWT + bcrypt
- **Scheduling:** node-cron
- **APIs:** axios

---

## 📋 الخطوات التالية للـ Production

1. إضافة Stripe أو HyperPay للفوترة
2. نشر على AWS / DigitalOcean
3. إضافة SSL (Let's Encrypt)
4. إعداد Redis Cloud
5. بناء Frontend بـ React أو Next.js
6. إضافة WebSockets للإشعارات الفورية
