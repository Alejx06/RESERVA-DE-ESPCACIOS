const path = require('path');

// Lee las variables de backend/.env (si existe). Las variables ya definidas en el sistema tienen prioridad.
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const bool = (value, fallback = false) => (value === undefined || value === '' ? fallback : value === 'true');
const num = (value, fallback) => (value === undefined || value === '' || Number.isNaN(Number(value)) ? fallback : Number(value));

// Conexión a MySQL: se puede dar por partes (DB_HOST, DB_USER...) o con una sola URL (DATABASE_URL),
// que es lo que entregan la mayoría de servicios de hosting.
function readDbConfig() {
  const cfg = {
    host: process.env.DB_HOST || '127.0.0.1', // 127.0.0.1 evita problemas de IPv6 con "localhost" en Windows
    port: num(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'reservas',
    ssl: bool(process.env.DB_SSL),
  };
  if (process.env.DATABASE_URL) {
    const u = new URL(process.env.DATABASE_URL);
    cfg.host = u.hostname;
    cfg.port = Number(u.port) || 3306;
    cfg.user = decodeURIComponent(u.username);
    cfg.password = decodeURIComponent(u.password);
    cfg.database = u.pathname.replace(/^\//, '') || cfg.database;
  }
  return cfg;
}

const PORT = num(process.env.PORT, 3000);
const NODE_ENV = process.env.NODE_ENV || 'development';

module.exports = {
  PORT,
  NODE_ENV,
  DB: readDbConfig(),
  FRONTEND_DIR: path.join(__dirname, '..', '..', 'frontend'),

  APP_NAME: 'Sistema de Reservas de Espacios',
  // Dirección pública de la aplicación (aparece en los correos). Ej: https://reservas.midominio.com
  APP_URL: process.env.APP_URL || `http://localhost:${PORT}`,
  // Detrás de un proxy (hosting en la nube) hay que confiar en él para leer la IP real del cliente.
  TRUST_PROXY: process.env.TRUST_PROXY !== undefined ? num(process.env.TRUST_PROXY, 1) : (NODE_ENV === 'production' ? 1 : 0),

  // Cuentas
  EMAIL_DOMAIN: process.env.EMAIL_DOMAIN || 'amigo.edu.co',
  BOOTSTRAP_ADMIN_EMAIL: process.env.BOOTSTRAP_ADMIN_EMAIL || '',
  BOOTSTRAP_ADMIN_PASSWORD: process.env.BOOTSTRAP_ADMIN_PASSWORD || '',
  SESSION_TTL_HOURS: 12,
  EMAIL_VERIFICATION_TTL_MINUTES: 15,

  // Correo saliente (SMTP). Con Gmail: smtp.gmail.com, puerto 587 y una "contraseña de aplicación".
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: num(process.env.SMTP_PORT, 587),
  SMTP_SECURE: bool(process.env.SMTP_SECURE),
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASSWORD: process.env.SMTP_PASSWORD || '',
  SMTP_FROM: process.env.SMTP_FROM || '',
  // Sin SMTP, si es true los correos se imprimen en la consola del servidor (modo simulación / pruebas).
  MAIL_SIMULATE: bool(process.env.MAIL_SIMULATE),

  // Notificaciones de reservas (confirmación, cambios, cancelación y recordatorio)
  NOTIFICATIONS_ENABLED: bool(process.env.NOTIFICATIONS_ENABLED, true),
  REMINDER_MINUTES_BEFORE: num(process.env.REMINDER_MINUTES_BEFORE, 60),
  REMINDER_CHECK_SECONDS: num(process.env.REMINDER_CHECK_SECONDS, 60),

  // Horario de servicio de la institución (por defecto 07:00 a 21:00).
  // Se puede cambiar con las variables de entorno OPEN_HOUR y CLOSE_HOUR (ej. para una demo fuera de horario).
  OPEN_HOUR: num(process.env.OPEN_HOUR, 7),
  CLOSE_HOUR: num(process.env.CLOSE_HOUR, 21),

  // Reglas de negocio de las reservas.
  MAX_HOURS_PER_RESERVATION: 4,
  MAX_DAYS_AHEAD: 90,

  // Si es true, permite crear/cancelar reservas en horas ya pasadas (útil para demos).
  ALLOW_PAST: bool(process.env.ALLOW_PAST),

  SPACE_TYPES: ['salon', 'laboratorio', 'sala'],
  TYPE_LABELS: { salon: 'Salón', laboratorio: 'Laboratorio', sala: 'Sala' },
  ROLES: ['Profesor', 'Estudiante', 'Administrativo'],
};
