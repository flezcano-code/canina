/**
 * app.js
 * Punto de entrada. Mantiene el estado global del wizard de reserva y
 * orquesta el paso entre pantallas. Cada paso delega su render/lógica
 * a funciones puras de calendar.js / utils.js, o a funciones locales
 * de render (renderServices, renderSummary) definidas más abajo.
 */

import { api } from './api.js';
import { renderCalendar, renderTimeSlots } from './calendar.js';
import {
  $, $$, validateForm, formToObject, formatDateISO, formatDateLong,
  formatCLP, showToast, generateBookingCode,
} from './utils.js';

// ---------------------------------------------------------------------------
// Estado global del wizard (una sola fuente de verdad, sin variables sueltas)
// ---------------------------------------------------------------------------
const state = {
  step: 1,               // 1..5, o 'success'
  services: [],
  selectedService: null,
  pet: null,
  calendarViewDate: new Date(),
  selectedDate: null,     // ISO yyyy-mm-dd
  scheduleConfig: null,   // { diasHabiles: [1,2,..], fechasBloqueadas: ['YYYY-MM-DD',...] }
  availableSlots: [],
  selectedSlot: null,
  owner: null,
  lastBooking: null,
};

const STEP_LABELS = { 1: 'Servicio', 2: 'Mascota', 3: 'Fecha', 4: 'Hora', 5: 'Tus datos' };

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
init();

async function init() {
  renderProgress();
  wireNavButtons();
  wireForms();

  try {
    state.services = await api.getServicios();
  } catch (err) {
    // Sin backend conectado todavía: usamos datos de ejemplo para poder
    // demostrar y desarrollar el frontend de forma independiente.
    console.warn('No se pudo conectar al backend, usando datos de ejemplo:', err.message);
    state.services = MOCK_SERVICES;
  }

  try {
    state.scheduleConfig = await api.getConfiguracionPublica();
  } catch (err) {
    console.warn('No se pudo cargar la configuración de horario, usando valores por defecto:', err.message);
    state.scheduleConfig = { diasHabiles: [1, 2, 3, 4, 5, 6], fechasBloqueadas: [] };
  }

  renderServices();
  goToStep(1);
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

  if (step === 3) renderCalendarStep();
  if (step === 4) renderTimeStep();

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderProgress() {
  const wrap = $('#progress-steps');
  const steps = [1, 2, 3, 4, 5];
  wrap.innerHTML = steps.map((s) => {
    const cls = s === state.step ? 'active' : (s < state.step ? 'done' : '');
    return `<li class="progress-step ${cls}">${STEP_LABELS[s]}</li>`;
  }).join('');
}

function updateNavButtons() {
  const backBtn = $('#btn-back');
  const nextBtn = $('#btn-next');
  const navWrap = $('#nav-buttons');

  if (state.step === 'success') {
    navWrap.classList.add('hidden');
    return;
  }
  navWrap.classList.remove('hidden');

  backBtn.style.visibility = state.step === 1 ? 'hidden' : 'visible';
  nextBtn.textContent = state.step === 5 ? 'Confirmar reserva' : 'Continuar';
}

function wireNavButtons() {
  $('#btn-back').addEventListener('click', () => {
    if (state.step > 1) goToStep(state.step - 1);
  });

  $('#btn-next').addEventListener('click', async () => {
    if (!validateCurrentStep()) return;

    if (state.step < 5) {
      goToStep(state.step + 1);
    } else {
      await submitBooking();
    }
  });

  $('#btn-new-booking').addEventListener('click', () => {
    Object.assign(state, {
      step: 1, selectedService: null, pet: null, selectedDate: null,
      selectedSlot: null, owner: null, lastBooking: null,
    });
    $('#pet-form').reset();
    $('#owner-form').reset();
    renderServices();
    goToStep(1);
  });
}

function validateCurrentStep() {
  if (state.step === 1 && !state.selectedService) {
    showToast('Elige un servicio para continuar');
    return false;
  }
  if (state.step === 2) {
    const { valid, errors } = validateForm($('#pet-form'));
    if (!valid) { showToast(errors[0]); return false; }
    state.pet = formToObject($('#pet-form'));
  }
  if (state.step === 3 && !state.selectedDate) {
    showToast('Elige una fecha');
    return false;
  }
  if (state.step === 4 && !state.selectedSlot) {
    showToast('Elige un horario');
    return false;
  }
  if (state.step === 5) {
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
      renderServices();
    });
  });
}

