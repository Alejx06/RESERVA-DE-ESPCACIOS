const { nowInfo } = require('../utils/time');

function createStatsService({ db, config, clock }) {
  // Resumen "ahora mismo" para el panel principal.
  async function getStats() {
    const now = nowInfo(clock(), config);

    const spaces = await db.all('SELECT id, type FROM spaces WHERE active = 1');
    const byType = { salon: 0, laboratorio: 0, sala: 0 };
    spaces.forEach((s) => { byType[s.type] += 1; });

    let occupiedNow = 0;
    if (now.isOpen) {
      const row = await db.get(
        `SELECT COUNT(DISTINCT r.space_id) AS n
         FROM reservations r JOIN spaces s ON s.id = r.space_id AND s.active = 1
         WHERE r.date = ? AND r.status = 'activa' AND r.start_hour <= ? AND r.end_hour > ?`,
        [now.date, now.hour, now.hour]
      );
      occupiedNow = Number(row.n);
    }

    const today = await db.get(
      "SELECT COUNT(*) AS n FROM reservations WHERE date = ? AND status = 'activa'",
      [now.date]
    );

    const top = await db.all(
      `SELECT s.name AS name, COUNT(*) AS reservations, SUM(r.end_hour - r.start_hour) AS hours
       FROM reservations r JOIN spaces s ON s.id = r.space_id
       WHERE r.status = 'activa' AND s.active = 1
       GROUP BY s.id, s.name ORDER BY hours DESC, s.name LIMIT 5`
    );

    return {
      now,
      openHour: config.OPEN_HOUR,
      closeHour: config.CLOSE_HOUR,
      totalSpaces: spaces.length,
      byType,
      occupiedNow,
      availableNow: now.isOpen ? spaces.length - occupiedNow : 0,
      reservationsToday: Number(today.n),
      // SUM() en MySQL llega como texto: se convierte a número
      topSpaces: top.map((t) => ({ name: t.name, reservations: Number(t.reservations), hours: Number(t.hours) })),
    };
  }

  return { getStats };
}

module.exports = { createStatsService };
