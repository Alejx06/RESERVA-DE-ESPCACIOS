const crypto = require('crypto');
const { promisify } = require('util');
const { HttpError } = require('../utils/errors');

const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = 'reserve_session';
const PASSWORD_MIN_LENGTH = 12;
const SESSION_TTL_HOURS = 12;

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
  };
}

function normalizeEmail(email, domain) {
  if (typeof email !== 'string') throw new HttpError(400, 'El correo institucional no es válido', 'VALIDATION');
  const normalized = email.trim().toLowerCase();
  const escapedDomain = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`^[^\\s@]+@${escapedDomain}$`).test(normalized)) {
    throw new HttpError(400, `Usa un correo institucional terminado en @${domain}`, 'VALIDATION');
  }
  return normalized;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derivedKey = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `${salt.toString('hex')}:${derivedKey.toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
  const [saltHex, hashHex] = storedHash.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length, { N: 16384, r: 8, p: 1 });
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function createAuthService({ db, config, clock, sendVerificationEmail }) {
  const domain = config.EMAIL_DOMAIN || 'amigo.edu.co';
  const ttlHours = config.SESSION_TTL_HOURS || SESSION_TTL_HOURS;
  let dummyPasswordHash;

  function validateName(name) {
    const fullName = typeof name === 'string' ? name.trim() : '';
    if (fullName.length < 2 || fullName.length > 80) {
      throw new HttpError(400, 'El nombre debe tener entre 2 y 80 caracteres', 'VALIDATION');
    }
    return fullName;
  }

  function validatePassword(password) {
    if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH || password.length > 128) {
      throw new HttpError(400, `La contraseña debe tener entre ${PASSWORD_MIN_LENGTH} y 128 caracteres`, 'VALIDATION');
    }
    return password;
  }

  async function createAccount({ email, fullName, password, role, active = 1 }) {
    const normalizedEmail = normalizeEmail(email, domain);
    const name = validateName(fullName);
    const safePassword = validatePassword(password);
    if (!config.ROLES.includes(role)) throw new HttpError(400, 'El perfil seleccionado no es válido', 'VALIDATION');
    const passwordHash = await hashPassword(safePassword);
    try {
      const result = db.prepare(`
        INSERT INTO users (email, full_name, password_hash, role, active, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(normalizedEmail, name, passwordHash, role, active, clock().toISOString());
      return sanitizeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid));
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new HttpError(409, 'Ya existe una cuenta con ese correo institucional', 'DUPLICATE');
      }
      throw error;
    }
  }

  async function issueVerification(user) {
    if (!sendVerificationEmail) {
      throw new HttpError(503, 'El correo institucional no está configurado para enviar códigos de verificación', 'EMAIL_NOT_CONFIGURED');
    }
    const code = String(crypto.randomInt(0, 100000000)).padStart(8, '0');
    const now = clock();
    const expiresAt = new Date(now.getTime() + (config.EMAIL_VERIFICATION_TTL_MINUTES || 15) * 60 * 1000).toISOString();
    const codeHash = await hashPassword(code);
    db.prepare(`
      INSERT INTO account_verifications (user_id, code_hash, expires_at, attempts, created_at)
      VALUES (?, ?, ?, 0, ?)
      ON CONFLICT(user_id) DO UPDATE SET code_hash = excluded.code_hash,
        expires_at = excluded.expires_at, attempts = 0, created_at = excluded.created_at
    `).run(user.id, codeHash, expiresAt, now.toISOString());
    try {
      await sendVerificationEmail({ email: user.email, fullName: user.fullName, code });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      console.error('No se pudo enviar el correo de verificación:', error);
      throw new HttpError(502, 'No se pudo enviar el código al correo institucional. Intenta solicitarlo de nuevo más tarde.', 'EMAIL_DELIVERY_FAILED');
    }
  }

  async function registerStudent(input) {
    let user;
    try {
      user = await createAccount({ ...input, role: 'Estudiante', active: 0 });
    } catch (error) {
      if (error.code === 'DUPLICATE') return { accepted: true };
      throw error;
    }
    await issueVerification(user);
    return { accepted: true };
  }

  async function createStaff(input) {
    if (!['Profesor', 'Administrativo'].includes(input.role)) {
      throw new HttpError(400, 'Solo se pueden crear cuentas de profesor o administrativo', 'VALIDATION');
    }
    return createAccount(input);
  }

  async function verifyEmail({ email, code }) {
    const normalizedEmail = normalizeEmail(email, domain);
    const user = db.prepare('SELECT id, active FROM users WHERE email = ? AND role = ?')
      .get(normalizedEmail, 'Estudiante');
    const verification = user && db.prepare('SELECT * FROM account_verifications WHERE user_id = ?').get(user.id);
    if (!user || user.active || !verification || !/^\d{8}$/.test(String(code || ''))) {
      throw new HttpError(400, 'El código no es válido o ya venció', 'INVALID_VERIFICATION');
    }
    if (verification.expires_at <= clock().toISOString() || verification.attempts >= 5) {
      db.prepare('DELETE FROM account_verifications WHERE user_id = ?').run(user.id);
      throw new HttpError(400, 'El código no es válido o ya venció', 'INVALID_VERIFICATION');
    }
    db.prepare('UPDATE account_verifications SET attempts = attempts + 1 WHERE user_id = ?').run(user.id);
    if (!(await verifyPassword(String(code), verification.code_hash))) {
      if (verification.attempts + 1 >= 5) {
        db.prepare('DELETE FROM account_verifications WHERE user_id = ?').run(user.id);
      }
      throw new HttpError(400, 'El código no es válido o ya venció', 'INVALID_VERIFICATION');
    }
    const run = db.transaction(() => {
      db.prepare('UPDATE users SET active = 1 WHERE id = ?').run(user.id);
      db.prepare('DELETE FROM account_verifications WHERE user_id = ?').run(user.id);
    });
    run();
    return { verified: true };
  }

  async function resendVerification(email) {
    const normalizedEmail = normalizeEmail(email, domain);
    const userRow = db.prepare('SELECT * FROM users WHERE email = ? AND role = ? AND active = 0')
      .get(normalizedEmail, 'Estudiante');
    if (userRow) await issueVerification(sanitizeUser(userRow));
    return { accepted: true };
  }

  async function login({ email, password }) {
    const normalizedEmail = normalizeEmail(email, domain);
    if (typeof password !== 'string' || password.length < 1 || password.length > 128) {
      throw new HttpError(400, 'Correo y contraseña son obligatorios', 'VALIDATION');
    }
    const row = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(normalizedEmail);
    if (!row) {
      dummyPasswordHash = dummyPasswordHash || await hashPassword('not-a-real-account-password');
      await verifyPassword(password, dummyPasswordHash);
      throw new HttpError(401, 'Correo o contraseña incorrectos', 'UNAUTHORIZED');
    }
    if (!(await verifyPassword(password, row.password_hash))) {
      throw new HttpError(401, 'Correo o contraseña incorrectos', 'UNAUTHORIZED');
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const now = clock();
    const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000).toISOString();
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now.toISOString());
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(crypto.createHash('sha256').update(token).digest('hex'), row.id, expiresAt, now.toISOString());
    return { token, user: sanitizeUser(row), expiresAt };
  }

  function getSession(token) {
    if (!token) return null;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const row = db.prepare(`
      SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1
    `).get(tokenHash, clock().toISOString());
    return row ? sanitizeUser(row) : null;
  }

  function logout(token) {
    if (token) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?')
        .run(crypto.createHash('sha256').update(token).digest('hex'));
    }
  }

  function listUsers() {
    return db.prepare('SELECT id, email, full_name, role, active, created_at FROM users ORDER BY full_name')
      .all().map((user) => ({
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        active: !!user.active,
        createdAt: user.created_at,
      }));
  }

  function deactivateUser(id, currentUserId) {
    const user = db.prepare('SELECT id, role FROM users WHERE id = ? AND active = 1').get(id);
    if (!user) throw new HttpError(404, 'La cuenta no existe o ya está desactivada', 'NOT_FOUND');
    if (id === currentUserId) throw new HttpError(409, 'No puedes desactivar tu propia cuenta', 'SELF_DEACTIVATION');
    if (user.role === 'Administrativo') {
      const admins = db.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'Administrativo' AND active = 1").get().total;
      if (admins <= 1) throw new HttpError(409, 'No se puede desactivar el último administrador', 'LAST_ADMIN');
    }
    db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }

  return {
    createAccount,
    registerStudent,
    createStaff,
    verifyEmail,
    resendVerification,
    login,
    getSession,
    logout,
    listUsers,
    deactivateUser,
  };
}

