/**
 * app.js
 * Wizard de reserva — 4 pasos:
 *   1. Servicio
 *   2. Mascotas (1 o más)
 *   3. Fecha y hora (vista semana con slots inline)
 *   4. Tus datos
 */

import { api } from './api.js';
import { renderWeekView } from './calendar.js';
import {
  $, $$, validateForm, formToObject, formatDateISO, formatDateLong,
  formatCLP, showToast, generateBookingCode,
} from './utils.js';

// ---------------------------------------------------------------------------
// Estado global
// ---------------------------------------------------------------------------
const state = {
  step: 1,
  services: [],
  selectedService: null,
  pets: [],                  // Array de objetos de mascota
  scheduleConfig: null,
  weekStart: null,           // Date — lunes de la semana en vista
  selectedDate: null,        // ISO YYYY-MM-DD
  selectedSlot: null,        // HH:MM
  slotsPerDay: {},           // { 'YYYY-MM-DD': ['09:00', ...] }
  slotsLoading: false,
  owner: null,
  lastBookings: [],          // Array de reservas creadas
};

const STEP_LABELS = { 1: 'Servicio', 2: 'Mascotas', 3: 'Fecha y hora', 4: 'Tus datos' };
const MAX_PETS = 5;

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
init();

async function init() {
  renderProgress();
  wireNavButtons();
  wirePetsStep();
  wireOwnerForm();

  $('#services-grid').innerHTML = `<div class="loading-block sm:col-span-2"><div class="paw-loader"><span>🐾</span><span>🐾</span><span>🐾</span></div><span>Cargando servicios…</span></div>`;

  try { state.services = await api.getServicios(); }
  catch (err) { console.warn('Backend no disponible, usando datos de ejemplo:', err.message); state.services = MOCK_SERVICES; }

  try { state.scheduleConfig = await api.getConfiguracionPublica(); }
  catch (err) {
    console.warn('No se pudo cargar config, usando valores por defecto:', err.message);
    state.scheduleConfig = { diasHabiles: [1, 2, 3, 4, 5, 6], fechasBloqueadas: [], semanasPlanificadas: [] };
  }

  // Inicializar semana de inicio (próxima semana disponible o semana actual)
  state.weekStart = calcularSemanaInicial();

  // Render inicial
  renderServices();
  addPetCard(); // empieza con una mascota vacía
  goToStep(1);
}

