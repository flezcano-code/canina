/**
 * admin.js
 * Lógica del panel de administrador. Completamente separado de app.js
 * (la página del cliente) — comparten api.js y utils.js, nada más.
 *
 * La sesión se guarda en sessionStorage (no localStorage): se borra sola
 * al cerrar la pestaña, lo que reduce la ventana de riesgo si alguien más
 * usa el mismo computador después.
 */

import { api } from './api.js';
import { $, $$, showToast, formatDateLong, formatCLP } from './utils.js';

const DIAS_SEMANA = [
  { valor: 1, corto: 'Lun' }, { valor: 2, corto: 'Mar' }, { valor: 3, corto: 'Mié' },
  { valor: 4, corto: 'Jue' }, { valor: 5, corto: 'Vie' }, { valor: 6, corto: 'Sáb' },
  { valor: 0, corto: 'Dom' },
];

const state = {
  token: sessionStorage.getItem('pawbook_admin_token') || null,
  reservas: [],
  servicios: [],
  config: null,
  bloqueos: [], // [{fecha, motivo, grupoSemana}]
  diasSeleccionados: new Set(),
};

init();

async function init() {
  wireLogin();
  wireLogout();
  wireTabs();
  wireReservasFiltros();
  wireHorarioForm();
  wireBloqueoFechas();
  wireServicioModal();

  if (state.token) {
    try {
      await api.verificarSesion(state.token);
      mostrarDashboard();
    } catch (err) {
      cerrarSesionLocal();
    }
  }
}

// ---------------------------------------------------------------------------
// LOGIN / SESIÓN
// ---------------------------------------------------------------------------
function wireLogin() {
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const usuario = $('#login-usuario').value.trim();
    const password = $('#login-password').value;
    const errorEl = $('#login-error');
    errorEl.classList.add('hidden');

    try {
      const { token } = await api.login(usuario, password);
      state.token = token;
      sessionStorage.setItem('pawbook_admin_token', token);
      mostrarDashboard();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    }
  });
}

function wireLogout() {
  $('#btn-logout').addEventListener('click', async () => {
    try { await api.logout(state.token); } catch (_) { /* no importa si falla */ }
    cerrarSesionLocal();
  });
}

function cerrarSesionLocal() {
  state.token = null;
  sessionStorage.removeItem('pawbook_admin_token');
  $('#dashboard-view').classList.add('hidden');
  $('#login-view').classList.remove('hidden');
}

async function mostrarDashboard() {
  $('#login-view').classList.add('hidden');
  $('#dashboard-view').classList.remove('hidden');
  activarTab('reservas');
  await Promise.all([cargarReservas(), cargarConfiguracion(), cargarServicios()]);
}

// ---------------------------------------------------------------------------
// TABS
// ---------------------------------------------------------------------------
function wireTabs() {
  $$('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => activarTab(btn.dataset.tab));
  });
}

