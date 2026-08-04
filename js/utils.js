/**
 * utils.js
 * Helpers puros: validación, formateo y atajos de DOM.
 * Sin estado propio, sin efectos secundarios salvo los de DOM explícitos.
 */

export const $ = (selector, scope = document) => scope.querySelector(selector);
export const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Acepta formatos como +56 9 1234 5678, 912345678, (56) 9 1234-5678, etc.
const PHONE_REGEX = /^[\d\s()+-]{7,20}$/;

export function isValidEmail(value) {
  return EMAIL_REGEX.test(String(value).trim());
}

export function isValidPhone(value) {
  return PHONE_REGEX.test(String(value).trim()) && String(value).replace(/\D/g, '').length >= 8;
}

/** Valida un <form> completo devolviendo { valid, errors[] } y marcando campos inválidos. */
export function validateForm(formEl) {
  const errors = [];
  let valid = true;

  $$('input[required], select[required], textarea[required]', formEl).forEach((field) => {
    field.classList.add('touched');
    if (!field.value || (field.type === 'checkbox' && !field.checked)) {
      valid = false;
      errors.push(`Falta completar: ${field.name}`);
    }
  });

  const email = formEl.querySelector('input[type="email"]');
  if (email && email.value && !isValidEmail(email.value)) {
    valid = false;
    errors.push('Correo inválido');
  }

  $$('input[type="tel"]', formEl).forEach((tel) => {
    if (tel.value && !isValidPhone(tel.value)) {
      valid = false;
      errors.push('Teléfono inválido');
    }
  });

  return { valid, errors };
}

/** Serializa un <form> a un objeto plano {name: value}. */
export function formToObject(formEl) {
  const data = {};
  new FormData(formEl).forEach((value, key) => { data[key] = value; });
  // checkboxes ausentes de FormData cuando no están marcados
  $$('input[type="checkbox"]', formEl).forEach((cb) => { data[cb.name] = cb.checked; });
  return data;
}

export function formatDateISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function formatDateLong(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${DIAS[date.getDay()]} ${d} de ${MESES[m - 1]}`;
}

export function formatCLP(amount) {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(amount);
}

let toastTimer = null;
export function showToast(message, type = 'error') {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.style.background = type === 'error' ? '#1E2A28' : '#3F8F73';
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
}

export function generateBookingCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return `PB-${code}`;
}
