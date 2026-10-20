const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { openDatabase } = require('../src/db/database');
const { seedIfEmpty } = require('../src/db/seed');
const { createApp } = require('../src/app');
const config = require('../src/config');
const { bootstrapAdmin } = require('../src/services/authService');

// Reloj fijo para que las pruebas sean deterministas: lunes 12-oct-2026, 09:30.
const FIXED_NOW = new Date(2026, 9, 12, 9, 30, 0);
const TODAY = '2026-10-12';
const TOMORROW = '2026-10-13';

let db, server, base, adminCookie, studentCookie, actingCookie, verificationCode;
let salon, lab;

async function api(path, { method = 'GET', body, headers = {}, cookie = actingCookie } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, setCookie: res.headers.get('set-cookie') };
}

const reserve = (over = {}) =>
  api('/api/reservations', {
    method: 'POST',
    body: { spaceId: salon, date: TOMORROW, startHour: 8, endHour: 10, responsibleName: 'Ana Gómez', role: 'Profesor', purpose: 'Cálculo I', ...over },
  });

before(async () => {
  db = openDatabase(':memory:');
  salon = db.prepare("INSERT INTO spaces (name, type, capacity, location) VALUES ('Salón 101','salon',35,'A1')").run().lastInsertRowid;
  lab = db.prepare("INSERT INTO spaces (name, type, capacity, location) VALUES ('Lab Cómputo','laboratorio',28,'B2')").run().lastInsertRowid;
  const testConfig = {
    ...config,
    BOOTSTRAP_ADMIN_EMAIL: 'admin@amigo.edu.co',
    BOOTSTRAP_ADMIN_PASSWORD: 'Admin-Test-Password-123',
    EMAIL_DOMAIN: 'amigo.edu.co',
  };
  await bootstrapAdmin(db, testConfig, () => FIXED_NOW);
  const app = createApp(db, {
    config: testConfig,
    clock: () => FIXED_NOW,
    sendVerificationEmail: async ({ code }) => { verificationCode = code; },
  });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  adminCookie = (await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@amigo.edu.co', password: 'Admin-Test-Password-123' },
    cookie: null,
  })).setCookie.split(';')[0];
  await api('/api/auth/register', {
    method: 'POST',
    body: { fullName: 'Ana Gómez', email: 'ana@amigo.edu.co', password: 'Student-Test-Password-123' },
    cookie: null,
  });
  await api('/api/auth/verify-email', {
    method: 'POST',
    body: { email: 'ana@amigo.edu.co', code: verificationCode },
    cookie: null,
  });
  studentCookie = (await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'ana@amigo.edu.co', password: 'Student-Test-Password-123' },
    cookie: null,
  })).setCookie.split(';')[0];
  actingCookie = studentCookie;
});

after(() => { server.close(); db.close(); });

test('health responde ok', async () => {
  const r = await api('/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'ok');
});

test('protege la API, restringe el registro al dominio institucional y asigna perfiles desde el servidor', async () => {
  assert.equal((await api('/api/auth/options', { cookie: null })).body.emailDomain, 'amigo.edu.co');
  assert.equal((await api('/api/spaces', { cookie: null })).status, 401);
  assert.equal((await api('/api/auth/register', {
    method: 'POST',
    body: { fullName: 'Cuenta Externa', email: 'alguien@gmail.com', password: 'Long-Password-123' },
    cookie: null,
  })).status, 400);
  assert.equal((await api('/api/auth/register', {
    method: 'POST',
    body: { fullName: 'Cuenta Inválida', email: 'student2@amigo.edu.co', password: 'long-password-123', role: 'Administrativo' },
    cookie: null,
  })).status, 202);
  assert.equal((await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'student2@amigo.edu.co', password: 'long-password-123' },
    cookie: null,
  })).status, 401);
  assert.equal((await api('/api/auth/verify-email', {
    method: 'POST',
    body: { email: 'student2@amigo.edu.co', code: '00000000' },
    cookie: null,
  })).status, 400);
  assert.equal((await api('/api/auth/verify-email', {
    method: 'POST',
    body: { email: 'student2@amigo.edu.co', code: verificationCode },
    cookie: null,
  })).status, 200);
  const student2 = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'student2@amigo.edu.co', password: 'long-password-123' },
    cookie: null,
  });
  assert.equal(student2.body.user.role, 'Estudiante');
  assert.equal((await api('/api/spaces', { method: 'POST', body: { name: 'No permitido', type: 'sala', capacity: 8 }, cookie: studentCookie })).status, 403);
  assert.equal((await api('/api/reservations', {
    method: 'POST',
    body: { spaceId: salon, date: TOMORROW, startHour: 15, endHour: 16 },
    headers: { Origin: 'https://attacker.example' },
  })).status, 403);
});

