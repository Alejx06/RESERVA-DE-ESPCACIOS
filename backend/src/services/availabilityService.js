const { HttpError } = require('../utils/errors');
const { isValidDate, nowInfo } = require('../utils/time');
const { toSpace, toReservation } = require('./mappers');

function createAvailabilityService({ db, config, clock }) {
  // Devuelve, para una fecha, cada espacio con sus bloques horarios y el estado de cada uno:
  //   free  -> libre y reservable
  //   busy  -> ocupado por una reserva activa
  //   past  -> libre pero ya pasó (no reservable)
  function getAvailability({ date, type } = {}) {
    const now = nowInfo(clock(), config);
    const day = date === undefined ? now.date : date;
    if (!isValidDate(day)) throw new HttpError(400, 'La fecha debe tener formato YYYY-MM-DD', 'VALIDATION');
    if (type !== undefined && !config.SPACE_TYPES.includes(type)) {
      throw new HttpError(400, `El tipo debe ser uno de: ${config.SPACE_TYPES.join(', ')}`, 'VALIDATION');
    }

    let spaceSql = 'SELECT * FROM spaces WHERE active = 1';
    const params = [];
    if (type) { spaceSql += ' AND type = ?'; params.push(type); }
    spaceSql += " ORDER BY CASE type WHEN 'salon' THEN 1 WHEN 'laboratorio' THEN 2 ELSE 3 END, name";
    const spaces = db.prepare(spaceSql).all(...params);

    const resRows = db
      .prepare(`
        SELECT r.*, s.name AS space_name, s.type AS space_type
        FROM reservations r JOIN spaces s ON s.id = r.space_id
        WHERE r.date = ? AND r.status = 'activa'
      `)
      .all(day);
    const bySpace = new Map();
    resRows.forEach((r) => {
      if (!bySpace.has(r.space_id)) bySpace.set(r.space_id, []);
      bySpace.get(r.space_id).push(toReservation(r, now));
    });

    const isToday = day === now.date;
    const hours = [];
    for (let h = config.OPEN_HOUR; h < config.CLOSE_HOUR; h++) hours.push(h);

    const result = spaces.map((row) => {
      const reservations = bySpace.get(row.id) || [];
      const slots = hours.map((h) => {
        const reservation = reservations.find((r) => h >= r.startHour && h < r.endHour) || null;
        if (reservation) return { hour: h, state: 'busy', reservation };
        const isPast = !config.ALLOW_PAST && (day < now.date || (isToday && h < now.hour));
        return { hour: h, state: isPast ? 'past' : 'free', reservation: null };
      });

      let statusNow = null;
      if (isToday) {
        if (!now.isOpen) statusNow = 'closed';
        else statusNow = slots.find((s) => s.hour === now.hour).state === 'busy' ? 'occupied' : 'available';
      }

      return {
        ...toSpace(row, config),
        statusNow,
        freeHours: slots.filter((s) => s.state === 'free').length,
        slots,
      };
    });

    return {
      date: day,
      now,
      openHour: config.OPEN_HOUR,
      closeHour: config.CLOSE_HOUR,
      maxHours: config.MAX_HOURS_PER_RESERVATION,
      allowPast: config.ALLOW_PAST,
      spaces: result,
    };
  }

  return { getAvailability };
}

module.exports = { createAvailabilityService };
