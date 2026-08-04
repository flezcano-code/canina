# 🐾 PawBook — Sistema de Reservas para Peluquerías de Mascotas

Sistema completo de agendamiento online, 100% gratuito, sin servidores propios:
**GitHub Pages (frontend) + Google Apps Script (API) + Google Sheets (base de datos)**.

---

## 1. Arquitectura

```
┌─────────────────┐        fetch() JSON        ┌──────────────────────┐
│  GitHub Pages    │ ──────────────────────────▶│  Google Apps Script  │
│  (HTML/CSS/JS)   │ ◀──────────────────────────│  Web App (doGet/Post)│
└─────────────────┘                             └──────────┬────────────┘
                                                             │
                                                             ▼
                                                  ┌──────────────────────┐
                                                  │   Google Sheets       │
                                                  │ (Clientes, Mascotas,  │
                                                  │  Servicios, Reservas, │
                                                  │  Configuracion)       │
                                                  └──────────────────────┘
```

**Por qué esta arquitectura y no otra:**

- **Apps Script como backend REST**: es gratis, no requiere tarjeta de crédito, corre en la
  infraestructura de Google, y `SpreadsheetApp` nos da persistencia sin configurar una base
  de datos. Es el punto óptimo costo/beneficio para una peluquería pequeña.
- **Google Sheets como DB**: el dueño de la peluquería puede abrir la planilla y ver/editar
  reservas manualmente sin depender de nosotros. Eso es un requisito no-funcional importante
  en negocios pequeños (autonomía del dueño).
- **Sin frameworks pesados (React/Vue)**: GitHub Pages sirve archivos estáticos; un SPA hecho
  a mano con ES6 modules + Tailwind es suficiente, más liviano y sin build step (no Webpack,
  no Node en producción).
- **Un solo `index.html`, sin partials HTML server-side incluidos por fetch**: GitHub Pages
  no tiene includes de servidor, y traer `calendar.html`/`modal.html` por `fetch()` sólo para
  inyectarlos agrega una llamada de red y complejidad sin beneficio real. En su lugar, cada
  "componente" es una función JS que **genera** el HTML (`renderCalendar()`, `renderModal()`,
  `renderServiceCard()`), viven en sus propios archivos JS y se importan como módulos ES6.
  Esto es más modular y más rápido que fetch-de-partials, así que me desvié ligeramente del
  árbol de carpetas pedido (sin `/components/*.html`) — lo documento aquí en vez de generar
  archivos vacíos "por cumplir".
- **CORS con Apps Script**: Apps Script Web Apps no permiten configurar headers CORS
  libremente. La solución estándar (y la que usamos) es que el frontend haga `fetch` con
  `Content-Type: text/plain` (evita el preflight OPTIONS, que Apps Script maneja mal) y el
  backend responda siempre con `ContentService` en JSON. Todos los endpoints están diseñados
  alrededor de esta restricción.

## 2. Árbol del proyecto

```
pet-grooming-booking/
├── index.html            # landing: hero, por qué es importante el aseo, Instagram, mapa, 2 botones
├── reservar.html          # wizard de reserva del cliente (5 pasos) — antes era index.html
├── admin.html              # panel de administrador (login + dashboard)
├── css/
│   └── styles.css
├── js/
│   ├── app.js            # Estado global + orquestación del wizard de reserva
│   ├── admin.js            # Lógica del panel de administrador
│   ├── landing.js           # Animación de aparición al hacer scroll en la landing
│   ├── calendar.js           # Calendario visual (mes) + selector de horas
│   ├── api.js                # Cliente fetch() hacia Apps Script
│   └── utils.js               # Validaciones, formateo, helpers DOM
├── assets/
│   ├── icons/
│   └── images/
│       └── logo.png
├── backend/
│   └── AppsScript.gs      # API REST completa + inicialización de Sheets
└── README.md
```

## 3. Sistema de diseño (token system)

| Rol | Valor |
|---|---|
| Fondo | `#FBFAF7` (hueso cálido) |
| Superficie / tarjetas | `#FFFFFF` |
| Texto principal | `#1E2A28` (verde-carbón, no negro puro) |
| Primario | `#3F8F73` (verde salvia profundo — evoca "cuidado natural") |
| Primario hover | `#2F6E58` |
| Acento | `#FF9166` (durazno/apricot — calidez, "mascota feliz") |
| Borde sutil | `#E7E3DA` |