function activarTab(nombre) {
  $$('.tab-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === nombre));
  $$('.tab-panel').forEach((panel) => panel.classList.toggle('hidden', panel.dataset.tabPanel !== nombre));
}

// ---------------------------------------------------------------------------
// RESERVAS
// ---------------------------------------------------------------------------
function wireReservasFiltros() {
  $('#filtro-fecha').addEventListener('change', cargarReservas);
  $('#filtro-estado').addEventListener('change', cargarReservas);
  $('#btn-limpiar-filtros').addEventListener('click', () => {
    $('#filtro-fecha').value = '';
    $('#filtro-estado').value = '';
    cargarReservas();
  });
}

async function cargarReservas() {
  const filtros = {};
  if ($('#filtro-fecha').value) filtros.fecha = $('#filtro-fecha').value;
  if ($('#filtro-estado').value) filtros.estado = $('#filtro-estado').value;

  $('#reservas-list').innerHTML = `<div class="loading-block"><div class="paw-loader"><span>🐾</span><span>🐾</span><span>🐾</span></div><span>Cargando reservas…</span></div>`;

  try {
    state.reservas = await api.getReservasAdmin(state.token, filtros);
  } catch (err) {
    showToast(err.message);
    return;
  }
  renderReservas();
}

const ESTADOS = ['Pendiente', 'Confirmada', 'Completada', 'Cancelada', 'No asistió'];

function renderReservas() {
  const list = $('#reservas-list');
  if (!state.reservas.length) {
    list.innerHTML = `<p class="text-center text-ink/40 py-10">No hay reservas para este filtro.</p>`;
    return;
  }

  list.innerHTML = state.reservas.map((r) => `
    <div class="reserva-card" data-id="${r.id}">
      <div>
        <p class="font-semibold">${r.mascotaNombre} <span class="text-ink/40 font-normal">· ${r.clienteNombre}</span></p>
        <p class="text-sm text-ink/60">${r.servicioNombre} — ${formatDateLong(r.fecha)} a las ${r.hora}</p>
        <p class="text-sm text-honey font-medium">${formatCLP(r.precio)}</p>
      </div>
      <div class="flex items-center gap-2">
        <span class="estado-badge estado-${String(r.estado).replace(' ', '-')}">${r.estado}</span>
        <select class="estado-select border border-line rounded-full px-3 py-1.5 text-sm" data-id="${r.id}">
          ${ESTADOS.map((e) => `<option ${e === r.estado ? 'selected' : ''}>${e}</option>`).join('')}
        </select>
      </div>
    </div>
  `).join('');

  $$('.estado-select', list).forEach((select) => {
    select.addEventListener('change', async () => {
      try {
        await api.cambiarEstadoReserva(state.token, select.dataset.id, select.value);
        showToast('Estado actualizado', 'success');
        cargarReservas();
      } catch (err) {
        showToast(err.message);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// HORARIO / CONFIGURACIÓN
// ---------------------------------------------------------------------------
async function cargarConfiguracion() {
  try {
    state.config = await api.getConfiguracionPublica();
    state.bloqueos = await api.getBloqueosAdmin(state.token);
  } catch (err) {
    showToast(err.message);
    return;
  }

  state.diasSeleccionados = new Set(state.config.diasHabiles);
  renderDiasSemanaPicker();

  $('#cfg-hora-inicio').value = state.config.horaInicio;
  $('#cfg-hora-fin').value = state.config.horaFin;
  $('#cfg-almuerzo-inicio').value = state.config.almuerzoInicio;
  $('#cfg-almuerzo-fin').value = state.config.almuerzoFin;
  $('#cfg-intervalo').value = state.config.intervaloMinutos;

  renderFechasBloqueadas();
}

function renderDiasSemanaPicker() {
  const wrap = $('#dias-semana-picker');
  wrap.innerHTML = DIAS_SEMANA.map((d) => `
    <button type="button" class="day-toggle ${state.diasSeleccionados.has(d.valor) ? 'active' : ''}" data-dia="${d.valor}">${d.corto}</button>
  `).join('');

  $$('.day-toggle', wrap).forEach((btn) => {
    btn.addEventListener('click', () => {
      const dia = Number(btn.dataset.dia);
      if (state.diasSeleccionados.has(dia)) state.diasSeleccionados.delete(dia);
      else state.diasSeleccionados.add(dia);
      renderDiasSemanaPicker();
    });
  });
}

function wireHorarioForm() {
  $('#btn-guardar-horario').addEventListener('click', async () => {
    const config = {
      diasHabiles: Array.from(state.diasSeleccionados),
      horaInicio: $('#cfg-hora-inicio').value,
      horaFin: $('#cfg-hora-fin').value,
      almuerzoInicio: $('#cfg-almuerzo-inicio').value,
      almuerzoFin: $('#cfg-almuerzo-fin').value,
      intervaloMinutos: Number($('#cfg-intervalo').value),
    };

    if (!config.diasHabiles.length) {
      showToast('Debes dejar al menos un día habilitado');
      return;
    }

    try {
      state.config = await api.guardarConfiguracion(state.token, config);
      showToast('Horario guardado', 'success');
    } catch (err) {
      showToast(err.message);
    }
  });
}

function wireBloqueoFechas() {
  $('#btn-bloquear-fecha').addEventListener('click', async () => {
    const fecha = $('#bloqueo-fecha').value;
    const motivo = $('#bloqueo-motivo').value.trim();
    if (!fecha) { showToast('Elige una fecha'); return; }

    try {
      await api.bloquearFecha(state.token, fecha, motivo);
      $('#bloqueo-fecha').value = '';
      $('#bloqueo-motivo').value = '';
      await cargarConfiguracion();
      showToast('Día bloqueado', 'success');
    } catch (err) {
      showToast(err.message);
    }
  });

  $('#btn-bloquear-semana').addEventListener('click', async () => {
    const fecha = $('#bloqueo-semana-fecha').value;
    const motivo = $('#bloqueo-semana-motivo').value.trim();
    if (!fecha) { showToast('Elige un día de referencia para la semana'); return; }

    try {
      await api.bloquearSemana(state.token, fecha, motivo);
      $('#bloqueo-semana-fecha').value = '';
      $('#bloqueo-semana-motivo').value = '';
      await cargarConfiguracion();
      showToast('Semana bloqueada', 'success');
    } catch (err) {
      showToast(err.message);
    }
  });
}

function renderFechasBloqueadas() {
  const list = $('#fechas-bloqueadas-list');
  const bloqueos = state.bloqueos || [];

  if (!bloqueos.length) {
    list.innerHTML = `<p class="text-sm text-ink/40">No hay días ni semanas bloqueadas.</p>`;
    return;
  }

  // Agrupa por semana (grupoSemana no vacío) y deja el resto como bloqueos sueltos.
  const semanas = new Map();
  const sueltos = [];
  bloqueos.forEach((b) => {
    if (b.grupoSemana) {
      if (!semanas.has(b.grupoSemana)) semanas.set(b.grupoSemana, []);
      semanas.get(b.grupoSemana).push(b.fecha);
    } else {
      sueltos.push(b);
    }
  });

  const chipsSemana = Array.from(semanas.entries()).map(([grupo, fechas]) => {
    fechas.sort();
    const desde = formatDateLong(fechas[0]);
    const hasta = formatDateLong(fechas[fechas.length - 1]);
    return `
      <div class="blocked-date-chip">
        <span>📅 Semana: ${desde} — ${hasta}</span>
        <button type="button" class="text-accent hover:underline text-xs font-medium" data-grupo="${grupo}">Desbloquear semana</button>
      </div>
    `;
  });

  const chipsSueltos = sueltos.map((b) => `
    <div class="blocked-date-chip">
      <span>${formatDateLong(b.fecha)}${b.motivo ? ` · ${b.motivo}` : ''}</span>
      <button type="button" class="text-accent hover:underline text-xs font-medium" data-fecha="${b.fecha}">Desbloquear</button>
    </div>
  `);

  list.innerHTML = chipsSemana.join('') + chipsSueltos.join('');

  $$('button[data-fecha]', list).forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api.desbloquearFecha(state.token, btn.dataset.fecha);
        await cargarConfiguracion();
      } catch (err) {
        showToast(err.message);
      }
    });
  });

  $$('button[data-grupo]', list).forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api.desbloquearSemana(state.token, btn.dataset.grupo);
        await cargarConfiguracion();
      } catch (err) {
        showToast(err.message);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// SERVICIOS
// ---------------------------------------------------------------------------
async function cargarServicios() {
  try {
    state.servicios = await api.getServicios();
  } catch (err) {
    showToast(err.message);
    return;
  }
  renderServiciosAdmin();
}

function renderServiciosAdmin() {
  const list = $('#servicios-admin-list');
  list.innerHTML = state.servicios.map((s) => `
    <div class="reserva-card">
      <div class="flex items-center gap-3">
        <span class="text-2xl">${s.icono || '🐾'}</span>
        <div>
          <p class="font-semibold">${s.nombre}</p>
          <p class="text-sm text-ink/50">${s.duracion} min · ${formatCLP(s.precio)}</p>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <button type="button" class="text-primary hover:underline text-sm font-medium" data-editar="${s.id}">Editar</button>
        <button type="button" class="text-accent hover:underline text-sm font-medium" data-eliminar="${s.id}">Eliminar</button>
      </div>
    </div>
  `).join('');

  $$('button[data-editar]', list).forEach((btn) => {
    btn.addEventListener('click', () => abrirModalServicio(state.servicios.find((s) => String(s.id) === btn.dataset.editar)));
  });
  $$('button[data-eliminar]', list).forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este servicio? Ya no aparecerá para nuevas reservas.')) return;
      try {
        await api.eliminarServicio(state.token, btn.dataset.eliminar);
        await cargarServicios();
        showToast('Servicio eliminado', 'success');
      } catch (err) {
        showToast(err.message);
      }
    });
  });
}

