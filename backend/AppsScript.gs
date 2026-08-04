/**
 * AppsScript.gs
 * Backend REST completo para PawBook, usando Google Sheets como base de datos.
 *
 * ---------------------------------------------------------------------------
 * ENDPOINTS PÚBLICOS (sin token — los usa la página de reserva del cliente)
 * ---------------------------------------------------------------------------
 *   GET  ?action=servicios
 *   GET  ?action=horarios&fecha=YYYY-MM-DD&duracion=60
 *   GET  ?action=configuracionPublica      → horario laboral + días bloqueados
 *   POST {action:'reservar', servicio, mascota, fecha, hora, duenio}
 *
 * ---------------------------------------------------------------------------
 * ENDPOINTS DE ADMINISTRADOR (requieren "token" de sesión válido)
 * ---------------------------------------------------------------------------
 *   POST {action:'login', usuario, password}              → { token }
 *   POST {action:'logout', token}
 *   GET  ?action=verificarSesion&token=...
 *   GET  ?action=reservasAdmin&token=...[&fecha=][&estado=]
 *   GET  ?action=bloqueosAdmin&token=...
 *   POST {action:'cambiarEstadoReserva', token, idReserva, estado}
 *   POST {action:'cancelar', token, idReserva}
 *   POST {action:'guardarConfiguracion', token, diasHabiles, horaInicio, horaFin, almuerzoInicio, almuerzoFin, intervaloMinutos}
 *   POST {action:'bloquearFecha', token, fecha, motivo}
 *   POST {action:'desbloquearFecha', token, fecha}
 *   POST {action:'bloquearSemana', token, fecha, motivo}       — bloquea Lun-Dom de la semana que contiene "fecha"
 *   POST {action:'desbloquearSemana', token, grupoSemana}
 *   POST {action:'guardarServicio', token, servicio:{id?, nombre, descripcion, duracion, precio, icono, activo}}
 *   POST {action:'eliminarServicio', token, id}
 *
 * ---------------------------------------------------------------------------
 * PRIMEROS PASOS
 * ---------------------------------------------------------------------------
 *   1. Pega este archivo en Extensiones → Apps Script.
 *   2. Ejecuta inicializarHojas() una vez (crea todas las hojas necesarias).
 *   3. Ejecuta crearPrimerAdministrador() una vez (te deja un usuario admin
 *      de ejemplo — instrucciones completas más abajo en ese mismo bloque).
 *   4. Implementar → Nueva implementación → Aplicación web
 *      (Ejecutar como: yo · Acceso: cualquiera).
 */

// ---------------------------------------------------------------------------
// VALORES POR DEFECTO (se usan solo la primera vez; luego todo se administra
// desde la hoja Configuracion vía el panel de administrador)
// ---------------------------------------------------------------------------
const CONFIG_POR_DEFECTO = {
  diasHabiles: '1,2,3,4,5,6', // 0=Domingo ... 6=Sábado
  horaInicio: '09:00',
  horaFin: '18:00',
  almuerzoInicio: '13:00',
  almuerzoFin: '14:00',
  intervaloMinutos: '30',
};

// Cambia este texto por algo propio antes del primer despliegue: se usa para
// "salar" el hash de las contraseñas de administrador. No es secreto de alto
// nivel (vive en el código del servidor, nunca llega al navegador), pero
// conviene que no sea el mismo de este ejemplo.
const SALT_PASSWORD = 'pawbook-estetica-canina-2026';

// Duración de la sesión de administrador (segundos). 6 horas.
const DURACION_SESION_SEGUNDOS = 6 * 60 * 60;

const SHEET_NAMES = {
  clientes: 'Clientes',
  mascotas: 'Mascotas',
  servicios: 'Servicios',
  reservas: 'Reservas',
  configuracion: 'Configuracion',
  diasBloqueados: 'DiasBloqueados',
  administradores: 'Administradores',
};

