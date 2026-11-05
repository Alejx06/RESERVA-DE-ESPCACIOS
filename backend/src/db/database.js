const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

// Envuelve un "ejecutor" (el pool o una conexión de transacción) con tres helpers:
//   all -> todas las filas · get -> la primera fila · run -> resultado de INSERT/UPDATE/DELETE
// Los valores se envían como parámetros (?) y el driver los escapa: no se concatena texto del usuario en el SQL.
function wrap(executor) {
  const all = async (sql, params = []) => {
    const [rows] = await executor.query(sql, params);
    return rows;
  };
  const get = async (sql, params = []) => (await all(sql, params))[0];
  const run = async (sql, params = []) => {
    const [result] = await executor.query(sql, params);
    return result;
  };
  return { all, get, run };
}

const sslOption = (cfg) => (cfg.ssl ? { rejectUnauthorized: false } : undefined);

// Intenta crear la base de datos si no existe. Si el usuario no tiene permiso (caso típico en un hosting
// donde la base ya viene creada), se ignora el error y se continúa.
async function ensureDatabase(cfg) {
  if (!/^[A-Za-z0-9_]+$/.test(cfg.database)) {
    throw new Error('DB_NAME solo puede tener letras, números y guion bajo');
  }
  try {
    const conn = await mysql.createConnection({
      host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, ssl: sslOption(cfg),
    });
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${cfg.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await conn.end();
  } catch (_) {
    /* sin permisos para crear la base: se asume que ya existe */
  }
}

async function createDatabase(cfg, { createIfMissing = true } = {}) {
  if (createIfMissing) await ensureDatabase(cfg);

  const pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    ssl: sslOption(cfg),
    charset: 'utf8mb4',
    dateStrings: true, // DATE/DATETIME llegan como texto 'YYYY-MM-DD' y no se desfasan por zona horaria
    waitForConnections: true,
    connectionLimit: 10,
  });

  const db = wrap(pool);

  // Ejecuta varias operaciones como una sola unidad: o se aplican todas o ninguna.
  db.transaction = async (fn) => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(wrap(conn));
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback().catch(() => {});
      throw err;
    } finally {
      conn.release();
    }
  };

  db.initSchema = async () => {
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    const statements = sql
      .split(';')
      .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
      .filter(Boolean);
    for (const statement of statements) await pool.query(statement);
  };

  db.close = () => pool.end();
  return db;
}

module.exports = { createDatabase };
