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
  semanasPlanificadas: [],         // [{ semana: 'YYYY-WNN', diasHabiles: [1,2,3,4,5] }]
  diasPlanSeleccionados: new Set(), // días elegidos para la semana nueva a agregar
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
  wireSemanasPlanificadas();
  wireModalFechaHora();

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
  // Cargamos en paralelo; semanasPlanificadas tiene su propio try/catch
  // para que un error de permisos no impida cargar el resto del panel.
  await Promise.all([cargarReservas(), cargarConfiguracion(), cargarServicios()]);
  cargarSemanasPlanificadas(); // sin await — no bloquea el render inicial
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
  // Filtros que requieren ir al backend (fecha y estado)
  $('#filtro-fecha').addEventListener('change', cargarReservas);
  $('#filtro-estado').addEventListener('change', cargarReservas);

  // Filtros locales (no llaman al backend, solo re-renderizan)
  $('#filtro-busqueda').addEventListener('input', renderReservas);
  $('#filtro-dia-semana').addEventListener('change', renderReservas);

  $('#btn-limpiar-filtros').addEventListener('click', () => {
    $('#filtro-fecha').value = '';
    $('#filtro-estado').value = '';
    $('#filtro-busqueda').value = '';
    $('#filtro-dia-semana').value = '';
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
  const countEl = $('#reservas-count');

  // Filtros locales
  const busqueda = ($('#filtro-busqueda')?.value || '').toLowerCase().trim();
  const diaSemana = $('#filtro-dia-semana')?.value; // '0'..'6' o ''

  let reservas = state.reservas;

  if (busqueda) {
    reservas = reservas.filter((r) => {
      const haystack = [
        r.clienteNombre,
        r.telefono || '',
        r.id,
      ].join(' ').toLowerCase();
      return haystack.includes(busqueda);
    });
  }

  if (diaSemana !== '') {
    reservas = reservas.filter((r) => {
      const d = new Date(r.fecha + 'T00:00:00');
      return String(d.getDay()) === diaSemana;
    });
  }

  if (countEl) {
    countEl.textContent = reservas.length
      ? `${reservas.length} reserva${reservas.length !== 1 ? 's' : ''} encontrada${reservas.length !== 1 ? 's' : ''}`
      : '';
  }

  if (!reservas.length) {
    list.innerHTML = `<p class="text-center text-ink/40 py-10">No hay reservas para este filtro.</p>`;
    return;
  }

  list.innerHTML = reservas.map((r) => `
    <div class="reserva-card" data-id="${r.id}">
      <div>
        <p class="font-semibold">${r.mascotaNombre} <span class="text-ink/40 font-normal">· ${r.clienteNombre}</span></p>
        <p class="text-sm text-ink/60">${r.servicioNombre} — ${formatDateLong(r.fecha)} a las ${r.hora}</p>
        <p class="text-xs text-ink/35 font-mono mt-0.5"># ${r.id}</p>
        <p class="text-sm text-honey font-medium">${formatCLP(r.precio)}</p>
      </div>
      <div class="flex flex-col items-end gap-2">
        <div class="flex items-center gap-2">
          <span class="estado-badge estado-${String(r.estado).replace(' ', '-')}">${r.estado}</span>
          <select class="estado-select border border-line rounded-full px-3 py-1.5 text-sm" data-id="${r.id}">
            ${ESTADOS.map((e) => `<option ${e === r.estado ? 'selected' : ''}>${e}</option>`).join('')}
          </select>
        </div>
        <button type="button"
          class="text-xs text-primary hover:underline font-medium"
          data-editar-fecha="${r.id}"
          data-fecha="${r.fecha}"
          data-hora="${r.hora}">
          ✏️ Cambiar fecha/hora
        </button>
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

  $$('[data-editar-fecha]', list).forEach((btn) => {
    btn.addEventListener('click', () => {
      abrirModalFechaHora(btn.dataset.editarFecha, btn.dataset.fecha, btn.dataset.hora);
    });
  });
}

// ---------------------------------------------------------------------------
// HORARIO / CONFIGURACIÓN — horario individual por día
// ---------------------------------------------------------------------------

// horarioPorDia: Map<numeroDia, {horaInicio, horaFin, almuerzoInicio, almuerzoFin}>
// Se construye al cargar la config y se actualiza al hacer clic en los toggles.

async function cargarConfiguracion() {
  try {
    state.config = await api.getConfiguracionPublica();
    state.bloqueos = await api.getBloqueosAdmin(state.token);
  } catch (err) {
    showToast(err.message);
    return;
  }

  // Reconstruir diasSeleccionados y horarioPorDia desde la config
  state.diasSeleccionados = new Set(state.config.diasHabiles);

  // horarioPorDia puede venir como JSON en config.horarioPorDia,
  // o usamos los valores globales como fallback para todos los días.
  const hpd = state.config.horarioPorDia || {};
  state.horarioPorDia = {};
  state.config.diasHabiles.forEach((d) => {
    state.horarioPorDia[d] = hpd[d] || {
      horaInicio: state.config.horaInicio || '09:00',
      horaFin: state.config.horaFin || '18:00',
      almuerzoInicio: state.config.almuerzoInicio || '13:00',
      almuerzoFin: state.config.almuerzoFin || '14:00',
    };
  });

  $('#cfg-intervalo').value = state.config.intervaloMinutos;
  renderDiasSemanaPicker();
  renderFechasBloqueadas();
}

function renderDiasSemanaPicker() {
  const wrap = $('#dias-semana-picker');
  wrap.innerHTML = DIAS_SEMANA.map((d) => `
    <button type="button" class="day-toggle ${state.diasSeleccionados.has(d.valor) ? 'active' : ''}" data-dia="${d.valor}">${d.corto}</button>
  `).join('');

  $$('[data-dia]', wrap).forEach((btn) => {
    btn.addEventListener('click', () => {
      const dia = Number(btn.dataset.dia);
      if (state.diasSeleccionados.has(dia)) {
        state.diasSeleccionados.delete(dia);
        delete state.horarioPorDia[dia];
      } else {
        state.diasSeleccionados.add(dia);
        // Horario por defecto al activar un día nuevo
        state.horarioPorDia[dia] = {
          horaInicio: '09:00', horaFin: '18:00',
          almuerzoInicio: '13:00', almuerzoFin: '14:00',
        };
      }
      renderDiasSemanaPicker();
      renderHorariosPorDia();
    });
  });

  renderHorariosPorDia();
}

const NOMBRE_DIA = {
  0: 'Domingo', 1: 'Lunes', 2: 'Martes', 3: 'Miércoles',
  4: 'Jueves', 5: 'Viernes', 6: 'Sábado',
};

function renderHorariosPorDia() {
  const wrap = $('#horarios-por-dia');
  const diasOrdenados = DIAS_SEMANA.map((d) => d.valor).filter((v) => state.diasSeleccionados.has(v));

  if (!diasOrdenados.length) {
    wrap.innerHTML = `<p class="text-sm text-ink/40">Activa al menos un día arriba para configurar su horario.</p>`;
    return;
  }

  wrap.innerHTML = diasOrdenados.map((d) => {
    const h = state.horarioPorDia[d] || { horaInicio: '09:00', horaFin: '18:00', almuerzoInicio: '13:00', almuerzoFin: '14:00' };
    return `
      <div class="border border-line rounded-2xl p-4">
        <p class="font-semibold text-sm mb-3">${NOMBRE_DIA[d]}</p>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <label class="field mb-0">
            <span class="text-xs">Apertura</span>
            <input type="time" class="hpd-input" data-dia="${d}" data-campo="horaInicio" value="${h.horaInicio}">
          </label>
          <label class="field mb-0">
            <span class="text-xs">Cierre</span>
            <input type="time" class="hpd-input" data-dia="${d}" data-campo="horaFin" value="${h.horaFin}">
          </label>
          <label class="field mb-0">
            <span class="text-xs">Inicio almuerzo</span>
            <input type="time" class="hpd-input" data-dia="${d}" data-campo="almuerzoInicio" value="${h.almuerzoInicio}">
          </label>
          <label class="field mb-0">
            <span class="text-xs">Fin almuerzo</span>
            <input type="time" class="hpd-input" data-dia="${d}" data-campo="almuerzoFin" value="${h.almuerzoFin}">
          </label>
        </div>
      </div>
    `;
  }).join('');

  // Sincronizar cambios en los inputs al state en tiempo real
  $$('.hpd-input', wrap).forEach((input) => {
    input.addEventListener('change', () => {
      const dia = Number(input.dataset.dia);
      const campo = input.dataset.campo;
      if (!state.horarioPorDia[dia]) state.horarioPorDia[dia] = {};
      state.horarioPorDia[dia][campo] = input.value;
    });
  });
}

function wireHorarioForm() {
  $('#btn-guardar-horario').addEventListener('click', async () => {
    const diasHabiles = Array.from(state.diasSeleccionados);

    if (!diasHabiles.length) {
      showToast('Activa al menos un día');
      return;
    }

    // Leer valores actuales de los inputs por si el usuario no disparó 'change'
    $$('.hpd-input').forEach((input) => {
      const dia = Number(input.dataset.dia);
      const campo = input.dataset.campo;
      if (!state.horarioPorDia[dia]) state.horarioPorDia[dia] = {};
      state.horarioPorDia[dia][campo] = input.value;
    });

    // Para compatibilidad con el backend actual, enviamos los valores globales
    // tomando el primer día hábil como referencia, más el objeto horarioPorDia completo.
    const primerDia = state.horarioPorDia[diasHabiles[0]] || {};
    const config = {
      diasHabiles,
      horaInicio: primerDia.horaInicio || '09:00',
      horaFin: primerDia.horaFin || '18:00',
      almuerzoInicio: primerDia.almuerzoInicio || '13:00',
      almuerzoFin: primerDia.almuerzoFin || '14:00',
      intervaloMinutos: Number($('#cfg-intervalo').value),
      horarioPorDia: state.horarioPorDia,
    };

    try {
      state.config = await api.guardarConfiguracion(state.token, config);
      showToast('Horario guardado ✓', 'success');
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

// ---------------------------------------------------------------------------
// SEMANAS PLANIFICADAS
// ---------------------------------------------------------------------------

/** Helpers de conversión fecha ↔ clave de semana ISO (YYYY-WNN) */
function fechaAClaveISO(fecha) {
  // fecha puede ser un string YYYY-MM-DD o un objeto Date
  const d = typeof fecha === 'string' ? new Date(fecha + 'T00:00:00') : fecha;
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const diaSemana = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - diaSemana);
  const primero = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const num = Math.ceil(((tmp - primero) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(num).padStart(2, '0')}`;
}

/** Dado 'YYYY-WNN', devuelve el lunes de esa semana como Date UTC */
function lunesDeSemanaISO(claveISO) {
  const [anioStr, wStr] = claveISO.split('-W');
  const anio = Number(anioStr);
  const semana = Number(wStr);
  // 4 de enero siempre está en la semana 1
  const cuatroEnero = new Date(Date.UTC(anio, 0, 4));
  const diaSemana = cuatroEnero.getUTCDay() || 7;
  const lunesSemana1 = new Date(cuatroEnero);
  lunesSemana1.setUTCDate(cuatroEnero.getUTCDate() - diaSemana + 1);
  const lunes = new Date(lunesSemana1);
  lunes.setUTCDate(lunesSemana1.getUTCDate() + (semana - 1) * 7);
  return lunes;
}

/** Formatea una clave YYYY-WNN en texto legible, ej: "4 ago – 10 ago 2026" */
function formatearSemanaISO(claveISO) {
  const lunes = lunesDeSemanaISO(claveISO);
  const domingo = new Date(lunes);
  domingo.setUTCDate(lunes.getUTCDate() + 6);
  const fmt = (d) => d.toLocaleDateString('es-CL', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const anio = domingo.getUTCFullYear();
  return `${fmt(lunes)} – ${fmt(domingo)} ${anio}`;
}

async function cargarSemanasPlanificadas() {
  try {
    state.semanasPlanificadas = await api.getSemanasAdmin(state.token);
  } catch (err) {
    showToast(err.message);
    return;
  }
  renderSemanasPlanificadas();
}

function wireSemanasPlanificadas() {
  // Inicializar picker de días con todos los días seleccionados por defecto
  state.diasPlanSeleccionados = new Set([1, 2, 3, 4, 5]); // Lun-Vie por defecto
  renderPlanDiasPicker();

  $('#btn-agregar-semana').addEventListener('click', async () => {
    const semana = $('#plan-semana').value; // formato "YYYY-WNN" nativo del input[type=week]
    if (!semana) { showToast('Elige una semana primero'); return; }
    if (state.diasPlanSeleccionados.size === 0) { showToast('Selecciona al menos un día'); return; }

    const diasHabiles = Array.from(state.diasPlanSeleccionados);
    try {
      await api.guardarSemanaPlanificada(state.token, semana, diasHabiles);
      await cargarSemanasPlanificadas();
      showToast('Semana planificada guardada ✓', 'success');
      $('#plan-semana').value = '';
      // resetear días a Lun-Vie
      state.diasPlanSeleccionados = new Set([1, 2, 3, 4, 5]);
      renderPlanDiasPicker();
    } catch (err) {
      showToast(err.message);
    }
  });
}

function renderPlanDiasPicker() {
  const wrap = $('#plan-dias-picker');
  wrap.innerHTML = DIAS_SEMANA.map((d) => `
    <button type="button"
      class="day-toggle ${state.diasPlanSeleccionados.has(d.valor) ? 'active' : ''}"
      data-plan-dia="${d.valor}">${d.corto}</button>
  `).join('');

  $$('[data-plan-dia]', wrap).forEach((btn) => {
    btn.addEventListener('click', () => {
      const dia = Number(btn.dataset.planDia);
      if (state.diasPlanSeleccionados.has(dia)) state.diasPlanSeleccionados.delete(dia);
      else state.diasPlanSeleccionados.add(dia);
      renderPlanDiasPicker();
    });
  });
}

function renderSemanasPlanificadas() {
  const list = $('#semanas-planificadas-list');
  const semanas = state.semanasPlanificadas;

  if (!semanas || semanas.length === 0) {
    list.innerHTML = `<p class="text-sm text-ink/40">No hay semanas planificadas aún. Cuando agregues una, solo esas semanas estarán disponibles para reservas.</p>`;
    return;
  }

  const DIAS_MAP = { 0: 'Dom', 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb' };

  // Ordenar por semana
  const ordenadas = [...semanas].sort((a, b) => a.semana.localeCompare(b.semana));

  list.innerHTML = ordenadas.map((s) => {
    const etiqueta = formatearSemanaISO(s.semana);
    const diasTexto = s.diasHabiles.map((d) => DIAS_MAP[d] || d).join(', ');
    return `
      <div class="blocked-date-chip">
        <div>
          <span class="font-medium">📅 ${etiqueta}</span>
          <span class="text-xs text-ink/50 ml-2">${diasTexto}</span>
        </div>
        <button type="button" class="text-accent hover:underline text-xs font-medium" data-eliminar-semana="${s.semana}">Eliminar</button>
      </div>
    `;
  }).join('');

  $$('[data-eliminar-semana]', list).forEach((btn) => {
    btn.addEventListener('click', async () => {
      const semana = btn.dataset.eliminarSemana;
      const etiqueta = formatearSemanaISO(semana);
      if (!confirm(`¿Eliminar la semana ${etiqueta}? Los clientes no podrán reservar en esa semana.`)) return;
      try {
        await api.eliminarSemanaPlanificada(state.token, semana);
        await cargarSemanasPlanificadas();
        showToast('Semana eliminada', 'success');
      } catch (err) {
        showToast(err.message);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// MODAL: CAMBIAR FECHA/HORA DE RESERVA
// ---------------------------------------------------------------------------
function wireModalFechaHora() {
  $('#btn-cerrar-fh-modal').addEventListener('click', cerrarModalFechaHora);

  $('#btn-guardar-fh').addEventListener('click', async () => {
    const idReserva = $('#fh-id').value;
    const fecha = $('#fh-fecha').value;
    const hora = $('#fh-hora').value;

    if (!fecha) { showToast('Elige una fecha'); return; }
    if (!hora)  { showToast('Elige una hora');  return; }

    const btn = $('#btn-guardar-fh');
    btn.disabled = true;
    btn.textContent = 'Guardando…';

    try {
      await api.cambiarFechaHoraReserva(state.token, idReserva, fecha, hora);
      cerrarModalFechaHora();
      await cargarReservas();
      showToast('Reserva reprogramada ✓', 'success');
    } catch (err) {
      showToast(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Guardar cambio';
    }
  });

  // Cerrar al hacer clic en el fondo
  $('#fecha-hora-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) cerrarModalFechaHora();
  });
}

function abrirModalFechaHora(idReserva, fechaActual, horaActual) {
  $('#fh-id').value = idReserva;
  $('#fh-reserva-id').textContent = idReserva;
  $('#fh-fecha').value = fechaActual;
  $('#fh-hora').value = horaActual;

  const modal = $('#fecha-hora-modal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function cerrarModalFechaHora() {
  const modal = $('#fecha-hora-modal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}