function wireServicioModal() {
  $('#btn-nuevo-servicio').addEventListener('click', () => abrirModalServicio(null));
  $('#btn-cerrar-modal').addEventListener('click', cerrarModalServicio);

  $('#servicio-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const servicio = {
      id: $('#servicio-id').value || undefined,
      nombre: $('#servicio-nombre').value.trim(),
      descripcion: $('#servicio-descripcion').value.trim(),
      duracion: Number($('#servicio-duracion').value),
      precio: Number($('#servicio-precio').value),
      icono: $('#servicio-icono').value.trim() || '🐾',
    };

    try {
      await api.guardarServicio(state.token, servicio);
      cerrarModalServicio();
      await cargarServicios();
      showToast('Servicio guardado', 'success');
    } catch (err) {
      showToast(err.message);
    }
  });
}

function abrirModalServicio(servicio) {
  $('#servicio-modal-title').textContent = servicio ? 'Editar servicio' : 'Nuevo servicio';
  $('#servicio-id').value = servicio ? servicio.id : '';
  $('#servicio-nombre').value = servicio ? servicio.nombre : '';
  $('#servicio-descripcion').value = servicio ? servicio.descripcion : '';
  $('#servicio-duracion').value = servicio ? servicio.duracion : '';
  $('#servicio-precio').value = servicio ? servicio.precio : '';
  $('#servicio-icono').value = servicio ? servicio.icono : '';

  const modal = $('#servicio-modal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function cerrarModalServicio() {
  const modal = $('#servicio-modal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  $('#servicio-form').reset();
}
