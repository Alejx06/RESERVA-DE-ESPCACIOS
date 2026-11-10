const express = require('express');
const { HttpError } = require('../utils/errors');
const { asyncHandler: asyncRoute } = require('../utils/asyncHandler');
const { sessionCookie } = require('../services/authService');

function authRouter({ auth, requireAuth, config }) {
  const router = express.Router();
  const maxAge = config.SESSION_TTL_HOURS * 60 * 60;
  const attemptsByAddress = new Map();
  const registrationByAddress = new Map();

  function enforceLimit(map, address, maximum, period) {
    const now = Date.now();
    for (const [key, record] of map) {
      if (now - record.startedAt >= period) map.delete(key);
    }
    const record = map.get(address);
    if (record && record.count >= maximum) {
      throw new HttpError(429, 'Demasiadas solicitudes. Intenta de nuevo más tarde.', 'RATE_LIMITED');
    }
    map.set(address, record
      ? { ...record, count: record.count + 1 }
      : { count: 1, startedAt: now });
  }

  router.get('/options', (req, res) => {
    res.json({ emailDomain: config.EMAIL_DOMAIN });
  });

  router.post('/register', asyncRoute(async (req, res) => {
    enforceLimit(registrationByAddress, req.ip, 30, 60 * 60 * 1000);
    const input = req.body || {};
    await auth.registerStudent(input);
    const session = await auth.login(input);
    res.set('Set-Cookie', sessionCookie(session.token, config, maxAge));
    res.set('Cache-Control', 'no-store');
    res.status(201).json({ user: session.user, expiresAt: session.expiresAt });
  }));

  router.post('/login', asyncRoute(async (req, res) => {
    const address = req.ip;
    const now = Date.now();
    for (const [key, attempt] of attemptsByAddress) {
      if (now - attempt.startedAt >= 15 * 60 * 1000) attemptsByAddress.delete(key);
    }
    const attempt = attemptsByAddress.get(address);
    if (attempt && attempt.count >= 5) {
      throw new HttpError(429, 'Demasiados intentos. Espera 15 minutos antes de volver a intentar.', 'RATE_LIMITED');
    }
    let session;
    try {
      session = await auth.login(req.body || {});
    } catch (error) {
      if (error.status === 401) {
        const current = attemptsByAddress.get(address);
        attemptsByAddress.set(address, current
          ? { ...current, count: current.count + 1 }
          : { count: 1, startedAt: now });
      }
      throw error;
    }
    attemptsByAddress.delete(address);
    res.set('Set-Cookie', sessionCookie(session.token, config, maxAge));
    res.set('Cache-Control', 'no-store');
    res.json({ user: session.user, expiresAt: session.expiresAt });
  }));

  router.post('/logout', requireAuth, asyncRoute(async (req, res) => {
    await auth.logout(req.sessionToken);
    res.set('Set-Cookie', sessionCookie('', config, 0));
    res.status(204).end();
  }));

  router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));
  return router;
}

function adminRouter({ auth, spaces, notifications, requireAuth, requireAdmin }) {
  const router = express.Router();
  router.use(requireAuth, requireAdmin);

  router.get('/users', asyncRoute(async (req, res) => res.json(await auth.listUsers())));
  router.post('/users', asyncRoute(async (req, res) => {
    const user = await auth.createStaff(req.body || {});
    res.status(201).json({ user });
  }));
  router.delete('/users/:id', asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'El id debe ser un número válido', 'VALIDATION');
    await auth.deactivateUser(id, req.user.id);
    res.status(204).end();
  }));

  router.get('/spaces', asyncRoute(async (req, res) => {
    res.json(await spaces.list({ includeInactive: true }));
  }));
  router.get('/notifications', asyncRoute(async (req, res) => {
    res.json(await notifications.list(req.query.limit));
  }));
  return router;
}

module.exports = { authRouter, adminRouter };
