const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

// Las pruebas usan SU PROPIA base de datos (reservas_test) para no tocar la real.
// Se define antes de cargar la configuración.
process.env.DB_NAME = process.env.DB_NAME_TEST || 'reservas_test';

const ExcelJS = require('exceljs');
const config = require('../src/config');
const { createDatabase } = require('../src/db/database');
const { seedIfEmpty } = require('../src/db/seed');
const { createApp } = require('../src/app');
const { bootstrapAdmin } = require('../src/services/authService');

// Reloj fijo para que las pruebas sean deterministas: lunes 12-oct-2026, 09:30.
const FIXED_NOW = new Date(2026, 9, 12, 9, 30, 0);
const TODAY = '2026-10-12';
const TOMORROW = '2026-10-13';

let db, server, base, appInstance, adminCookie, studentCookie, actingCookie;
let salon, lab;
const mails = []; // correos "enviados" durante las pruebas

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

const flushMail = () => appInstance.locals.services.notifications.flush();

before(async () => {
  // Seguridad: estas pruebas BORRAN las tablas; solo se ejecutan sobre una base cuyo nombre contenga "test".
  assert.match(config.DB.database, /test/i, `Por seguridad las pruebas solo corren en una base "test" (actual: ${config.DB.database})`);

  db = await createDatabase(config.DB);
  await db.initSchema();
  for (const table of ['notifications', 'sessions', 'account_verifications', 'reservations', 'users', 'spaces']) {
    await db.run(`DELETE FROM ${table}`);
  }

  salon = (await db.run("INSERT INTO spaces (name, type, capacity, location) VALUES ('Salón 101','salon',35,'A1')")).insertId;
  lab = (await db.run("INSERT INTO spaces (name, type, capacity, location) VALUES ('Lab Cómputo','laboratorio',28,'B2')")).insertId;
  const testConfig = {
    ...config,
    BOOTSTRAP_ADMIN_EMAIL: 'admin@amigo.edu.co',
    BOOTSTRAP_ADMIN_PASSWORD: 'Admin-Test-Password-123',
    EMAIL_DOMAIN: 'amigo.edu.co',
    NOTIFICATIONS_ENABLED: true,
    REMINDER_MINUTES_BEFORE: 60,
  };
  await bootstrapAdmin(db, testConfig, () => FIXED_NOW);
  const mailer = {
    isConfigured: () => true,
    sendMail: async (mail) => { mails.push(mail); return { status: 'enviado' }; },
  };
  appInstance = createApp(db, { config: testConfig, clock: () => FIXED_NOW, mailer });
  await new Promise((resolve) => { server = appInstance.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  adminCookie = (await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@amigo.edu.co', password: 'Admin-Test-Password-123' },
    cookie: null,
  })).setCookie.split(';')[0];
  const registeredStudent = await api('/api/auth/register', {
    method: 'POST',
    body: { fullName: 'Ana Gómez', email: 'ana@amigo.edu.co', password: 'Student-Test-Password-123' },
    cookie: null,
  });
  assert.equal(registeredStudent.status, 201);
  studentCookie = registeredStudent.setCookie.split(';')[0];
  actingCookie = studentCookie;
});

after(async () => {
  if (server) server.close();
  if (db) await db.close();
});

