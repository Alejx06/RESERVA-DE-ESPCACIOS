const { HttpError } = require('../utils/errors');
const { toSpace } = require('./mappers');

function createSpaceService({ db, config, clock }) {
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

  async function list({ type, includeInactive } = {}) {
    if (type !== undefined && !config.SPACE_TYPES.includes(type)) {
      throw new HttpError(400, `El tipo debe ser uno de: ${config.SPACE_TYPES.join(', ')}`, 'VALIDATION');
    }
    let sql = 'SELECT * FROM spaces WHERE 1=1';
    const params = [];
    if (!includeInactive) sql += ' AND active = 1';
    if (type) { sql += ' AND type = ?'; params.push(type); }
    sql += " ORDER BY CASE type WHEN 'salon' THEN 1 WHEN 'laboratorio' THEN 2 ELSE 3 END, name";
    return (await db.all(sql, params)).map((r) => toSpace(r, config));
  }

  async function getById(id) {
    const row = await db.get('SELECT * FROM spaces WHERE id = ?', [id]);
    if (!row) throw new HttpError(404, 'El espacio no existe', 'NOT_FOUND');
    return toSpace(row, config);
  }

  // La columna name es UNIQUE con collation insensible a mayúsculas y tildes ("Salon 1" = "Salón 1").
  async function assertUniqueName(name, exceptId) {
    const dup = await db.get('SELECT id FROM spaces WHERE name = ? AND id <> ?', [name, exceptId || 0]);
    if (dup) throw new HttpError(409, 'Ya existe un espacio con ese nombre', 'DUPLICATE');
  }

  async function create(input) {
    const data = validate(input);
    await assertUniqueName(data.name);
    const res = await db.run('INSERT INTO spaces (name, type, capacity, location) VALUES (?, ?, ?, ?)', [
      data.name, data.type, data.capacity, data.location,
    ]);
    return getById(res.insertId);
  }

  async function update(id, input) {
    const current = await getById(id);
    const data = validate(input, { partial: true });
    if (Object.keys(data).length === 0) throw new HttpError(400, 'No se enviaron campos para actualizar', 'VALIDATION');
    if (data.name) await assertUniqueName(data.name, id);
    const merged = { ...current, ...data };
    await db.run('UPDATE spaces SET name = ?, type = ?, capacity = ?, location = ? WHERE id = ?', [
      merged.name, merged.type, merged.capacity, merged.location, id,
    ]);
    return getById(id);
  }

  // Lock the same row used by reservation creation so a booking cannot race with deactivation.
  async function remove(id) {
    await db.transaction(async (tx) => {
      const space = await tx.get('SELECT id FROM spaces WHERE id = ? FOR UPDATE', [id]);
      if (!space) throw new HttpError(404, 'El espacio no existe', 'NOT_FOUND');
      await tx.run('UPDATE spaces SET active = 0 WHERE id = ?', [id]);
    });
  }

  return { list, getById, create, update, remove };
}

module.exports = { createSpaceService };