// ---------------------------------------------------------------------------
// Semana inicial — salta a la primera semana planificada disponible
// ---------------------------------------------------------------------------
function getLunesDeSemana(date) {
  const d = new Date(date);
  const dia = d.getDay() || 7; // 1=lunes, 7=domingo
  d.setDate(d.getDate() - dia + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function fechaAClaveISO(fecha) {
  const d = typeof fecha === 'string' ? new Date(fecha + 'T00:00:00') : new Date(fecha);
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dow = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dow);
  const primero = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const num = Math.ceil(((tmp - primero) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(num).padStart(2, '0')}`;
}

function calcularSemanaInicial() {
  const semanas = state.scheduleConfig?.semanasPlanificadas || [];
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const claveHoy = fechaAClaveISO(hoy);

  if (semanas.length > 0) {
    const ordenadas = [...semanas].sort((a, b) => a.semana.localeCompare(b.semana));
    const proxima = ordenadas.find((s) => s.semana >= claveHoy);
    if (proxima) {
      const [anioStr, wStr] = proxima.semana.split('-W');
      const anio = Number(anioStr), semNum = Number(wStr);
      const cuatroEnero = new Date(Date.UTC(anio, 0, 4));
      const ds = cuatroEnero.getUTCDay() || 7;
      const lunes1 = new Date(cuatroEnero);
      lunes1.setUTCDate(cuatroEnero.getUTCDate() - ds + 1);
      const lunesProxima = new Date(lunes1);
      lunesProxima.setUTCDate(lunes1.getUTCDate() + (semNum - 1) * 7);
      return new Date(lunesProxima.getUTCFullYear(), lunesProxima.getUTCMonth(), lunesProxima.getUTCDate());
    }
  }
  return getLunesDeSemana(hoy);
}

// ---------------------------------------------------------------------------
// Disponibilidad de días
// ---------------------------------------------------------------------------
function isDayAvailable(date) {
  const iso = formatDateISO(date);
  const semanas = state.scheduleConfig?.semanasPlanificadas || [];
  const bloqueados = state.scheduleConfig?.fechasBloqueadas || [];

  if (bloqueados.includes(iso)) return false;

  if (semanas.length > 0) {
    const clave = fechaAClaveISO(date);
    const semana = semanas.find((s) => s.semana === clave);
    return semana ? semana.diasHabiles.includes(date.getDay()) : false;
  }
  return (state.scheduleConfig?.diasHabiles || []).includes(date.getDay());
}

// ---------------------------------------------------------------------------
// Navegación del wizard
// ---------------------------------------------------------------------------
function goToStep(step) {
  state.step = step;
  $$('.step-panel').forEach((panel) => {
    panel.classList.toggle('hidden', panel.dataset.step !== String(step));
  });
  renderProgress();
  updateNavButtons();

  if (step === 2) renderMascotasGuardadas();
  if (step === 3) cargarYRenderSemana();

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderProgress() {
  const wrap = $('#progress-steps');
  const steps = [1, 2, 3, 4];
  wrap.innerHTML = steps.map((s) => {
    const cls = s === state.step ? 'active' : (s < state.step ? 'done' : '');
    return `<li class="progress-step ${cls}">${STEP_LABELS[s]}</li>`;
  }).join('');
}

function updateNavButtons() {
  const backBtn = $('#btn-back');
  const nextBtn = $('#btn-next');
  const navWrap = $('#nav-buttons');

  if (state.step === 'success') { navWrap.classList.add('hidden'); return; }
  navWrap.classList.remove('hidden');
  backBtn.style.visibility = state.step === 1 ? 'hidden' : 'visible';
  nextBtn.textContent = state.step === 4 ? 'Confirmar reserva' : 'Continuar';
}

function wireNavButtons() {
  $('#btn-back').addEventListener('click', () => {
    if (state.step > 1) goToStep(state.step - 1);
  });

  $('#btn-next').addEventListener('click', async () => {
    if (!validateCurrentStep()) return;
    if (state.step < 4) goToStep(state.step + 1);
    else await submitBooking();
  });

  $('#btn-new-booking').addEventListener('click', () => {
    state.step = 1; state.selectedService = null; state.pets = [];
    state.selectedDate = null; state.selectedSlot = null;
    state.slotsPerDay = {}; state.lastBookings = [];
    state.weekStart = calcularSemanaInicial();
    $('#owner-form').reset();
    renderServices();
    // Reiniciar mascota
    const container = $('#pets-container');
    if (container) container.innerHTML = '';
    addPetCard();
    goToStep(1);
  });
}

function validateCurrentStep() {
  if (state.step === 1 && !state.selectedService) {
    showToast('Elige un servicio para continuar'); return false;
  }
  if (state.step === 2) {
    const pets = collectPets();
    if (!pets.length) { showToast('Agrega al menos una mascota'); return false; }
    for (let i = 0; i < pets.length; i++) {
      if (!pets[i].petName?.trim()) { showToast(`Mascota ${i + 1}: falta el nombre`); return false; }
      if (!pets[i].species) { showToast(`Mascota ${i + 1}: selecciona la especie`); return false; }
      if (!pets[i].size) { showToast(`Mascota ${i + 1}: selecciona el tamaño`); return false; }
    }
    state.pets = pets;
  }
  if (state.step === 3) {
    if (!state.selectedDate || !state.selectedSlot) {
      showToast('Elige un día y horario'); return false;
    }
  }
  if (state.step === 4) {
    const { valid, errors } = validateForm($('#owner-form'));
    if (!valid) { showToast(errors[0]); return false; }
    state.owner = formToObject($('#owner-form'));
  }
  return true;
}

// ---------------------------------------------------------------------------
// Paso 1 — Servicios
// ---------------------------------------------------------------------------
function renderServices() {
  const grid = $('#services-grid');
  grid.innerHTML = state.services.map((svc) => `
    <button type="button" class="service-card text-left ${state.selectedService?.id === svc.id ? 'selected' : ''}" data-id="${svc.id}">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="font-display font-semibold text-lg">${svc.nombre}</p>
          <p class="text-sm text-ink/60 mt-1">${svc.descripcion}</p>
        </div>
        <span class="text-2xl shrink-0">${svc.icono || '🐾'}</span>
      </div>
      <div class="flex items-center gap-3 mt-4 text-sm">
        <span class="px-2.5 py-1 rounded-full bg-bone border border-line text-ink/70">${svc.duracion} min</span>
        <span class="px-2.5 py-1 rounded-full bg-accent-light text-accent font-medium">${formatCLP(svc.precio)}</span>
      </div>
    </button>
  `).join('');

  $$('.service-card', grid).forEach((card) => {
    card.addEventListener('click', () => {
      state.selectedService = state.services.find((s) => String(s.id) === card.dataset.id);
      // Resetear slots al cambiar servicio
      state.slotsPerDay = {};
      state.selectedDate = null;
      state.selectedSlot = null;
      renderServices();
    });
  });
}

// ---------------------------------------------------------------------------
// Paso 2 — Mascotas múltiples
// ---------------------------------------------------------------------------
const PET_FORM_TEMPLATE = (idx) => `
  <div class="pet-card bg-white border border-line rounded-3xl p-5" data-pet-idx="${idx}">
    <div class="flex items-center justify-between mb-4">
      <p class="font-semibold text-sm">🐾 Mascota ${idx + 1}</p>
      ${idx > 0 ? `<button type="button" class="btn-remove-pet text-xs text-accent hover:underline" data-idx="${idx}">Eliminar</button>` : ''}
    </div>
    <div class="grid sm:grid-cols-2 gap-3">
      <label class="field sm:col-span-2 mb-0">
        <span>Nombre *</span>
        <input type="text" name="petName" required placeholder="Ej: Firulais" autocomplete="off">
      </label>
      <label class="field mb-0">
        <span>Especie *</span>
        <select name="species" required>
          <option value="">Selecciona</option>
          <option>Perro</option><option>Gato</option><option>Otro</option>
        </select>
      </label>
      <label class="field mb-0">
        <span>Raza</span>
        <input type="text" name="breed" placeholder="Ej: Poodle">
      </label>
      <label class="field mb-0">
        <span>Tamaño *</span>
        <select name="size" required>
          <option value="">Selecciona</option>
          <option>Pequeño</option><option>Mediano</option><option>Grande</option><option>Gigante</option>
        </select>
      </label>
      <label class="field mb-0">
        <span>Sexo</span>
        <select name="sex">
          <option value="">Selecciona</option>
          <option>Macho</option><option>Hembra</option>
        </select>
      </label>
      <label class="field mb-0">
        <span>Edad (años)</span>
        <input type="number" name="age" min="0" max="30" step="1" placeholder="3">
      </label>
      <label class="field mb-0">
        <span>Peso (kg)</span>
        <input type="number" name="weight" min="0" max="120" step="0.1" placeholder="8.5">
      </label>
      <label class="field sm:col-span-2 mb-0">
        <span>Observaciones</span>
        <textarea name="notes" rows="2" placeholder="Alergias, comportamiento especial…"></textarea>
      </label>
    </div>
  </div>
`;

function addPetCard(prefill = null) {
  const container = $('#pets-container');
  const idx = container.children.length;
  if (idx >= MAX_PETS) { showToast(`Máximo ${MAX_PETS} mascotas por reserva`); return; }

  container.insertAdjacentHTML('beforeend', PET_FORM_TEMPLATE(idx));
  const card = container.lastElementChild;

  if (prefill) {
    Object.entries(prefill).forEach(([campo, valor]) => {
      const el = card.querySelector(`[name="${campo}"]`);
      if (el) el.value = valor;
    });
  }

  card.querySelector('.btn-remove-pet')?.addEventListener('click', () => {
    card.remove();
    renumberPetCards();
  });

  // Actualizar visibilidad del botón agregar
  const btn = $('#btn-agregar-mascota');
  if (btn) btn.style.display = container.children.length >= MAX_PETS ? 'none' : 'flex';
}

function renumberPetCards() {
  $$('.pet-card').forEach((card, i) => {
    card.dataset.petIdx = i;
    const title = card.querySelector('p.font-semibold');
    if (title) title.textContent = `🐾 Mascota ${i + 1}`;
    const removeBtn = card.querySelector('.btn-remove-pet');
    if (removeBtn) { removeBtn.style.display = i === 0 ? 'none' : ''; removeBtn.dataset.idx = i; }
  });
  const btn = $('#btn-agregar-mascota');
  if (btn) btn.style.display = $$('.pet-card').length >= MAX_PETS ? 'none' : 'flex';
}

function collectPets() {
  return Array.from($$('.pet-card')).map((card) => {
    const pet = {};
    card.querySelectorAll('[name]').forEach((el) => { pet[el.name] = el.value; });
    return pet;
  });
}

function wirePetsStep() {
  const btn = $('#btn-agregar-mascota');
  if (btn) btn.addEventListener('click', () => addPetCard());
}

// ---------------------------------------------------------------------------
// Paso 2 — Mascotas guardadas (localStorage)
// ---------------------------------------------------------------------------
const CLAVE_MASCOTAS_GUARDADAS = 'pawbook_mascotas';
function getMascotasGuardadas() {
  try { return JSON.parse(localStorage.getItem(CLAVE_MASCOTAS_GUARDADAS)) || []; } catch (_) { return []; }
}
function guardarMascotaLocal(mascota) {
  const guardadas = getMascotasGuardadas();
  const idx = guardadas.findIndex((m) => m.petName?.toLowerCase() === mascota.petName?.toLowerCase() && m.species === mascota.species);
  if (idx !== -1) guardadas[idx] = mascota; else guardadas.unshift(mascota);
  localStorage.setItem(CLAVE_MASCOTAS_GUARDADAS, JSON.stringify(guardadas.slice(0, 10)));
}

function renderMascotasGuardadas() {
  const wrap = $('#mascotas-guardadas-wrap');
  const list = $('#mascotas-guardadas-list');
  const guardadas = getMascotasGuardadas();
  if (!guardadas.length) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  list.innerHTML = guardadas.map((m, i) => `
    <button type="button" class="mascota-chip" data-idx="${i}">🐾 ${m.petName}</button>
  `).join('') + `<button type="button" id="btn-mascota-nueva" class="mascota-chip mascota-chip-nueva">+ Limpiar</button>`;

  $$('.mascota-chip[data-idx]', list).forEach((btn) => {
    btn.addEventListener('click', () => {
      const mascota = guardadas[Number(btn.dataset.idx)];
      // Rellenar la primera tarjeta de mascota
      const primerCard = $('#pets-container .pet-card');
      if (primerCard) {
        Object.entries(mascota).forEach(([campo, valor]) => {
          const el = primerCard.querySelector(`[name="${campo}"]`);
          if (el) el.value = valor;
        });
      }
    });
  });
  $('#btn-mascota-nueva')?.addEventListener('click', () => {
    $('#pets-container').innerHTML = '';
    addPetCard();
  });
}

// ---------------------------------------------------------------------------
// Paso 3 — Vista de semana con slots
// ---------------------------------------------------------------------------
async function cargarYRenderSemana() {
  // Renderizar esqueleto de carga primero
  renderWeekView($('#week-view-root'), {
    weekStart: state.weekStart,
    slotsPerDay: {},
    loading: true,
    selectedDate: state.selectedDate,
    selectedSlot: state.selectedSlot,
    isDayAvailable,
    onSelect: onSelectSlot,
    onChangeWeek: async (newStart) => {
      state.weekStart = newStart;
      state.selectedDate = null;
      state.selectedSlot = null;
      await cargarYRenderSemana();
    },
  });

  // Cargar slots para todos los días disponibles de la semana en paralelo
  const dias = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(state.weekStart);
    d.setDate(state.weekStart.getDate() + i);
    return d;
  });

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diasDisponibles = dias.filter((d) => d >= today && isDayAvailable(d));

  await Promise.all(diasDisponibles.map(async (date) => {
    const iso = formatDateISO(date);
    if (state.slotsPerDay[iso]) return; // ya cargado
    try {
      state.slotsPerDay[iso] = await api.getHorarios(iso, state.selectedService.duracion);
    } catch (_) {
      state.slotsPerDay[iso] = MOCK_SLOTS;
    }
  }));

  renderWeekViewActual();
}

function renderWeekViewActual() {
  renderWeekView($('#week-view-root'), {
    weekStart: state.weekStart,
    slotsPerDay: state.slotsPerDay,
    loading: false,
    selectedDate: state.selectedDate,
    selectedSlot: state.selectedSlot,
    isDayAvailable,
    takenSlots: getTakenSlots(),
    onSelect: onSelectSlot,
    onChangeWeek: async (newStart) => {
      state.weekStart = newStart;
      state.selectedDate = null;
      state.selectedSlot = null;
      await cargarYRenderSemana();
    },
  });
  renderPetsSchedulePreview();
}

function onSelectSlot(iso, slot) {
  state.selectedDate = iso;
  state.selectedSlot = slot;
  renderWeekViewActual();
}

/** Calcula slots ocupados por las otras mascotas de este grupo (slots consecutivos desde el elegido) */
function getTakenSlots() {
  // Por ahora no marcamos ninguno como taken (se asignarán consecutivamente al enviar)
  return [];
}

/** Muestra el panel de "Horarios asignados" cuando hay más de 1 mascota */
function renderPetsSchedulePreview() {
  const preview = $('#pets-schedule-preview');
  const listEl = $('#pets-schedule-list');
  const pets = collectPets().filter((p) => p.petName?.trim());

  if (!state.selectedDate || !state.selectedSlot || pets.length <= 1) {
    preview?.classList.add('hidden');
    return;
  }

  preview?.classList.remove('hidden');
  const duracion = state.selectedService?.duracion || 30;
  const intervalo = state.scheduleConfig?.intervaloMinutos || duracion;
  const slots = calcularSlotsConsecutivos(state.selectedDate, state.selectedSlot, pets.length, intervalo);

  if (listEl) {
    listEl.innerHTML = pets.map((p, i) => `
      <div class="flex justify-between text-sm">
        <span class="font-medium">${p.petName}</span>
        <span class="text-ink/60">${formatDateLong(slots[i].fecha)} · ${slots[i].hora}</span>
      </div>
    `).join('');
  }
}

/** Calcula N slots consecutivos a partir del slot elegido, usando el intervalo de la config */
function calcularSlotsConsecutivos(fecha, horaInicio, n, intervaloMin) {
  const [h, m] = horaInicio.split(':').map(Number);
  const resultado = [];
  for (let i = 0; i < n; i++) {
    const totalMin = h * 60 + m + i * intervaloMin;
    const hh = String(Math.floor(totalMin / 60)).padStart(2, '0');
    const mm = String(totalMin % 60).padStart(2, '0');
    resultado.push({ fecha, hora: `${hh}:${mm}` });
  }
  return resultado;
}

// ---------------------------------------------------------------------------
// Paso 4 — Formulario del dueño
// ---------------------------------------------------------------------------
function wireOwnerForm() {
  ['#owner-form'].forEach((sel) => {
    $(sel)?.addEventListener('submit', (e) => e.preventDefault());
  });
}

// ---------------------------------------------------------------------------
// Envío final — una reserva por mascota con slots consecutivos
// ---------------------------------------------------------------------------
async function submitBooking() {
  const nextBtn = $('#btn-next');
  nextBtn.disabled = true;
  nextBtn.textContent = 'Reservando…';

  const duracion = state.selectedService.duracion;
  const intervalo = state.scheduleConfig?.intervaloMinutos || duracion;
  const slots = calcularSlotsConsecutivos(state.selectedDate, state.selectedSlot, state.pets.length, intervalo);

  state.lastBookings = [];

  for (let i = 0; i < state.pets.length; i++) {
    const mascota = state.pets[i];
    const { fecha, hora } = slots[i];
    const payload = {
      servicio: state.selectedService,
      mascota,
      fecha,
      hora,
      duenio: state.owner,
    };
    try {
      const result = await api.crearReserva(payload);
      state.lastBookings.push(result || { ...payload, id: generateBookingCode() });
    } catch (err) {
      console.warn(`Error al reservar mascota ${i + 1}:`, err.message);
      state.lastBookings.push({ ...payload, id: generateBookingCode(), error: err.message });
    }
    guardarMascotaLocal(mascota);
  }

  renderSummary();
  state.step = 'success';
  goToStep('success');
  nextBtn.disabled = false;
}

function renderSummary() {
  const container = $('#booking-summary');
  if (state.lastBookings.length === 1) {
    const b = state.lastBookings[0];
    container.innerHTML = `
      <p class="text-xs text-ink/50 mb-1">Código de reserva</p>
      <p class="font-display text-xl font-semibold text-primary mb-4">${b.id}</p>
      <dl class="space-y-2 text-sm">
        <div class="flex justify-between"><dt class="text-ink/50">Servicio</dt><dd class="font-medium">${state.selectedService.nombre}</dd></div>
        <div class="flex justify-between"><dt class="text-ink/50">Mascota</dt><dd class="font-medium">${state.pets[0].petName}</dd></div>
        <div class="flex justify-between"><dt class="text-ink/50">Fecha</dt><dd class="font-medium">${formatDateLong(b.fecha)}</dd></div>
        <div class="flex justify-between"><dt class="text-ink/50">Hora</dt><dd class="font-medium">${b.hora}</dd></div>
        <div class="flex justify-between"><dt class="text-ink/50">Total</dt><dd class="font-medium">${formatCLP(state.selectedService.precio)}</dd></div>
      </dl>
    `;
  } else {
    // Resumen multi-mascota
    const total = state.selectedService.precio * state.lastBookings.length;
    container.innerHTML = `
      <p class="text-xs text-ink/50 mb-3">Códigos de reserva</p>
      <div class="space-y-3 mb-4">
        ${state.lastBookings.map((b, i) => `
          <div class="bg-bone rounded-2xl p-3 text-sm">
            <div class="flex justify-between mb-1">
              <span class="font-semibold">${state.pets[i].petName}</span>
              <span class="font-mono text-xs text-primary">${b.id}</span>
            </div>
            <span class="text-ink/60">${formatDateLong(b.fecha)} · ${b.hora}</span>
            ${b.error ? `<p class="text-xs text-accent mt-1">⚠️ ${b.error}</p>` : ''}
          </div>
        `).join('')}
      </div>
      <div class="flex justify-between text-sm font-semibold">
        <span>Total</span><span>${formatCLP(total)}</span>
      </div>
    `;
  }
}

// ---------------------------------------------------------------------------
// Datos de ejemplo (fallback sin backend)
// ---------------------------------------------------------------------------
const MOCK_SERVICES = [
  { id: 1, nombre: 'Baño y limpieza profunda', descripcion: 'Uso de shampoo adecuado al tipo de piel, enjuague cuidadoso y secado.', duracion: 45, precio: 12000, icono: '🛁' },
  { id: 2, nombre: 'Corte de pelo y deslanado', descripcion: 'Cortes higiénicos y de mantención, deslanado en épocas de muda.', duracion: 60, precio: 15000, icono: '✂️' },
  { id: 3, nombre: 'Uñas y detalles', descripcion: 'Corte de uñas, limpieza de oídos y revisión general.', duracion: 20, precio: 6000, icono: '💅' },
];
const MOCK_SLOTS = ['09:00', '09:30', '10:00', '10:30', '11:00', '15:00', '15:30', '16:00', '17:00'];
