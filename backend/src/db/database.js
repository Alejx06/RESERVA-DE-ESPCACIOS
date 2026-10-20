const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function openDatabase(dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  const reservationColumns = db.pragma('table_info(reservations)');
  if (!reservationColumns.some((column) => column.name === 'user_id')) {
    db.exec('ALTER TABLE reservations ADD COLUMN user_id INTEGER REFERENCES users(id)');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_reservations_user ON reservations (user_id, date, status)');
  return db;
}

module.exports = { openDatabase };
