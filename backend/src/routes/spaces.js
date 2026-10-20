const express = require('express');
const { HttpError } = require('../utils/errors');

function spacesRouter({ spaces }, { requireAdmin }) {
  const router = express.Router();

  const parseId = (req) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'El id debe ser un número válido', 'VALIDATION');
    return id;
  };

  router.get('/', (req, res) => {
    res.json(spaces.list({
      type: req.query.type,
      includeInactive: req.user.role === 'Administrativo' && req.query.includeInactive === 'true',
    }));
  });
  router.get('/:id', (req, res) => res.json(spaces.getById(parseId(req))));
  router.post('/', requireAdmin, (req, res) => res.status(201).json(spaces.create(req.body || {})));
  router.put('/:id', requireAdmin, (req, res) => res.json(spaces.update(parseId(req), req.body || {})));
  router.delete('/:id', requireAdmin, (req, res) => {
    spaces.remove(parseId(req));
    res.status(204).end();
  });

  return router;
}

module.exports = { spacesRouter };