- **Tipografía display**: `Fraunces` (serif con carácter, variable) para títulos — evita el
  cliché de sans-serif genérica en todo, le da un aire "boutique" en vez de "SaaS B2B".
- **Tipografía UI/body**: `Inter` — legible, neutra, funciona bien en formularios.
- **Firma visual**: el selector de hora usa "píldoras" (pill buttons) tipo Koalendar con un
  micro-rebote al seleccionar, y el paso activo del wizard se muestra como una barra de
  progreso con las 5 etapas nombradas (no genérica "Paso 2 de 5").

## 4. Instalación

### Backend (Google Apps Script)

1. Crea una Google Sheet nueva (o usa la que ya tienes) → `Extensiones → Apps Script`.
2. Borra todo el contenido del editor y pega el de `backend/AppsScript.gs`.
3. Arriba del editor, en el desplegable de funciones, selecciona **`inicializarHojas`** y presiona ▶ **Ejecutar**.
   - La primera vez te va a pedir autorización (tu propia cuenta de Google) — acepta los permisos.
   - Esto crea automáticamente las hojas: `Clientes`, `Mascotas`, `Servicios`, `Reservas`, `Configuracion`, `DiasBloqueados` y `Administradores`.
4. Antes de crear tu usuario admin, edita estas dos líneas dentro de la función `crearPrimerAdministrador()` (búscala en el archivo, está cerca de la mitad):
   ```js
   const usuario = 'admin';               // 👉 cámbialo por el usuario que quieras
   const password = 'CambiaEstaClave123'; // 👉 cámbialo por una contraseña real y segura
   ```
5. Selecciona **`crearPrimerAdministrador`** en el mismo desplegable de funciones y presiona ▶ **Ejecutar**.
   - Esto guarda tu usuario en la hoja `Administradores` — pero **nunca la contraseña en texto plano**, solo su hash (una huella digital irreversible). Ni tú, abriendo la hoja, vas a poder leer la contraseña real ahí.
   - Después de ejecutarlo una vez, puedes borrar la contraseña del código si quieres (ya quedó guardada, hasheada, en la hoja).
6. `Implementar → Nueva implementación → Aplicación web`.
   - Ejecutar como: **Yo (tu cuenta)**.
   - Quién tiene acceso: **Cualquier usuario**.
7. Copia la URL `.../exec` que te entrega Google — esa es tu API.

### Frontend

1. En `js/api.js`, reemplaza la constante `API_BASE_URL` con la URL del paso anterior.
2. Sube la carpeta completa a un repo de GitHub → `Settings → Pages → Deploy from branch`.
3. Página de inicio (landing, con los dos botones): `https://tuusuario.github.io/tu-repo/`
   Reservas del cliente: `https://tuusuario.github.io/tu-repo/reservar.html`
   Panel de administrador: `https://tuusuario.github.io/tu-repo/admin.html`
4. Entra a `admin.html` con el usuario/contraseña que definiste en el paso 4-5 de arriba.

> ⚠️ Si ya tenías el sitio publicado antes de esta versión: el archivo que antes era
> `index.html` (el formulario de reserva) ahora se llama `reservar.html`, y `index.html`
> pasó a ser la página de inicio nueva. Sube ambos archivos.

### Sobre las fotos de Instagram

No es técnicamente posible traer automáticamente las fotos de tu Instagram
(`@esteticacaninacopiapo`) a la página — Instagram bloquea ese tipo de descarga
automatizada y no ofrecemos acceso a su API privada. Lo que sí dejé listo: un botón grande
en la landing que lleva directo a tu perfil. Si más adelante quieres mostrar fotos
específicas directamente en la página, la forma real de hacerlo es que me pases 3-6 fotos
tuyas (las subes como archivo) y las agrego a una galería en `assets/images/instagram/` —
ahí sí puedo maquetarlas bonito.

### ¿Cómo bloqueo un día (ej. no trabajar los miércoles)?

Panel administrador → pestaña **Horario** → desmarca "Mié" en los días de la semana → **Guardar horario**. Ese día desaparece del calendario del cliente de inmediato (no hace falta redeploy, se lee en vivo desde la hoja).

Para un día puntual (ej. "el 25 de diciembre no trabajo aunque normalmente sí"), usa **Bloquear un día puntual**.

Para bloquear una semana entera de una vez (ej. "esta semana no trabajo"), usa **Bloquear una semana completa**: eliges cualquier día dentro de esa semana y bloquea de lunes a domingo automáticamente. Aparece como un solo bloque en la lista ("Semana: 10 ago — 16 ago") con un botón para desbloquearla completa de nuevo.