test('health responde ok y confirma la conexión a MySQL', async () => {
  const r = await api('/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'ok');
  assert.equal(r.body.database, 'mysql');
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
    body: { fullName: 'Cuenta Corta', email: 'student-short@amigo.edu.co', password: 'abc1234' },
    cookie: null,
  })).status, 400);
  const registeredStudent2 = await api('/api/auth/register', {
    method: 'POST',
    body: { fullName: 'Cuenta Inválida', email: 'student2@amigo.edu.co', password: 'abc12345', role: 'Administrativo' },
    cookie: null,
  });
  assert.equal(registeredStudent2.status, 201);
  assert.equal(registeredStudent2.body.user.role, 'Estudiante');
  assert.equal((await api('/api/auth/me', { cookie: registeredStudent2.setCookie.split(';')[0] })).body.user.email, 'student2@amigo.edu.co');
  assert.equal((await api('/api/auth/register', {
    method: 'POST',
    body: { fullName: 'Cuenta Ya Activada', email: 'student2@amigo.edu.co', password: 'abc12345' },
    cookie: null,
  })).status, 409);
  await appInstance.locals.services.auth.createAccount({
    fullName: 'Registro Pendiente',
    email: 'pending@amigo.edu.co',
    password: 'Old-Student-Password-123',
    role: 'Estudiante',
    active: 0,
  });
  const resumedRegistration = await api('/api/auth/register', {
    method: 'POST',
    body: { fullName: 'Registro Recuperado', email: 'pending@amigo.edu.co', password: 'New-Student-Password-123' },
    cookie: null,
  });
  assert.equal(resumedRegistration.status, 201);
  assert.equal(resumedRegistration.body.user.email, 'pending@amigo.edu.co');
  assert.equal((await api('/api/auth/me', { cookie: resumedRegistration.setCookie.split(';')[0] })).body.user.fullName, 'Registro Recuperado');
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

