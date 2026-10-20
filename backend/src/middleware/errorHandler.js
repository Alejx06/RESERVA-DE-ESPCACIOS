function notFoundApi(req, res) {
  res.status(404).json({ error: { message: 'Ruta no encontrada', code: 'NOT_FOUND' } });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { message: 'El cuerpo de la petición no es un JSON válido', code: 'BAD_JSON' } });
  }
  if (err && err.status) {
    return res.status(err.status).json({ error: { message: err.message, code: err.code || undefined } });
  }
  console.error(err);
  res.status(500).json({ error: { message: 'Error interno del servidor', code: 'INTERNAL' } });
}

module.exports = { notFoundApi, errorHandler };