async function bootstrapAdmin(db, config, clock = () => new Date()) {
  const email = config.BOOTSTRAP_ADMIN_EMAIL || '';
  const password = config.BOOTSTRAP_ADMIN_PASSWORD || '';
  if (!email && !password) return false;
  if (!email || !password) throw new Error('Configura BOOTSTRAP_ADMIN_EMAIL y BOOTSTRAP_ADMIN_PASSWORD juntos');
  const normalizedEmail = normalizeEmail(email, config.EMAIL_DOMAIN || 'amigo.edu.co');
  if (password.length < PASSWORD_MIN_LENGTH || password.length > 128) {
    throw new Error(`BOOTSTRAP_ADMIN_PASSWORD debe tener entre ${PASSWORD_MIN_LENGTH} y 128 caracteres`);
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    const user = db.prepare('SELECT id, role, active FROM users WHERE id = ?').get(existing.id);
    if (user.role === 'Administrativo' && user.active) return false;
    if (user.active) {
      throw new Error('BOOTSTRAP_ADMIN_EMAIL ya pertenece a una cuenta que no es administrativa');
    }
    const passwordHash = await hashPassword(password);
    const run = db.transaction(() => {
      db.prepare(`
        UPDATE users SET full_name = ?, password_hash = ?, role = 'Administrativo', active = 1
        WHERE id = ?
      `).run('Administrador institucional', passwordHash, user.id);
      db.prepare('DELETE FROM account_verifications WHERE user_id = ?').run(user.id);
    });
    run();
    return true;
  }
  const passwordHash = await hashPassword(password);
  db.prepare(`
    INSERT INTO users (email, full_name, password_hash, role, created_at)
    VALUES (?, ?, ?, 'Administrativo', ?)
  `).run(normalizedEmail, 'Administrador institucional', passwordHash, clock().toISOString());
  return true;
}

