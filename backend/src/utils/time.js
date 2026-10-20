const pad = (n) => String(n).padStart(2, '0');

// Siempre usamos la hora LOCAL del servidor (no UTC) para evitar desfases de fecha por la noche.
function formatDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(d, days) {
  const copy = new Date(d.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function isValidDate(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function daysBetween(fromStr, toStr) {
  const [y1, m1, d1] = fromStr.split('-').map(Number);
  const [y2, m2, d2] = toStr.split('-').map(Number);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((b - a) / 86400000);
}

function nowInfo(date, config) {
  const hour = date.getHours();
  return {
    date: formatDate(date),
    hour,
    minute: date.getMinutes(),
    isOpen: hour >= config.OPEN_HOUR && hour < config.CLOSE_HOUR,
  };
}

const hh = (h) => `${pad(h)}:00`;

module.exports = { pad, formatDate, addDays, isValidDate, daysBetween, nowInfo, hh };
