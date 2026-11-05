const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { HttpError } = require('../utils/errors');

function reservationsRouter({ reservations }) {
  const router = express.Router();

  const parseId = (req) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'El id debe ser un número válido', 'VALIDATION');
    return id;
  };

  router.get('/', asyncHandler(async (req, res) => {
    res.json(await reservations.list({
      date: req.query.date,
      spaceId: req.query.spaceId,
      responsible: req.query.responsible,
      includeCancelled: req.query.includeCancelled === 'true',
      limit: req.query.limit,
      user: req.user,
    }));
  }));
  router.get('/:id', asyncHandler(async (req, res) => res.json(await reservations.getById(parseId(req), req.user))));
  router.post('/', asyncHandler(async (req, res) => res.status(201).json(await reservations.create(req.body || {}, req.user))));
  router.put('/:id', asyncHandler(async (req, res) => res.json(await reservations.update(parseId(req), req.body || {}, req.user))));
  // Cancelar: la reserva queda en el historial como "cancelada".
  router.delete('/:id', asyncHandler(async (req, res) => res.json(await reservations.cancel(parseId(req), req.user))));

  return router;
}

module.exports = { reservationsRouter };