test('solo administrativos pueden crear cuentas de personal y desactivarlas', async () => {
  const staff = {
    fullName: 'Profesor Nuevo',
    email: 'profesor@amigo.edu.co',
    password: 'Teacher-Test-Password-123',
    role: 'Profesor',
  };
  assert.equal((await api('/api/admin/users', { method: 'POST', body: staff, cookie: studentCookie })).status, 403);
  const created = await api('/api/admin/users', { method: 'POST', body: staff, cookie: adminCookie });
  assert.equal(created.status, 201);
  assert.equal(created.body.user.role, 'Profesor');
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { email: staff.email, password: staff.password },
    cookie: null,
  });
  const staffCookie = login.setCookie.split(';')[0];
  assert.equal((await api('/api/auth/me', { cookie: staffCookie })).body.user.role, 'Profesor');
  assert.equal((await api(`/api/admin/users/${created.body.user.id}`, { method: 'DELETE', cookie: adminCookie })).status, 204);
  assert.equal((await api('/api/auth/me', { cookie: staffCookie })).status, 401);
});

test('permite iniciar y cerrar sesión con cookies HttpOnly', async () => {
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'ana@amigo.edu.co', password: 'Student-Test-Password-123' },
    cookie: null,
  });
  assert.equal(login.status, 200);
  assert.match(login.setCookie, /HttpOnly/);
  assert.match(login.setCookie, /SameSite=Strict/);
  const cookie = login.setCookie.split(';')[0];
  assert.equal((await api('/api/auth/me', { cookie })).body.user.email, 'ana@amigo.edu.co');
  assert.equal((await api('/api/auth/logout', { method: 'POST', body: {}, cookie })).status, 204);
  assert.equal((await api('/api/auth/me', { cookie })).status, 401);
});

test('lista espacios y filtra por tipo', async () => {
  const all = await api('/api/spaces');
  assert.equal(all.body.length, 2);
  const labs = await api('/api/spaces?type=laboratorio');
  assert.equal(labs.body.length, 1);
  assert.equal(labs.body[0].typeLabel, 'Laboratorio');
  assert.equal((await api('/api/spaces?type=invalido')).status, 400);
});

test('crea una reserva válida (201) con responsable registrado', async () => {
  const r = await reserve();
  assert.equal(r.status, 201);
  assert.equal(r.body.responsibleName, 'Ana Gómez');
  assert.equal(r.body.status, 'activa');
  assert.equal(r.body.spaceName, 'Salón 101');
});

