// Capa de acceso a la API REST del backend.
// La sesión es una cookie HttpOnly del mismo origen; no se guarda ningún token en JavaScript.
const Api = (() => {
  const CANDIDATES = ['/api'];
  let base = null;

  async function connect() {
    for (const candidate of CANDIDATES) {
      try {
        const res = await fetch(candidate + '/health', { cache: 'no-store' });
        if (res.ok) { base = candidate; return true; }
      } catch (_) { /* probar siguiente candidata */ }
    }
    base = null;
    return false;
  }

  function offlineError() {
    const err = new Error('No se pudo conectar con el servidor');
    err.offline = true;
    return err;
  }

  async function request(path, { method = 'GET', body } = {}) {
    if (!base && !(await connect())) throw offlineError();

    let res;
    try {
      res = await fetch(base + path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
    } catch (_) {
      base = null; // forzar nueva detección en la próxima llamada
      throw offlineError();
    }

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error((data && data.error && data.error.message) || `Error ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const qs = (params) => {
    const p = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') p.set(k, v);
    });
    const s = p.toString();
    return s ? '?' + s : '';
  };

  return {
    connect,
    authOptions: () => request('/auth/options'),
    me: () => request('/auth/me'),
    login: (body) => request('/auth/login', { method: 'POST', body }),
    register: (body) => request('/auth/register', { method: 'POST', body }),
    verifyEmail: (body) => request('/auth/verify-email', { method: 'POST', body }),
    resendVerification: (body) => request('/auth/verification/resend', { method: 'POST', body }),
    logout: () => request('/auth/logout', { method: 'POST', body: {} }),
    stats: () => request('/stats'),
    spaces: (params) => request('/spaces' + qs(params)),
    availability: (date) => request('/availability' + qs({ date })),
    reservations: (params) => request('/reservations' + qs(params)),
    createReservation: (body) => request('/reservations', { method: 'POST', body }),
    updateReservation: (id, body) => request(`/reservations/${id}`, { method: 'PUT', body }),
    cancelReservation: (id) => request(`/reservations/${id}`, { method: 'DELETE' }),
    adminSpaces: () => request('/admin/spaces'),
    createSpace: (body) => request('/spaces', { method: 'POST', body }),
    updateSpace: (id, body) => request(`/spaces/${id}`, { method: 'PUT', body }),
    deactivateSpace: (id) => request(`/spaces/${id}`, { method: 'DELETE' }),
    adminUsers: () => request('/admin/users'),
    createStaffUser: (body) => request('/admin/users', { method: 'POST', body }),
    deactivateUser: (id) => request(`/admin/users/${id}`, { method: 'DELETE' }),
  };
})();