// ---------------------------------------------------------------------------
// ENTRY POINTS
// ---------------------------------------------------------------------------
function doGet(e) {
  try {
    const action = e.parameter.action;
    let data;

    switch (action) {
      case 'servicios':
        data = getServicios();
        break;
      case 'horarios':
        data = getHorariosDisponibles(e.parameter.fecha, Number(e.parameter.duracion) || 30);
        break;
      case 'configuracionPublica':
        data = getConfiguracionPublica();
        break;
      case 'verificarSesion':
        data = { usuario: verificarToken_(e.parameter.token) };
        break;
      case 'reservasAdmin':
        verificarToken_(e.parameter.token);
        data = getReservas(e.parameter);
        break;
      case 'bloqueosAdmin':
        verificarToken_(e.parameter.token);
        data = getBloqueosDetallados_();
        break;
      default:
        return jsonResponse({ ok: false, error: 'Acción GET no reconocida: ' + action });
    }

    return jsonResponse({ ok: true, data });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    let data;

    switch (body.action) {
      // ---- públicos ----
      case 'reservar':
        data = crearReserva(body);
        break;

      // ---- requieren login ----
      case 'login':
        data = login_(body.usuario, body.password);
        break;
      case 'logout':
        CacheService.getScriptCache().remove('sesion_' + body.token);
        data = { ok: true };
        break;
      case 'cancelar':
        verificarToken_(body.token);
        data = cancelarReserva(body.idReserva);
        break;
      case 'cambiarEstadoReserva':
        verificarToken_(body.token);
        data = cambiarEstadoReserva(body.idReserva, body.estado);
        break;
      case 'guardarConfiguracion':
        verificarToken_(body.token);
        data = guardarConfiguracion(body);
        break;
      case 'bloquearFecha':
        verificarToken_(body.token);
        data = bloquearFecha(body.fecha, body.motivo || '', '');
        break;
      case 'desbloquearFecha':
        verificarToken_(body.token);
        data = desbloquearFecha(body.fecha);
        break;
      case 'bloquearSemana':
        verificarToken_(body.token);
        data = bloquearSemana(body.fecha, body.motivo || '');
        break;
      case 'desbloquearSemana':
        verificarToken_(body.token);
        data = desbloquearSemana(body.grupoSemana);
        break;
      case 'guardarServicio':
        verificarToken_(body.token);
        data = guardarServicio(body.servicio);
        break;
      case 'eliminarServicio':
        verificarToken_(body.token);
        data = eliminarServicio(body.id);
        break;

      default:
        return jsonResponse({ ok: false, error: 'Acción POST no reconocida: ' + body.action });
    }

    return jsonResponse({ ok: true, data });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// INICIALIZACIÓN DE HOJAS (ejecutar manualmente una vez)
// ---------------------------------------------------------------------------
function inicializarHojas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  crearHojaSiNoExiste_(ss, SHEET_NAMES.clientes,
    ['ID', 'Nombre', 'Apellido', 'Telefono', 'WhatsApp', 'Correo', 'FechaCreacion']);

  crearHojaSiNoExiste_(ss, SHEET_NAMES.mascotas,
    ['ID', 'IDCliente', 'Nombre', 'Especie', 'Raza', 'Tamano', 'Edad', 'Peso', 'Sexo', 'Observaciones']);

  const hojaServicios = crearHojaSiNoExiste_(ss, SHEET_NAMES.servicios,
    ['ID', 'Nombre', 'Descripcion', 'DuracionMin', 'Precio', 'Icono', 'Activo']);
  if (hojaServicios.getLastRow() === 1) {
    hojaServicios.getRange(2, 1, 3, 7).setValues([
      [1, 'Baño y limpieza profunda', 'Uso de shampoo adecuado al tipo de piel, enjuague cuidadoso y secado que ayuda a eliminar suciedad, polvo y malos olores.', 45, 12000, '🛁', true],
      [2, 'Corte de pelo y deslanado', 'Cortes higiénicos y de mantención, deslanado en épocas de muda y recomendaciones según la raza y estilo de vida de tu perro.', 60, 15000, '✂️', true],
      [3, 'Uñas y detalles', 'Corte de uñas, limpieza de oídos y revisión general para detectar signos que puedan requerir una consulta veterinaria.', 20, 6000, '💅', true],
    ]);
  }

  crearHojaSiNoExiste_(ss, SHEET_NAMES.reservas,
    ['ID', 'Fecha', 'Hora', 'IDCliente', 'ClienteNombre', 'IDMascota', 'MascotaNombre',
     'IDServicio', 'ServicioNombre', 'DuracionMin', 'Precio', 'Estado', 'FechaCreacion']);

  const hojaConfig = crearHojaSiNoExiste_(ss, SHEET_NAMES.configuracion, ['Clave', 'Valor']);
  if (hojaConfig.getLastRow() === 1) {
    Object.keys(CONFIG_POR_DEFECTO).forEach((clave) => {
      hojaConfig.appendRow([clave, CONFIG_POR_DEFECTO[clave]]);
    });
  }
  // Fuerza texto plano en la columna Valor: si no, Sheets auto-convierte cosas
  // como "09:00" en un valor de Hora interno y el backend deja de poder leerlo.
  hojaConfig.getRange('B:B').setNumberFormat('@');

  const hojaBloqueados = crearHojaSiNoExiste_(ss, SHEET_NAMES.diasBloqueados, ['Fecha', 'Motivo', 'GrupoSemana']);
  hojaBloqueados.getRange('A:A').setNumberFormat('@');
  hojaBloqueados.getRange('C:C').setNumberFormat('@');

  crearHojaSiNoExiste_(ss, SHEET_NAMES.administradores, ['Usuario', 'PasswordHash', 'Activo']);

  const hojaReservas = ss.getSheetByName(SHEET_NAMES.reservas);
  if (hojaReservas) {
    hojaReservas.getRange('B:B').setNumberFormat('@'); // Fecha
    hojaReservas.getRange('C:C').setNumberFormat('@'); // Hora
  }

  SpreadsheetApp.getUi().alert('Hojas inicializadas correctamente ✅\n\nAhora ejecuta crearPrimerAdministrador() para crear tu usuario de acceso al panel.');
}

/**
 * Ejecuta esta función UNA SOLA VEZ desde el editor de Apps Script
 * (menú de funciones arriba → selecciona "crearPrimerAdministrador" → ▶ Ejecutar).
 *
 * Cambia usuario y password de ejemplo abajo por los tuyos reales ANTES de
 * ejecutar. La contraseña nunca se guarda en texto plano: esta función la
 * hashea antes de escribirla en la hoja Administradores.
 */
function crearPrimerAdministrador() {
  const usuario = 'admin';           // 👉 cámbialo
  const password = 'CambiaEstaClave123'; // 👉 cámbialo antes de ejecutar

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName(SHEET_NAMES.administradores) ||
    crearHojaSiNoExiste_(ss, SHEET_NAMES.administradores, ['Usuario', 'PasswordHash', 'Activo']);

  hoja.appendRow([usuario, hashPassword_(password), true]);
  SpreadsheetApp.getUi().alert('Administrador "' + usuario + '" creado. Ya puedes iniciar sesión en /admin.html con la contraseña que pusiste en el código (bórrala del código después si quieres).');
}

function crearHojaSiNoExiste_(ss, nombre, encabezados) {
  let hoja = ss.getSheetByName(nombre);
  if (!hoja) {
    hoja = ss.insertSheet(nombre);
    hoja.appendRow(encabezados);
    hoja.setFrozenRows(1);
    hoja.getRange(1, 1, 1, encabezados.length).setFontWeight('bold');
  }
  return hoja;
}

// ---------------------------------------------------------------------------
// NORMALIZACIÓN DE FECHAS/HORAS
// ---------------------------------------------------------------------------
// Google Sheets a veces detecta automáticamente que un texto como "09:00" o
// "2026-08-10" es una hora/fecha y lo convierte en un valor interno de tipo
// Date, aunque nosotros escribamos un string. Estas funciones dejan el valor
// siempre en el formato de texto que espera el resto del código, sin importar
// cómo lo haya guardado la hoja. (Además fijamos las columnas relevantes en
// formato "texto plano" al crear las hojas, para que esto no vuelva a pasar.)
function normalizarHora_(valor) {
  if (valor instanceof Date) {
    return Utilities.formatDate(valor, Session.getScriptTimeZone(), 'HH:mm');
  }
  return String(valor).trim();
}

function normalizarFechaISO_(valor) {
  if (valor instanceof Date) {
    return Utilities.formatDate(valor, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(valor).split('T')[0].trim();
}

function formatearFechaISO_(fecha) {
  return Utilities.formatDate(fecha, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/** Devuelve el lunes (ISO) de la semana que contiene fechaISO. */
function lunesDeLaSemana_(fechaISO) {
  const fecha = new Date(fechaISO + 'T00:00:00');
  const dia = fecha.getDay(); // 0=domingo
  const offset = dia === 0 ? -6 : 1 - dia;
  fecha.setDate(fecha.getDate() + offset);
  return formatearFechaISO_(fecha);
}

// ---------------------------------------------------------------------------
// AUTENTICACIÓN
// ---------------------------------------------------------------------------
function hashPassword_(password) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + SALT_PASSWORD);
  return Utilities.base64Encode(bytes);
}

function login_(usuario, password) {
  if (!usuario || !password) throw new Error('Usuario y contraseña son obligatorios');

  const cache = CacheService.getScriptCache();
  const claveIntentos = 'intentos_' + usuario;
  const intentos = Number(cache.get(claveIntentos) || 0);
  if (intentos >= 5) {
    throw new Error('Demasiados intentos fallidos. Intenta de nuevo en 15 minutos.');
  }

  const admins = sheetToObjects_(SHEET_NAMES.administradores);
  const admin = admins.find((a) => a.Usuario === usuario && (a.Activo === true || a.Activo === 'TRUE'));

  if (!admin || admin.PasswordHash !== hashPassword_(password)) {
    cache.put(claveIntentos, String(intentos + 1), 15 * 60);
    throw new Error('Usuario o contraseña incorrectos');
  }

  cache.remove(claveIntentos);
  const token = Utilities.getUuid();
  cache.put('sesion_' + token, usuario, DURACION_SESION_SEGUNDOS);
  return { token, usuario };
}

/** Lanza un error si el token no corresponde a una sesión activa; si es válida, devuelve el usuario. */
function verificarToken_(token) {
  if (!token) throw new Error('No autorizado: falta token de sesión');
  const usuario = CacheService.getScriptCache().get('sesion_' + token);
  if (!usuario) throw new Error('Sesión inválida o expirada. Vuelve a iniciar sesión.');
  return usuario;
}

// ---------------------------------------------------------------------------
// CONFIGURACIÓN (horario laboral, editable desde el panel)
// ---------------------------------------------------------------------------
function cargarConfiguracion_() {
  const filas = sheetToObjects_(SHEET_NAMES.configuracion);
  const config = Object.assign({}, CONFIG_POR_DEFECTO);
  filas.forEach((f) => { config[f.Clave] = f.Valor; });

  const horaInicio = normalizarHora_(config.horaInicio);
  const horaFin = normalizarHora_(config.horaFin);
  const almuerzoInicio = normalizarHora_(config.almuerzoInicio);
  const almuerzoFin = normalizarHora_(config.almuerzoFin);
  const intervaloMinutos = Number(config.intervaloMinutos);

  const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
  return {
    diasHabiles: String(config.diasHabiles).split(',').map(Number).filter((n) => !isNaN(n)),
    horaInicio: HHMM.test(horaInicio) ? horaInicio : CONFIG_POR_DEFECTO.horaInicio,
    horaFin: HHMM.test(horaFin) ? horaFin : CONFIG_POR_DEFECTO.horaFin,
    almuerzoInicio: HHMM.test(almuerzoInicio) ? almuerzoInicio : CONFIG_POR_DEFECTO.almuerzoInicio,
    almuerzoFin: HHMM.test(almuerzoFin) ? almuerzoFin : CONFIG_POR_DEFECTO.almuerzoFin,
    intervaloMinutos: (intervaloMinutos > 0) ? intervaloMinutos : Number(CONFIG_POR_DEFECTO.intervaloMinutos),
  };
}

function guardarConfiguracion(body) {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.configuracion);
  const nuevaConfig = {
    diasHabiles: (body.diasHabiles || []).join(','),
    horaInicio: body.horaInicio,
    horaFin: body.horaFin,
    almuerzoInicio: body.almuerzoInicio,
    almuerzoFin: body.almuerzoFin,
    intervaloMinutos: String(body.intervaloMinutos),
  };

  const datos = hoja.getDataRange().getValues();
  Object.keys(nuevaConfig).forEach((clave) => {
    let encontrada = false;
    for (let i = 1; i < datos.length; i++) {
      if (datos[i][0] === clave) {
        hoja.getRange(i + 1, 2).setValue(nuevaConfig[clave]);
        encontrada = true;
        break;
      }
    }
    if (!encontrada) hoja.appendRow([clave, nuevaConfig[clave]]);
  });

  return cargarConfiguracion_();
}

function getBloqueosDetallados_() {
  return sheetToObjects_(SHEET_NAMES.diasBloqueados).map((r) => ({
    fecha: normalizarFechaISO_(r.Fecha),
    motivo: r.Motivo || '',
    grupoSemana: r.GrupoSemana ? normalizarFechaISO_(r.GrupoSemana) : '',
  }));
}

function getFechasBloqueadas_() {
  return getBloqueosDetallados_().map((r) => r.fecha);
}

function bloquearFecha(fechaISO, motivo, grupoSemana) {
  if (!fechaISO) throw new Error('Falta la fecha a bloquear');
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.diasBloqueados);
  if (getFechasBloqueadas_().indexOf(fechaISO) !== -1) return { fecha: fechaISO, yaExistia: true };
  hoja.appendRow([fechaISO, motivo || '', grupoSemana || '']);
  return { fecha: fechaISO, motivo };
}

function desbloquearFecha(fechaISO) {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.diasBloqueados);
  const datos = hoja.getDataRange().getValues();
  for (let i = 1; i < datos.length; i++) {
    if (normalizarFechaISO_(datos[i][0]) === fechaISO) {
      hoja.deleteRow(i + 1);
      return { fecha: fechaISO, desbloqueada: true };
    }
  }
  return { fecha: fechaISO, desbloqueada: false };
}

