/**
 * api.js
 * Cliente HTTP hacia el backend de Google Apps Script.
 *
 * IMPORTANTE sobre CORS con Apps Script:
 * Apps Script Web Apps no dejan configurar headers CORS a mano, y las
 * peticiones con Content-Type "application/json" disparan un preflight
 * OPTIONS que Apps Script no maneja bien. La solución que usamos:
 *   - GET: parámetros por querystring, sin problema de CORS.
 *   - POST: enviamos el body como texto plano (Content-Type: text/plain)
 *     para evitar el preflight; el backend lo parsea con JSON.parse().
 */

// 👉 Reemplaza esta URL por la de tu propia implementación de Apps Script.
export const API_BASE_URL = 'https://script.google.com/macros/s/TU_ID_DE_DESPLIEGUE/exec';

/**
 * Realiza un GET contra el backend.
 * @param {string} action - nombre del endpoint (servicios | horarios | reservas | configuracion)
 * @param {Object} params - parámetros adicionales de querystring
 */
async function get(action, params = {}) {
  const url = new URL(API_BASE_URL);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  const response = await fetch(url.toString(), { method: 'GET' });
  if (!response.ok) throw new Error(`Error de red (${response.status})`);

  const data = await response.json();
  if (data.ok === false) throw new Error(data.error || 'Error desconocido del servidor');
  return data.data;
}

/**
 * Realiza un POST contra el backend, enviando el body como texto plano
 * (ver nota de CORS arriba) con la acción embebida en el payload.
 * @param {string} action - nombre del endpoint (reservar | cancelar)
 * @param {Object} payload - datos a enviar
 */
async function post(action, payload = {}) {
  const response = await fetch(API_BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!response.ok) throw new Error(`Error de red (${response.status})`);

  const data = await response.json();
  if (data.ok === false) throw new Error(data.error || 'Error desconocido del servidor');
  return data.data;
}

export const api = {
  getServicios: () => get('servicios'),
  getConfiguracionPublica: () => get('configuracionPublica'),
  getHorarios: (fecha, duracionMinutos) => get('horarios', { fecha, duracion: duracionMinutos }),
  crearReserva: (reserva) => post('reservar', reserva),

  // ---- administrador (requieren token de sesión) ----
  login: (usuario, password) => post('login', { usuario, password }),
  logout: (token) => post('logout', { token }),
  verificarSesion: (token) => get('verificarSesion', { token }),
  getReservasAdmin: (token, filtros = {}) => get('reservasAdmin', { token, ...filtros }),
  cambiarEstadoReserva: (token, idReserva, estado) => post('cambiarEstadoReserva', { token, idReserva, estado }),
  cancelarReservaAdmin: (token, idReserva) => post('cancelar', { token, idReserva }),
  guardarConfiguracion: (token, config) => post('guardarConfiguracion', { token, ...config }),
  bloquearFecha: (token, fecha, motivo) => post('bloquearFecha', { token, fecha, motivo }),
  desbloquearFecha: (token, fecha) => post('desbloquearFecha', { token, fecha }),
  guardarServicio: (token, servicio) => post('guardarServicio', { token, servicio }),
  eliminarServicio: (token, id) => post('eliminarServicio', { token, id }),
};
