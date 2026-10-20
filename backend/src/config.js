const path = require('path');

module.exports = {
  PORT: Number(process.env.PORT) || 3000,
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'reservas.db'),
  FRONTEND_DIR: path.join(__dirname, '..', '..', 'frontend'),

  EMAIL_DOMAIN: process.env.EMAIL_DOMAIN || 'amigo.edu.co',
  BOOTSTRAP_ADMIN_EMAIL: process.env.BOOTSTRAP_ADMIN_EMAIL || '',
  BOOTSTRAP_ADMIN_PASSWORD: process.env.BOOTSTRAP_ADMIN_PASSWORD || '',
  NODE_ENV: process.env.NODE_ENV || 'development',
  SESSION_TTL_HOURS: 12,
  EMAIL_VERIFICATION_TTL_MINUTES: 15,
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: Number(process.env.SMTP_PORT) || 587,
  SMTP_SECURE: process.env.SMTP_SECURE === 'true',
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASSWORD: process.env.SMTP_PASSWORD || '',
  SMTP_FROM: process.env.SMTP_FROM || '',

  // Horario de servicio de la institución (por defecto 07:00 a 21:00).
  // Se puede cambiar con las variables de entorno OPEN_HOUR y CLOSE_HOUR (ej. para una demo fuera de horario).
  OPEN_HOUR: process.env.OPEN_HOUR !== undefined ? Number(process.env.OPEN_HOUR) : 7,
  CLOSE_HOUR: process.env.CLOSE_HOUR !== undefined ? Number(process.env.CLOSE_HOUR) : 21,

  // Reglas de negocio de las reservas.
  MAX_HOURS_PER_RESERVATION: 4,
  MAX_DAYS_AHEAD: 90,

  // Si es true, permite crear/cancelar reservas en horas ya pasadas (útil para demos).
  ALLOW_PAST: process.env.ALLOW_PAST === 'true',

  SPACE_TYPES: ['salon', 'laboratorio', 'sala'],
  TYPE_LABELS: { salon: 'Salón', laboratorio: 'Laboratorio', sala: 'Sala' },
  ROLES: ['Profesor', 'Estudiante', 'Administrativo'],
};
