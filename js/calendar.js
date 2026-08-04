/**
 * calendar.js
 * Calendario visual (vista mes) + render de píldoras de horario.
 * No mantiene estado propio: recibe datos y callbacks, devuelve/inyecta HTML.
 */

import { $, formatDateISO } from './utils.js';

const DIAS_CORTOS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/**
 * Renderiza un calendario mensual dentro de `container`.
 * @param {HTMLElement} container
 * @param {Object} opts
 * @param {Date} opts.viewDate - mes que se está mostrando
 * @param {string|null} opts.selectedDate - fecha ISO seleccionada
 * @param {(date: Date) => boolean} opts.isDayAvailable - si un día puede reservarse
 * @param {(isoDate: string) => void} opts.onSelectDate
 * @param {(newViewDate: Date) => void} opts.onChangeMonth
 */
export function renderCalendar(container, opts) {
  const { viewDate, selectedDate, isDayAvailable, onSelectDate, onChangeMonth } = opts;
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const firstDay = new Date(year, month, 1);
  // Lunes = 0 ... Domingo = 6
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  container.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <button id="cal-prev" class="w-9 h-9 rounded-full hover:bg-primary-light transition" aria-label="Mes anterior">‹</button>
      <p class="font-display font-semibold">${MESES[month]} ${year}</p>
      <button id="cal-next" class="w-9 h-9 rounded-full hover:bg-primary-light transition" aria-label="Mes siguiente">›</button>
    </div>
    <div class="grid grid-cols-7 gap-1 text-center text-xs text-ink/40 font-medium mb-2">
      ${DIAS_CORTOS.map((d) => `<div>${d}</div>`).join('')}
    </div>
    <div class="grid grid-cols-7 gap-1" id="cal-grid"></div>
  `;

  const grid = $('#cal-grid', container);

  for (let i = 0; i < startOffset; i++) {
    grid.insertAdjacentHTML('beforeend', '<div></div>');
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const iso = formatDateISO(date);
    const isPast = date < today;
    const available = !isPast && isDayAvailable(date);
    const classes = ['cal-day'];
    if (!available) classes.push('disabled');
    if (iso === selectedDate) classes.push('selected');
    if (formatDateISO(today) === iso) classes.push('today');

    grid.insertAdjacentHTML('beforeend', `
      <button type="button" class="${classes.join(' ')}" data-date="${iso}" ${available ? '' : 'disabled'}>${day}</button>
    `);
  }

  $('#cal-prev', container).addEventListener('click', () => onChangeMonth(new Date(year, month - 1, 1)));
  $('#cal-next', container).addEventListener('click', () => onChangeMonth(new Date(year, month + 1, 1)));

  container.querySelectorAll('.cal-day:not(.disabled)').forEach((btn) => {
    btn.addEventListener('click', () => onSelectDate(btn.dataset.date));
  });
}

/**
 * Renderiza las píldoras de horario disponibles.
 * @param {HTMLElement} container
 * @param {string[]} availableSlots - horas en formato "HH:MM"
 * @param {string|null} selectedSlot
 * @param {(slot: string) => void} onSelect
 */
export function renderTimeSlots(container, availableSlots, selectedSlot, onSelect) {
  if (!availableSlots.length) {
    container.innerHTML = `<p class="col-span-full text-center text-ink/50 py-6">No hay horarios disponibles para este día. Elige otra fecha.</p>`;
    return;
  }

  container.innerHTML = availableSlots.map((slot) => `
    <button type="button" class="time-pill ${slot === selectedSlot ? 'selected' : ''}" data-slot="${slot}">${slot}</button>
  `).join('');

  container.querySelectorAll('.time-pill').forEach((btn) => {
    btn.addEventListener('click', () => onSelect(btn.dataset.slot));
  });
}