// ---------------------------------------------------------------------------
// Paso 3 — Calendario
// ---------------------------------------------------------------------------
function renderCalendarStep() {
  renderCalendar($('#calendar-root'), {
    viewDate: state.calendarViewDate,
    selectedDate: state.selectedDate,
    isDayAvailable: (date) => {
      const iso = formatDateISO(date);
      const habil = state.scheduleConfig.diasHabiles.includes(date.getDay());
      const bloqueado = state.scheduleConfig.fechasBloqueadas.includes(iso);
      return habil && !bloqueado;
    },
    onSelectDate: (iso) => {
      state.selectedDate = iso;
      state.selectedSlot = null;
      renderCalendarStep();
    },
    onChangeMonth: (newDate) => {
      state.calendarViewDate = newDate;
      renderCalendarStep();
    },
  });
}

// ---------------------------------------------------------------------------
// Paso 4 — Horarios
// ---------------------------------------------------------------------------
async function renderTimeStep() {
  $('#selected-date-label').textContent = formatDateLong(state.selectedDate);
  const container = $('#time-slots');
  container.innerHTML = `<p class="col-span-full text-center text-ink/50 py-6">Cargando horarios…</p>`;

  try {
    state.availableSlots = await api.getHorarios(state.selectedDate, state.selectedService.duracion);
  } catch (err) {
    console.warn('Backend no disponible, usando horarios de ejemplo:', err.message);
    state.availableSlots = MOCK_SLOTS;
  }

  paintTimeSlots(container);
}

function paintTimeSlots(container) {
  renderTimeSlots(container, state.availableSlots, state.selectedSlot, (slot) => {
    state.selectedSlot = slot;
    paintTimeSlots(container);
  });
}

// ---------------------------------------------------------------------------
// Envío final de la reserva
// ---------------------------------------------------------------------------
async function submitBooking() {
  const nextBtn = $('#btn-next');
  nextBtn.disabled = true;
  nextBtn.textContent = 'Reservando…';

  const payload = {
    servicio: state.selectedService,
    mascota: state.pet,
    fecha: state.selectedDate,
    hora: state.selectedSlot,
    duenio: state.owner,
  };

  try {
    const result = await api.crearReserva(payload);
    state.lastBooking = result || { ...payload, id: generateBookingCode() };
  } catch (err) {
    console.warn('Backend no disponible, generando confirmación local de ejemplo:', err.message);
    state.lastBooking = { ...payload, id: generateBookingCode() };
  }

  renderSummary();
  state.step = 'success';
  goToStep('success');

  nextBtn.disabled = false;
}

function renderSummary() {
  const b = state.lastBooking;
  $('#booking-summary').innerHTML = `
    <p class="text-xs text-ink/50 mb-1">Código de reserva</p>
    <p class="font-display text-xl font-semibold text-primary mb-4">${b.id}</p>
    <dl class="space-y-2 text-sm">
      <div class="flex justify-between"><dt class="text-ink/50">Servicio</dt><dd class="font-medium">${state.selectedService.nombre}</dd></div>
      <div class="flex justify-between"><dt class="text-ink/50">Mascota</dt><dd class="font-medium">${state.pet.petName}</dd></div>
      <div class="flex justify-between"><dt class="text-ink/50">Fecha</dt><dd class="font-medium">${formatDateLong(state.selectedDate)}</dd></div>
      <div class="flex justify-between"><dt class="text-ink/50">Hora</dt><dd class="font-medium">${state.selectedSlot}</dd></div>
      <div class="flex justify-between"><dt class="text-ink/50">Total</dt><dd class="font-medium">${formatCLP(state.selectedService.precio)}</dd></div>
    </dl>
  `;
}

function wireForms() {
  // Evita que el submit nativo del <form> recargue la página; toda la
  // navegación del wizard pasa por #btn-next.
  ['#pet-form', '#owner-form'].forEach((sel) => {
    $(sel).addEventListener('submit', (e) => e.preventDefault());
  });
}

// ---------------------------------------------------------------------------
// Datos de ejemplo — solo se usan si el backend aún no está conectado,
// para poder desarrollar y mostrar el frontend de forma independiente.
// ---------------------------------------------------------------------------
const MOCK_SERVICES = [
  { id: 1, nombre: 'Baño y limpieza profunda', descripcion: 'Uso de shampoo adecuado al tipo de piel, enjuague cuidadoso y secado que ayuda a eliminar suciedad, polvo y malos olores.', duracion: 45, precio: 12000, icono: '🛁' },
  { id: 2, nombre: 'Corte de pelo y deslanado', descripcion: 'Cortes higiénicos y de mantención, deslanado en épocas de muda y recomendaciones según la raza y estilo de vida de tu perro.', duracion: 60, precio: 15000, icono: '✂️' },
  { id: 3, nombre: 'Uñas y detalles', descripcion: 'Corte de uñas, limpieza de oídos y revisión general para detectar signos que puedan requerir una consulta veterinaria.', duracion: 20, precio: 6000, icono: '💅' },
];
const MOCK_SLOTS = ['09:00', '09:30', '10:30', '11:00', '15:00', '16:00', '17:00'];
