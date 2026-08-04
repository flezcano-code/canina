/**
 * landing.js
 * Lógica de la página de inicio: menú/nav, animación de aparición al hacer
 * scroll, vista previa de servicios y horario "en vivo" (traídos del mismo
 * backend público que usa la página de reserva), y una galería que detecta
 * automáticamente las fotos que el dueño vaya subiendo a assets/images/galeria/.
 */

import { api } from './api.js';
import { formatCLP } from './utils.js';

document.body.classList.add('js-enabled');

// ---------------------------------------------------------------------------
// NAV: sombra al hacer scroll + menú mobile
// ---------------------------------------------------------------------------
const nav = document.getElementById('site-nav');
window.addEventListener('scroll', () => {
  nav.classList.toggle('landing-nav-scrolled', window.scrollY > 8);
}, { passive: true });

const btnMobileMenu = document.getElementById('btn-mobile-menu');
const mobileMenu = document.getElementById('mobile-menu');
btnMobileMenu.addEventListener('click', () => mobileMenu.classList.toggle('open'));
mobileMenu.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => mobileMenu.classList.remove('open')));

// ---------------------------------------------------------------------------
// Animación de aparición al hacer scroll
// ---------------------------------------------------------------------------
const revealObserver = new IntersectionObserver((entradas) => {
  entradas.forEach((entrada) => {
    if (entrada.isIntersecting) {
      entrada.target.classList.add('reveal-visible');
      revealObserver.unobserve(entrada.target);
    }
  });
}, { threshold: 0.12 });

document.querySelectorAll('.reveal').forEach((el) => revealObserver.observe(el));

// ---------------------------------------------------------------------------
// Vista previa de servicios (misma API pública que usa reservar.html)
// ---------------------------------------------------------------------------
async function cargarServiciosPreview() {
  const grid = document.getElementById('servicios-preview-grid');
  try {
    const servicios = await api.getServicios();
    grid.innerHTML = servicios.map((s) => `
      <div class="service-preview-card">
        <span class="text-3xl">${s.icono || '🐾'}</span>
        <h3 class="font-display font-semibold text-lg mt-3 mb-1">${s.nombre}</h3>
        <p class="text-sm text-ink/60 mb-4">${s.descripcion}</p>
        <div class="flex items-center gap-2 text-xs">
          <span class="px-2.5 py-1 rounded-full bg-bone border border-line text-ink/70">${s.duracion} min</span>
          <span class="px-2.5 py-1 rounded-full bg-accent-light text-accent font-medium">${formatCLP(s.precio)}</span>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.warn('No se pudieron cargar los servicios para la vista previa:', err.message);
    grid.innerHTML = `<p class="sm:col-span-3 text-center text-ink/40 py-6">No se pudieron cargar los servicios en este momento.</p>`;
  }
}

// ---------------------------------------------------------------------------
// Horario "en vivo"
// ---------------------------------------------------------------------------
const NOMBRES_DIA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

async function cargarHorarioVivo() {
  const wrap = document.getElementById('horario-vivo');
  try {
    const config = await api.getConfiguracionPublica();
    const diasOrdenados = [1, 2, 3, 4, 5, 6, 0].filter((d) => config.diasHabiles.includes(d));
    const diasTexto = diasOrdenados.length
      ? agruparDiasConsecutivos_(diasOrdenados)
      : 'Cerrado temporalmente';

    wrap.innerHTML = `
      <p class="text-2xl font-display font-semibold text-primary mb-1">${config.horaInicio} – ${config.horaFin}</p>
      <p class="text-sm text-ink/60 mb-3">${diasTexto}</p>
      <p class="text-xs text-ink/40">Horario de almuerzo: ${config.almuerzoInicio} – ${config.almuerzoFin}</p>
    `;
  } catch (err) {
    console.warn('No se pudo cargar el horario en vivo:', err.message);
    wrap.innerHTML = `<p class="text-sm text-ink/40">No se pudo cargar el horario en este momento. Puedes ver la disponibilidad real al agendar.</p>`;
  }
}

function agruparDiasConsecutivos_(dias) {
  // dias viene en orden Lun..Dom (ya filtrado a los días hábiles)
  if (dias.length === 7) return 'Todos los días';
  const nombres = dias.map((d) => NOMBRES_DIA[d]);
  if (nombres.length <= 2) return nombres.join(' y ');
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Galería con detección automática de fotos
// ---------------------------------------------------------------------------
// El dueño del negocio simplemente sube archivos con estos nombres exactos a
// assets/images/galeria/ y aparecen solos acá, sin tocar código. Mientras no
// existan, se muestra un estado vacío con link a Instagram.
const CANDIDATOS_GALERIA = Array.from({ length: 8 }, (_, i) => `assets/images/galeria/galeria-${i + 1}.jpg`);

function cargarGaleria() {
  const grid = document.getElementById('galeria-grid');
  const vacia = document.getElementById('galeria-vacia');

  const intentos = CANDIDATOS_GALERIA.map((ruta) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(ruta);
    img.onerror = () => resolve(null);
    img.src = ruta;
  }));

  Promise.all(intentos).then((resultados) => {
    const encontradas = resultados.filter(Boolean);
    if (!encontradas.length) {
      grid.classList.add('hidden');
      vacia.classList.remove('hidden');
      revealObserver.observe(vacia);
      return;
    }

    grid.innerHTML = encontradas.map((ruta) => `
      <div class="gallery-card"><img src="${ruta}" alt="Trabajo realizado en Estética Canina" loading="lazy"></div>
    `).join('');
  });
}

cargarServiciosPreview();
cargarHorarioVivo();
cargarGaleria();