/**
 * Bloquea una semana completa (Lunes a Domingo) a partir de cualquier fecha
 * que caiga dentro de esa semana. Así el administrador puede ir marcando
 * "esta semana no trabajo" sin tener que bloquear día por día.
 */
function bloquearSemana(fechaCualquierDia, motivo) {
  if (!fechaCualquierDia) throw new Error('Falta una fecha de referencia para la semana');
  const lunes = lunesDeLaSemana_(fechaCualquierDia);
  const fechas = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(lunes + 'T00:00:00');
    d.setDate(d.getDate() + i);
    fechas.push(formatearFechaISO_(d));
  }

  const existentes = getFechasBloqueadas_();
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.diasBloqueados);
  fechas.forEach((f) => {
    if (existentes.indexOf(f) === -1) {
      hoja.appendRow([f, motivo || 'Semana bloqueada', lunes]);
    }
  });

  return { grupoSemana: lunes, fechas };
}

function desbloquearSemana(grupoSemana) {
  if (!grupoSemana) throw new Error('Falta el identificador de la semana');
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.diasBloqueados);
  const datos = hoja.getDataRange().getValues();

  // Recorremos de abajo hacia arriba para que borrar filas no desordene los índices.
  for (let i = datos.length - 1; i >= 1; i--) {
    if (datos[i][2] && normalizarFechaISO_(datos[i][2]) === grupoSemana) {
      hoja.deleteRow(i + 1);
    }
  }
  return { grupoSemana, desbloqueada: true };
}

