const nodemailer = require('nodemailer');
const { HttpError } = require('../utils/errors');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

// Envío de correos por SMTP (con Gmail: smtp.gmail.com, puerto 587 y una contraseña de aplicación).
function createMailer(config) {
  let transporter = null;

  const isConfigured = () => Boolean(config.SMTP_HOST && config.SMTP_USER && config.SMTP_PASSWORD && config.SMTP_FROM);

  function getTransporter() {
    if (!transporter) {
      transporter = nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: config.SMTP_SECURE,
        auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 20000,
      });
    }
    return transporter;
  }

  async function sendMail({ to, subject, text, html }) {
    if (!isConfigured()) {
      if (config.MAIL_SIMULATE) {
        console.log(`\n[correo simulado]\n  Para   : ${to}\n  Asunto : ${subject}\n  ${String(text).split('\n').join('\n  ')}\n`);
        return { status: 'simulado' };
      }
      throw new HttpError(503, 'El correo institucional no está configurado para enviar mensajes', 'EMAIL_NOT_CONFIGURED');
    }
    await getTransporter().sendMail({ from: config.SMTP_FROM, to, subject, text, html });
    return { status: 'enviado' };
  }

  return { isConfigured, sendMail };
}

module.exports = { createMailer, escapeHtml };
