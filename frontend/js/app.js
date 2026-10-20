(() => {
  const POLL_MS = 10000; // refresco automático para ver cambios hechos por otros usuarios

  const state = {
    filter: 'all',
    date: null,
    availability: null,
    stats: null,
    reservations: [],
    openIds: new Set(), // espacios con el panel desplegado (se conserva entre refrescos)
    user: null,
    editingSpaceId: null,
  };

  const $ = (id) => document.getElementById(id);
  const board = $('board');
  const historyBody = $('historyBody');
  const historyEmpty = $('historyEmpty');

  // ---------- Utilidades ----------
  const pad = (n) => String(n).padStart(2, '0');
  const hourLabel = (h) => `${pad(h)}:00`;
  // Los datos ahora vienen de la base de datos y son compartidos: se escapan antes de pintarlos como HTML.
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function localToday() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function longDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  let toastTimer;
  function toast(message, isError) {
    const el = $('toast');
    el.textContent = message;
    el.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 3200);
  }

  function setOnline(online) {
    const el = $('conn');
    el.className = 'conn ' + (online ? 'online' : 'offline');
    el.textContent = online ? 'Servidor conectado' : 'Sin conexión con el servidor';
    const banner = $('banner');
    if (online) {
      banner.hidden = true;
    } else {
      banner.hidden = false;
      banner.innerHTML = 'No se pudo conectar con el servidor. Abre una terminal en la carpeta <b>backend</b> y ejecuta <code>npm start</code>; esta página se reconecta sola.';
    }
  }

  // ---------- Reloj ----------
  function renderClock() {
    const d = new Date();
    const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    $('clock').innerHTML = days[d.getDay()].toUpperCase() + '<br>' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  renderClock();
  setInterval(renderClock, 1000);

  // ---------- Carga de datos ----------
  async function loadAll() {
    try {
      const [availability, stats, reservations] = await Promise.all([
        Api.availability(state.date),
        Api.stats(),
        Api.reservations({ date: state.date, includeCancelled: true }),
      ]);
      state.availability = availability;
      state.stats = stats;
      state.reservations = reservations;
      setOnline(true);
      renderAll();
    } catch (err) {
      if (err.status === 401) {
        state.user = null;
        showAuth();
      } else if (err.offline) setOnline(false);
      else toast(err.message, true);
    }
  }

  // ---------- Panel superior ----------
  function renderStats() {
    const s = state.stats;
    if (!s) return;
    if (s.now.isOpen) {
      $('heroCount').innerHTML = `${s.availableNow}<span>/${s.totalSpaces}</span>`;
      $('heroLabel').textContent = `espacios disponibles ahora mismo, sobre un total de ${s.totalSpaces}`;
    } else {
      $('heroCount').innerHTML = `–<span>/${s.totalSpaces}</span>`;
      $('heroLabel').textContent = `fuera del horario de servicio (${hourLabel(s.openHour)} a ${hourLabel(s.closeHour)}); la institución tiene ${s.totalSpaces} espacios`;
    }
    $('statSalones').textContent = s.byType.salon;
    $('statLabs').textContent = s.byType.laboratorio;
    $('statSalas').textContent = s.byType.sala;
    $('statReservas').textContent = s.reservationsToday;
  }

  // ---------- Paneles de reserva ----------
  function closePanel(spaceId) {
    const existing = document.getElementById('panel-' + spaceId);
    if (existing) existing.remove();
  }

  function maxDuration(space, hour) {
    let n = 0;
    for (let h = hour; n < state.availability.maxHours; h++) {
      const slot = space.slots.find((s) => s.hour === h);
      if (slot && slot.state === 'free') n++;
      else break;
    }
    return n;
  }

  function openReserveForm(space, hour, container) {
    closePanel(space.id);
    const maxDur = maxDuration(space, hour);
    const durationOptions = Array.from({ length: maxDur }, (_, i) => {
      const d = i + 1;
      return `<option value="${d}">${d} ${d === 1 ? 'hora' : 'horas'} (hasta las ${hourLabel(hour + d)})</option>`;
    }).join('');

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.id = 'panel-' + space.id;
    panel.innerHTML = `
      <h4>Reservar ${esc(space.name)}</h4>
      <div class="sub">${esc(longDate(state.date))} · desde las ${hourLabel(hour)}</div>
      <div class="sub">Responsable: <strong>${esc(state.user.fullName)}</strong> · ${esc(state.user.role)}</div>
      <div class="field-row">
        <div class="field">
          <label for="dur-${space.id}">Duración</label>
          <select id="dur-${space.id}">${durationOptions}</select>
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="purpose-${space.id}">Motivo de la reserva</label>
          <input type="text" id="purpose-${space.id}" maxlength="200" placeholder="Ej. Clase de Programación II">
        </div>
      </div>
      <div class="form-error" id="err-${space.id}" role="alert"></div>
      <div class="panel-actions">
        <button class="primary" id="confirm-${space.id}">Confirmar reserva</button>
        <button class="ghost" id="cancelForm-${space.id}">Cancelar</button>
      </div>
    `;
    container.appendChild(panel);

    const confirmBtn = panel.querySelector('#confirm-' + space.id);
    confirmBtn.addEventListener('click', async () => {
      const errBox = document.getElementById('err-' + space.id);
      errBox.textContent = '';
      confirmBtn.disabled = true;
      try {
        const duration = Number(document.getElementById('dur-' + space.id).value);
        await Api.createReservation({
          spaceId: space.id,
          date: state.date,
          startHour: hour,
          endHour: hour + duration,
          purpose: document.getElementById('purpose-' + space.id).value.trim(),
        });
        closePanel(space.id);
        toast('Reserva confirmada: ' + space.name);
        await loadAll();
      } catch (err) {
        confirmBtn.disabled = false;
        errBox.textContent = err.message;
        if (err.status === 409) panel.dataset.stale = '1'; // otro usuario ocupó el horario: refrescar al cerrar
      }
    });
    panel.querySelector('#cancelForm-' + space.id).addEventListener('click', () => {
      const stale = panel.dataset.stale;
      closePanel(space.id);
      if (stale) loadAll();
    });
  }

  function openInfoPanel(space, res, container) {
    closePanel(space.id);
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.id = 'panel-' + space.id;
    panel.innerHTML = `
      <h4>${esc(space.name)} · ${hourLabel(res.startHour)}–${hourLabel(res.endHour)}</h4>
      <div class="sub">Reservado por <strong>${esc(res.responsibleName)}</strong> (${esc(res.role)}) — ${esc(res.purpose)}</div>
      <div class="form-error" id="err-${space.id}" role="alert"></div>
      <div class="panel-actions">
        ${res.finished ? '<span class="note">Esta reserva ya finalizó y queda en el historial.</span>' : `<button class="primary" id="edit-${space.id}">Modificar reserva</button><button class="danger" id="release-${space.id}">Cancelar reserva</button>`}
        <button class="ghost" id="cancelForm-${space.id}">Cerrar</button>
      </div>
    `;
    container.appendChild(panel);
    const canManage = state.user.role === 'Administrativo' || res.userId === state.user.id;
    const edit = panel.querySelector('#edit-' + space.id);
    const release = panel.querySelector('#release-' + space.id);
    if (!canManage) {
      if (edit) edit.remove();
      if (release) release.remove();
    }
    if (edit) edit.addEventListener('click', () => openEditReservationForm(res));
    if (release) {
      release.addEventListener('click', async () => {
        release.disabled = true;
        try {
          await Api.cancelReservation(res.id);
          closePanel(space.id);
          toast('Reserva cancelada: ' + space.name);
          await loadAll();
        } catch (err) {
          release.disabled = false;
          document.getElementById('err-' + space.id).textContent = err.message;
        }
      });
    }
    panel.querySelector('#cancelForm-' + space.id).addEventListener('click', () => closePanel(space.id));
  }

  async function openEditReservationForm(reservation) {
    closeAllPanels();
    const panel = document.createElement('section');
    panel.className = 'admin-form edit-reservation';
    panel.innerHTML = `
      <h3>Modificar reserva</h3>
      <div class="field-row">
        <label class="field">Espacio<select id="editSpace"></select></label>
        <label class="field">Fecha<input id="editDate" type="date" required></label>
        <label class="field">Hora de inicio<select id="editStart"></select></label>
        <label class="field">Hora de fin<select id="editEnd"></select></label>
        <label class="field">Motivo<input id="editPurpose" maxlength="200" required></label>
      </div>
      <p class="form-error" id="editFeedback" role="alert"></p>
      <div class="panel-actions"><button class="primary" id="saveReservation">Guardar cambios</button><button class="ghost" id="dismissEdit">Cerrar</button></div>
    `;
    document.querySelector('main').prepend(panel);
    try {
      const spaces = await Api.spaces();
      const select = $('editSpace');
      select.innerHTML = spaces.map((space) => `<option value="${space.id}">${esc(space.name)}</option>`).join('');
      select.value = String(reservation.spaceId);
      $('editDate').value = reservation.date;
      $('editPurpose').value = reservation.purpose;
      const hours = Array.from({ length: state.availability.closeHour - state.availability.openHour + 1 }, (_, i) => state.availability.openHour + i);
      $('editStart').innerHTML = hours.slice(0, -1).map((hour) => `<option value="${hour}">${hourLabel(hour)}</option>`).join('');
      $('editEnd').innerHTML = hours.slice(1).map((hour) => `<option value="${hour}">${hourLabel(hour)}</option>`).join('');
      $('editStart').value = String(reservation.startHour);
      $('editEnd').value = String(reservation.endHour);
    } catch (err) {
      $('editFeedback').textContent = err.message;
    }

    $('dismissEdit').addEventListener('click', () => panel.remove());
    $('saveReservation').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      $('editFeedback').textContent = '';
      try {
        await Api.updateReservation(reservation.id, {
          spaceId: Number($('editSpace').value),
          date: $('editDate').value,
          startHour: Number($('editStart').value),
          endHour: Number($('editEnd').value),
          purpose: $('editPurpose').value.trim(),
        });
        panel.remove();
        toast('Reserva modificada');
        await loadAll();
      } catch (err) {
        button.disabled = false;
        $('editFeedback').textContent = err.message;
      }
    });
  }

  // ---------- Tablero de espacios ----------
  function statusPill(space) {
    if (space.statusNow === 'available') return ['available', 'Disponible ahora'];
    if (space.statusNow === 'occupied') return ['occupied', 'Ocupado ahora'];
    if (space.statusNow === 'closed') return ['closed', 'Fuera de horario'];
    return space.freeHours > 0 ? ['available', `${space.freeHours} h libres`] : ['occupied', 'Sin horas libres'];
  }

  function renderTimeline(space) {
    const wrap = document.createElement('div');
    wrap.className = 'schedule';
    wrap.innerHTML = `<div class="hint">Horario del ${esc(longDate(state.date))} — toca un bloque libre para reservarlo, o uno ocupado para ver los detalles.</div>`;
    const line = document.createElement('div');
    line.className = 'timeline';

    space.slots.forEach((slot) => {
      const el = document.createElement('div');
      el.className = 'slot ' + (slot.state === 'busy' ? 'busy' : slot.state === 'past' ? 'past' : 'free');
      const small = slot.state === 'busy' ? esc(slot.reservation.responsibleName.split(' ')[0]) : slot.state === 'past' ? '—' : 'Libre';
      el.innerHTML = `${hourLabel(slot.hour)}<small>${small}</small>`;
      if (slot.state === 'busy') el.addEventListener('click', () => openInfoPanel(space, slot.reservation, wrap));
      else if (slot.state === 'free') el.addEventListener('click', () => openReserveForm(space, slot.hour, wrap));
      line.appendChild(el);
    });
    wrap.appendChild(line);
    return wrap;
  }

  function renderBoard() {
    board.innerHTML = '';
    if (!state.availability) return;
    const visible = state.availability.spaces.filter((s) => state.filter === 'all' || s.type === state.filter);
    if (!visible.length) {
      board.innerHTML = '<div class="empty">No hay espacios de este tipo registrados.</div>';
      return;
    }
    visible.forEach((space) => {
      const row = document.createElement('details');
      row.className = 'space-row';
      row.open = state.openIds.has(space.id);
      row.addEventListener('toggle', () => {
        if (row.open) state.openIds.add(space.id);
        else state.openIds.delete(space.id);
      });

      const [cls, label] = statusPill(space);
      const summary = document.createElement('summary');
      summary.innerHTML = `
        <span class="tag">${esc(space.typeLabel)}</span>
        <span class="space-name">${esc(space.name)}</span>
        <span class="space-loc">${esc(space.location)}</span>
        <span class="space-cap">${space.capacity} personas</span>
        <span class="status ${cls}">${label}</span>
        <svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      `;
      row.appendChild(summary);
      row.appendChild(renderTimeline(space));
      board.appendChild(row);
    });
  }

  // ---------- Historial ----------
  function renderHistory() {
    $('historyTitle').textContent = 'Historial de uso — ' + longDate(state.date);
    historyBody.innerHTML = '';
    historyEmpty.style.display = state.reservations.length ? 'none' : 'block';

    state.reservations.forEach((r) => {
      const tr = document.createElement('tr');
      let estado;
      if (r.status === 'cancelada') {
        tr.className = 'row-cancelled';
        estado = '<span class="state-pill cancelled">Cancelada</span>';
      } else if (r.finished) {
        estado = '<span class="state-pill done">Finalizada</span>';
      } else if (state.user.role === 'Administrativo' || r.userId === state.user.id) {
        estado = `<div class="row-actions"><button class="ghost small" data-edit-reservation="${r.id}">Modificar</button><button class="danger small" data-release="${r.id}">Cancelar</button></div>`;
      } else {
        estado = '<span class="note">Activa</span>';
      }
      tr.innerHTML = `
        <td>${esc(r.spaceName)}</td>
        <td>${hourLabel(r.startHour)} – ${hourLabel(r.endHour)}</td>
        <td>${esc(r.responsibleName)}</td>
        <td><span class="role-pill">${esc(r.role)}</span></td>
        <td>${esc(r.purpose)}</td>
        <td>${estado}</td>
      `;
      historyBody.appendChild(tr);
    });

    historyBody.querySelectorAll('[data-release]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await Api.cancelReservation(Number(btn.dataset.release));
          toast('Reserva cancelada');
          await loadAll();
        } catch (err) {
          btn.disabled = false;
          toast(err.message, true);
        }
      });
    });
    historyBody.querySelectorAll('[data-edit-reservation]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const reservation = state.reservations.find((item) => item.id === Number(btn.dataset.editReservation));
        if (reservation) openEditReservationForm(reservation);
      });
    });
  }

  function renderAll() {
    renderStats();
    renderBoard();
    renderHistory();
  }

  async function refreshAdmin() {
    if (state.user.role !== 'Administrativo') return;
    const [spaces, users] = await Promise.all([Api.adminSpaces(), Api.adminUsers()]);
    $('adminSpaces').innerHTML = spaces.map((space) => `
      <article class="admin-item">
        <div><strong>${esc(space.name)}</strong><span>${esc(space.typeLabel)} · ${space.capacity} personas · ${esc(space.location || 'Sin ubicación')}</span></div>
        <span class="state-pill ${space.active ? 'done' : 'cancelled'}">${space.active ? 'Activo' : 'Inactivo'}</span>
        <button class="ghost small" data-edit-space="${space.id}" ${space.active ? '' : 'disabled'}>Editar</button>
        ${space.active ? `<button class="danger small" data-deactivate-space="${space.id}">Dar de baja</button>` : ''}
      </article>`).join('');
    $('adminUsers').innerHTML = users.map((user) => `
      <article class="admin-item">
        <div><strong>${esc(user.fullName)}</strong><span>${esc(user.email)} · ${esc(user.role)}</span></div>
        <span class="state-pill ${user.active ? 'done' : 'cancelled'}">${user.active ? 'Activo' : 'Inactivo'}</span>
        ${user.active && user.id !== state.user.id ? `<button class="danger small" data-deactivate-user="${user.id}">Desactivar cuenta</button>` : ''}
      </article>`).join('');

    $('adminSpaces').querySelectorAll('[data-edit-space]').forEach((button) => {
      button.addEventListener('click', () => {
        const space = spaces.find((item) => item.id === Number(button.dataset.editSpace));
        if (!space) return;
        state.editingSpaceId = space.id;
        $('spaceName').value = space.name;
        $('spaceType').value = space.type;
        $('spaceCapacity').value = space.capacity;
        $('spaceLocation').value = space.location;
        $('spaceFormTitle').textContent = 'Editar espacio';
        $('saveSpaceButton').textContent = 'Guardar cambios';
        $('resetSpaceForm').hidden = false;
        $('spaceName').focus();
      });
    });
    $('adminSpaces').querySelectorAll('[data-deactivate-space]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (!window.confirm('¿Dar de baja este espacio? Se conservará su historial.')) return;
        try {
          await Api.deactivateSpace(Number(button.dataset.deactivateSpace));
          await Promise.all([refreshAdmin(), loadAll()]);
          toast('Espacio dado de baja');
        } catch (err) {
          toast(err.message, true);
        }
      });
    });
    $('adminUsers').querySelectorAll('[data-deactivate-user]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (!window.confirm('¿Desactivar esta cuenta? Se cerrarán sus sesiones activas.')) return;
        try {
          await Api.deactivateUser(Number(button.dataset.deactivateUser));
          await refreshAdmin();
          toast('Cuenta desactivada');
        } catch (err) {
          toast(err.message, true);
        }
      });
    });
  }

  // ---------- Eventos ----------
  $('tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.filter = btn.dataset.type;
    renderBoard();
  });

  $('dateInput').addEventListener('change', (e) => {
    if (!e.target.value) return;
    state.date = e.target.value;
    closeAllPanels();
    loadAll();
  });
  $('todayBtn').addEventListener('click', () => {
    state.date = (state.stats && state.stats.now.date) || localToday();
    $('dateInput').value = state.date;
    closeAllPanels();
    loadAll();
  });

  function closeAllPanels() {
    document.querySelectorAll('.panel').forEach((p) => p.remove());
  }

  function showAuth() {
    $('authScreen').hidden = false;
    $('appShell').hidden = true;
  }

  async function enterApp(user) {
    state.user = user;
    $('authScreen').hidden = true;
    $('appShell').hidden = false;
    $('userName').textContent = user.fullName;
    $('roleBadge').textContent = user.role;
    $('adminSection').hidden = user.role !== 'Administrativo';
    try {
      const stats = await Api.stats();
      state.stats = stats;
      state.date = stats.now.date; // la fecha "hoy" la define el servidor
    } catch (err) {
      if (err.status === 401) {
        state.user = null;
        showAuth();
        return;
      }
      state.date = localToday();
    }
    $('dateInput').value = state.date;
    await loadAll();
    if (!state.user) return;
    if (user.role === 'Administrativo') {
      try {
        await refreshAdmin();
      } catch (err) {
        toast(err.message, true);
      }
    }

    // Refresco automático (no interrumpe si el usuario está llenando un formulario)
    if (!pollingStarted) {
      pollingStarted = true;
      setInterval(() => {
        if (state.user && !document.hidden && !document.querySelector('.panel')) loadAll();
      }, POLL_MS);
      document.addEventListener('visibilitychange', () => {
        if (state.user && !document.hidden && !document.querySelector('.panel')) loadAll();
      });
    }
  }

  document.querySelectorAll('[data-auth-view]').forEach((button) => {
    button.addEventListener('click', () => {
      const register = button.dataset.authView === 'register';
      document.querySelectorAll('[data-auth-view]').forEach((tab) => tab.classList.toggle('active', tab === button));
      $('loginForm').hidden = register;
      $('registerForm').hidden = !register;
      $('verificationForm').hidden = true;
    });
  });

  $('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('loginFeedback').textContent = '';
    try {
      await Api.login({ email: $('loginEmail').value, password: $('loginPassword').value });
      const { user } = await Api.me();
      $('loginPassword').value = '';
      await enterApp(user);
    } catch (err) {
      $('loginFeedback').textContent = err.message;
    }
  });

  $('registerForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('registerFeedback').textContent = '';
    if ($('registerPassword').value !== $('registerConfirm').value) {
      $('registerFeedback').textContent = 'Las contraseñas no coinciden.';
      return;
    }
    try {
      await Api.register({
        fullName: $('registerName').value,
        email: $('registerEmail').value,
        password: $('registerPassword').value,
      });
      $('verificationEmail').value = $('registerEmail').value.trim();
      $('verificationCode').value = '';
      $('loginForm').hidden = true;
      $('registerForm').hidden = true;
      $('verificationForm').hidden = false;
      $('verificationFeedback').textContent = 'Revisa tu correo institucional para obtener el código.';
    } catch (err) {
      $('registerFeedback').textContent = err.message;
    }
  });

  $('verificationForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('verificationFeedback').textContent = '';
    try {
      await Api.verifyEmail({
        email: $('verificationEmail').value,
        code: $('verificationCode').value,
      });
      await Api.login({
        email: $('verificationEmail').value,
        password: $('registerPassword').value,
      });
      const { user } = await Api.me();
      $('registerPassword').value = '';
      $('registerConfirm').value = '';
      await enterApp(user);
    } catch (err) {
      $('verificationFeedback').textContent = err.message;
    }
  });

  $('resendVerification').addEventListener('click', async () => {
    $('verificationFeedback').textContent = '';
    try {
      await Api.resendVerification({ email: $('verificationEmail').value });
      $('verificationFeedback').textContent = 'Si hay una cuenta pendiente, enviaremos otro código.';
    } catch (err) {
      $('verificationFeedback').textContent = err.message;
    }
  });

  $('logoutButton').addEventListener('click', async () => {
    try {
      await Api.logout();
      state.user = null;
      state.availability = null;
      state.stats = null;
      showAuth();
    } catch (err) {
      toast(err.message, true);
    }
  });

  function resetSpaceForm() {
    state.editingSpaceId = null;
    $('spaceForm').reset();
    $('spaceFormTitle').textContent = 'Registrar espacio';
    $('saveSpaceButton').textContent = 'Guardar espacio';
    $('resetSpaceForm').hidden = true;
    $('spaceFeedback').textContent = '';
  }

  let pollingStarted = false;
  $('spaceForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('spaceFeedback').textContent = '';
    const payload = {
      name: $('spaceName').value,
      type: $('spaceType').value,
      capacity: Number($('spaceCapacity').value),
      location: $('spaceLocation').value,
    };
    const updating = Boolean(state.editingSpaceId);
    try {
      if (state.editingSpaceId) await Api.updateSpace(state.editingSpaceId, payload);
      else await Api.createSpace(payload);
      resetSpaceForm();
      await Promise.all([refreshAdmin(), loadAll()]);
      toast(updating ? 'Espacio actualizado' : 'Espacio registrado');
    } catch (err) {
      $('spaceFeedback').textContent = err.message;
    }
  });
  $('resetSpaceForm').addEventListener('click', resetSpaceForm);

  $('staffForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('staffFeedback').textContent = '';
    try {
      await Api.createStaffUser({
        fullName: $('staffName').value,
        email: $('staffEmail').value,
        password: $('staffPassword').value,
        role: $('staffRole').value,
      });
      $('staffForm').reset();
      await refreshAdmin();
      toast('Cuenta de personal creada');
    } catch (err) {
      $('staffFeedback').textContent = err.message;
    }
  });

  async function init() {
    showAuth();
    const connected = await Api.connect();
    if (!connected) {
      $('loginFeedback').textContent = 'No hay conexión con el servidor. Intenta nuevamente cuando esté disponible.';
      return;
    }
    try {
      const options = await Api.authOptions();
      $('emailDomain').textContent = '@' + options.emailDomain;
      const { user } = await Api.me();
      await enterApp(user);
    } catch (err) {
      if (err.status !== 401) $('loginFeedback').textContent = err.message;
    }
  }

  init();
})();
