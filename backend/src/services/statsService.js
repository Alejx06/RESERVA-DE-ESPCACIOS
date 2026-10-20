const { nowInfo } = require('../utils/time');

function createStatsService({ db, config, clock }) {
  // Resumen "ahora mismo" para el panel principal + datos base para reportes (Épica E7).
  function getStats() {
    const now = nowInfo(clock(), config);

    const spaces = db.prepare('SELECT id, type FROM spaces WHERE active = 1').all();
    const byType = { salon: 0, laboratorio: 0, sala: 0 };
    spaces.forEach((s) => { byType[s.type] += 1; });

    const occupiedIds = now.isOpen
      ? db
          .prepare(`
            SELECT DISTINCT space_id FROM reservations
            WHERE date = ? AND status = 'activa' AND start_hour <= ? AND end_hour > ?
          `)
          .all(now.date, now.hour, now.hour)
          .map((r) => r.space_id)
      : [];
    const activeIds = new Set(spaces.map((s) => s.id));
    const occupiedNow = occupiedIds.filter((id) => activeIds.has(id)).length;

    const reservationsToday = db
      .prepare("SELECT COUNT(*) AS n FROM reservations WHERE date = ? AND status = 'activa'")
      .get(now.date).n;

    const topSpaces = db
      .prepare(`
        SELECT s.name AS name, COUNT(*) AS reservations, SUM(r.end_hour - r.start_hour) AS hours
        FROM reservations r JOIN spaces s ON s.id = r.space_id
        WHERE r.status = 'activa' AND s.active = 1
        GROUP BY s.id ORDER BY hours DESC, s.name LIMIT 5
      `)
      .all();

    return {
      now,
      openHour: config.OPEN_HOUR,
      closeHour: config.CLOSE_HOUR,
      totalSpaces: spaces.length,
      byType,
      occupiedNow,
      availableNow: now.isOpen ? spaces.length - occupiedNow : 0,
      reservationsToday,
      topSpaces,
    };
  }

  return { getStats };
}

module.exports = { createStatsService };