test('permite editar una reserva propia y rechaza colisiones y modificaciones ajenas', async () => {
  const created = await reserve({ date: '2026-10-15', startHour: 8, endHour: 9 });
  const changed = await api(`/api/reservations/${created.body.id}`, {
    method: 'PUT',
    body: { date: '2026-10-15', startHour: 9, endHour: 10, purpose: 'Clase actualizada' },
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.startHour, 9);
  assert.equal(changed.body.purpose, 'Clase actualizada');

  const occupied = await reserve({ date: '2026-10-15', startHour: 11, endHour: 12 });
  assert.equal((await api(`/api/reservations/${changed.body.id}`, {
    method: 'PUT',
    body: { date: '2026-10-15', startHour: 11, endHour: 12 },
  })).status, 409);

  const adminCreated = await api('/api/reservations', {
    method: 'POST',
    cookie: adminCookie,
    body: { spaceId: salon, date: '2026-10-15', startHour: 13, endHour: 14, purpose: 'Reserva de administración' },
  });
  assert.equal((await api(`/api/reservations/${adminCreated.body.id}`, { method: 'PUT', body: { purpose: 'No autorizado' } })).status, 403);
  assert.equal((await api(`/api/reservations/${adminCreated.body.id}`, {
    method: 'PUT',
    cookie: adminCookie,
    body: { purpose: 'Actualización autorizada' },
  })).body.purpose, 'Actualización autorizada');
  assert.equal(occupied.status, 201);
});

test('rechaza reservas que se solapan (409) e informa quién ocupa el espacio', async () => {
  const r = await reserve({ startHour: 9, endHour: 11, responsibleName: 'Otra Persona' });
  assert.equal(r.status, 409);
  assert.match(r.body.error.message, /Ana Gómez/);
});

test('permite reservas contiguas (el fin de una es el inicio de otra)', async () => {
  const r = await reserve({ startHour: 10, endHour: 11, responsibleName: 'Carlos Ruiz' });
  assert.equal(r.status, 201);
});

test('el mismo horario en otro espacio no genera conflicto', async () => {
  const r = await reserve({ spaceId: lab });
  assert.equal(r.status, 201);
});

test('valida los datos de entrada (400)', async () => {
  assert.equal((await reserve({ date: '2026-13-45' })).status, 400);
  assert.equal((await reserve({ startHour: 6, endHour: 8 })).status, 400);
  assert.equal((await reserve({ startHour: 20, endHour: 22 })).status, 400);
  assert.equal((await reserve({ startHour: 12, endHour: 12 })).status, 400);
  assert.equal((await reserve({ startHour: 8, endHour: 14 })).status, 400); // más de 4 horas
  const spoofed = await reserve({ role: 'Administrativo', responsibleName: 'Otra Persona', date: '2026-10-14', startHour: 12, endHour: 13 });
  assert.equal(spoofed.body.role, 'Estudiante');
  assert.equal(spoofed.body.responsibleName, 'Ana Gómez');
});

test('devuelve 404 si el espacio no existe', async () => {
  assert.equal((await reserve({ spaceId: 999 })).status, 404);
});

test('no permite reservar en horas o fechas pasadas (422)', async () => {
  assert.equal((await reserve({ date: '2026-10-11' })).status, 422);
  assert.equal((await reserve({ date: TODAY, startHour: 8, endHour: 9 })).status, 422); // ya son las 9:30
  const ok = await reserve({ date: TODAY, startHour: 9, endHour: 10, spaceId: lab }); // hora en curso
  assert.equal(ok.status, 201);
});

test('liberar una reserva la deja en el historial como cancelada y libera el horario', async () => {
  const created = await reserve({ date: '2026-10-14', startHour: 13, endHour: 14 });
  const cancelled = await api(`/api/reservations/${created.body.id}`, { method: 'DELETE' });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.status, 'cancelada');

  assert.equal((await api(`/api/reservations/${created.body.id}`, { method: 'DELETE' })).status, 409);

  const activeOnly = await api('/api/reservations?date=2026-10-14');
  assert.equal(activeOnly.body.some((reservation) => reservation.id === created.body.id), false);
  const withCancelled = await api('/api/reservations?date=2026-10-14&includeCancelled=true');
  assert.equal(withCancelled.body.some((reservation) => reservation.id === created.body.id), true);

  const again = await reserve({ date: '2026-10-14', startHour: 13, endHour: 14, responsibleName: 'Nuevo Responsable' });
  assert.equal(again.status, 201);
});

test('no se puede liberar una reserva que ya finalizó', async () => {
  const info = db
    .prepare("INSERT INTO reservations (space_id, date, start_hour, end_hour, responsible_name, role, purpose, status, created_at) VALUES (?, ?, 7, 8, 'Histórico', 'Profesor', 'x', 'activa', ?)")
    .run(salon, TODAY, FIXED_NOW.toISOString());
  const r = await api(`/api/reservations/${info.lastInsertRowid}`, { method: 'DELETE', cookie: adminCookie });
  assert.equal(r.status, 409);
});

