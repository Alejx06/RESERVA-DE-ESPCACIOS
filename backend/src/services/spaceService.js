const { HttpError } = require('../utils/errors');
const { toSpace } = require('./mappers');

function createSpaceService({ db, config, clock }) {
  const { formatDate } = require('../utils/time');

  function validate(input, { partial = false } = {}) {
    const out = {};
    const has = (k) => input[k] !== undefined;

    if (!partial || has('name')) {
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (name.length < 2 || name.length > 80) throw new HttpError(400, 'El nombre debe tener entre 2 y 80 caracteres', 'VALIDATION');
      out.name = name;
    }
    if (!partial || has('type')) {
      if (!config.SPACE_TYPES.includes(input.type)) {
        throw new HttpError(400, `El tipo debe ser uno de: ${config.SPACE_TYPES.join(', ')}`, 'VALIDATION');
      }
      out.type = input.type;
    }
    if (!partial || has('capacity')) {
      const cap = Number(input.capacity);
      if (!Number.isInteger(cap) || cap < 1 || cap > 500) throw new HttpError(400, 'La capacidad debe ser un entero entre 1 y 500', 'VALIDATION');
      out.capacity = cap;
    }
    if (!partial || has('location')) {
      const loc = input.location === undefined ? '' : String(input.location).trim();
      if (loc.length > 100) throw new HttpError(400, 'La ubicación no puede superar 100 caracteres', 'VALIDATION');
      out.location = loc;
    }
    return out;
  }

  function list({ type, includeInactive } = {}) {
    if (type !== undefined && !config.SPACE_TYPES.includes(type)) {
      throw new HttpError(400, `El tipo debe ser uno de: ${config.SPACE_TYPES.join(', ')}`, 'VALIDATION');
    }
    let sql = 'SELECT * FROM spaces WHERE 1=1';
    const params = [];
    if (!includeInactive) sql += ' AND active = 1';
    if (type) { sql += ' AND type = ?'; params.push(type); }
    sql += ' ORDER BY CASE type WHEN \'salon\' THEN 1 WHEN \'laboratorio\' THEN 2 ELSE 3 END, name';
    return db.prepare(sql).all(...params).map((r) => toSpace(r, config));
  }

  function getById(id) {
    const row = db.prepare('SELECT * FROM spaces WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, 'El espacio no existe', 'NOT_FOUND');
    return toSpace(row, config);
  }

  function assertUniqueName(name, exceptId) {
    const dup = db.prepare('SELECT id FROM spaces WHERE name = ? COLLATE NOCASE AND id != ?').get(name, exceptId || -1);
    if (dup) throw new HttpError(409, 'Ya existe un espacio con ese nombre', 'DUPLICATE');
  }

  function create(input) {
    const data = validate(input);
    assertUniqueName(data.name);
    const info = db
      .prepare('INSERT INTO spaces (name, type, capacity, location) VALUES (?, ?, ?, ?)')
      .run(data.name, data.type, data.capacity, data.location);
    return getById(info.lastInsertRowid);
  }

  function update(id, input) {
    const current = getById(id);
    const data = validate(input, { partial: true });
    if (Object.keys(data).length === 0) throw new HttpError(400, 'No se enviaron campos para actualizar', 'VALIDATION');
    if (data.name) assertUniqueName(data.name, id);
    const merged = { ...current, ...data };
    db.prepare('UPDATE spaces SET name = ?, type = ?, capacity = ?, location = ? WHERE id = ?')
      .run(merged.name, merged.type, merged.capacity, merged.location, id);
    return getById(id);
  }

  // Baja lógica: el espacio deja de aparecer, pero se conserva el historial de sus reservas.
  function remove(id) {
    getById(id);
    const today = formatDate(clock());
    const pending = db
      .prepare("SELECT COUNT(*) AS n FROM reservations WHERE space_id = ? AND status = 'activa' AND date >= ?")
      .get(id, today);
    if (pending.n > 0) {
      throw new HttpError(409, 'El espacio tiene reservas activas pendientes; cancélalas antes de darlo de baja', 'HAS_RESERVATIONS');
    }
    db.prepare('UPDATE spaces SET active = 0 WHERE id = ?').run(id);
  }

  return { list, getById, create, update, remove };
}

module.exports = { createSpaceService };
