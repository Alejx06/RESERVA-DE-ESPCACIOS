// Express 4 no captura los errores de funciones async; este envoltorio los pasa al manejador de errores.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { asyncHandler };
