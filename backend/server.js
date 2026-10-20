const config = require('./src/config');
const { openDatabase } = require('./src/db/database');
const { seedIfEmpty } = require('./src/db/seed');
const { bootstrapAdmin } = require('./src/services/authService');
const { createApp } = require('./src/app');

async function start() {
  const db = openDatabase(config.DB_PATH);
  if (seedIfEmpty(db, undefined, { includeDemoData: config.NODE_ENV !== 'production' })) {
    console.log('Base de datos vacía: se cargaron espacios y reservas de ejemplo.');
  }
  if (await bootstrapAdmin(db, config)) console.log('Cuenta administrativa inicial creada desde variables de entorno.');
  const activeAdmins = db.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'Administrativo' AND active = 1").get().total;
  if (!config.BOOTSTRAP_ADMIN_EMAIL && activeAdmins === 0) {
    console.warn('No se configuró BOOTSTRAP_ADMIN_EMAIL/PASSWORD. Configúralos para habilitar la gestión administrativa.');
  }
  if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASSWORD || !config.SMTP_FROM) {
    console.warn('SMTP incompleto: no se podrán enviar códigos para el registro de estudiantes.');
  }

  const app = createApp(db);
  const server = app.listen(config.PORT, () => {
    console.log('');
    console.log('  Sistema de Reservas de Espacios');
    console.log(`  Aplicación web : http://localhost:${config.PORT}`);
    console.log(`  API REST       : http://localhost:${config.PORT}/api`);
    console.log(`  Base de datos  : ${config.DB_PATH}`);
    console.log('');
  });

  function shutdown() {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((error) => {
  console.error('No se pudo iniciar el servidor:', error.message);
  process.exitCode = 1;
});