test('da de baja espacios con reservas pendientes y conserva las reservas existentes', async () => {
  const createdSpace = await api('/api/spaces', {
    method: 'POST',
    cookie: adminCookie,
    body: { name: 'Espacio para dar de baja', type: 'sala', capacity: 12, location: 'Prueba' },
  });
  assert.equal(createdSpace.status, 201);

  const booking = await api('/api/reservations', {
    method: 'POST',
    body: { spaceId: createdSpace.body.id, date: TOMORROW, startHour: 8, endHour: 9, purpose: 'Reserva que se conserva' },
  });
  assert.equal(booking.status, 201);

  const deactivated = await api(`/api/spaces/${createdSpace.body.id}`, {
    method: 'DELETE',
    cookie: adminCookie,
  });
  assert.equal(deactivated.status, 204);

  const activeSpaces = await api('/api/spaces');
  assert.equal(activeSpaces.body.some((space) => space.id === createdSpace.body.id), false);
  const adminSpaces = await api('/api/admin/spaces', { cookie: adminCookie });
  assert.equal(adminSpaces.body.find((space) => space.id === createdSpace.body.id).active, false);

  const existingBooking = await api(`/api/reservations/${booking.body.id}`);
  assert.equal(existingBooking.status, 200);
  assert.equal(existingBooking.body.status, 'activa');

  const nextBooking = await api('/api/reservations', {
    method: 'POST',
    body: { spaceId: createdSpace.body.id, date: TOMORROW, startHour: 10, endHour: 11 },
  });
  assert.equal(nextBooking.status, 404);
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
  const info = await db.run(
    "INSERT INTO reservations (space_id, date, start_hour, end_hour, responsible_name, role, purpose, status, created_at) VALUES (?, ?, 7, 8, 'Histórico', 'Profesor', 'x', 'activa', ?)",
    [salon, TODAY, FIXED_NOW.toISOString()]
  );
  const r = await api(`/api/reservations/${info.insertId}`, { method: 'DELETE', cookie: adminCookie });
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


test('CONCURRENCIA: 10 personas reservan el mismo bloque a la vez y solo una lo logra', async () => {
  const attempts = await Promise.all(
    Array.from({ length: 10 }, () => reserve({ date: '2026-10-20', startHour: 15, endHour: 17 }))
  );
  assert.equal(attempts.filter((r) => r.status === 201).length, 1, 'exactamente una reserva debe confirmarse');
  assert.equal(attempts.filter((r) => r.status === 409).length, 9, 'las otras 9 deben recibir conflicto');
  const stored = await api('/api/reservations?date=2026-10-20');
  assert.equal(stored.body.length, 1, 'en la base de datos debe existir una sola reserva');
});

test('texto con comillas y caracteres especiales se guarda sin romper la consulta (anti inyección SQL)', async () => {
  const evil = "'; DROP TABLE reservations;-- <b>x</b>";
  const r = await reserve({ date: '2026-10-25', startHour: 8, endHour: 9, purpose: evil });
  assert.equal(r.status, 201);
  assert.equal(r.body.purpose, evil);
  assert.equal((await api('/api/reservations?date=2026-10-25')).body.length, 1); // la tabla sigue funcionando
});

test('NOTIFICACIONES: confirmación, modificación y cancelación llegan al correo de quien reservó', async () => {
  mails.splice(0);
  const created = await reserve({ date: '2026-10-27', startHour: 9, endHour: 11, purpose: 'Clase de redes' });
  await flushMail();
  assert.equal(created.status, 201);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, 'ana@amigo.edu.co');
  assert.match(mails[0].subject, /Reserva confirmada: Salón 101/);
  assert.match(mails[0].text, /martes 27 de octubre de 2026/);
  assert.match(mails[0].text, /09:00 a 11:00/);

  await api(`/api/reservations/${created.body.id}`, { method: 'PUT', body: { startHour: 10, endHour: 12 } });
  await flushMail();
  assert.match(mails[1].subject, /Reserva modificada/);

  await api(`/api/reservations/${created.body.id}`, { method: 'DELETE' });
  await flushMail();
  assert.match(mails[2].subject, /Reserva cancelada/);

  const log = await api('/api/admin/notifications', { cookie: adminCookie });
  assert.equal(log.status, 200);
  assert.deepEqual(log.body.slice(0, 3).map((n) => n.type).reverse(), ['confirmacion', 'modificacion', 'cancelacion']);
  assert.equal(log.body[0].status, 'enviado');
  assert.equal((await api('/api/admin/notifications')).status, 403); // un estudiante no ve la bitácora
});

test('NOTIFICACIONES: el recordatorio se envía una sola vez, cerca de la hora de inicio', async () => {
  const created = await reserve({ date: TODAY, startHour: 10, endHour: 11, spaceId: salon, purpose: 'Reunión corta' });
  assert.equal(created.status, 201); // son las 9:30, falta media hora
  await flushMail();
  mails.splice(0);
  const reminders = appInstance.locals.services.notifications;
  assert.equal(await reminders.sendDueReminders(), 1);
  assert.equal(mails.length, 1);
  assert.match(mails[0].subject, /Recordatorio: Salón 101 hoy a las 10:00/);
  assert.equal(await reminders.sendDueReminders(), 0); // no se repite
  assert.equal(mails.length, 1);
});

test('NOTIFICACIONES: las reservas sin cuenta asociada (datos de ejemplo) no generan correo', async () => {
  const info = await db.run(
    "INSERT INTO reservations (space_id, date, start_hour, end_hour, responsible_name, role, purpose, status, created_at) VALUES (?, ?, 10, 11, 'Sin cuenta', 'Profesor', 'x', 'activa', ?)",
    [lab, TODAY, FIXED_NOW.toISOString()]
  );
  mails.splice(0);
  await appInstance.locals.services.notifications.reservationEvent('confirmacion', info.insertId);
  assert.equal(mails.length, 0);
});

test('REPORTES: solo el perfil administrativo puede consultarlos y exportarlos', async () => {
  assert.equal((await api('/api/reports/summary?from=2026-10-01&to=2026-10-31')).status, 403);
  assert.equal((await api('/api/reports/export')).status, 403);
  assert.equal((await api('/api/reports/summary', { cookie: null })).status, 401);
});

test('REPORTES: el resumen calcula totales, ocupación y distribuciones del rango', async () => {
  const r = await api('/api/reports/summary?from=2026-10-01&to=2026-10-31', { cookie: adminCookie });
  assert.equal(r.status, 200);
  assert.equal(r.body.days, 31);
  assert.equal(r.body.byDay.length, 31);
  assert.equal(r.body.byWeekday.length, 7);
  const knownSpaces = await api('/api/admin/spaces', { cookie: adminCookie });
  assert.equal(r.body.bySpace.length, knownSpaces.body.length);
  assert.ok(r.body.totals.reservations >= 5);
  assert.ok(r.body.totals.cancelled >= 1);
  assert.equal(typeof r.body.totals.occupancyPct, 'number');
  const hoursBySpace = r.body.bySpace.reduce((sum, s) => sum + s.hours, 0);
  assert.equal(hoursBySpace, r.body.totals.hours); // coherencia entre totales y detalle
  const deactivatedSpace = r.body.bySpace.find((space) => space.name === 'Espacio para dar de baja');
  assert.equal(deactivatedSpace.active, false);
  assert.equal(deactivatedSpace.reservations, 1);
  assert.equal(r.body.totals.totalSpaces, knownSpaces.body.length);
  assert.equal(r.body.totals.spacesUsed, new Set(r.body.bySpace.filter((space) => space.reservations > 0).map((space) => space.spaceId)).size);
  assert.equal(r.body.byRole.reduce((sum, s) => sum + s.reservations, 0), r.body.totals.reservations);
  assert.ok(r.body.topUsers.length >= 1);

  const byDefault = await api('/api/reports/summary', { cookie: adminCookie }); // mes actual del reloj
  assert.equal(byDefault.body.from, '2026-10-01');
  assert.equal(byDefault.body.to, '2026-10-31');
  assert.equal((await api('/api/reports/summary?from=2026-10-31&to=2026-10-01', { cookie: adminCookie })).status, 400);
  assert.equal((await api('/api/reports/summary?from=2026-01-01&to=2027-12-31', { cookie: adminCookie })).status, 400);
  assert.equal((await api('/api/reports/summary?from=abc&to=2026-10-31', { cookie: adminCookie })).status, 400);
});

test('REPORTES: exporta un libro de Excel válido con todas las hojas', async () => {
  const res = await fetch(`${base}/api/reports/export?from=2026-10-01&to=2026-10-31`, { headers: { Cookie: adminCookie } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /spreadsheetml\.sheet/);
  assert.match(res.headers.get('content-disposition'), /reporte-reservas_2026-10-01_2026-10-31\.xlsx/);
  const buffer = Buffer.from(await res.arrayBuffer());
  assert.equal(buffer.slice(0, 2).toString(), 'PK'); // los .xlsx son archivos zip
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Resumen', 'Por espacio', 'Por tipo', 'Por perfil', 'Por día', 'Por hora', 'Reservas']);
  assert.ok(wb.getWorksheet('Reservas').rowCount > 2);
  assert.equal(wb.getWorksheet('Por día').rowCount, 32); // encabezado + 31 días
});

test('puede iniciar producción sin insertar espacios ni reservas de demostración', async () => {
  const emptyCfg = { ...config.DB, database: 'reservas_test_vacia' };
  const emptyDb = await createDatabase(emptyCfg);
  try {
    await emptyDb.initSchema();
    await emptyDb.run('DELETE FROM reservations');
    await emptyDb.run('DELETE FROM spaces');
    assert.equal(await seedIfEmpty(emptyDb, () => FIXED_NOW, { includeDemoData: false }), false);
    assert.equal((await emptyDb.get('SELECT COUNT(*) AS n FROM spaces')).n, 0);
    assert.equal(await seedIfEmpty(emptyDb, () => FIXED_NOW), true); // con datos de ejemplo sí los carga
    assert.equal((await emptyDb.get('SELECT COUNT(*) AS n FROM spaces')).n, 9);
    assert.ok((await emptyDb.get('SELECT COUNT(*) AS n FROM reservations')).n >= 12);
  } finally {
    await emptyDb.close();
    const admin = await createDatabase(config.DB, { createIfMissing: false });
    await admin.run('DROP DATABASE IF EXISTS reservas_test_vacia');
    await admin.close();
  }
});
