const config = require('./src/config');
const { createDatabase } = require('./src/db/database');
const { seedIfEmpty } = require('./src/db/seed');
const { bootstrapAdmin } = require('./src/services/authService');
const { createApp } = require('./src/app');

function explainDbError(err) {
  const { host, port, user, database } = config.DB;
  console.error('\n  No se pudo conectar con MySQL: ' + (err.message || err.code));
  if (err.code === 'ECONNREFUSED') {
    console.error(`  -> MySQL no está encendido en ${host}:${port}. Inicia el servicio (o XAMPP/MySQL Workbench) y vuelve a intentar.`);
  } else if (err.code === 'ER_ACCESS_DENIED_ERROR') {
    console.error(`  -> Usuario o contraseña incorrectos (usuario "${user}"). Revisa DB_USER y DB_PASSWORD en backend/.env`);
  } else if (err.code === 'ER_BAD_DB_ERROR') {
    console.error(`  -> La base "${database}" no existe y el usuario no tiene permiso para crearla. Créala a mano: CREATE DATABASE ${database};`);
  } else {
    console.error('  -> Revisa los datos de conexión en backend/.env (copia .env.example si aún no existe).');
  }
  console.error('');
}

async function main() {
  let db;
  try {
    db = await createDatabase(config.DB);
    await db.initSchema();
    if (await seedIfEmpty(db, undefined, { includeDemoData: config.NODE_ENV !== 'production' })) {
      console.log('Base de datos vacía: se cargaron espacios y reservas de ejemplo.');
    }
    if (await bootstrapAdmin(db, config)) {
      console.log(`Cuenta administrativa inicial creada: ${config.BOOTSTRAP_ADMIN_EMAIL}`);
    }
  } catch (err) {
    explainDbError(err);
    process.exit(1);
  }

  const app = createApp(db);
  app.locals.services.notifications.start(); // recordatorios automáticos
  const server = app.listen(config.PORT, () => {
    const mail = app.locals.services.notifications && (config.SMTP_HOST ? `SMTP ${config.SMTP_HOST}` : (config.MAIL_SIMULATE ? 'simulado (consola)' : 'NO configurado'));
    console.log('');
    console.log(`  ${config.APP_NAME}`);
    console.log(`  Aplicación web : http://localhost:${config.PORT}`);
    console.log(`  Base de datos  : MySQL "${config.DB.database}" en ${config.DB.host}:${config.DB.port}`);
    console.log(`  Correo         : ${mail}`);
    console.log('');
  });

  const shutdown = () => {
    app.locals.services.notifications.stop();
    server.close(async () => {
      await db.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
