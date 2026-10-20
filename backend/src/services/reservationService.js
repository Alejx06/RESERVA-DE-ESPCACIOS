const { HttpError } = require('../utils/errors');
const { isValidDate, daysBetween, nowInfo, hh } = require('../utils/time');
const { toReservation } = require('./mappers');

function createReservationService({ db, config, clock }) {
  const BASE_SELECT = `
    SELECT r.*, s.name AS space_name, s.type AS space_type
    FROM reservations r
    JOIN spaces s ON s.id = r.space_id
  `;

  function validateCreate(input, user) {
    const spaceId = Number(input.spaceId);
    if (!Number.isInteger(spaceId) || spaceId < 1) throw new HttpError(400, 'spaceId es obligatorio y debe ser un número válido', 'VALIDATION');

    if (!isValidDate(input.date)) throw new HttpError(400, 'La fecha es obligatoria y debe tener formato YYYY-MM-DD', 'VALIDATION');

    const startHour = Number(input.startHour);
    const endHour = Number(input.endHour);
    if (!Number.isInteger(startHour) || !Number.isInteger(endHour)) {
      throw new HttpError(400, 'startHour y endHour son obligatorios y deben ser horas enteras (ej. 8 y 10)', 'VALIDATION');
    }
    if (startHour < config.OPEN_HOUR || endHour > config.CLOSE_HOUR || endHour <= startHour) {
      throw new HttpError(400, `El horario debe estar entre ${hh(config.OPEN_HOUR)} y ${hh(config.CLOSE_HOUR)}, con una hora de fin posterior al inicio`, 'VALIDATION');
    }
    if (endHour - startHour > config.MAX_HOURS_PER_RESERVATION) {
      throw new HttpError(400, `Una reserva no puede superar ${config.MAX_HOURS_PER_RESERVATION} horas`, 'VALIDATION');
    }

    const responsibleName = user.fullName;
    const role = user.role;
    let purpose = typeof input.purpose === 'string' ? input.purpose.trim() : '';
    if (purpose.length > 200) throw new HttpError(400, 'El motivo no puede superar 200 caracteres', 'VALIDATION');
    if (!purpose) purpose = 'Sin especificar';

    return { spaceId, date: input.date, startHour, endHour, responsibleName, role, purpose };
  }

  function assertOwner(row, user) {
    if (user.role !== 'Administrativo' && row.user_id !== user.id) {
      throw new HttpError(403, 'Solo puedes consultar o modificar tus propias reservas', 'FORBIDDEN');
    }
  }

  function getById(id, user) {
    const now = nowInfo(clock(), config);
    const row = db.prepare(`${BASE_SELECT} WHERE r.id = ?`).get(id);
    if (!row) throw new HttpError(404, 'La reserva no existe', 'NOT_FOUND');
    if (user) assertOwner(row, user);
    return toReservation(row, now);
  }

  function validateDateLimits(data, now) {
    if (!config.ALLOW_PAST && (data.date < now.date || (data.date === now.date && data.startHour < now.hour))) {
      throw new HttpError(422, 'No se pueden crear reservas en una fecha u hora que ya pasó', 'PAST_SLOT');
    }
    if (daysBetween(now.date, data.date) > config.MAX_DAYS_AHEAD) {
      throw new HttpError(422, `Solo se puede reservar con hasta ${config.MAX_DAYS_AHEAD} días de anticipación`, 'TOO_FAR');
    }
  }

  function create(input, user) {
    const data = validateCreate(input, user);
    const now = nowInfo(clock(), config);

    const space = db.prepare('SELECT * FROM spaces WHERE id = ? AND active = 1').get(data.spaceId);
    if (!space) throw new HttpError(404, 'El espacio no existe o no está disponible', 'NOT_FOUND');
    validateDateLimits(data, now);

    // La comprobación de conflicto y el INSERT van en una sola transacción (atómico).
    const run = db.transaction(() => {
      const conflict = db
        .prepare(`
          SELECT * FROM reservations
          WHERE space_id = ? AND date = ? AND status = 'activa'
            AND start_hour < ? AND end_hour > ?
          LIMIT 1
        `)
        .get(data.spaceId, data.date, data.endHour, data.startHour);
      if (conflict) {
        throw new HttpError(
          409,
          `${space.name} ya está reservado de ${hh(conflict.start_hour)} a ${hh(conflict.end_hour)} por ${conflict.responsible_name}`,
          'CONFLICT'
        );
      }
      return db
        .prepare(`
          INSERT INTO reservations (space_id, user_id, date, start_hour, end_hour, responsible_name, role, purpose, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'activa', ?)
        `)
        .run(data.spaceId, user.id, data.date, data.startHour, data.endHour, data.responsibleName, data.role, data.purpose, clock().toISOString())
        .lastInsertRowid;
    });

    return getById(run(), user);
  }

  function update(id, input, user) {
    const currentRow = db.prepare(`${BASE_SELECT} WHERE r.id = ?`).get(id);
    if (!currentRow) throw new HttpError(404, 'La reserva no existe', 'NOT_FOUND');
    assertOwner(currentRow, user);
    const current = toReservation(currentRow, nowInfo(clock(), config));
    if (current.status !== 'activa') throw new HttpError(409, 'No se puede modificar una reserva cancelada', 'ALREADY_CANCELLED');
    if (!config.ALLOW_PAST && current.finished) throw new HttpError(409, 'No se puede modificar una reserva que ya finalizó', 'FINISHED');
    if (!input || !['spaceId', 'date', 'startHour', 'endHour', 'purpose'].some((key) => input[key] !== undefined)) {
      throw new HttpError(400, 'No se enviaron campos para actualizar', 'VALIDATION');
    }

    const data = validateCreate({
      spaceId: input.spaceId === undefined ? current.spaceId : input.spaceId,
      date: input.date === undefined ? current.date : input.date,
      startHour: input.startHour === undefined ? current.startHour : input.startHour,
      endHour: input.endHour === undefined ? current.endHour : input.endHour,
      purpose: input.purpose === undefined ? current.purpose : input.purpose,
    }, user);
    const now = nowInfo(clock(), config);
    validateDateLimits(data, now);
    const space = db.prepare('SELECT * FROM spaces WHERE id = ? AND active = 1').get(data.spaceId);
    if (!space) throw new HttpError(404, 'El espacio no existe o no está disponible', 'NOT_FOUND');

    const run = db.transaction(() => {
      const conflict = db.prepare(`
        SELECT * FROM reservations
        WHERE space_id = ? AND date = ? AND status = 'activa' AND id != ?
          AND start_hour < ? AND end_hour > ?
        LIMIT 1
      `).get(data.spaceId, data.date, id, data.endHour, data.startHour);
      if (conflict) {
        throw new HttpError(
          409,
          `${space.name} ya está reservado de ${hh(conflict.start_hour)} a ${hh(conflict.end_hour)} por ${conflict.responsible_name}`,
          'CONFLICT'
        );
      }
      db.prepare(`
        UPDATE reservations
        SET space_id = ?, date = ?, start_hour = ?, end_hour = ?, purpose = ?
        WHERE id = ? AND status = 'activa'
      `).run(data.spaceId, data.date, data.startHour, data.endHour, data.purpose, id);
    });
    run();
    return getById(id, user);
  }

  // Cancelación lógica: la reserva se conserva en el historial con estado "cancelada" (trazabilidad).
  function cancel(id, user) {
    const reservation = getById(id, user);
    if (reservation.status === 'cancelada') throw new HttpError(409, 'La reserva ya estaba cancelada', 'ALREADY_CANCELLED');
    if (!config.ALLOW_PAST && reservation.finished) {
      throw new HttpError(409, 'No se puede liberar una reserva que ya finalizó', 'FINISHED');
    }
    db.prepare("UPDATE reservations SET status = 'cancelada', cancelled_at = ? WHERE id = ?").run(clock().toISOString(), id);
    return getById(id, user);
  }

  function list({ date, spaceId, responsible, includeCancelled, limit, user } = {}) {
    const now = nowInfo(clock(), config);
    let sql = `${BASE_SELECT} WHERE 1=1`;
    const params = [];
    if (user && user.role !== 'Administrativo') {
      sql += ' AND r.user_id = ?';
      params.push(user.id);
    }

    if (date !== undefined) {
      if (!isValidDate(date)) throw new HttpError(400, 'La fecha debe tener formato YYYY-MM-DD', 'VALIDATION');
      sql += ' AND r.date = ?';
      params.push(date);
    }
    if (spaceId !== undefined) {
      const sid = Number(spaceId);
      if (!Number.isInteger(sid)) throw new HttpError(400, 'spaceId debe ser un número', 'VALIDATION');
      sql += ' AND r.space_id = ?';
      params.push(sid);
    }
    if (responsible) {
      sql += ' AND r.responsible_name LIKE ?';
      params.push(`%${String(responsible).trim()}%`);
    }
    if (!includeCancelled) sql += " AND r.status = 'activa'";

    sql += ' ORDER BY r.date, r.start_hour, s.name LIMIT ?';
    const max = Math.min(Math.max(parseInt(limit, 10) || 500, 1), 1000);
    params.push(max);

    return db.prepare(sql).all(...params).map((r) => toReservation(r, now));
  }

  return { create, update, cancel, list, getById };
}

module.exports = { createReservationService };
