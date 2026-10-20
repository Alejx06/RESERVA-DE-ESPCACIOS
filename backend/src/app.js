const express = require('express');
const defaultConfig = require('./config');
const { createMailer } = require('./services/mailer');
const { notFoundApi, errorHandler } = require('./middleware/errorHandler');
const { createAuthService, authMiddleware } = require('./services/authService');
const { createSpaceService } = require('./services/spaceService');
const { createReservationService } = require('./services/reservationService');
const { createAvailabilityService } = require('./services/availabilityService');
const { createStatsService } = require('./services/statsService');
const { spacesRouter } = require('./routes/spaces');
const { reservationsRouter } = require('./routes/reservations');
const { authRouter, adminRouter } = require('./routes/auth');

// Fábrica de la aplicación: recibe la BD y un reloj, lo que permite probarla con datos y hora controlados.
function createApp(db, {
  config = defaultConfig,
  clock = () => new Date(),
  sendVerificationEmail = createMailer(config).sendVerificationEmail,
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
    });
    if (config.NODE_ENV === 'production') {
      res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    if (req.path.startsWith('/api')) res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '50kb' }));

  const ctx = { db, config, clock };
  const auth = createAuthService({ ...ctx, sendVerificationEmail });
  const access = authMiddleware(auth);
  const services = {
    auth,
    spaces: createSpaceService(ctx),
    reservations: createReservationService(ctx),
    availability: createAvailabilityService(ctx),
    stats: createStatsService(ctx),
  };

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', database: 'sqlite', time: clock().toISOString() });
  });
  app.use('/api/auth', authRouter({ auth, requireAuth: access.requireAuth, config }));
  app.use('/api', access.requireAuth);
  app.use('/api/admin', adminRouter({
    auth,
    spaces: services.spaces,
    requireAuth: access.requireAuth,
    requireAdmin: access.requireAdmin,
  }));
  app.use('/api/spaces', spacesRouter(services, access));
  app.use('/api/reservations', reservationsRouter(services));
  app.get('/api/availability', (req, res) => {
    res.json(services.availability.getAvailability({ date: req.query.date, type: req.query.type }));
  });
  app.get('/api/stats', (req, res) => res.json(services.stats.getStats()));
  app.use('/api', notFoundApi);

  // El backend también sirve el frontend: así todo corre con un solo comando (http://localhost:3000).
  app.use(express.static(config.FRONTEND_DIR));

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
