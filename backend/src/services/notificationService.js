// src/services/notificationService.js
const db = require('../config/database');
const axios = require('axios');

const send = async ({ tenantId, userId, type, title, message, channel = 'in_app', referenceType, referenceId, metadata }) => {
  try {
    await db.query(
      `INSERT INTO notifications (tenant_id,user_id,type,title,message,channel,reference_type,reference_id,metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tenantId, userId, type, title, message, channel, referenceType, referenceId, JSON.stringify(metadata||{})]
    );
  } catch (err) {
    console.error('Failed to save notification:', err.message);
  }
};

const sendWhatsapp = async (to, message) => {
  try {
    if (!process.env.WHATSAPP_ACCOUNT_SID) return;
    await axios.post(
      `${process.env.WHATSAPP_API_URL}/Accounts/${process.env.WHATSAPP_ACCOUNT_SID}/Messages.json`,
      new URLSearchParams({ From: process.env.WHATSAPP_FROM, To: `whatsapp:${to}`, Body: message }),
      { auth: { username: process.env.WHATSAPP_ACCOUNT_SID, password: process.env.WHATSAPP_AUTH_TOKEN } }
    );
  } catch (err) {
    console.error('WhatsApp send failed:', err.message);
  }
};

const sendEmail = async ({ to, subject, body }) => {
  // Use nodemailer or any email service
  console.log(`📧 Email to ${to}: ${subject}`);
};

module.exports = { send, sendWhatsapp, sendEmail };
