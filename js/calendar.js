/**
 * calendar.js
 * Calendario visual (vista mes) + vista semana con slots inline + píldoras de horario.
 */

import { $, formatDateISO } from './utils.js';

const DIAS_CORTOS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const DIAS_NOMBRES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * Renderiza un calendario mensual dentro de `container`.
 */
export function renderCalendar(container, opts) {
  const { viewDate, selectedDate, isDayAvailable, onSelectDate, onChangeMonth } = opts;
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const firstDay = new Date(year, month, 1);
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
  for (let i = 0; i < startOffset; i++) grid.insertAdjacentHTML('beforeend', '<div></div>');

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
 * Renderiza una vista de SEMANA con los slots de cada día directamente visibles.
 * El usuario elige día + hora en una sola pantalla.
 *
 * @param {HTMLElement} container
 * @param {Object} opts
 * @param {Date} opts.weekStart          - Lunes de la semana a mostrar
 * @param {Object} opts.slotsPerDay      - { 'YYYY-MM-DD': ['09:00', ...] }
 * @param {boolean} opts.loading         - si true, muestra spinner
 * @param {string|null} opts.selectedDate
 * @param {string|null} opts.selectedSlot
 * @param {(date: Date) => boolean} opts.isDayAvailable
 * @param {(iso: string, slot: string) => void} opts.onSelect
 * @param {(newStart: Date) => void} opts.onChangeWeek
 * @param {string[]} opts.takenSlots     - slots ya reservados por otras mascotas del mismo grupo
 */
export function renderWeekView(container, opts) {
  const {
    weekStart, slotsPerDay = {}, loading = false,
    selectedDate, selectedSlot, isDayAvailable,
    onSelect, onChangeWeek, takenSlots = [],
  } = opts;

  const today = new Date(); today.setHours(0, 0, 0, 0);

  // Construir los 7 días de la semana
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  const weekEnd = days[6];
  const sameMonth = days[0].getMonth() === weekEnd.getMonth();
  const headerText = sameMonth
    ? `${days[0].getDate()} – ${weekEnd.getDate()} de ${MESES[days[0].getMonth()]} ${days[0].getFullYear()}`
    : `${days[0].getDate()} ${MESES_CORTOS[days[0].getMonth()]} – ${weekEnd.getDate()} ${MESES_CORTOS[weekEnd.getMonth()]} ${weekEnd.getFullYear()}`;

  container.innerHTML = `
    <div class="flex items-center justify-between mb-5">
      <button id="week-prev" class="w-9 h-9 rounded-full hover:bg-primary-light transition flex items-center justify-center text-lg" aria-label="Semana anterior">‹</button>
      <p class="font-display font-semibold text-sm text-center">${headerText}</p>
      <button id="week-next" class="w-9 h-9 rounded-full hover:bg-primary-light transition flex items-center justify-center text-lg" aria-label="Semana siguiente">›</button>
    </div>

    ${loading ? `
      <div class="flex flex-col items-center justify-center py-10 gap-3 text-ink/40">
        <div class="paw-loader"><span>🐾</span><span>🐾</span><span>🐾</span></div>
        <span class="text-sm">Cargando disponibilidad…</span>
      </div>
    ` : `
      <div class="grid gap-3" id="week-days-list">
        ${days.map((date) => {
          const iso = formatDateISO(date);
          const isPast = date < today;
          const available = !isPast && isDayAvailable(date);
          const slots = slotsPerDay[iso] || [];
          const isSelectedDay = iso === selectedDate;

          if (!available) {
            return `
              <div class="border border-line/40 rounded-2xl p-3 flex items-center gap-3 opacity-35 select-none">
                <div class="w-14 shrink-0 text-center">
                  <p class="text-xs font-semibold uppercase tracking-wide">${DIAS_NOMBRES[date.getDay()]}</p>
                  <p class="text-lg font-bold leading-none">${date.getDate()}</p>
                </div>
                <p class="text-xs text-ink/50 italic">No disponible</p>
              </div>
            `;
          }

          return `
            <div class="border ${isSelectedDay ? 'border-primary bg-primary/5' : 'border-line'} rounded-2xl p-3">
              <div class="flex items-center gap-3 mb-2.5">
                <div class="w-14 shrink-0 text-center">
                  <p class="text-xs font-semibold uppercase tracking-wide text-ink/60">${DIAS_NOMBRES[date.getDay()]}</p>
                  <p class="text-xl font-bold leading-none ${isSelectedDay ? 'text-primary' : ''}">${date.getDate()}</p>
                </div>
                ${slots.length === 0 ? `<p class="text-xs text-ink/40 italic">Sin horarios disponibles este día</p>` : `
                  <div class="flex flex-wrap gap-1.5">
                    ${slots.map((slot) => {
                      const isSel = isSelectedDay && slot === selectedSlot;
                      const isTaken = takenSlots.includes(iso + '_' + slot);
                      return `
                        <button type="button"
                          class="time-pill text-xs ${isSel ? 'selected' : ''} ${isTaken ? 'opacity-30 cursor-not-allowed line-through' : ''}"
                          data-date="${iso}" data-slot="${slot}" ${isTaken ? 'disabled' : ''}>
                          ${slot}
                        </button>
                      `;
                    }).join('')}
                  </div>
                `}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `}
  `;

  container.querySelector('#week-prev')?.addEventListener('click', () => {
    const prev = new Date(weekStart);
    prev.setDate(weekStart.getDate() - 7);
    onChangeWeek(prev);
  });
  container.querySelector('#week-next')?.addEventListener('click', () => {
    const next = new Date(weekStart);
    next.setDate(weekStart.getDate() + 7);
    onChangeWeek(next);
  });

  container.querySelectorAll('.time-pill[data-date]:not([disabled])').forEach((btn) => {
    btn.addEventListener('click', () => onSelect(btn.dataset.date, btn.dataset.slot));
  });
}

/**
 * Renderiza las píldoras de horario disponibles.
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

