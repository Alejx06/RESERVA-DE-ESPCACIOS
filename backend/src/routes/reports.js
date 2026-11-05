const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');

// Reportes: solo para el perfil administrativo.
function reportsRouter({ reports }, { requireAdmin }) {
  const router = express.Router();
  router.use(requireAdmin);

  router.get('/summary', asyncHandler(async (req, res) => {
    const { reservations, ...summary } = await reports.getSummary({ from: req.query.from, to: req.query.to });
    res.json(summary);
  }));

  router.get('/export', asyncHandler(async (req, res) => {
    const { buffer, from, to } = await reports.buildWorkbook({ from: req.query.from, to: req.query.to });
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="reporte-reservas_${from}_${to}.xlsx"`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  }));

  return router;
}

module.exports = { reportsRouter };
