const config = require('../config');
const { openDatabase } = require('./database');
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
];

function seed(db, clock = () => new Date()) {
  const insertSpace = db.prepare('INSERT INTO spaces (name, type, capacity, location) VALUES (?, ?, ?, ?)');
  const insertRes = db.prepare(`
    INSERT INTO reservations (space_id, date, start_hour, end_hour, responsible_name, role, purpose, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'activa', ?)
  `);
  const now = clock();
  const run = db.transaction(() => {
    SPACES.forEach((s) => insertSpace.run(...s));
    RESERVATIONS.forEach(([spaceName, offset, start, end, who, role, purpose]) => {
      const space = db.prepare('SELECT id FROM spaces WHERE name = ?').get(spaceName);
      insertRes.run(space.id, formatDate(addDays(now, offset)), start, end, who, role, purpose, now.toISOString());
    });
  });
  run();
}

function seedIfEmpty(db, clock, { includeDemoData = true } = {}) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM spaces').get();
  if (n === 0 && includeDemoData) {
    seed(db, clock);
    return true;
  }
  return false;
}

function resetAndSeed(db, clock) {
  db.exec("DELETE FROM reservations; DELETE FROM spaces; DELETE FROM sqlite_sequence;");
  seed(db, clock);
}

module.exports = { seed, seedIfEmpty, resetAndSeed };

// Uso por consola: npm run seed  (borra los datos y los vuelve a cargar con fechas relativas a HOY)
if (require.main === module) {
  if (config.NODE_ENV === 'production') {
    throw new Error('No ejecutes el seed de demostración en producción; elimina reservas y espacios.');
  }
  const db = openDatabase(config.DB_PATH);
  resetAndSeed(db);
  console.log(`Base de datos reiniciada con datos de ejemplo: ${config.DB_PATH}`);
  db.close();
}