/** Config + días bloqueados, expuesto sin token porque el cliente lo necesita para pintar el calendario. */
function getConfiguracionPublica() {
  const config = cargarConfiguracion_();
  return Object.assign({}, config, { fechasBloqueadas: getFechasBloqueadas_() });
}

// ---------------------------------------------------------------------------
// SERVICIOS
// ---------------------------------------------------------------------------
function getServicios() {
  const rows = sheetToObjects_(SHEET_NAMES.servicios);
  return rows
    .filter((r) => r.Activo === true || r.Activo === 'TRUE' || r.Activo === 'VERDADERO')
    .map(filaServicioAObjeto_);
}

function filaServicioAObjeto_(r) {
  return {
    id: r.ID,
    nombre: r.Nombre,
    descripcion: r.Descripcion,
    duracion: Number(r.DuracionMin),
    precio: Number(r.Precio),
    icono: r.Icono,
    activo: r.Activo === true || r.Activo === 'TRUE',
  };
}

/** Crea (sin id) o actualiza (con id) un servicio. Usado por el panel de administrador. */
function guardarServicio(servicio) {
  if (!servicio || !servicio.nombre || !servicio.duracion || servicio.precio == null) {
    throw new Error('Faltan datos del servicio (nombre, duración y precio son obligatorios)');
  }

  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.servicios);
  const datos = hoja.getDataRange().getValues();

  if (servicio.id) {
    for (let i = 1; i < datos.length; i++) {
      if (String(datos[i][0]) === String(servicio.id)) {
        hoja.getRange(i + 1, 1, 1, 7).setValues([[
          servicio.id, servicio.nombre, servicio.descripcion || '', servicio.duracion,
          servicio.precio, servicio.icono || '🐾', servicio.activo !== false,
        ]]);
        return filaServicioAObjeto_({
          ID: servicio.id, Nombre: servicio.nombre, Descripcion: servicio.descripcion,
          DuracionMin: servicio.duracion, Precio: servicio.precio, Icono: servicio.icono,
          Activo: servicio.activo !== false,
        });
      }
    }
    throw new Error('Servicio no encontrado: ' + servicio.id);
  }

  const nuevoId = datos.length; // fila siguiente (encabezado ocupa la 1)
  hoja.appendRow([nuevoId, servicio.nombre, servicio.descripcion || '', servicio.duracion,
    servicio.precio, servicio.icono || '🐾', true]);
  return filaServicioAObjeto_({
    ID: nuevoId, Nombre: servicio.nombre, Descripcion: servicio.descripcion,
    DuracionMin: servicio.duracion, Precio: servicio.precio, Icono: servicio.icono, Activo: true,
  });
}