function getCookieToken(req) {
  const cookieHeader = req.headers.cookie || '';
  const cookie = cookieHeader.split(';').map((value) => value.trim())
    .find((value) => value.startsWith(`${SESSION_COOKIE}=`));
  return cookie ? decodeURIComponent(cookie.slice(SESSION_COOKIE.length + 1)) : null;
}

function sessionCookie(token, config, maxAge) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${config.NODE_ENV === 'production' ? '; Secure' : ''}`;
}

function authMiddleware(authService) {
  return {
    requireAuth(req, res, next) {
      const token = getCookieToken(req);
      const user = authService.getSession(token);
      if (!user) return next(new HttpError(401, 'Inicia sesión para continuar', 'UNAUTHORIZED'));
      req.user = user;
      req.sessionToken = token;
      const origin = req.get('origin');
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && origin) {
        try {
          if (new URL(origin).host !== req.get('host')) {
            return next(new HttpError(403, 'Origen no permitido', 'FORBIDDEN'));
          }
        } catch {
          return next(new HttpError(403, 'Origen no permitido', 'FORBIDDEN'));
        }
      }
      next();
    },
    requireAdmin(req, res, next) {
      if (!req.user || req.user.role !== 'Administrativo') {
        return next(new HttpError(403, 'Esta acción requiere perfil administrativo', 'FORBIDDEN'));
      }
      next();
    },
  };
}

module.exports = {
  createAuthService,
  bootstrapAdmin,
  authMiddleware,
  normalizeEmail,
  hashPassword,
  SESSION_COOKIE,
  sessionCookie,
  getCookieToken,
};