test('disponibilidad: estados de cada bloque y estado "ahora"', async () => {
  const av = await api(`/api/availability?date=${TODAY}`);
  assert.equal(av.status, 200);
  assert.equal(av.body.now.hour, 9);
  const lab1 = av.body.spaces.find((s) => s.name === 'Lab Cómputo');
  assert.equal(lab1.statusNow, 'occupied'); // reservado de 9 a 10 en el test anterior
  const slot7 = lab1.slots.find((s) => s.hour === 7);
  assert.equal(slot7.state, 'past');
  const slot12 = lab1.slots.find((s) => s.hour === 12);
  assert.equal(slot12.state, 'free');

  const tomorrow = await api(`/api/availability?date=${TOMORROW}`);
  const s101 = tomorrow.body.spaces.find((s) => s.name === 'Salón 101');
  assert.equal(s101.statusNow, null);
  assert.equal(s101.slots.find((s) => s.hour === 8).state, 'busy');
  assert.equal(s101.slots.find((s) => s.hour === 9).reservation.responsibleName, 'Ana Gómez');
});

test('estadísticas del panel principal', async () => {
  const st = await api('/api/stats');
  assert.equal(st.status, 200);
  assert.equal(st.body.totalSpaces, 2);
  assert.equal(st.body.occupiedNow, 1);
  assert.equal(st.body.availableNow, 1);
});

test('administración de espacios requiere sesión administrativa', async () => {
  const body = { name: 'Sala Nueva', type: 'sala', capacity: 12, location: 'C1' };
  assert.equal((await api('/api/spaces', { method: 'POST', body, cookie: null })).status, 401);
  assert.equal((await api('/api/spaces', { method: 'POST', body, cookie: studentCookie })).status, 403);

  const created = await api('/api/spaces', { method: 'POST', body, cookie: adminCookie });
  assert.equal(created.status, 201);
  assert.equal((await api('/api/spaces', { method: 'POST', body, cookie: adminCookie })).status, 409); // duplicado

  const updated = await api(`/api/spaces/${created.body.id}`, { method: 'PUT', body: { capacity: 20 }, cookie: adminCookie });
  assert.equal(updated.body.capacity, 20);

  assert.equal((await api(`/api/spaces/${created.body.id}`, { method: 'DELETE', cookie: adminCookie })).status, 204);
  const visible = await api('/api/spaces');
  assert.equal(visible.body.find((s) => s.id === created.body.id), undefined);
});

test('rutas inexistentes de la API devuelven 404 en JSON', async () => {
  const r = await api('/api/nada');
  assert.equal(r.status, 404);
  assert.equal(r.body.error.code, 'NOT_FOUND');
});

test('migra una base de datos anterior sin perder reservas existentes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reservas-migration-'));
  const dbPath = path.join(directory, 'old.db');
  const legacy = new Database(dbPath);
  legacy.exec(`
    CREATE TABLE spaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL, capacity INTEGER NOT NULL, location TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, space_id INTEGER NOT NULL,
      date TEXT NOT NULL, start_hour INTEGER NOT NULL, end_hour INTEGER NOT NULL,
      responsible_name TEXT NOT NULL, role TEXT NOT NULL, purpose TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'activa', created_at TEXT NOT NULL, cancelled_at TEXT
    );
    INSERT INTO spaces (name, type, capacity, location) VALUES ('Legado 1', 'salon', 20, 'A1');
    INSERT INTO reservations (space_id, date, start_hour, end_hour, responsible_name, role, purpose, created_at)
    VALUES (1, '2026-10-14', 8, 9, 'Cuenta anterior', 'Profesor', 'Clase', '2026-10-10T12:00:00.000Z');
  `);
  legacy.close();

  let migrated;
  try {
    migrated = openDatabase(dbPath);
    const reservation = migrated.prepare('SELECT * FROM reservations WHERE id = 1').get();
    assert.equal(reservation.user_id, null);
    assert.equal(reservation.responsible_name, 'Cuenta anterior');
    assert.ok(migrated.pragma('table_info(users)').some((column) => column.name === 'password_hash'));
  } finally {
    if (migrated) migrated.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('puede iniciar producción sin insertar espacios ni reservas de demostración', () => {
  const productionDb = openDatabase(':memory:');
  try {
    assert.equal(seedIfEmpty(productionDb, () => FIXED_NOW, { includeDemoData: false }), false);
    assert.equal(productionDb.prepare('SELECT COUNT(*) AS total FROM spaces').get().total, 0);
    assert.equal(productionDb.prepare('SELECT COUNT(*) AS total FROM reservations').get().total, 0);
  } finally {
    productionDb.close();
  }
});