/** Borrado suave: marca el servicio como inactivo en vez de eliminar la fila (conserva el historial de reservas). */
function eliminarServicio(id) {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.servicios);
  const datos = hoja.getDataRange().getValues();
  for (let i = 1; i < datos.length; i++) {
    if (String(datos[i][0]) === String(id)) {
      hoja.getRange(i + 1, 7).setValue(false);
      return { id, eliminado: true };
    }
  }
  throw new Error('Servicio no encontrado: ' + id);
}

// ---------------------------------------------------------------------------
// DISPONIBILIDAD DE HORARIOS
// ---------------------------------------------------------------------------
function getHorariosDisponibles(fechaISO, duracionMinutos) {
  if (!fechaISO) throw new Error('Falta el parámetro fecha');

  const config = cargarConfiguracion_();
  const fecha = new Date(fechaISO + 'T00:00:00');
  const diaSemana = fecha.getDay();

  if (config.diasHabiles.indexOf(diaSemana) === -1) return [];
  if (getFechasBloqueadas_().indexOf(fechaISO) !== -1) return [];

  const slots = generarSlotsDelDia_(config);
  const reservasDelDia = getReservas({ fecha: fechaISO })
    .filter((r) => r.estado !== 'Cancelada');

  return slots.filter((slot) => {
    const inicioSlot = minutosDesdeMedianoche_(slot);
    const finSlot = inicioSlot + duracionMinutos;

    const finJornada = minutosDesdeMedianoche_(config.horaFin);
    const inicioAlmuerzo = minutosDesdeMedianoche_(config.almuerzoInicio);
    const finAlmuerzo = minutosDesdeMedianoche_(config.almuerzoFin);

    if (finSlot > finJornada) return false;
    if (inicioSlot < finAlmuerzo && finSlot > inicioAlmuerzo) return false;

    const seSuperpone = reservasDelDia.some((r) => {
      const inicioR = minutosDesdeMedianoche_(r.hora);
      const finR = inicioR + Number(r.duracion);
      return inicioSlot < finR && finSlot > inicioR;
    });

    return !seSuperpone;
  });
}

