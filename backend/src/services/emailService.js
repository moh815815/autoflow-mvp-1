// src/services/emailService.js
const send = async ({ to, subject, body, html }) => {
  // Replace with nodemailer in production
  // const nodemailer = require('nodemailer');
  // const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, ... });
  console.log(`📧 [Email] To: ${to} | Subject: ${subject}`);
};
module.exports = { send };