## 5. Estado del proyecto (fases)

- ✅ **Fase 1**: flujo de reserva completo (5 pantallas), calendario visual, selección de hora
  tipo Koalendar, validaciones de formulario, API REST en Apps Script con cálculo real de
  disponibilidad, inicialización automática de hojas.
- ✅ **Fase 2**: panel de administrador con login (usuario/contraseña hasheada,
  sesiones con expiración de 6h y bloqueo tras intentos fallidos), gestión de reservas
  (filtrar y cambiar estado), gestión de horario laboral y días bloqueados, CRUD de servicios.
- ✅ **Fase 2.1** (esta entrega):
  - **Corregido un bug** que dejaba "No hay horarios disponibles" para todos los días — la
    causa era que Google Sheets auto-convertía valores como `"09:00"` en un tipo interno de
    Hora en vez de dejarlos como texto, y el backend no sabía leer eso. Ahora el backend
    normaliza cualquier celda de hora/fecha sin importar cómo la haya guardado Sheets, y
    además las columnas relevantes quedan fijadas en formato texto para que no vuelva a pasar.
    **Si ya tenías el sistema desplegado, vuelve a ejecutar `inicializarHojas()` una vez** para
    aplicar el formato de texto a tu hoja existente.
  - **Bloqueo de semanas completas** (además del bloqueo día por día que ya existía).
  - **Landing page** (`index.html`) con sección de por qué es importante el aseo, animación
    de aparición al hacer scroll, botón a Instagram, mapa de Google Maps embebido, y los dos
    botones "Agendar hora" / "Panel administrador".
  - **Aviso de tolerancia de 15 minutos** en el formulario de reserva y en la pantalla de
    confirmación.
  - **Mascotas guardadas**: el sistema recuerda (en el navegador del cliente, sin necesidad de
    cuenta) las mascotas que ya reservaron antes, para que no tengan que volver a escribir sus
    datos — aparecen como chips seleccionables en el paso 2. *Nota:* esto es por dispositivo/
    navegador (no hay login de cliente), y cada reserva sigue siendo para una mascota a la vez;
    si quieres reservar el mismo horario para varias mascotas juntas, cuéntame y lo armamos
    como una fase aparte, ya que implica repensar cómo se calcula la duración del bloque.
- ✅ **Fase 2.2** (esta entrega):
  - **Landing page rediseñada por completo**: nav fija arriba (con los botones "Agendar
    hora" y "Administrador" siempre visibles, más menú mobile), hero con blobs decorativos,
    vista previa de servicios y horario de atención **traídos en vivo desde el backend**
    (si cambias un precio o el horario en el panel, se refleja automáticamente en la
    landing), sección de por qué es importante el aseo, galería, franja de Instagram, mapa,
    y un CTA final.
  - **Animación de carga con patitas** (`.paw-loader`): un componente reutilizable que
    reemplaza los textos planos de "Cargando…" en toda la app — landing, reserva y panel
    de administrador.
  - **Galería con detección automática**: sube tus fotos con estos nombres exactos a
    `assets/images/galeria/` — `galeria-1.jpg`, `galeria-2.jpg`, ... hasta `galeria-8.jpg` —
    y aparecen solas en la landing, sin tocar código. No hace falta subir las 8; con las que
    existan alcanza. Mientras no subas ninguna, se muestra un aviso con link a Instagram.
- ⏳ **Fase 3**: integración de envío real de WhatsApp/Correo al confirmar una reserva (la
  estructura de datos ya queda lista para conectar).

## 6. Sobre seguridad y "F12"

Ningún sitio web puede ocultar su HTML/CSS/JS al abrir las herramientas de desarrollador —
es una limitación de la web en general, no de este proyecto. Lo que sí está resuelto acá:

- La contraseña del administrador **nunca** se valida ni se compara en el navegador; toda la
  autenticación ocurre en el backend (Apps Script).
- La contraseña se guarda **hasheada** (SHA-256 + salt) en la hoja `Administradores`, nunca en
  texto plano — ni siquiera quien edite la hoja directamente puede leerla.
- Los datos de clientes, mascotas y reservas **no se descargan al navegador** hasta que el
  backend valida un token de sesión vigente.
- Después de 5 intentos fallidos de login para un mismo usuario, el backend bloquea nuevos
  intentos por 15 minutos.
- La sesión se guarda en `sessionStorage` (no en `localStorage`), así que se borra sola al
  cerrar la pestaña del navegador.