function generarSlotsDelDia_(config) {
  const slots = [];
  let cursor = minutosDesdeMedianoche_(config.horaInicio);
  const fin = minutosDesdeMedianoche_(config.horaFin);

  while (cursor < fin) {
    slots.push(formatearMinutos_(cursor));
    cursor += config.intervaloMinutos;
  }
  return slots;
}

function minutosDesdeMedianoche_(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function formatearMinutos_(totalMin) {
  const h = String(Math.floor(totalMin / 60)).padStart(2, '0');
  const m = String(totalMin % 60).padStart(2, '0');
  return `${h}:${m}`;
}

// ---------------------------------------------------------------------------
// RESERVAS
// ---------------------------------------------------------------------------
function getReservas(filtros) {
  filtros = filtros || {};
  let rows = sheetToObjects_(SHEET_NAMES.reservas).map((r) => ({
    id: r.ID,
    fecha: normalizarFechaISO_(r.Fecha),
    hora: normalizarHora_(r.Hora),
    clienteNombre: r.ClienteNombre,
    mascotaNombre: r.MascotaNombre,
    servicioNombre: r.ServicioNombre,
    duracion: r.DuracionMin,
    precio: r.Precio,
    estado: r.Estado,
  }));

  if (filtros.fecha) rows = rows.filter((r) => r.fecha === filtros.fecha);
  if (filtros.estado) rows = rows.filter((r) => r.estado === filtros.estado);

  return rows;
}

function crearReserva(payload) {
  const { servicio, mascota, fecha, hora, duenio } = payload;
  if (!servicio || !mascota || !fecha || !hora || !duenio) {
    throw new Error('Faltan datos obligatorios para la reserva');
  }

  // Re-validar disponibilidad en el servidor (nunca confiar solo en el frontend)
  const disponibles = getHorariosDisponibles(fecha, Number(servicio.duracion));
  if (disponibles.indexOf(hora) === -1) {
    throw new Error('Ese horario ya no está disponible. Por favor elige otro.');
  }

  const idCliente = guardarCliente_(duenio);
  const idMascota = guardarMascota_(mascota, idCliente);
  const idReserva = 'PB-' + Utilities.getUuid().slice(0, 8).toUpperCase();

  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.reservas);
  hoja.appendRow([
    idReserva, fecha, hora, idCliente, `${duenio.firstName} ${duenio.lastName}`,
    idMascota, mascota.petName, servicio.id, servicio.nombre, servicio.duracion,
    servicio.precio, 'Pendiente', new Date(),
  ]);

  return {
    id: idReserva, fecha, hora,
    servicioNombre: servicio.nombre, mascotaNombre: mascota.petName,
    precio: servicio.precio, estado: 'Pendiente',
  };
}

