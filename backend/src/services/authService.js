const crypto = require('crypto');
const { promisify } = require('util');
const { HttpError } = require('../utils/errors');

const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = 'reserve_session';
const PASSWORD_MIN_LENGTH = 8;
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

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

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
      const result = await db.run(
        'INSERT INTO users (email, full_name, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [normalizedEmail, name, passwordHash, role, active, clock().toISOString()]
      );
      return sanitizeUser(await db.get('SELECT * FROM users WHERE id = ?', [result.insertId]));
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
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
    await db.run(
      `INSERT INTO account_verifications (user_id, code_hash, expires_at, attempts, created_at)
       VALUES (?, ?, ?, 0, ?)
       ON DUPLICATE KEY UPDATE code_hash = VALUES(code_hash), expires_at = VALUES(expires_at),
         attempts = 0, created_at = VALUES(created_at)`,
      [user.id, codeHash, expiresAt, now.toISOString()]
    );
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
      if (error.code === 'DUPLICATE') {
        const existing = await db.get('SELECT * FROM users WHERE email = ?', [normalizeEmail(input.email, domain)]);
        if (existing && existing.role === 'Estudiante' && existing.active) {
          throw new HttpError(409, 'Esta cuenta ya está activada. Inicia sesión con tu correo y contraseña.', 'ACCOUNT_ACTIVE');
        }
        if (existing && existing.role === 'Estudiante') {
          await issueVerification(sanitizeUser(existing));
        }
        return { accepted: true };
      }
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
    const user = await db.get('SELECT id, active FROM users WHERE email = ? AND role = ?', [normalizedEmail, 'Estudiante']);
    const verification = user && await db.get('SELECT * FROM account_verifications WHERE user_id = ?', [user.id]);
    if (!user || user.active || !verification || !/^\d{8}$/.test(String(code || ''))) {
      throw new HttpError(400, 'El código no es válido o ya venció', 'INVALID_VERIFICATION');
    }
    if (verification.expires_at <= clock().toISOString() || verification.attempts >= 5) {
      await db.run('DELETE FROM account_verifications WHERE user_id = ?', [user.id]);
      throw new HttpError(400, 'El código no es válido o ya venció', 'INVALID_VERIFICATION');
    }
    await db.run('UPDATE account_verifications SET attempts = attempts + 1 WHERE user_id = ?', [user.id]);
    if (!(await verifyPassword(String(code), verification.code_hash))) {
      if (verification.attempts + 1 >= 5) {
        await db.run('DELETE FROM account_verifications WHERE user_id = ?', [user.id]);
      }
      throw new HttpError(400, 'El código no es válido o ya venció', 'INVALID_VERIFICATION');
    }
    await db.transaction(async (tx) => {
      await tx.run('UPDATE users SET active = 1 WHERE id = ?', [user.id]);
      await tx.run('DELETE FROM account_verifications WHERE user_id = ?', [user.id]);
    });
    return { verified: true };
  }

  async function resendVerification(email) {
    const normalizedEmail = normalizeEmail(email, domain);
    const userRow = await db.get('SELECT * FROM users WHERE email = ? AND role = ? AND active = 0', [normalizedEmail, 'Estudiante']);
    if (userRow) await issueVerification(sanitizeUser(userRow));
    return { accepted: true };
  }

  async function login({ email, password }) {
    const normalizedEmail = normalizeEmail(email, domain);
    if (typeof password !== 'string' || password.length < 1 || password.length > 128) {
      throw new HttpError(400, 'Correo y contraseña son obligatorios', 'VALIDATION');
    }
    const row = await db.get('SELECT * FROM users WHERE email = ? AND active = 1', [normalizedEmail]);
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
    await db.run('DELETE FROM sessions WHERE expires_at <= ?', [now.toISOString()]);
    await db.run('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)', [
      sha256(token), row.id, expiresAt, now.toISOString(),
    ]);
    return { token, user: sanitizeUser(row), expiresAt };
  }

  async function getSession(token) {
    if (!token) return null;
    const row = await db.get(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`,
      [sha256(token), clock().toISOString()]
    );
    return row ? sanitizeUser(row) : null;
  }

  async function logout(token) {
    if (token) await db.run('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)]);
  }

  async function listUsers() {
    const rows = await db.all('SELECT id, email, full_name, role, active, created_at FROM users ORDER BY full_name');
    return rows.map((user) => ({
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      active: !!user.active,
      createdAt: user.created_at,
    }));
  }

  async function deactivateUser(id, currentUserId) {
    const user = await db.get('SELECT id, role FROM users WHERE id = ? AND active = 1', [id]);
    if (!user) throw new HttpError(404, 'La cuenta no existe o ya está desactivada', 'NOT_FOUND');
    if (id === currentUserId) throw new HttpError(409, 'No puedes desactivar tu propia cuenta', 'SELF_DEACTIVATION');
    if (user.role === 'Administrativo') {
      const { total } = await db.get("SELECT COUNT(*) AS total FROM users WHERE role = 'Administrativo' AND active = 1");
      if (total <= 1) throw new HttpError(409, 'No se puede desactivar el último administrador', 'LAST_ADMIN');
    }
    await db.run('UPDATE users SET active = 0 WHERE id = ?', [id]);
    await db.run('DELETE FROM sessions WHERE user_id = ?', [id]);
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
  const existing = await db.get('SELECT id, role, active FROM users WHERE email = ?', [normalizedEmail]);
  if (existing) {
    if (existing.role === 'Administrativo' && existing.active) return false;
    if (existing.active) {
      throw new Error('BOOTSTRAP_ADMIN_EMAIL ya pertenece a una cuenta que no es administrativa');
    }
    const passwordHash = await hashPassword(password);
    await db.transaction(async (tx) => {
      await tx.run(
        "UPDATE users SET full_name = ?, password_hash = ?, role = 'Administrativo', active = 1 WHERE id = ?",
        ['Administrador institucional', passwordHash, existing.id]
      );
      await tx.run('DELETE FROM account_verifications WHERE user_id = ?', [existing.id]);
    });
    return true;
  }
  const passwordHash = await hashPassword(password);
  await db.run(
    "INSERT INTO users (email, full_name, password_hash, role, created_at) VALUES (?, ?, ?, 'Administrativo', ?)",
    [normalizedEmail, 'Administrador institucional', passwordHash, clock().toISOString()]
  );
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
    async requireAuth(req, res, next) {
      try {
        const token = getCookieToken(req);
        const user = await authService.getSession(token);
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
        return next();
      } catch (error) {
        return next(error);
      }
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
