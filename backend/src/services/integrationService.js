// src/services/integrationService.js
const db = require('../config/database');
const axios = require('axios');
const crypto = require('crypto');

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '12345678901234567890123456789012';

// ===== Encrypt/Decrypt credentials =====
const encrypt = (text) => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
};

const decrypt = (text) => {
  const [ivHex, encryptedHex] = text.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  return Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]).toString();
};

// ===== Call integration action =====
const call = async (tenantId, integrationId, action, params) => {
  const result = await db.query(
    'SELECT * FROM integrations WHERE id = $1 AND tenant_id = $2 AND is_active = true',
    [integrationId, tenantId]
  );

  if (!result.rows.length) throw new Error('التكامل غير موجود أو غير نشط');
  const integration = result.rows[0];

  // Decrypt credentials
  let creds = {};
  try {
    creds = JSON.parse(decrypt(integration.credentials));
  } catch {
    creds = integration.credentials;
  }

  switch (integration.type) {
    case 'aramex': return await callAramex(integration, creds, action, params);
    case 'zatca':  return await callZatca(integration, creds, action, params);
    case 'erp':    return await callCustom(integration, creds, action, params);
    case 'custom': return await callCustom(integration, creds, action, params);
    default:       return await callCustom(integration, creds, action, params);
  }
};

// ===== Aramex =====
const callAramex = async (integration, creds, action, params) => {
  const base = integration.base_url || 'https://ws.aramex.net/ShippingAPI.V2';
  switch (action) {
    case 'create_shipment':
      const response = await axios.post(`${base}/Shipping/Service_1_0.svc/json/CreateShipments`, {
        ClientInfo: {
          UserName: creds.username,
          Password: creds.password,
          AccountNumber: creds.account_number,
          AccountPin: creds.account_pin,
          AccountEntity: creds.account_entity || 'RUH',
          Version: 'v1.0',
        },
        Shipments: [params],
        LabelInfo: { ReportID: 9201, ReportType: 'URL' },
      });
      return response.data;

    case 'track_shipment':
      const track = await axios.post(`${base}/Tracking/Service_1_0.svc/json/TrackShipments`, {
        ClientInfo: {
          UserName: creds.username,
          Password: creds.password,
          AccountNumber: creds.account_number,
          Version: 'v1.0',
        },
        Shipments: { ShipmentNumber: { string: [params.tracking_number] } },
      });
      return track.data;

    default:
      throw new Error(`إجراء غير مدعوم لـ Aramex: ${action}`);
  }
};

// ===== ZATCA =====
const callZatca = async (integration, creds, action, params) => {
  const base = integration.base_url || process.env.ZATCA_API_URL;
  switch (action) {
    case 'report_invoice':
      const response = await axios.post(`${base}/invoices/reporting/single`, params, {
        headers: {
          Authorization: `Basic ${creds.token}`,
          'Content-Type': 'application/json',
        }
      });
      return response.data;
    default:
      throw new Error(`إجراء غير مدعوم لـ ZATCA: ${action}`);
  }
};

// ===== Custom API =====
const callCustom = async (integration, creds, action, params) => {
  const actionConfig = integration.metadata?.actions?.[action];
  if (!actionConfig) throw new Error(`الإجراء "${action}" غير موجود في التكامل`);

  const headers = { ...integration.headers };
  if (integration.auth_type === 'api_key') {
    headers[creds.header_name || 'X-API-Key'] = creds.api_key;
  } else if (integration.auth_type === 'bearer') {
    headers['Authorization'] = `Bearer ${creds.token}`;
  } else if (integration.auth_type === 'basic') {
    headers['Authorization'] = `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString('base64')}`;
  }

  const response = await axios({
    method: actionConfig.method || 'POST',
    url: `${integration.base_url}${actionConfig.path}`,
    headers,
    data: params,
    timeout: 30000,
  });
  return response.data;
};

// ===== Test integration connection =====
const test = async (tenantId, integrationId) => {
  const result = await db.query(
    'SELECT * FROM integrations WHERE id = $1 AND tenant_id = $2',
    [integrationId, tenantId]
  );
  if (!result.rows.length) throw new Error('التكامل غير موجود');

  const integration = result.rows[0];
  let status = 'success';
  let error = null;

  try {
    if (integration.metadata?.test_url) {
      await axios.get(integration.metadata.test_url, { timeout: 10000 });
    } else if (integration.base_url) {
      await axios.get(integration.base_url, { timeout: 10000 });
    }
  } catch (err) {
    status = 'failed';
    error = err.message;
  }

  await db.query(
    'UPDATE integrations SET last_tested_at = NOW(), last_test_status = $1 WHERE id = $2',
    [status, integrationId]
  );

  return { status, error };
};

module.exports = { call, encrypt, decrypt, test };