function cancelarReserva(idReserva) {
  return cambiarEstadoReserva(idReserva, 'Cancelada');
}

function cambiarEstadoReserva(idReserva, estado) {
  const ESTADOS_VALIDOS = ['Pendiente', 'Confirmada', 'Completada', 'Cancelada', 'No asistió'];
  if (!idReserva) throw new Error('Falta idReserva');
  if (ESTADOS_VALIDOS.indexOf(estado) === -1) throw new Error('Estado inválido: ' + estado);

  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.reservas);
  const datos = hoja.getDataRange().getValues();
  const colID = 0;
  const colEstado = 11;

  for (let i = 1; i < datos.length; i++) {
    if (datos[i][colID] === idReserva) {
      hoja.getRange(i + 1, colEstado + 1).setValue(estado);
      return { id: idReserva, estado };
    }
  }
  throw new Error('Reserva no encontrada: ' + idReserva);
}

function guardarCliente_(duenio) {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.clientes);
  const datos = hoja.getDataRange().getValues();

  // Evita duplicar cliente si ya reservó antes con el mismo correo.
  for (let i = 1; i < datos.length; i++) {
    if (datos[i][5] === duenio.email) return datos[i][0];
  }

  const idCliente = 'CL-' + Utilities.getUuid().slice(0, 6).toUpperCase();
  hoja.appendRow([idCliente, duenio.firstName, duenio.lastName, duenio.phone, duenio.whatsapp || '', duenio.email, new Date()]);
  return idCliente;
}

function guardarMascota_(mascota, idCliente) {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.mascotas);
  const idMascota = 'MA-' + Utilities.getUuid().slice(0, 6).toUpperCase();
  hoja.appendRow([
    idMascota, idCliente, mascota.petName, mascota.species, mascota.breed || '',
    mascota.size, mascota.age || '', mascota.weight || '', mascota.sex || '', mascota.notes || '',
  ]);
  return idMascota;
}

// ---------------------------------------------------------------------------
// HELPER: convierte una hoja completa en un array de objetos {Encabezado: valor}
// ---------------------------------------------------------------------------
function sheetToObjects_(nombreHoja) {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombreHoja);
  if (!hoja || hoja.getLastRow() < 2) return [];

  const [encabezados, ...filas] = hoja.getDataRange().getValues();
  return filas.map((fila) => {
    const obj = {};
    encabezados.forEach((h, i) => { obj[h] = fila[i]; });
    return obj;
  });
}
