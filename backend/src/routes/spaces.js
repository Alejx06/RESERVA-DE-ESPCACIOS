const express = require('express');
const { HttpError } = require('../utils/errors');
const { asyncHandler } = require('../utils/asyncHandler');

function spacesRouter({ spaces }, { requireAdmin }) {
  const router = express.Router();

  const parseId = (req) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'El id debe ser un número válido', 'VALIDATION');
    return id;
  };

  router.get('/', asyncHandler(async (req, res) => {
    res.json(await spaces.list({
      type: req.query.type,
      includeInactive: req.user.role === 'Administrativo' && req.query.includeInactive === 'true',
    }));
  }));
  router.get('/:id', asyncHandler(async (req, res) => res.json(await spaces.getById(parseId(req)))));
  router.post('/', requireAdmin, asyncHandler(async (req, res) => res.status(201).json(await spaces.create(req.body || {}))));
  router.put('/:id', requireAdmin, asyncHandler(async (req, res) => res.json(await spaces.update(parseId(req), req.body || {}))));
  router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
    await spaces.remove(parseId(req));
    res.status(204).end();
  }));

  return router;
}

module.exports = { spacesRouter };
