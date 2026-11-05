const config = require('../config');
const { createDatabase } = require('./database');
const { formatDate, addDays } = require('../utils/time');

const SPACES = [
  ['Salón 101', 'salon', 35, 'Edificio A · Piso 1'],
  ['Salón 102', 'salon', 40, 'Edificio A · Piso 1'],
  ['Salón 203', 'salon', 30, 'Edificio A · Piso 2'],
  ['Laboratorio de Química', 'laboratorio', 24, 'Edificio B · Piso 1'],
  ['Laboratorio de Cómputo', 'laboratorio', 28, 'Edificio B · Piso 2'],
  ['Laboratorio de Física', 'laboratorio', 20, 'Edificio B · Piso 1'],
  ['Sala de Juntas A', 'sala', 10, 'Edificio C · Piso 3'],
  ['Sala de Profesores', 'sala', 14, 'Edificio C · Piso 2'],
  ['Sala de Reuniones B', 'sala', 8, 'Edificio C · Piso 3'],
];

// [espacio, díasDesdeHoy, horaInicio, horaFin, responsable, rol, motivo]
const RESERVATIONS = [
  ['Salón 101', 0, 8, 10, 'Ana Gómez', 'Profesor', 'Cálculo I'],
  ['Laboratorio de Cómputo', 0, 10, 12, 'Carlos Ruiz', 'Profesor', 'Programación II'],
  ['Sala de Juntas A', 0, 11, 12, 'Coordinación Académica', 'Administrativo', 'Reunión de coordinación'],
  ['Laboratorio de Química', 0, 9, 11, 'María Torres', 'Profesor', 'Práctica de titulación'],
  ['Salón 203', 0, 14, 16, 'Laura Méndez', 'Profesor', 'Física General'],
  ['Sala de Reuniones B', 0, 15, 16, 'Juan Pérez', 'Estudiante', 'Reunión de grupo de tesis'],
  ['Salón 102', 1, 8, 10, 'Pedro Salazar', 'Profesor', 'Álgebra Lineal'],
  ['Laboratorio de Física', 1, 13, 15, 'María Torres', 'Profesor', 'Laboratorio de Mecánica'],
  ['Salón 101', -3, 8, 10, 'Ana Gómez', 'Profesor', 'Cálculo I'],
  ['Laboratorio de Cómputo', -3, 14, 16, 'Carlos Ruiz', 'Profesor', 'Programación II'],
  ['Salón 203', -5, 10, 12, 'Laura Méndez', 'Profesor', 'Física General'],
  ['Sala de Juntas A', -7, 9, 10, 'Coordinación Académica', 'Administrativo', 'Reunión de coordinación'],
];

// Historial de demostración: bloques de 2 horas repartidos por los últimos 14 días y los próximos 3,
// generados con una secuencia fija para que siempre se vean igual (sin choques de horario).
const PEOPLE = [
  ['Ana Gómez', 'Profesor'], ['Carlos Ruiz', 'Profesor'], ['María Torres', 'Profesor'], ['Laura Méndez', 'Profesor'],
  ['Pedro Salazar', 'Profesor'], ['Juan Pérez', 'Estudiante'], ['Camila Rojas', 'Estudiante'], ['Coordinación Académica', 'Administrativo'],
];
const PURPOSES = {
  salon: ['Clase magistral', 'Taller de refuerzo', 'Asesoría grupal', 'Examen parcial'],
  laboratorio: ['Práctica de laboratorio', 'Práctica de programación', 'Taller experimental'],
  sala: ['Reunión de coordinación', 'Reunión de grupo de tesis', 'Comité de área'],
};

function demoHistory(now) {
  let state = 20261029;
  const next = () => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296; };
  const rows = [];
  for (let offset = -14; offset <= 3; offset++) {
    const day = addDays(now, offset);
    if (day.getDay() === 0) continue; // sin domingos
    SPACES.forEach(([name, type]) => {
      [[8, 10], [10, 12], [14, 16], [16, 18]].forEach(([start, end]) => {
        if (next() > 0.42) return;
        const [who, role] = PEOPLE[Math.floor(next() * PEOPLE.length)];
        const list = PURPOSES[type];
        const cancelled = offset < 0 && next() < 0.08;
        rows.push([name, offset, start, end, who, role, list[Math.floor(next() * list.length)], cancelled ? 'cancelada' : 'activa']);
      });
    });
  }
  return rows;
}

async function seed(db, clock = () => new Date()) {
  const now = clock();
  await db.transaction(async (tx) => {
    const ids = {};
    for (const [name, type, capacity, location] of SPACES) {
      const res = await tx.run('INSERT INTO spaces (name, type, capacity, location) VALUES (?, ?, ?, ?)', [name, type, capacity, location]);
      ids[name] = res.insertId;
    }
    // Primero las reservas fijas de ejemplo; luego el historial, omitiendo cualquier bloque que choque con ellas.
    const taken = new Set();
    const key = (space, offset, h) => `${space}|${offset}|${h}`;
    const all = [...RESERVATIONS.map((r) => [...r, 'activa']), ...demoHistory(now)];
    for (const [spaceName, offset, start, end, who, role, purpose, status] of all) {
      const hours = Array.from({ length: end - start }, (_, i) => key(spaceName, offset, start + i));
      if (status === 'activa' && hours.some((h) => taken.has(h))) continue;
      if (status === 'activa') hours.forEach((h) => taken.add(h));
      await tx.run(
        `INSERT INTO reservations (space_id, date, start_hour, end_hour, responsible_name, role, purpose, status, created_at, cancelled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ids[spaceName], formatDate(addDays(now, offset)), start, end, who, role, purpose, status, now.toISOString(), status === 'cancelada' ? now.toISOString() : null]
      );
    }
  });
}

async function seedIfEmpty(db, clock, { includeDemoData = true } = {}) {
  const { n } = await db.get('SELECT COUNT(*) AS n FROM spaces');
  if (n === 0 && includeDemoData) {
    await seed(db, clock);
    return true;
  }
  return false;
}

async function resetAndSeed(db, clock) {
  await db.run('DELETE FROM notifications');
  await db.run('DELETE FROM reservations');
  await db.run('DELETE FROM spaces');
  await db.run('ALTER TABLE reservations AUTO_INCREMENT = 1');
  await db.run('ALTER TABLE spaces AUTO_INCREMENT = 1');
  await seed(db, clock);
}

module.exports = { seed, seedIfEmpty, resetAndSeed };

// Uso por consola: npm run seed  (borra espacios y reservas y los recarga con fechas relativas a HOY)
// Las cuentas de usuario NO se borran.
if (require.main === module) {
  (async () => {
    if (config.NODE_ENV === 'production') {
      throw new Error('No ejecutes el seed de demostración en producción: borraría espacios y reservas reales.');
    }
    const db = await createDatabase(config.DB);
    await db.initSchema();
    await resetAndSeed(db);
    console.log(`Base de datos "${config.DB.database}" reiniciada con espacios y reservas de ejemplo.`);
    await db.close();
  })().catch((err) => {
    console.error('No se pudo reiniciar la base de datos:', err.message);
    process.exit(1);
  });
}
