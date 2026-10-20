const express = require('express');
const { HttpError } = require('../utils/errors');

function reservationsRouter({ reservations }) {
  const router = express.Router();

  const parseId = (req) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'El id debe ser un número válido', 'VALIDATION');
    return id;
  };

  router.get('/', (req, res) => {
    res.json(
      reservations.list({
        date: req.query.date,
        spaceId: req.query.spaceId,
        responsible: req.query.responsible,
        includeCancelled: req.query.includeCancelled === 'true',
        limit: req.query.limit,
        user: req.user,
      })
    );
  });
  router.get('/:id', (req, res) => res.json(reservations.getById(parseId(req), req.user)));
  router.post('/', (req, res) => res.status(201).json(reservations.create(req.body || {}, req.user)));
  router.put('/:id', (req, res) => res.json(reservations.update(parseId(req), req.body || {}, req.user)));
  // "Liberar espacio": cancela la reserva (queda registrada como cancelada en el historial).
  router.delete('/:id', (req, res) => res.json(reservations.cancel(parseId(req), req.user)));

  return router;
}

module.exports = { reservationsRouter };
