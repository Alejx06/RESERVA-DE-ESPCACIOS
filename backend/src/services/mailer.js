const nodemailer = require('nodemailer');
const { HttpError } = require('../utils/errors');

function createMailer(config) {
  return {
    async sendVerificationEmail({ email, fullName, code }) {
      if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASSWORD || !config.SMTP_FROM) {
        throw new HttpError(503, 'El correo institucional no está configurado para enviar códigos de verificación', 'EMAIL_NOT_CONFIGURED');
      }
      const transporter = nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: config.SMTP_SECURE,
        auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
      });
      await transporter.sendMail({
        from: config.SMTP_FROM,
        to: email,
        subject: 'Verifica tu cuenta de reservas institucionales',
        text: `Hola ${fullName}. Tu código de verificación es ${code}. Vence en ${config.EMAIL_VERIFICATION_TTL_MINUTES} minutos.`,
        html: `<p>Hola ${escapeHtml(fullName)}.</p><p>Tu código de verificación es:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">${code}</p><p>Vence en ${config.EMAIL_VERIFICATION_TTL_MINUTES} minutos.</p>`,
      });
    },
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

module.exports = { createMailer };
