const { HttpError } = require('../utils/errors');
const { escapeHtml } = require('./mailer');
const { formatDate, addDays, longDateEs, hh } = require('../utils/time');

const SUBJECTS = {
  confirmacion: (r) => `Reserva confirmada: ${r.space_name}`,
  modificacion: (r) => `Reserva modificada: ${r.space_name}`,
  cancelacion: (r) => `Reserva cancelada: ${r.space_name}`,
  recordatorio: (r) => `Recordatorio: ${r.space_name} hoy a las ${hh(r.start_hour)}`,
};

const HEADLINES = {
  confirmacion: 'Tu reserva fue confirmada',
  modificacion: 'Tu reserva fue modificada',
  cancelacion: 'Tu reserva fue cancelada',
  recordatorio: 'Tu reserva comienza pronto',
};

function buildEmail(type, row, config) {
  const when = `${longDateEs(row.date)}, de ${hh(row.start_hour)} a ${hh(row.end_hour)}`;
  const place = row.space_location ? `${row.space_name} (${row.space_location})` : row.space_name;
  const subject = SUBJECTS[type](row);
  const lines = [
    `Hola ${row.full_name},`,
    '',
    `${HEADLINES[type]}.`,
    '',
    `Espacio : ${place}`,
    `Fecha   : ${when}`,
    `Motivo  : ${row.purpose}`,
    '',
    `Puedes gestionar tus reservas en ${config.APP_URL}`,
    `— ${config.APP_NAME}`,
  ];
  const cell = (label, value) => `<tr><td style="padding:6px 14px 6px 0;color:#6b7280">${label}</td><td style="padding:6px 0"><strong>${escapeHtml(value)}</strong></td></tr>`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto;color:#1c2530">
  <div style="background:#1c2530;color:#f5f2ea;padding:16px 20px;border-bottom:4px solid #a97d3d"><strong>${escapeHtml(config.APP_NAME)}</strong></div>
  <div style="padding:20px">
    <p>Hola ${escapeHtml(row.full_name)},</p>
    <p style="font-size:18px"><strong>${HEADLINES[type]}.</strong></p>
    <table style="border-collapse:collapse">${cell('Espacio', place)}${cell('Fecha', when)}${cell('Motivo', row.purpose)}</table>
    <p style="margin-top:20px"><a href="${escapeHtml(config.APP_URL)}" style="color:#7e5e2c">Gestionar mis reservas</a></p>
  </div></div>`;
  return { subject, text: lines.join('\n'), html };
}

// Correos de confirmación, cambios, cancelación y recordatorios, con bitácora en la tabla "notifications".
function createNotificationService({ db, config, clock, mailer }) {
  const pending = new Set();
  let timer = null;

  async function log({ reservationId, userId, type, recipient, subject, status, error }) {
    await db.run(
      `INSERT INTO notifications (reservation_id, user_id, type, recipient, subject, status, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [reservationId, userId, type, recipient, subject.slice(0, 200), status, error ? String(error).slice(0, 255) : null, clock().toISOString()]
    );
  }

  const loadRow = (id) => db.get(
    `SELECT r.*, s.name AS space_name, s.location AS space_location, u.email, u.full_name
     FROM reservations r
     JOIN spaces s ON s.id = r.space_id
     JOIN users u ON u.id = r.user_id
     WHERE r.id = ?`,
    [id]
  );

  async function deliver(type, row) {
    const { subject, text, html } = buildEmail(type, row, config);
    const base = { reservationId: row.id, userId: row.user_id, type, recipient: row.email, subject };
    try {
      const result = await mailer.sendMail({ to: row.email, subject, text, html });
      await log({ ...base, status: result.status });
      return result.status;
    } catch (error) {
      const notConfigured = error instanceof HttpError && error.code === 'EMAIL_NOT_CONFIGURED';
      await log({ ...base, status: notConfigured ? 'omitido' : 'fallido', error: notConfigured ? 'SMTP no configurado' : error.message });
      if (!notConfigured) console.error(`No se pudo enviar el correo (${type}) a ${row.email}:`, error.message);
      return notConfigured ? 'omitido' : 'fallido';
    }
  }

  // Se ejecuta en segundo plano: la reserva no espera al servidor de correo.
  function reservationEvent(type, reservationId) {
    if (!config.NOTIFICATIONS_ENABLED) return null;
    const task = (async () => {
      const row = await loadRow(reservationId); // las reservas sin cuenta asociada (datos de ejemplo) no generan correo
      if (row) await deliver(type, row);
    })()
      .catch((error) => console.error('Error al procesar la notificación:', error.message))
      .finally(() => pending.delete(task));
    pending.add(task);
    return task;
  }

  const flush = () => Promise.allSettled([...pending]);

  async function sendDueReminders() {
    if (!config.NOTIFICATIONS_ENABLED) return 0;
    const now = clock();
    const rows = await db.all(
      `SELECT r.*, s.name AS space_name, s.location AS space_location, u.email, u.full_name
       FROM reservations r
       JOIN spaces s ON s.id = r.space_id
       JOIN users u ON u.id = r.user_id
       WHERE r.status = 'activa' AND r.reminder_sent_at IS NULL AND r.date IN (?, ?)`,
      [formatDate(now), formatDate(addDays(now, 1))]
    );
    let sent = 0;
    for (const row of rows) {
      const [y, m, d] = row.date.split('-').map(Number);
      const minutes = (new Date(y, m - 1, d, row.start_hour).getTime() - now.getTime()) / 60000;
      if (minutes <= 0 || minutes > config.REMINDER_MINUTES_BEFORE) continue;
      // Se "reclama" el recordatorio antes de enviarlo para que nunca se mande dos veces.
      const claim = await db.run(
        "UPDATE reservations SET reminder_sent_at = ? WHERE id = ? AND reminder_sent_at IS NULL AND status = 'activa'",
        [now.toISOString(), row.id]
      );
      if (claim.affectedRows === 1) {
        await deliver('recordatorio', row);
        sent += 1;
      }
    }
    return sent;
  }

  function start() {
    if (timer || !config.NOTIFICATIONS_ENABLED) return;
    const tick = () => sendDueReminders().catch((error) => console.error('Error en recordatorios:', error.message));
    tick();
    timer = setInterval(tick, config.REMINDER_CHECK_SECONDS * 1000);
    timer.unref();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  async function list(limit = 50) {
    const rows = await db.all(
      'SELECT id, reservation_id, type, recipient, subject, status, error, created_at FROM notifications ORDER BY id DESC LIMIT ?',
      [Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200)]
    );
    return rows.map((n) => ({
      id: n.id, reservationId: n.reservation_id, type: n.type, recipient: n.recipient,
      subject: n.subject, status: n.status, error: n.error, createdAt: n.created_at,
    }));
  }

  return { reservationEvent, flush, sendDueReminders, start, stop, list };
}

module.exports = { createNotificationService, buildEmail };
