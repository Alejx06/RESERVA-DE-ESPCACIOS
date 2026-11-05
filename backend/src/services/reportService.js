const ExcelJS = require('exceljs');
const { HttpError } = require('../utils/errors');
const { isValidDate, daysBetween, nowInfo, pad, hh } = require('../utils/time');

const WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const round1 = (n) => Math.round(n * 10) / 10;

// Reportes de ocupación (Épica E7): resumen para el panel y libro de Excel para descargar.
function createReportService({ db, config, clock }) {
  function resolveRange({ from, to } = {}) {
    let start = from;
    let end = to;
    if (start === undefined && end === undefined) {
      const [y, m] = nowInfo(clock(), config).date.split('-').map(Number);
      start = `${y}-${pad(m)}-01`;
      end = `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`;
    }
    if (!isValidDate(start) || !isValidDate(end)) throw new HttpError(400, 'Las fechas deben tener formato YYYY-MM-DD', 'VALIDATION');
    if (end < start) throw new HttpError(400, 'La fecha final no puede ser anterior a la inicial', 'VALIDATION');
    const days = daysBetween(start, end) + 1;
    if (days > 366) throw new HttpError(400, 'El rango no puede superar 366 días', 'VALIDATION');
    return { from: start, to: end, days };
  }

  async function getSummary(range) {
    const { from, to, days } = resolveRange(range);
    const rows = await db.all(
      `SELECT r.id, r.date, r.start_hour, r.end_hour, r.responsible_name, r.role, r.purpose, r.status,
              r.created_at, r.cancelled_at, s.id AS space_id, s.name AS space_name, s.type AS space_type
       FROM reservations r JOIN spaces s ON s.id = r.space_id
       WHERE r.date BETWEEN ? AND ?
       ORDER BY r.date, r.start_hour, s.name LIMIT 20000`,
      [from, to]
    );
    const spaces = await db.all(
      "SELECT id, name, type, active FROM spaces ORDER BY CASE type WHEN 'salon' THEN 1 WHEN 'laboratorio' THEN 2 ELSE 3 END, name"
    );

    const active = rows.filter((r) => r.status === 'activa');
    const cancelled = rows.length - active.length;
    const hoursOf = (r) => r.end_hour - r.start_hour;
    const hoursPerDay = config.CLOSE_HOUR - config.OPEN_HOUR;
    const capacityPerSpace = days * hoursPerDay;
    const pct = (hours, capacity) => (capacity > 0 ? round1((hours / capacity) * 100) : 0);

    const bySpace = spaces.map((s) => {
      const mine = active.filter((r) => r.space_id === s.id);
      const hours = mine.reduce((sum, r) => sum + hoursOf(r), 0);
      return { spaceId: s.id, name: s.name, type: s.type, typeLabel: config.TYPE_LABELS[s.type], active: Boolean(s.active), reservations: mine.length, hours, occupancyPct: pct(hours, capacityPerSpace) };
    }).sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name));

    const byType = config.SPACE_TYPES.map((type) => {
      const group = bySpace.filter((s) => s.type === type);
      const hours = group.reduce((sum, s) => sum + s.hours, 0);
      return { type, label: config.TYPE_LABELS[type], spaces: group.length, reservations: group.reduce((sum, s) => sum + s.reservations, 0), hours, occupancyPct: pct(hours, capacityPerSpace * group.length) };
    });

    const byRole = config.ROLES.map((role) => {
      const mine = active.filter((r) => r.role === role);
      return { role, reservations: mine.length, hours: mine.reduce((sum, r) => sum + hoursOf(r), 0) };
    });

    const byDay = [];
    const dayIndex = new Map();
    const [fy, fm, fd] = from.split('-').map(Number);
    for (let i = 0; i < days; i++) {
      const dt = new Date(fy, fm - 1, fd + i);
      const iso = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
      const entry = { date: iso, reservations: 0, hours: 0 };
      dayIndex.set(iso, entry);
      byDay.push(entry);
    }
    const byWeekday = WEEKDAYS.map((name) => ({ name, reservations: 0, hours: 0 }));
    const byHour = [];
    for (let h = config.OPEN_HOUR; h < config.CLOSE_HOUR; h++) byHour.push({ hour: h, reservations: 0 });

    active.forEach((r) => {
      const entry = dayIndex.get(r.date);
      if (entry) { entry.reservations += 1; entry.hours += hoursOf(r); }
      const [y, m, d] = r.date.split('-').map(Number);
      const wd = byWeekday[(new Date(y, m - 1, d).getDay() + 6) % 7];
      wd.reservations += 1; wd.hours += hoursOf(r);
      for (let h = r.start_hour; h < r.end_hour; h++) {
        const slot = byHour.find((x) => x.hour === h);
        if (slot) slot.reservations += 1;
      }
    });

    const people = new Map();
    active.forEach((r) => {
      const key = `${r.responsible_name}|${r.role}`;
      const p = people.get(key) || { name: r.responsible_name, role: r.role, reservations: 0, hours: 0 };
      p.reservations += 1; p.hours += hoursOf(r);
      people.set(key, p);
    });
    const topUsers = [...people.values()].sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name)).slice(0, 5);

    const totalHours = active.reduce((sum, r) => sum + hoursOf(r), 0);
    const peak = [...byHour].sort((a, b) => b.reservations - a.reservations)[0];
    return {
      from, to, days, hoursPerDay,
      totals: {
        reservations: active.length,
        cancelled,
        hours: totalHours,
        uniqueResponsibles: people.size,
        spacesUsed: new Set(active.map((r) => r.space_id)).size,
        totalSpaces: spaces.length,
        avgHoursPerReservation: active.length ? round1(totalHours / active.length) : 0,
        cancellationRate: rows.length ? round1((cancelled / rows.length) * 100) : 0,
        occupancyPct: pct(totalHours, capacityPerSpace * spaces.length),
        peakHour: peak && peak.reservations > 0 ? peak.hour : null,
      },
      bySpace, byType, byRole, byDay, byWeekday, byHour, topUsers,
      reservations: rows.map((r) => ({
        id: r.id, date: r.date, spaceName: r.space_name, typeLabel: config.TYPE_LABELS[r.space_type],
        startHour: r.start_hour, endHour: r.end_hour, responsibleName: r.responsible_name, role: r.role,
        purpose: r.purpose, status: r.status, createdAt: r.created_at, cancelledAt: r.cancelled_at,
      })),
    };
  }

  async function buildWorkbook(range) {
    const summary = await getSummary(range);
    const wb = new ExcelJS.Workbook();
    wb.creator = config.APP_NAME;
    wb.created = clock();

    const header = (ws, widths) => {
      ws.getRow(1).eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A4D' } };
        cell.alignment = { vertical: 'middle' };
      });
      ws.columns.forEach((col, i) => { col.width = widths[i]; });
      ws.views = [{ state: 'frozen', ySplit: 1 }];
    };
    const sheet = (name, columns, rows, widths) => {
      const ws = wb.addWorksheet(name);
      ws.addRow(columns);
      rows.forEach((r) => ws.addRow(r));
      header(ws, widths);
      return ws;
    };

    const t = summary.totals;
    const resumen = wb.addWorksheet('Resumen');
    resumen.addRows([
      [config.APP_NAME],
      [`Reporte de ocupación del ${summary.from} al ${summary.to}`],
      [],
      ['Indicador', 'Valor'],
      ['Reservas activas', t.reservations],
      ['Reservas canceladas', t.cancelled],
      ['Horas reservadas', t.hours],
      ['Personas responsables distintas', t.uniqueResponsibles],
      ['Espacios utilizados', `${t.spacesUsed} de ${t.totalSpaces}`],
      ['Duración promedio por reserva (horas)', t.avgHoursPerReservation],
      ['Tasa de cancelación (%)', t.cancellationRate],
      ['Ocupación general (%)', t.occupancyPct],
      ['Hora de mayor demanda', t.peakHour === null ? '—' : hh(t.peakHour)],
      [],
      [`La ocupación = horas reservadas ÷ horas disponibles (${hh(config.OPEN_HOUR)} a ${hh(config.CLOSE_HOUR)} todos los días del rango).`],
    ]);
    resumen.getCell('A1').font = { bold: true, size: 14 };
    resumen.getRow(4).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A4D' } };
    });
    resumen.columns = [{ width: 44 }, { width: 22 }];

    sheet('Por espacio', ['Espacio', 'Tipo', 'Estado', 'Reservas', 'Horas', 'Ocupación (%)'], summary.bySpace.map((s) => [s.name, s.typeLabel, s.active ? 'Activo' : 'Inactivo', s.reservations, s.hours, s.occupancyPct]), [30, 16, 12, 12, 10, 16]);
    sheet('Por tipo', ['Tipo', 'Espacios', 'Reservas', 'Horas', 'Ocupación (%)'], summary.byType.map((s) => [s.label, s.spaces, s.reservations, s.hours, s.occupancyPct]), [18, 12, 12, 10, 16]);
    sheet('Por perfil', ['Perfil', 'Reservas', 'Horas'], summary.byRole.map((s) => [s.role, s.reservations, s.hours]), [18, 12, 10]);
    sheet('Por día', ['Fecha', 'Reservas', 'Horas'], summary.byDay.map((s) => [s.date, s.reservations, s.hours]), [14, 12, 10]);
    sheet('Por hora', ['Hora', 'Reservas en curso'], summary.byHour.map((s) => [hh(s.hour), s.reservations]), [12, 20]);
    const detail = sheet('Reservas', ['ID', 'Fecha', 'Espacio', 'Tipo', 'Inicio', 'Fin', 'Responsable', 'Perfil', 'Motivo', 'Estado'],
      summary.reservations.map((r) => [r.id, r.date, r.spaceName, r.typeLabel, hh(r.startHour), hh(r.endHour), r.responsibleName, r.role, r.purpose, r.status === 'activa' ? 'Activa' : 'Cancelada']),
      [8, 12, 26, 14, 9, 9, 26, 16, 34, 12]);
    detail.autoFilter = { from: 'A1', to: 'J1' };

    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), from: summary.from, to: summary.to };
  }

  return { getSummary, buildWorkbook };
}

module.exports = { createReportService };
