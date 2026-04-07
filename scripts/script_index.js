const mapa = document.getElementById('map');
const contenedorParadas = document.getElementById('contenedor_paradas');
const contLineasFavs = document.getElementById('lineas_favs');

let ubicacion = null;
let leafletMap = null;
let userMarker = null;
let paradasGeojson = null;
let paradasLayer = null;
let paradasPuntos = null;
let actualizarParadasTimer = null;
let recorridoLayer = null;
let recorridoActivo = null;
let paradasRecorrido = null;
let paradasRecorridoMarkers = null;
let seleccionParadaLayer = null;
let _frequenciesData = null; // Cache de datos de frequencies.txt

const PARADAS_GEOJSON_URL = encodeURI('Datos/DATOS SAN JUAN.geojson');
const FREQUENCIES_URL = 'Datos/frequencies.txt';
const RADIO_PARADAS_METROS = 700;
const MAX_PARADAS_MOSTRAR = 40;
const MAX_PARADAS_MOSTRAR_EN_VISTA = 200;
const EVENTO_PARADAS_DEBOUNCE_MS = 150;
const ZOOM_CALLE = 18;
const ZOOM_PARADAS_EN_VISTA = 16;
const STORAGE_LINEAS_FAVS_KEY = 'transitsj_lineas_favs_v1';
const STORAGE_PARADAS_FAVS_KEY = 'transitsj_paradas_favs_v1';
const MAX_PARADAS_FAVS = 5;
const MAX_PARADAS_RECORRIDO = 3;
const MAX_HORARIOS_MOSTRAR = 3;
const STORAGE_DARK_MODE_KEY = 'transitsj_dark_mode_v1';
const STORAGE_TRANSPARENCY_KEY = 'transitsj_transparency_v1';
const BOTTOM_SHEET_STATE_HALF = 'half';
const BOTTOM_SHEET_STATE_FULL = 'full';
const SHEET_DRAG_EXPAND_THRESHOLD = 70;
const SHEET_DRAG_COLLAPSE_THRESHOLD = 90;
const SHEET_DRAG_CLOSE_THRESHOLD = 90;
const SHEET_DRAG_CLOSE_FROM_FULL_THRESHOLD = 220;

// ─── Planeación de ruta (estimaciones) ───────────────────────────────────────
// Velocidades aproximadas (m/s). Se usan para puntuar por tiempo en lugar de solo distancia.
const WALKING_SPEED_M_S = 1.35; // ~4.9 km/h
const BUS_SPEED_M_S = 5.0; // ~18 km/h (estimación conservadora)
const DESTINO_UMBRAL_CORTE_M = 90; // cortar tramo si pasa a <= 90m del destino
const WAIT_FALLBACK_SECS = 12 * 60; // si no hay frecuencia disponible, penaliza ~12 min
const DEFAULT_HEADWAY_SECS = 15 * 60; // si no hay datos de frequencies, asumir cada ~15 min

// Long press en mapa para guardar ubicación
const MAP_LONG_PRESS_MS = 650;
const MAP_LONG_PRESS_MOVE_TOL_M = 25;
let _longPressMapSetupDone = false;

const PARADA_ICON_URL = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMyIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBjbGFzcz0ibHVjaWRlIGx1Y2lkZS1kb3QtaWNvbiBsdWNpZGUtZG90Ij48Y2lyY2xlIGN4PSIxMi4xIiBjeT0iMTIuMSIgcj0iMSIvPjwvc3ZnPg==';
const USER_WAYPOINT_ICON_URL = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMyIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBjbGFzcz0ibHVjaWRlIGx1Y2lkZS1tYXAtcGluLWljb24gbHVjaWRlLW1hcC1waW4iPjxwYXRoIGQ9Ik0yMCAxMGMwIDQuOTkzLTUuNTM5IDEwLjE5My03LjM5OSAxMS43OTlhMSAxIDAgMCAxLTEuMjAyIDBDOS41MzkgMjAuMTkzIDQgMTQuOTkzIDQgMTBhOCA4IDAgMCAxIDE2IDAiLz48Y2lyY2xlIGN4PSIxMiIgY3k9IjEwIiByPSIzIi8+PC9zdmc+';
let _iconoParadaLeaflet = null;
let _iconoUserWaypointLeaflet = null;

function obtenerIconoParadaLeaflet() {
  if (!leafletMap || typeof L === 'undefined') return null;
  if (_iconoParadaLeaflet) return _iconoParadaLeaflet;

  _iconoParadaLeaflet = L.icon({
    iconUrl: PARADA_ICON_URL,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -28],
  });
  return _iconoParadaLeaflet;
}

function obtenerIconoUserWaypointLeaflet() {
  if (!leafletMap || typeof L === 'undefined') return null;
  if (_iconoUserWaypointLeaflet) return _iconoUserWaypointLeaflet;

  _iconoUserWaypointLeaflet = L.icon({
    iconUrl: USER_WAYPOINT_ICON_URL,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
  });
  return _iconoUserWaypointLeaflet;
}

const GEO_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 0,
};

function actualizarEstadoBotonFavoritos() {
  const favBtn = document.getElementById('bs-fav-btn');
  if (!favBtn) return;

  let esFavorita = false;
  
  if (favBtn.dataset.tipo === 'parada') {
    const feature = window._currentFeature;
    if (feature) {
      const id = obtenerIdParada(feature);
      const favs = obtenerParadasFavs();
      esFavorita = favs.some((f) => f?.id === id);
    }
  } else if (favBtn.dataset.tipo === 'linea') {
    const ref = window._currentLineaRef || '';
    const favs = obtenerLineasFavs();
    esFavorita = favs.some((f) => f?.ref === ref);
  }

  favBtn.classList.toggle('is-fav', esFavorita);
  favBtn.style.opacity = '1';
  favBtn.style.cursor = 'pointer';
  favBtn.setAttribute('aria-label', esFavorita ? 'Quitar de favoritos' : 'Agregar a favoritos');
}

function setBottomSheetState(state) {
  const bs = document.getElementById('bottom-sheet');
  if (!bs) return;
  bs.setAttribute('data-sheet-state', state);
}

function getBottomSheetState() {
  const bs = document.getElementById('bottom-sheet');
  const state = bs?.getAttribute('data-sheet-state');
  return state === BOTTOM_SHEET_STATE_FULL ? BOTTOM_SHEET_STATE_FULL : BOTTOM_SHEET_STATE_HALF;
}

function abrirBottomSheet(titulo, contenidoHtml, tipo = '') {
  const bs = document.getElementById('bottom-sheet');
  const bsTitle = document.getElementById('bs-title');
  const bsContent = document.getElementById('bs-content');
  const overlay = document.getElementById('bottom-sheet-overlay');
  const favBtn = document.getElementById('bs-fav-btn');
  const planBtn = document.getElementById('bs-plan-btn');
  
  if (bsTitle) bsTitle.textContent = titulo;
  if (bsContent) bsContent.innerHTML = contenidoHtml;
  
  // Limpiar estilos transform previos
  if (bs) {
    setBottomSheetState(BOTTOM_SHEET_STATE_HALF);
    bs.style.transform = '';
    bs.style.transition = '';
  }
  
  bs?.classList.add('active');
  overlay?.classList.add('active');
  
  // Reinicializar el drag después de un pequeño delay para asegurar que el DOM está actualizado
  setTimeout(() => {
    setupBottomSheetDrag();
  }, 50);
  
  // Mostrar/ocultar botón de favoritos según el tipo
  if (favBtn) {
    if (tipo === 'parada') {
      favBtn.style.display = '';
      favBtn.dataset.tipo = 'parada';
      favBtn.onclick = () => {
        agregarParadaAFavoritos(window._currentFeature || {});
        actualizarEstadoBotonFavoritos();
      };
      actualizarEstadoBotonFavoritos();
    } else if (tipo === 'linea') {
      favBtn.style.display = '';
      favBtn.dataset.tipo = 'linea';
      favBtn.onclick = () => {
        const ref = window._currentLineaRef || '';
        const name = window._currentLineaName || '';
        agregarLineaAFavoritos({ ref, name });
        actualizarEstadoBotonFavoritos();
      };
      actualizarEstadoBotonFavoritos();
    } else {
      favBtn.style.display = 'none';
      favBtn.classList.remove('is-fav');
      favBtn.removeAttribute('data-tipo');
      favBtn.setAttribute('aria-label', 'Agregar a favoritos');
      favBtn.onclick = null;
    }
  }

  // Botón Planear ruta: solo para paradas (ubicado a la izquierda del handle)
  if (planBtn) {
    if (tipo === 'parada') {
      planBtn.style.display = '';
      planBtn.onclick = () => {
        void verLineaMasCercanaHastaParadaSeleccionada(window._currentFeature || null);
      };
    } else {
      planBtn.style.display = 'none';
      planBtn.onclick = null;
    }
  }
}

function cerrarBottomSheet() {
  const bs = document.getElementById('bottom-sheet');
  const overlay = document.getElementById('bottom-sheet-overlay');
  const favBtn = document.getElementById('bs-fav-btn');
  const planBtn = document.getElementById('bs-plan-btn');
  
  // Limpiar estilos y clases
  if (bs) {
    bs.classList.remove('active');
    bs.classList.remove('dragging');
    setBottomSheetState(BOTTOM_SHEET_STATE_HALF);
    bs.style.transform = '';
    bs.style.transition = '';
  }
  
  overlay?.classList.remove('active');

  if (favBtn) {
    favBtn.onclick = null;
  }
  if (planBtn) {
    planBtn.onclick = null;
    planBtn.style.display = 'none';
  }
  
  // Limpiar recorrido activo al cerrar
  limpiarRecorrido();
  volverVistaGeneral();
}

function abrirBottomSheetFavoritos() {
  const contParadas = document.getElementById('paradas_favs');
  const contLineas = document.getElementById('lineas_favs');
  const contLugares = document.getElementById('lugares_favs');
  const paradasHtml = contParadas?.innerHTML || '<p>No hay paradas favoritas.</p>';
  const lineasHtml = contLineas?.innerHTML || '<p>No hay líneas favoritas.</p>';
  const lugaresHtml = contLugares?.innerHTML || '<p>No hay lugares guardados.</p>';
  
  const html = `
    <h3 style="margin-top: 0; margin-bottom: 16px; font-size: 16px; font-weight: 600;">Paradas Favoritas</h3>
    <div style="margin-bottom: 24px;">${paradasHtml}</div>
    <h3 style="margin-bottom: 16px; font-size: 16px; font-weight: 600;">Líneas Favoritas</h3>
    <div style="margin-bottom: 24px;">${lineasHtml}</div>
    <h3 style="margin-bottom: 16px; font-size: 16px; font-weight: 600;">Lugares Guardados</h3>
    <div>${lugaresHtml}</div>
  `;
  abrirBottomSheet('Favoritos', html);
}

// Funcionalidad de drag en el handle del bottom-sheet
function setupBottomSheetDrag() {
  const handle = document.getElementById('bs-handle');
  const bottomSheet = document.getElementById('bottom-sheet');
  const content = document.getElementById('bs-content');
  
  if (!handle || !bottomSheet) return;
  
  let isDragging = false;
  let startY = 0;
  let currentY = 0;
  let startState = BOTTOM_SHEET_STATE_HALF;

  const resolveTargetState = (initialState, deltaY) => {
    if (initialState === BOTTOM_SHEET_STATE_FULL) {
      if (deltaY > 0) return BOTTOM_SHEET_STATE_HALF;
      return BOTTOM_SHEET_STATE_FULL;
    }

    if (deltaY <= -SHEET_DRAG_EXPAND_THRESHOLD) return BOTTOM_SHEET_STATE_FULL;
    if (deltaY >= SHEET_DRAG_CLOSE_THRESHOLD) return 'close';
    return BOTTOM_SHEET_STATE_HALF;
  };

  const handleDragStart = (e) => {
    if (!bottomSheet.classList.contains('active')) return;
    isDragging = true;
    startY = e.type.includes('mouse') ? e.clientY : e.touches?.[0]?.clientY || 0;
    currentY = 0;
    startState = getBottomSheetState();
    bottomSheet.classList.add('dragging');
    // Prevenir selección de texto durante el drag
    document.body.style.userSelect = 'none';
    if (content) {
      content.style.pointerEvents = 'none';
    }
    e.preventDefault();
  };

  const handleDragMove = (e) => {
    if (!isDragging) return;
    const clientY = e.type.includes('mouse') ? e.clientY : e.touches?.[0]?.clientY || 0;
    currentY = clientY - startY;
    bottomSheet.style.transform = `translateY(${currentY}px)`;
  };

  const handleDragEnd = () => {
    if (!isDragging) return;
    isDragging = false;
    bottomSheet.classList.remove('dragging');
    document.body.style.userSelect = '';
    if (content) {
      content.style.pointerEvents = '';
    }

    const targetState = resolveTargetState(startState, currentY);

    if (targetState === 'close') {
      bottomSheet.style.transform = '';
      bottomSheet.style.transition = '';
      cerrarBottomSheet();
    } else {
      setBottomSheetState(targetState);
      bottomSheet.style.transition = 'transform 0.2s ease';
      bottomSheet.style.transform = '';
      setTimeout(() => {
        bottomSheet.classList.remove('dragging');
      }, 200);
    }
    
    currentY = 0;
  };

  // Remover listeners previos para evitar duplicados
  const prevHandlers = handle._bottomSheetDragHandlers;
  if (prevHandlers) {
    handle.removeEventListener('mousedown', prevHandlers.handleDragStart);
    handle.removeEventListener('touchstart', prevHandlers.handleDragStart);
    document.removeEventListener('mousemove', prevHandlers.handleDragMove);
    document.removeEventListener('mouseup', prevHandlers.handleDragEnd);
    document.removeEventListener('touchmove', prevHandlers.handleDragMove);
    document.removeEventListener('touchend', prevHandlers.handleDragEnd);
  }

  // Listener para el inicio del drag (solo en el handle)
  handle.addEventListener('mousedown', handleDragStart);
  handle.addEventListener('touchstart', handleDragStart, { passive: false });

  // Listeners globales para el movimiento y fin
  document.addEventListener('mousemove', handleDragMove, { passive: true });
  document.addEventListener('mouseup', handleDragEnd);
  document.addEventListener('touchmove', handleDragMove, { passive: true });
  document.addEventListener('touchend', handleDragEnd);

  handle._bottomSheetDragHandlers = {
    handleDragStart,
    handleDragMove,
    handleDragEnd,
  };
}

// Inicializar cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setupBottomSheetDrag();
    setupSidepanelConfiguracion();
  });
} else {
  setupBottomSheetDrag();
  setupSidepanelConfiguracion();
}

function obtenerPosicionActual() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Geolocalización no disponible en este navegador.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, GEO_OPTIONS);
  });
}

async function Centrar() {
  if (!mapa) {
    console.error('No se encontró el elemento #map.');
    return;
  }

  try {
    const position = await obtenerPosicionActual();
    ubicacion = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
    };
    console.log(`Ubicación: ${ubicacion.lat}, ${ubicacion.lng}`);
    limpiarRecorrido();
    cargarLF(ubicacion, ZOOM_CALLE);
    await dibujarParadasCercanas(ubicacion);
  } catch (error) {
    console.error('Error:', error.message ?? error);
  }
}

async function CentrarYOferécerGuardar() {
  await Centrar();

}

function abrirGuardadoDesdeMarcadorUbicacion() {
  if (!userMarker) return;
  const ll = typeof userMarker.getLatLng === 'function' ? userMarker.getLatLng() : null;
  const lat = Number(ll?.lat ?? ubicacion?.lat);
  const lng = Number(ll?.lng ?? ubicacion?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    alert('No se pudo obtener tu ubicación. Intenta de nuevo.');
    return;
  }

  const nombreLugar = generarNombreUbicacionGuardada();
  abrirBottomSheetGuardarUbicacion(nombreLugar, lat, lng, 'current');
}

function generarNombreUbicacionGuardada() {
  const ahora = new Date();
  const fechaHora = ahora.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `ubicacion guardada, ${fechaHora}`;
}

function abrirBottomSheetGuardarUbicacion(nombreLugar, lat, lng, contexto = 'current') {
  // Abrir bottom-sheet para confirmar guardado
  const iconSaveDark = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBjbGFzcz0ibHVjaWRlIGx1Y2lkZS1zYXZlLWljb24gbHVjaWRlLXNhdmUiPjxwYXRoIGQ9Ik0xNS4yIDNhMiAyIDAgMCAxIDEuNC42bDMuOCAzLjhhMiAyIDAgMCAxIC42IDEuNFYxOWEyIDIgMCAwIDEtMiAySDVhMiAyIDAgMCAxLTItMlY1YTIgMiAwIDAgMSAyLTJ6Ii8+PHBhdGggZD0iTTE3IDIxdi03YTEgMSAwIDAgMC0xLTFIOGExIDEgMCAwIDAtMSAxdjciLz48cGF0aCBkPSJNNyAzdjRhMSAxIDAgMCAwIDEgMWg3Ii8+PC9zdmc+';
  const iconSaveLight = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBjbGFzcz0ibHVjaWRlIGx1Y2lkZS1zYXZlLWljb24gbHVjaWRlLXNhdmUiPjxwYXRoIGQ9Ik0xNS4yIDNhMiAyIDAgMCAxIDEuNC42bDMuOCAzLjhhMiAyIDAgMCAxIC42IDEuNFYxOWEyIDIgMCAwIDEtMiAySDVhMiAyIDAgMCAxLTItMlY1YTIgMiAwIDAgMSAyLTJ6Ii8+PHBhdGggZD0iTTE3IDIxdi03YTEgMSAwIDAgMC0xLTFIOGExIDEgMCAwIDAtMSAxdjciLz48cGF0aCBkPSJNNyAzdjRhMSAxIDAgMCAwIDEgMWg3Ii8+PC9zdmc+';
  const iconPlanDark = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBjbGFzcz0ibHVjaWRlIGx1Y2lkZS1tYXAtcGlubmVkLWljb24gbHVjaWRlLW1hcC1waW5uZWQiPjxwYXRoIGQ9Ik0xOCA4YzAgMy42MTMtMy44NjkgNy40MjktNS4zOTMgOC43OTVhMSAxIDAgMCAxLTEuMjE0IDBDOS44NyAxNS40MjkgNiAxMS42MTMgNiA4YTYgNiAwIDAgMSAxMiAwIi8+PGNpcmNsZSBjeD0iMTIiIGN5PSI4IiByPSIyIi8+PHBhdGggZD0iTTguNzE0IDE0aC0zLjcxYTEgMSAwIDAgMC0uOTQ4LjY4M2wtMi4wMDQgNkExIDEgMCAwIDAgMyAyMmgxOGExIDEgMCAwIDAgLjk0OC0xLjMxNmwtMi02YTEgMSAwIDAgMC0uOTQ5LS42ODRoLTMuNzEyIi8+PC9zdmc+';
  const iconPlanLight = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBjbGFzcz0ibHVjaWRlIGx1Y2lkZS1tYXAtcGlubmVkLWljb24gbHVjaWRlLW1hcC1waW5uZWQiPjxwYXRoIGQ9Ik0xOCA4YzAgMy42MTMtMy44NjkgNy40MjktNS4zOTMgOC43OTVhMSAxIDAgMCAxLTEuMjE0IDBDOS44NyAxNS40MjkgNiAxMS42MTMgNiA4YTYgNiAwIDAgMSAxMiAwIi8+PGNpcmNsZSBjeD0iMTIiIGN5PSI4IiByPSIyIi8+PHBhdGggZD0iTTguNzE0IDE0aC0zLjcxYTEgMSAwIDAgMC0uOTQ4LjY4M2wtMi4wMDQgNkExIDEgMCAwIDAgMyAyMmgxOGExIDEgMCAwIDAgLjk0OC0xLjMxNmwtMi02YTEgMSAwIDAgMC0uOTQ5LS42ODRoLTMuNzEyIi8+PC9zdmc+';
  const mostrarBtnLinea = String(contexto || '').toLowerCase() === 'search';
  const btnLineaHtml = mostrarBtnLinea
    ? `
        <button type="button" class="btn-nearest-line" onclick="verLineaMasCercanaDesdeActualHastaDestino(${lat}, ${lng}, '${String(nombreLugar).replace(/'/g, "\\'")}')">
          <img class="icon light" alt="" src="${iconPlanLight}" />
          <img class="icon dark" alt="" src="${iconPlanDark}" />
          <span>Planear ruta</span>
        </button>
      `
    : '';

  const html = `
    <div class="save-location-sheet">
      <p class="save-location-label">Coordenadas:</p>
      <p class="save-location-coords">
        ${lat.toFixed(6)}, ${lng.toFixed(6)}
      </p>
      <div>
        <button
          type="button"
          class="btn-save-location"
          data-save-lugar="1"
          data-lugar-nombre="${escapeHtml(nombreLugar)}"
          data-lat="${String(lat)}"
          data-lng="${String(lng)}"
        >
          <img class="icon light" alt="" src="${iconSaveLight}" />
          <img class="icon dark" alt="" src="${iconSaveDark}" />
          <span>Guardar</span>
        </button>
        ${btnLineaHtml}
      </div>
    </div>
  `;
  
  abrirBottomSheet('Opciones', html);
}

function guardarUbicacionActualDesdeBottomSheet(nombreLugar, lat, lng) {
  agregarLugarAFavoritos(nombreLugar, lat, lng);
  cerrarBottomSheet();
}

function esFeatureParada(feature) {
  if (!feature || feature.type !== 'Feature') return false;
  if (!feature.geometry || feature.geometry.type !== 'Point') return false;

  const rels = feature.properties?.['@relations'];
  if (Array.isArray(rels) && rels.length > 0) {
    // Aceptar tanto 'stop' como 'platform' (OSM PTv2: ambos son parte de la parada física)
    return rels.some((r) => {
      const role = (r?.role ?? '').toLowerCase();
      return role === 'stop' || role === 'platform';
    });
  }

  const highway = feature.properties?.highway;
  const publicTransport = feature.properties?.public_transport;
  if (highway === 'bus_stop') return true;
  if (publicTransport === 'platform' || publicTransport === 'stop_position') return true;
  return false;
}

function obtenerLineasDesdeRelations(feature) {
  const rels = feature.properties?.['@relations'];
  if (!Array.isArray(rels)) return [];

  const refs = new Set();
  for (const rel of rels) {
    const ref = rel?.reltags?.ref;
    if (typeof ref === 'string' && ref.trim()) refs.add(ref.trim());
  }
  return Array.from(refs);
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function leerJsonLocalStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function guardarJsonLocalStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // noop
  }
}

function leerBoolLocalStorage(key, fallback = false) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    return typeof parsed === 'boolean' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function guardarBoolLocalStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(Boolean(value)));
  } catch {
    // noop
  }
}

function aplicarModoOscuro(enabled) {
  document.documentElement.classList.toggle('dark-mode', Boolean(enabled));
  guardarBoolLocalStorage(STORAGE_DARK_MODE_KEY, Boolean(enabled));
}

function aplicarTransparencia(enabled) {
  // enabled=true => superficies con blur/alpha (sin clase)
  // enabled=false => modo opaco y sin blur (clase .no-transparency)
  document.documentElement.classList.toggle('no-transparency', !Boolean(enabled));
  guardarBoolLocalStorage(STORAGE_TRANSPARENCY_KEY, Boolean(enabled));
}

function abrirSidepanelConfiguracion() {
  const overlay = document.getElementById('settings-overlay');
  const panel = document.getElementById('settings-panel');
  overlay?.classList.add('active');
  panel?.classList.add('active');
  overlay?.setAttribute('aria-hidden', 'false');
  panel?.setAttribute('aria-hidden', 'false');
}

function cerrarSidepanelConfiguracion() {
  const overlay = document.getElementById('settings-overlay');
  const panel = document.getElementById('settings-panel');
  overlay?.classList.remove('active');
  panel?.classList.remove('active');
  overlay?.setAttribute('aria-hidden', 'true');
  panel?.setAttribute('aria-hidden', 'true');
}

function setupSidepanelConfiguracion() {
  const btn = document.getElementById('btn-settings');
  const overlay = document.getElementById('settings-overlay');
  const closeBtn = document.getElementById('settings-close');
  const toggle = document.getElementById('toggle-darkmode');
  const toggleTransparency = document.getElementById('toggle-transparency');

  btn?.addEventListener('click', abrirSidepanelConfiguracion);
  overlay?.addEventListener('click', cerrarSidepanelConfiguracion);
  closeBtn?.addEventListener('click', cerrarSidepanelConfiguracion);

  const enabled = leerBoolLocalStorage(STORAGE_DARK_MODE_KEY, false);
  if (toggle instanceof HTMLInputElement) {
    toggle.checked = enabled;
    toggle.addEventListener('change', () => aplicarModoOscuro(toggle.checked));
  }
  aplicarModoOscuro(enabled);

  const transparencyEnabled = leerBoolLocalStorage(STORAGE_TRANSPARENCY_KEY, true);
  if (toggleTransparency instanceof HTMLInputElement) {
    toggleTransparency.checked = transparencyEnabled;
    toggleTransparency.addEventListener('change', () => aplicarTransparencia(toggleTransparency.checked));
  }
  aplicarTransparencia(transparencyEnabled);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cerrarSidepanelConfiguracion();
  });
}

function obtenerLineasFavs() {
  const arr = leerJsonLocalStorage(STORAGE_LINEAS_FAVS_KEY, []);
  return Array.isArray(arr) ? arr : [];
}

function guardarLineasFavs(arr) {
  guardarJsonLocalStorage(STORAGE_LINEAS_FAVS_KEY, arr);
}

function obtenerParadasFavs() {
  const arr = leerJsonLocalStorage(STORAGE_PARADAS_FAVS_KEY, []);
  return Array.isArray(arr) ? arr : [];
}

function guardarParadasFavs(arr) {
  guardarJsonLocalStorage(STORAGE_PARADAS_FAVS_KEY, arr);
}

function renderLineasFavs() {
  if (!contLineasFavs) return;
  const favs = obtenerLineasFavs();
  contLineasFavs.innerHTML = '';
  if (favs.length === 0) {
    contLineasFavs.innerHTML = '<p class="fav-empty">Sin líneas favoritas</p>';
    return;
  }
  for (const f of favs) {
    const ref = typeof f?.ref === 'string' ? f.ref.trim() : '';
    const name = typeof f?.name === 'string' ? f.name.trim() : '';
    
    const wrapper = document.createElement('div');
    wrapper.className = 'fav-row';
    
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'fav-main';
    item.dataset.lineaKey = ref || name;
    item.dataset.lineaRef = ref;
    item.dataset.lineaName = name;
    item.textContent = ref ? `Línea ${ref}${name ? ` — ${name}` : ''}` : name;
    
    const btnEliminar = document.createElement('button');
    btnEliminar.type = 'button';
    btnEliminar.textContent = '✕';
    btnEliminar.title = 'Eliminar de favoritos';
    btnEliminar.className = 'btn-eliminar-fav';
    btnEliminar.dataset.lineaRef = ref;
    btnEliminar.dataset.lineaName = name;
    
    wrapper.appendChild(item);
    wrapper.appendChild(btnEliminar);
    contLineasFavs.appendChild(wrapper);
  }
}

if (contLineasFavs) {
  // Este listener ya no será el principal, pero lo dejamos como respaldo
}

const bsContent = document.getElementById('bs-content');
if (bsContent) {
  bsContent.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;

    const btnGuardarLugar = target.closest('button[data-save-lugar="1"][data-lugar-nombre][data-lat][data-lng]');
    if (btnGuardarLugar instanceof HTMLButtonElement) {
      ev.stopPropagation();
      const nombre = btnGuardarLugar.dataset.lugarNombre || '';
      const lat = Number(btnGuardarLugar.dataset.lat);
      const lng = Number(btnGuardarLugar.dataset.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      guardarUbicacionActualDesdeBottomSheet(nombre, lat, lng);
      return;
    }

    // Volver a la lista de líneas de la parada (si la línea se abrió desde una parada)
    const btnVolverParada = target.closest('button[data-volver-parada="1"]');
    if (btnVolverParada instanceof HTMLButtonElement) {
      ev.stopPropagation();
      const paradaOrigen = window._lineaDesdeParadaFeature || null;
      if (paradaOrigen) {
        // Descargar/limpiar la línea previa (recorrido + paradas del recorrido)
        limpiarRecorrido();
        asegurarParadasLayer()?.clearLayers();
        mostrarLineasEnContenedorParadas(paradaOrigen);
      }
      return;
    }
    
    // Manejar botones de eliminar de favoritos
    const btnDeleteLugar = target.closest('.btn-eliminar-fav[data-lugar-nombre]');
    if (btnDeleteLugar instanceof HTMLButtonElement) {
      ev.stopPropagation();
      const nombre = btnDeleteLugar.dataset.lugarNombre || '';
      const lat = btnDeleteLugar.dataset.lugarLat ? Number(btnDeleteLugar.dataset.lugarLat) : 0;
      const lng = btnDeleteLugar.dataset.lugarLng ? Number(btnDeleteLugar.dataset.lugarLng) : 0;
      eliminarLugarGuardado(nombre, lat, lng);
      abrirBottomSheetFavoritos(); // Actualizar vista
      return;
    }
    
    const btnDeleteParada = target.closest('button.btn-eliminar-fav[data-parada-id]');
    if (btnDeleteParada instanceof HTMLButtonElement) {
      ev.stopPropagation();
      const id = btnDeleteParada.dataset.paradaId || '';
      if (!id) return;
      const favs = obtenerParadasFavs();
      const nextFavs = favs.filter((f) => f?.id !== id);
      guardarParadasFavs(nextFavs);
      renderParadasFavs();
      abrirBottomSheetFavoritos(); // Actualizar vista
      return;
    }
    
    // Eliminar líneas favoritas
    const btnDeleteLinea = target.closest('[data-linea-ref].btn-eliminar-fav');
    if (btnDeleteLinea instanceof HTMLButtonElement) {
      ev.stopPropagation();
      const ref = btnDeleteLinea.dataset.lineaRef || '';
      const name = btnDeleteLinea.dataset.lineaName || '';
      agregarLineaAFavoritos({ ref, name });
      abrirBottomSheetFavoritos(); // Actualizar vista
      return;
    }

    const btnParadaFav = target.closest('button[data-parada-id][data-lat][data-lng]');
    if (btnParadaFav instanceof HTMLButtonElement && !btnParadaFav.classList.contains('btn-eliminar-fav')) {
      const id = btnParadaFav.dataset.paradaId || '';
      const label = btnParadaFav.textContent || 'Parada';
      const lat = btnParadaFav.dataset.lat ? Number(btnParadaFav.dataset.lat) : null;
      const lng = btnParadaFav.dataset.lng ? Number(btnParadaFav.dataset.lng) : null;
      void centrarEnParadaFavorita({ id, label, lat, lng });
      return;
    }

    const btnLugarGuardado = target.closest('button[data-lugar-nombre][data-lat][data-lng]');
    if (btnLugarGuardado instanceof HTMLButtonElement && !btnLugarGuardado.classList.contains('btn-eliminar-fav')) {
      const nombre = btnLugarGuardado.dataset.lugarNombre || (btnLugarGuardado.textContent || 'Lugar guardado');
      const lat = btnLugarGuardado.dataset.lat ? Number(btnLugarGuardado.dataset.lat) : null;
      const lng = btnLugarGuardado.dataset.lng ? Number(btnLugarGuardado.dataset.lng) : null;
      void centrarEnLugarGuardado({ nombre, lat, lng });
      return;
    }

    const btnParada = target.closest('button[data-parada-id]');
    if (btnParada instanceof HTMLButtonElement && !btnParada.classList.contains('btn-eliminar-fav')) {
      const paradaId = btnParada.dataset.paradaId || '';
      if (!paradaId) return;
      if (Array.isArray(paradasRecorrido)) {
        const found = paradasRecorrido.find((p) => (p.paradaId || obtenerIdParada(p.feature)) === paradaId);
        if (found) {
          leafletMap?.setView([found.lat, found.lng], leafletMap.getZoom());
          mostrarLineasEnContenedorParadas(found.feature);
        }
      }
      return;
    }

    const btn = target.closest('button[data-linea-ref]');
    if (!(btn instanceof HTMLButtonElement) || btn.classList.contains('btn-eliminar-fav')) return;
    const ref = btn.dataset.lineaRef || '';
    const name = btn.dataset.lineaName || '';
    if (!ref && !name) return;

    // Marcar si esta línea se abrió desde una parada (para mostrar botón volver)
    const currentTipo = document.getElementById('bs-fav-btn')?.dataset?.tipo || '';
    window._lineaDesdeParadaFeature = currentTipo === 'parada' ? (window._currentFeature || null) : null;

    void mostrarRecorridoDeLinea(ref, name);
  });
}

async function centrarEnLugarGuardado({ nombre, lat, lng }) {
  const latNum = typeof lat === 'number' ? lat : Number(lat);
  const lngNum = typeof lng === 'number' ? lng : Number(lng);

  if (!leafletMap) {
    if (Number.isFinite(latNum) && Number.isFinite(lngNum)) {
      cargarLF({ lat: latNum, lng: lngNum }, ZOOM_CALLE);
    }
  }
  if (!leafletMap || typeof L === 'undefined') return;

  limpiarRecorrido();

  const layerSel = asegurarSeleccionParadaLayer();
  layerSel?.clearLayers();

  if (Number.isFinite(latNum) && Number.isFinite(lngNum)) {
    const marker = L.marker([latNum, lngNum]).bindPopup(escapeHtml(nombre || 'Lugar guardado')).addTo(layerSel);
    const z = typeof leafletMap.getMaxZoom === 'function' ? leafletMap.getMaxZoom() : ZOOM_CALLE;
    leafletMap.setView([latNum, lngNum], Number.isFinite(z) ? z : ZOOM_CALLE);
    marker.openPopup();
  }

  try {
    const puntos = await cargarParadasPuntos();
    if (!Array.isArray(puntos) || puntos.length === 0) return;

    let paradaCercana = null;
    let distMin = Infinity;
    for (const punto of puntos) {
      const dist = calcularDistancia(latNum, lngNum, punto.lat, punto.lng);
      if (dist < distMin) {
        distMin = dist;
        paradaCercana = punto;
      }
    }

    if (paradaCercana?.feature) {
      mostrarLineasEnContenedorParadas(paradaCercana.feature);
    }
  } catch {
    // noop
  }
}

function renderParadasFavs() {
  const contParadasFavs = document.getElementById('paradas_favs');
  if (!contParadasFavs) return;
  const favs = obtenerParadasFavs();
  contParadasFavs.innerHTML = '';
  if (favs.length === 0) {
    contParadasFavs.innerHTML = '<p class="fav-empty">Sin paradas favoritas</p>';
    return;
  }
  for (const f of favs) {
    const id = typeof f?.id === 'string' ? f.id : '';
    const label = typeof f?.label === 'string' ? f.label : 'Parada';
    const lat = typeof f?.lat === 'number' && Number.isFinite(f.lat) ? f.lat : null;
    const lng = typeof f?.lng === 'number' && Number.isFinite(f.lng) ? f.lng : null;
    
    const wrapper = document.createElement('div');
    wrapper.className = 'fav-row';
    
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'fav-main';
    item.dataset.paradaId = id;
    if (lat !== null) item.dataset.lat = String(lat);
    if (lng !== null) item.dataset.lng = String(lng);
    item.textContent = label;
    
    const btnEliminar = document.createElement('button');
    btnEliminar.type = 'button';
    btnEliminar.textContent = '✕';
    btnEliminar.title = 'Eliminar de favoritos';
    btnEliminar.className = 'btn-eliminar-fav';
    btnEliminar.dataset.paradaId = id;
    if (lat !== null) btnEliminar.dataset.paradaLat = String(lat);
    if (lng !== null) btnEliminar.dataset.paradaLng = String(lng);
    
    wrapper.appendChild(item);
    wrapper.appendChild(btnEliminar);
    contParadasFavs.appendChild(wrapper);
  }
}

async function centrarEnParadaFavorita({ id, label, lat, lng }) {
  const latNum = typeof lat === 'number' ? lat : Number(lat);
  const lngNum = typeof lng === 'number' ? lng : Number(lng);

  if (!leafletMap) {
    if (Number.isFinite(latNum) && Number.isFinite(lngNum)) {
      cargarLF({ lat: latNum, lng: lngNum }, ZOOM_CALLE);
    }
  }
  if (!leafletMap || typeof L === 'undefined') return;

  limpiarRecorrido();

  const layerSel = asegurarSeleccionParadaLayer();
  layerSel?.clearLayers();

  if (Number.isFinite(latNum) && Number.isFinite(lngNum)) {
    const z = typeof leafletMap.getMaxZoom === 'function' ? leafletMap.getMaxZoom() : ZOOM_CALLE;
    leafletMap.setView([latNum, lngNum], Number.isFinite(z) ? z : ZOOM_CALLE);
    const icon = obtenerIconoParadaLeaflet();
    L.marker([latNum, lngNum], icon ? { icon } : undefined).addTo(layerSel);
  }

  try {
    const puntos = await cargarParadasPuntos();
    if (Array.isArray(puntos) && id) {
      const found = puntos.find((p) => obtenerIdParada(p.feature) === id);
      if (found) {
        mostrarLineasEnContenedorParadas(found.feature);
      }
    }
  } catch {
    // noop
  }
}



function obtenerIdParada(feature) {
  const id = feature?.properties?.['@id'];
  if (typeof id === 'string' && id.trim()) return id.trim();
  const coords = feature?.geometry?.coordinates;
  if (Array.isArray(coords) && coords.length >= 2) return `coords:${coords[1]},${coords[0]}`;
  return 'parada_sin_id';
}

function obtenerEtiquetaParada(feature) {
  const props = feature?.properties || {};
  
  // Intenta obtener el nombre de la parada
  const name = props.name;
  if (typeof name === 'string' && name.trim()) return name.trim();
  
  // Si no hay nombre, intenta obtener información de calles cercanas
  const addr_street = props['addr:street'];
  if (typeof addr_street === 'string' && addr_street.trim()) return addr_street.trim();
  
  // Si existe un ref, usalo
  const ref = props.ref;
  if (typeof ref === 'string' && ref.trim()) return ref.trim();
  
  // Intenta obtener información de las relaciones (rutas que pasan por esta parada)
  const relations = props['@relations'];
  if (Array.isArray(relations) && relations.length > 0) {
    // Busca en las relaciones información descriptiva
    for (const rel of relations) {
      const reltags = rel?.reltags || {};
      // Prioriza usar "from" de la ruta
      if (typeof reltags.from === 'string' && reltags.from.trim()) {
        return reltags.from.trim();
      }
    }
    
    // Si no encontro "from", intenta con "to"
    for (const rel of relations) {
      const reltags = rel?.reltags || {};
      if (typeof reltags.to === 'string' && reltags.to.trim()) {
        return reltags.to.trim();
      }
    }
  }
  
  // Ultima opcion: usa el ID de OSM
  const id = props['@id'];
  if (typeof id === 'string' && id.trim()) return id.trim();
  
  return 'Parada';
}

function renderListaParadasRecorrido({ mostrarTodas = false } = {}) {
  if (!Array.isArray(paradasRecorrido) || paradasRecorrido.length === 0) return '';

  const listaParadas = mostrarTodas
    ? paradasRecorrido
    : paradasRecorrido.slice(0, MAX_PARADAS_RECORRIDO);

  const items = listaParadas
    .map((p, idx) => {
      const paradaId = p.paradaId || obtenerIdParada(p.feature);
      const etiqueta = obtenerEtiquetaParada(p.feature);
      return `<li><button type="button" data-parada-id="${escapeHtml(paradaId)}">${escapeHtml(etiqueta)} (${idx + 1})</button></li>`;
    })
    .join('');

  const total = paradasRecorrido.length;
  const subtitulo = mostrarTodas
    ? `<p style="margin: 0 0 8px 0; font-size: 12px; color: #666;">${total} paradas en este recorrido</p>`
    : '';

  return `<h4>Paradas del recorrido</h4>${subtitulo}<ul>${items}</ul>`;
}

// ─── Frequencies / Horarios ───────────────────────────────────────────────────

/** Carga y parsea frequencies.txt (CSV). Retorna array de objetos. */
async function cargarFrequencies() {
  if (_frequenciesData) return _frequenciesData;
  try {
    const resp = await fetch(FREQUENCIES_URL, { cache: 'force-cache' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    const lines = text.trim().split(/\r?\n/);
    const header = lines[0].split(',').map((h) => h.trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.trim());
      if (cols.length < 4) continue;
      const row = {};
      for (let j = 0; j < header.length; j++) row[header[j]] = cols[j] || '';
      rows.push(row);
    }
    _frequenciesData = rows;
    return _frequenciesData;
  } catch (err) {
    console.warn('No se pudo cargar frequencies.txt:', err);
    return [];
  }
}

/**
 * Convierte "HH:MM:SS" a segundos desde medianoche.
 * Soporta horas > 24 (GTFS permite eso).
 */
function horaASegundos(horaStr) {
  if (!horaStr) return NaN;
  const partes = String(horaStr).split(':').map(Number);
  if (partes.length < 3) return NaN;
  return partes[0] * 3600 + partes[1] * 60 + partes[2];
}

/**
 * Formatea segundos desde medianoche a "HH:MM".
 */
function segundosAHora(segs) {
  const h = Math.floor(segs / 3600) % 24;
  const m = Math.floor((segs % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function generarHorariosAproximadosDesdeAhora({ n = MAX_HORARIOS_MOSTRAR, headwaySecs = DEFAULT_HEADWAY_SECS, delaySecs = 0 }) {
  const headway = Number(headwaySecs);
  if (!Number.isFinite(headway) || headway <= 0) return [];

  const ahora = segundosActuales();
  const base = ahora + Math.max(0, Number(delaySecs) || 0);
  const horarios = [];
  for (let i = 0; i < n; i++) {
    horarios.push(segundosAHora(base + i * headway));
  }
  return horarios;
}

/**
 * Retorna segundos desde medianoche para la hora local actual.
 */
function segundosActuales() {
  const now = new Date();
  return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
}

/**
 * Busca en frequencies.txt la entrada para una línea (por ref).
 * El trip_id suele ser "trip_<ref>" pero también puede ser variante.
 */
function buscarFrequencyDeLinea(frequencies, ref) {
  if (!Array.isArray(frequencies) || !ref) return null;
  const refNorm = String(ref).trim().toUpperCase();

  // Búsqueda exacta: trip_<ref> (insensible a mayúsculas)
  let match = frequencies.find((r) => {
    const tid = String(r.trip_id || '').trim().toUpperCase();
    return tid === `TRIP_${refNorm}`;
  });
  if (match) return match;

  // Búsqueda parcial: trip_id contiene el ref
  match = frequencies.find((r) => {
    const tid = String(r.trip_id || '').trim().toUpperCase();
    return tid.includes(refNorm);
  });
  return match || null;
}

/**
 * Calcula los próximos N horarios de llegada aproximados.
 * Basado en headway_secs: los colectivos pasan cada headway_secs segundos.
 * Retorna array de hasta N strings "HH:MM".
 */
function calcularProximosHorarios(frequencyRow, n = MAX_HORARIOS_MOSTRAR) {
  if (!frequencyRow) return [];

  const inicio = horaASegundos(frequencyRow.start_time);
  const fin = horaASegundos(frequencyRow.end_time);
  const headway = Number(frequencyRow.headway_secs);

  if (!Number.isFinite(inicio) || !Number.isFinite(fin) || !Number.isFinite(headway) || headway <= 0) return [];

  const ahora = segundosActuales();

  // Si estamos fuera del rango de servicio
  if (ahora > fin) return [];

  // Calcular el primer colectivo a partir de ahora
  let primero;
  if (ahora < inicio) {
    // El servicio aún no empezó: primer colectivo es el de inicio
    primero = inicio;
  } else {
    // Dentro del rango: próximo múltiplo de headway desde inicio
    const transcurrido = ahora - inicio;
    const cicloActual = Math.floor(transcurrido / headway);
    primero = inicio + (cicloActual + 1) * headway;
  }

  const horarios = [];
  for (let i = 0; i < n; i++) {
    const t = primero + i * headway;
    if (t > fin) break;
    horarios.push(segundosAHora(t));
  }
  return horarios;
}

/**
 * Calcula próximos arribos a una PARADA, ajustando por un offset de viaje
 * (estimado en base a distancia sobre el recorrido de la línea).
 *
 * - start_time/end_time se interpretan como el rango de salida del servicio
 * - headway_secs es el intervalo entre salidas
 * - offsetSecs es el tiempo estimado desde el inicio del recorrido hasta la parada
 */
function calcularProximosArribosEnParada(frequencyRow, offsetSecs = 0, n = MAX_HORARIOS_MOSTRAR) {
  if (!frequencyRow) return [];

  const inicio = horaASegundos(frequencyRow.start_time);
  const fin = horaASegundos(frequencyRow.end_time);
  const headway = Number(frequencyRow.headway_secs);
  const offset = Math.max(0, Number(offsetSecs) || 0);

  if (!Number.isFinite(inicio) || !Number.isFinite(fin) || !Number.isFinite(headway) || headway <= 0) return [];

  const ahora = segundosActuales();
  // Último arribo posible aproximado en esta parada
  const finArribo = fin + offset;
  if (ahora > finArribo) return [];

  // Buscamos el primer k tal que (inicio + k*headway + offset) >= ahora
  const target = ahora - offset;
  let k;
  if (target <= inicio) {
    k = 0;
  } else {
    k = Math.ceil((target - inicio) / headway);
    if (!Number.isFinite(k) || k < 0) k = 0;
  }

  const horarios = [];
  for (let i = 0; i < n; i++) {
    const salida = inicio + (k + i) * headway;
    const arribo = salida + offset;
    if (arribo > finArribo) break;
    horarios.push(segundosAHora(arribo));
  }
  return horarios;
}

function estimarOffsetArriboParadaSegsDesdeRutas(rutas, paradaLat, paradaLng) {
  // Estima cuánto tarda el bus desde el “inicio” del recorrido hasta la parada,
  // usando distancia acumulada sobre la geometría y una velocidad promedio.
  if (!Array.isArray(rutas) || rutas.length === 0) return 0;
  const latP = Number(paradaLat);
  const lngP = Number(paradaLng);
  if (!Number.isFinite(latP) || !Number.isFinite(lngP)) return 0;

  let best = null;
  for (const f of rutas) {
    const latLngs = extraerLatLngsDeGeometria(f?.geometry);
    if (!Array.isArray(latLngs) || latLngs.length < 2) continue;

    const idx = indiceMasCercanoEnCaminoPreciso(latP, lngP, latLngs);
    if (idx < 0) continue;

    const p = latLngs[idx];
    const dToLine = calcularDistancia(latP, lngP, p[0], p[1]);
    // Si la parada queda demasiado lejos del trazado, evitamos offsets basura
    if (!Number.isFinite(dToLine) || dToLine > 350) continue;

    const totalLen = distanciaAcumuladaEnCamino(latLngs, 0, latLngs.length - 1);
    const fromStart = distanciaAcumuladaEnCamino(latLngs, 0, idx);
    // Como no sabemos si start_time corresponde al extremo A o B, tomamos el menor
    // (equivale a asumir que el servicio puede iniciar en cualquiera de los extremos).
    const along = Math.min(fromStart, Math.max(0, totalLen - fromStart));
    const offsetSecs = along / BUS_SPEED_M_S;

    if (!best || dToLine < best.dToLine) {
      best = { offsetSecs, dToLine };
    }
  }

  return best && Number.isFinite(best.offsetSecs) ? Math.max(0, Math.round(best.offsetSecs)) : 0;
}

/**
 * Genera el HTML con los próximos horarios para mostrar en el bottom-sheet.
 */
function renderHorariosLlegada(horarios, lineaRef, lineaNombre, headwaySecs = 0, mostrarVolverParada = false) {
  const titulo = lineaRef ? `Línea ${escapeHtml(lineaRef)}` : 'Línea';
  const detalle = lineaNombre ? ` — ${escapeHtml(lineaNombre)}` : '';
  const headwayMins = headwaySecs > 0 ? Math.round(headwaySecs / 60) : 0;

  const volverHtml = mostrarVolverParada
    ? `
      <button type="button" data-volver-parada="1" style="
        width: 100%;
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid rgba(0,0,0,0.12);
        background: rgba(0,0,0,0.03);
        color: #333;
        font-weight: 600;
        font-size: 13px;
        margin: 0 0 10px 0;
        cursor: pointer;
      ">
        ← Volver a líneas de la parada
      </button>
    `
    : '';

  if (!horarios || horarios.length === 0) {
    const approx = generarHorariosAproximadosDesdeAhora({ n: MAX_HORARIOS_MOSTRAR, headwaySecs: headwaySecs > 0 ? headwaySecs : DEFAULT_HEADWAY_SECS, delaySecs: WAIT_FALLBACK_SECS });
    if (!approx || approx.length === 0) {
      return `
        ${volverHtml}
        <p style="margin-bottom: 8px; font-size: 14px; color: #666;">${titulo}${detalle}</p>
        <p style="font-size: 13px; color: #999; text-align: center; padding: 12px 0;">Sin datos de horarios disponibles.</p>
      `;
    }
    horarios = approx;
  }

  const items = horarios.map((h, i) => {
    const esProximo = i === 0;
    const subtitulo = esProximo
      ? '⏱ Próximo colectivo'
      : headwayMins > 0
        ? `En ~${headwayMins * i} min`
        : '';
    return `
      <li style="
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 12px;
        border-radius: 10px;
        background: ${esProximo ? 'rgba(0,123,255,0.08)' : 'transparent'};
        border: 1px solid ${esProximo ? 'rgba(0,123,255,0.25)' : 'rgba(0,0,0,0.07)'};
        margin-bottom: 8px;
      ">
        <span style="font-size: 22px; font-weight: 700; color: ${esProximo ? '#007BFF' : '#333'}; min-width: 52px;">${escapeHtml(h)}</span>
        <span style="font-size: 12px; color: #888;">${subtitulo}</span>
      </li>
    `;
  }).join('');

  return `
    ${volverHtml}
    <p style="margin: 0 0 12px 0; font-size: 14px; color: #666;">${titulo}${detalle}</p>
    <h4 style="margin: 0 0 10px 0; font-size: 13px; font-weight: 600; color: #555; text-transform: uppercase; letter-spacing: 0.5px;">🚌 Próximas llegadas</h4>
    <ul style="list-style: none; padding: 0; margin: 0;">${items}</ul>
    <p style="margin: 10px 0 0 0; font-size: 11px; color: #aaa; text-align: center;">Horarios aproximados según frecuencia y distancia estimada hasta la parada</p>
  `;
}

function obtenerLineasDetalleDesdeRelations(feature) {
  const rels = feature.properties?.['@relations'];
  if (!Array.isArray(rels)) return [];

  const items = new Map();
  for (const rel of rels) {
    const ref = typeof rel?.reltags?.ref === 'string' ? rel.reltags.ref.trim() : '';
    const name = typeof rel?.reltags?.name === 'string' ? rel.reltags.name.trim() : '';
    const key = ref || name || String(rel?.rel ?? '');
    if (!key) continue;
    if (!items.has(key)) items.set(key, { ref, name });
  }

  const arr = Array.from(items.values());
  arr.sort((a, b) => {
    const aNum = Number.parseInt(a.ref, 10);
    const bNum = Number.parseInt(b.ref, 10);
    const aHasNum = Number.isFinite(aNum) && String(aNum) === a.ref;
    const bHasNum = Number.isFinite(bNum) && String(bNum) === b.ref;
    if (aHasNum && bHasNum) return aNum - bNum;
    return (a.ref || a.name).localeCompare(b.ref || b.name, 'es');
  });
  return arr;
}

function asegurarRecorridoLayer() {
  if (!leafletMap || typeof L === 'undefined') return null;
  if (!recorridoLayer) {
    recorridoLayer = L.layerGroup().addTo(leafletMap);
  }
  return recorridoLayer;
}

function asegurarSeleccionParadaLayer() {
  if (!leafletMap || typeof L === 'undefined') return null;
  if (!seleccionParadaLayer) {
    seleccionParadaLayer = L.layerGroup().addTo(leafletMap);
  }
  return seleccionParadaLayer;
}

function limpiarRecorrido() {
  recorridoActivo = null;
  paradasRecorrido = null;
  paradasRecorridoMarkers = null;
  if (recorridoLayer) recorridoLayer.clearLayers();
}

function volverVistaGeneral() {
  limpiarRecorrido();
  if (seleccionParadaLayer) seleccionParadaLayer.clearLayers();
  void actualizarParadasSegunVista();
}

function obtenerRelIdsDeRutas(rutas) {
  const ids = new Set();
  for (const f of rutas) {
    const raw = f?.properties?.['@id'];
    if (typeof raw === 'string' && raw.startsWith('relation/')) {
      const n = Number.parseInt(raw.slice('relation/'.length), 10);
      if (Number.isFinite(n)) ids.add(n);
    }
  }
  return ids;
}

function featurePerteneceAAlgunaRelacion(feature, relIds) {
  if (!relIds || relIds.size === 0) return false;
  const rels = feature?.properties?.['@relations'];
  if (!Array.isArray(rels)) return false;
  return rels.some((r) => Number.isFinite(r?.rel) && relIds.has(r.rel));
}

async function dibujarParadasDelRecorrido(relIds) {
  if (!leafletMap || typeof L === 'undefined') return;
  const layerParadas = asegurarParadasLayer();
  if (!layerParadas) return;
  layerParadas.clearLayers();

  paradasRecorridoMarkers = new Map();

  const puntos = await cargarParadasPuntos();
  if (!puntos) return;

  const seleccion = [];
  for (const p of puntos) {
    if (featurePerteneceAAlgunaRelacion(p.feature, relIds)) {
      const paradaId = obtenerIdParada(p.feature);
      seleccion.push({ ...p, paradaId });
    }
  }
  paradasRecorrido = seleccion;

  for (const item of seleccion) {
    const icon = obtenerIconoParadaLeaflet();
    const marker = L.marker([item.lat, item.lng], icon ? { icon } : undefined).addTo(layerParadas);
    marker.on('click', () => mostrarLineasEnContenedorParadas(item.feature));
    if (paradasRecorridoMarkers && item.paradaId) {
      paradasRecorridoMarkers.set(item.paradaId, marker);
    }
  }
}

async function dibujarParadasDelRecorridoRecortadas(relIds, latLngsRuta, startIndex, endIndex) {
  if (!leafletMap || typeof L === 'undefined') return;
  const layerParadas = asegurarParadasLayer();
  if (!layerParadas) return;

  const start = Number(startIndex);
  const end = Number(endIndex);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < 0 || start > end) {
    await dibujarParadasDelRecorrido(relIds);
    return;
  }
  if (!Array.isArray(latLngsRuta) || latLngsRuta.length < 2) {
    await dibujarParadasDelRecorrido(relIds);
    return;
  }

  layerParadas.clearLayers();
  paradasRecorridoMarkers = new Map();

  const puntos = await cargarParadasPuntos();
  if (!puntos) return;

  const seleccion = [];
  for (const p of puntos) {
    if (!featurePerteneceAAlgunaRelacion(p.feature, relIds)) continue;
    const idx = indiceMasCercanoEnCamino(p.lat, p.lng, latLngsRuta);
    if (idx < start || idx > end) continue;
    const paradaId = obtenerIdParada(p.feature);
    seleccion.push({ ...p, paradaId });
  }

  paradasRecorrido = seleccion;

  for (const item of seleccion) {
    const icon = obtenerIconoParadaLeaflet();
    const marker = L.marker([item.lat, item.lng], icon ? { icon } : undefined).addTo(layerParadas);
    marker.on('click', () => mostrarLineasEnContenedorParadas(item.feature));
    if (paradasRecorridoMarkers && item.paradaId) {
      paradasRecorridoMarkers.set(item.paradaId, marker);
    }
  }
}

function obtenerRutasDeLinea(geojson, refLinea) {
  if (!geojson || !Array.isArray(geojson.features)) return [];
  const refNorm = String(refLinea ?? '').trim();
  if (!refNorm) return [];

  return geojson.features.filter((f) => {
    const props = f?.properties;
    if (!props) return false;
    if (props.type !== 'route') return false;
    if (props.route !== 'bus') return false;
    const ref = typeof props.ref === 'string' ? props.ref.trim() : '';
    return ref === refNorm;
  });
}

function agregarLineaAFavoritos(linea) {
  const ref = typeof linea?.ref === 'string' ? linea.ref.trim() : '';
  const name = typeof linea?.name === 'string' ? linea.name.trim() : '';
  const key = ref || name;
  if (!key) return;

  const favs = obtenerLineasFavs();
  const indice = favs.findIndex((f) => f?.ref === ref);
  
  if (indice !== -1) {
    favs.splice(indice, 1);
  } else {
    favs.push({ ref, name });
  }
  
  guardarLineasFavs(favs);
  renderLineasFavs();
  actualizarEstadoBotonFavoritos();
}

function agregarParadaAFavoritos(feature) {
  const id = obtenerIdParada(feature);
  const label = obtenerEtiquetaParada(feature);
  if (!id) return;

  const coords = feature?.geometry?.coordinates;
  const lng = Array.isArray(coords) && coords.length >= 2 ? Number(coords[0]) : null;
  const lat = Array.isArray(coords) && coords.length >= 2 ? Number(coords[1]) : null;

  const favs = obtenerParadasFavs();
  const indice = favs.findIndex((f) => f?.id === id);
  
  if (indice !== -1) {
    favs.splice(indice, 1);
  } else {
    favs.push({
      id,
      label,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
    });
    while (favs.length > MAX_PARADAS_FAVS) {
      favs.shift();
    }
  }
  guardarParadasFavs(favs);
  renderParadasFavs();
  actualizarEstadoBotonFavoritos();
}

async function mostrarRecorridoDeLinea(ref, name = '') {
  if (!leafletMap || typeof L === 'undefined') return;

  // Verificar si venimos desde una parada seleccionada
  const paradaOrigen = window._lineaDesdeParadaFeature || null;

  if (seleccionParadaLayer) seleccionParadaLayer.clearLayers();

  const data = await cargarParadasGeojson();
  if (!data) return;

  const rutas = obtenerRutasDeLinea(data, ref);
  if (!rutas.length) {
    abrirBottomSheet('Recorrido', `<p>No se encontró el recorrido para la línea ${escapeHtml(ref)}.</p>`);
    return;
  }

  recorridoActivo = { ref: String(ref), name: String(name || '') };
  const relIds = obtenerRelIdsDeRutas(rutas);

  const layerRec = asegurarRecorridoLayer();
  layerRec?.clearLayers();

  const layerParadas = asegurarParadasLayer();
  layerParadas?.clearLayers();

  for (const f of rutas) {
    L.geoJSON(f).addTo(layerRec);
  }

  await dibujarParadasDelRecorrido(relIds);

  try {
    const bounds = layerRec.getBounds?.();
    if (bounds && bounds.isValid && bounds.isValid()) {
      leafletMap.fitBounds(bounds, { padding: [20, 20] });
    }
  } catch {
    // noop
  }

  window._currentLineaRef = ref;
  window._currentLineaName = name;

  // Si venimos desde una parada, mostrar horarios de llegada
  if (paradaOrigen) {
    const frequencies = await cargarFrequencies();
    const freqRow = buscarFrequencyDeLinea(frequencies, ref);
    const coords = paradaOrigen?.geometry?.coordinates;
    const paradaLng = Array.isArray(coords) && coords.length >= 2 ? Number(coords[0]) : NaN;
    const paradaLat = Array.isArray(coords) && coords.length >= 2 ? Number(coords[1]) : NaN;
    const offsetSegs = estimarOffsetArriboParadaSegsDesdeRutas(rutas, paradaLat, paradaLng);
    let horarios = calcularProximosArribosEnParada(freqRow, offsetSegs);
    let headwaySecs = Number(freqRow?.headway_secs || 0);

    // Si no hay datos de frequency o estamos fuera de servicio, igual mostrar aproximado.
    if (!horarios || horarios.length === 0) {
      const fallbackHeadway = headwaySecs > 0 ? headwaySecs : DEFAULT_HEADWAY_SECS;
      // Incorporar el offset de la parada (tiempo de viaje) en el delay inicial
      horarios = generarHorariosAproximadosDesdeAhora({ n: MAX_HORARIOS_MOSTRAR, headwaySecs: fallbackHeadway, delaySecs: Math.max(0, WAIT_FALLBACK_SECS + offsetSegs) });
      headwaySecs = fallbackHeadway;
    }

    const html = renderHorariosLlegada(horarios, ref, name, headwaySecs, true);
    abrirBottomSheet(`Línea ${escapeHtml(ref)}`, html, 'linea');
  } else {
    // Sin parada de origen: mostrar recorrido con paradas (comportamiento anterior)
    const titulo = ref ? `Línea ${escapeHtml(ref)}` : 'Línea';
    const detalle = name ? ` — ${escapeHtml(name)}` : '';
    const listaParadasHtml = renderListaParadasRecorrido({ mostrarTodas: true });
    const html = `
      <p style="margin-bottom: 8px; font-size: 14px; color: #666;">${titulo}${detalle}</p>
      ${listaParadasHtml}
    `;
    abrirBottomSheet('Recorrido', html, 'linea');
  }
}

function mostrarLineasEnContenedorParadas(feature) {
  const lineas = obtenerLineasDetalleDesdeRelations(feature);
  if (!lineas.length) {
    abrirBottomSheet('Parada', '<p>No hay líneas disponibles para esta parada.</p>');
    return;
  }

  const itemsHtml = lineas
    .map((l) => {
      const etiqueta = l.ref ? `Línea ${escapeHtml(l.ref)}` : escapeHtml(l.name || 'Línea');
      const detalle = l.name ? ` — ${escapeHtml(l.name)}` : '';
      const refAttr = escapeHtml(l.ref || '');
      const nameAttr = escapeHtml(l.name || '');
      return `<li><button type="button" data-linea-ref="${refAttr}" data-linea-name="${nameAttr}">${etiqueta}${detalle}</button></li>`;
    })
    .join('');

  const listaParadasHtml = recorridoActivo ? renderListaParadasRecorrido() : '';
  
  const html = `
    <h4 style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600; color: #333;">Líneas disponibles</h4>
    <ul>${itemsHtml}</ul>
    ${listaParadasHtml}
  `;
  window._currentFeature = feature;
  abrirBottomSheet('Parada seleccionada', html, 'parada');
}



function asegurarParadasLayer() {
  if (!leafletMap || typeof L === 'undefined') return null;
  if (!paradasLayer) {
    paradasLayer = L.layerGroup().addTo(leafletMap);
  }
  return paradasLayer;
}

async function cargarParadasGeojson() {
  if (paradasGeojson) return paradasGeojson;

  try {
    const resp = await fetch(PARADAS_GEOJSON_URL, { cache: 'force-cache' });
    if (!resp.ok) {
      throw new Error(`No se pudo cargar ${PARADAS_GEOJSON_URL} (HTTP ${resp.status}).`);
    }
    const data = await resp.json();
    if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
      throw new Error('El GeoJSON no tiene el formato esperado (FeatureCollection).');
    }
    paradasGeojson = data;
    return paradasGeojson;
  } catch (error) {
    console.error('Error cargando paradas:', error.message ?? error);
    return null;
  }
}

async function cargarParadasPuntos() {
  if (paradasPuntos) return paradasPuntos;
  const data = await cargarParadasGeojson();
  if (!data) return null;

  // Separar stops y platforms para poder fusionar pares cercanos
  const stops = [];
  const platforms = [];

  for (const feature of data.features) {
    if (!esFeatureParada(feature)) continue;
    const coords = feature.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;

    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const rels = feature.properties?.['@relations'];
    const roles = Array.isArray(rels) ? new Set(rels.map((r) => (r?.role ?? '').toLowerCase())) : new Set();
    const isPlatform = roles.has('platform') && !roles.has('stop');

    if (isPlatform) {
      platforms.push({ feature, lat, lng });
    } else {
      stops.push({ feature, lat, lng });
    }
  }

  // Deduplicar: fusionar stop con su platform gemelo cercano (<15m)
  // El platform absorbe las líneas del stop (suma de @relations de ambos)
  // y el stop se descarta para evitar duplicados en el mapa.
  const UMBRAL_FUSION_M = 15;
  const stopUsado = new Set(); // índices de stops absorbidos

  // Índice espacial sencillo para stops: bucket por lat/lng redondeado a 4 decimales (~11m)
  const stopBucket = new Map();
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    const key = `${Math.round(s.lat * 1000)},${Math.round(s.lng * 1000)}`;
    if (!stopBucket.has(key)) stopBucket.set(key, []);
    stopBucket.get(key).push(i);
  }

  const puntosFinales = [];

  for (const plat of platforms) {
    // Buscar stop cercano en buckets adyacentes
    let stopGemelo = null;
    outer: for (let dlat = -1; dlat <= 1; dlat++) {
      for (let dlng = -1; dlng <= 1; dlng++) {
        const key = `${Math.round(plat.lat * 1000) + dlat},${Math.round(plat.lng * 1000) + dlng}`;
        const candidatos = stopBucket.get(key) || [];
        for (const idx of candidatos) {
          if (stopUsado.has(idx)) continue;
          const s = stops[idx];
          const dist = calcularDistancia(plat.lat, plat.lng, s.lat, s.lng);
          if (dist <= UMBRAL_FUSION_M) {
            stopGemelo = { idx, stop: s };
            break outer;
          }
        }
      }
    }

    if (stopGemelo) {
      // Fusionar: combinar @relations de platform + stop en el feature del platform
      stopUsado.add(stopGemelo.idx);
      const relsPlat = plat.feature.properties?.['@relations'] ?? [];
      const relsStop = stopGemelo.stop.feature.properties?.['@relations'] ?? [];
      // Unión por rel id para no duplicar
      const relIds = new Set(relsPlat.map((r) => r?.rel));
      const relsExtra = relsStop.filter((r) => r?.rel && !relIds.has(r.rel));
      if (relsExtra.length > 0) {
        // Clonar feature y añadir relations faltantes
        const featClone = JSON.parse(JSON.stringify(plat.feature));
        featClone.properties['@relations'] = [...relsPlat, ...relsExtra];
        puntosFinales.push({ feature: featClone, lat: plat.lat, lng: plat.lng });
      } else {
        puntosFinales.push(plat);
      }
    } else {
      // Platform sin stop gemelo: agregar directamente
      puntosFinales.push(plat);
    }
  }

  // Stops que no fueron absorbidos por ningún platform
  for (let i = 0; i < stops.length; i++) {
    if (!stopUsado.has(i)) {
      puntosFinales.push(stops[i]);
    }
  }

  paradasPuntos = puntosFinales;
  return paradasPuntos;
}

function zoomEsSuficiente() {
  if (!leafletMap) return false;
  const z = leafletMap.getZoom();
  return z >= ZOOM_PARADAS_EN_VISTA;
}

function agendarActualizacionParadas() {
  if (!leafletMap) return;
  if (actualizarParadasTimer) window.clearTimeout(actualizarParadasTimer);
  actualizarParadasTimer = window.setTimeout(() => {
    actualizarParadasTimer = null;
    void actualizarParadasSegunVista();
  }, EVENTO_PARADAS_DEBOUNCE_MS);
}

async function actualizarParadasSegunVista() {
  if (!leafletMap) return;

  if (recorridoActivo) return;

  if (zoomEsSuficiente()) {
    await dibujarParadasEnVista();
  } else if (ubicacion) {
    await dibujarParadasCercanas(ubicacion);
  } else {
    const layer = asegurarParadasLayer();
    layer?.clearLayers();
  }
}

async function dibujarParadasEnVista() {
  if (!leafletMap || typeof L === 'undefined') return;
  if (recorridoActivo) return;
  const layer = asegurarParadasLayer();
  if (!layer) return;
  layer.clearLayers();

  const puntos = await cargarParadasPuntos();
  if (!puntos) return;

  const bounds = leafletMap.getBounds();
  const enVista = [];
  for (const p of puntos) {
    if (bounds.contains([p.lat, p.lng])) {
      enVista.push(p);
      if (enVista.length >= MAX_PARADAS_MOSTRAR_EN_VISTA) break;
    }
  }

  for (const item of enVista) {
    const icon = obtenerIconoParadaLeaflet();
    const marker = L.marker([item.lat, item.lng], icon ? { icon } : undefined).addTo(layer);
    marker.on('click', () => mostrarLineasEnContenedorParadas(item.feature));
  }
}

async function dibujarParadasCercanas(userCoords) {
  if (!leafletMap || typeof L === 'undefined') return;
  if (recorridoActivo) return;
  if (!userCoords || typeof userCoords.lat !== 'number' || typeof userCoords.lng !== 'number') return;

  const layer = asegurarParadasLayer();
  if (!layer) return;
  layer.clearLayers();

  const puntos = await cargarParadasPuntos();
  if (!puntos) return;

  const userLatLng = L.latLng(userCoords.lat, userCoords.lng);

  const cercanas = [];
  for (const p of puntos) {
    const d = leafletMap.distance(userLatLng, L.latLng(p.lat, p.lng));
    if (d <= RADIO_PARADAS_METROS) {
      cercanas.push({ feature: p.feature, lat: p.lat, lng: p.lng, d });
    }
  }

  cercanas.sort((a, b) => a.d - b.d);
  const seleccion = cercanas.slice(0, MAX_PARADAS_MOSTRAR);

  for (const item of seleccion) {
    const icon = obtenerIconoParadaLeaflet();
    const marker = L.marker([item.lat, item.lng], icon ? { icon } : undefined).addTo(layer);
    marker.on('click', () => mostrarLineasEnContenedorParadas(item.feature));
  }
}


function cargarLF(coords, zoomObjetivo = null){
    if (typeof L === 'undefined') {
        console.error('Leaflet no está cargado. Verifica que leaflet.js esté incluido.');
        return;
    }

  if (!coords || typeof coords.lat !== 'number' || typeof coords.lng !== 'number') {
    console.error('No hay coordenadas válidas para inicializar el mapa.');
    return;
  }

  // Inicializa una vez y luego actualiza en cada lectura
  if (!leafletMap) {
    leafletMap = L.map('map', {
      zoomControl: false,
      scrollWheelZoom: true,
      maxZoom: 19,
    }).setView([coords.lat, coords.lng], typeof zoomObjetivo === 'number' ? zoomObjetivo : ZOOM_CALLE);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(leafletMap);

    {
      const icon = obtenerIconoUserWaypointLeaflet();
      userMarker = L.marker([coords.lat, coords.lng], icon ? { icon } : undefined).addTo(leafletMap);
    }
    try {
      userMarker.off('click');
      userMarker.on('click', () => {
        abrirGuardadoDesdeMarcadorUbicacion();
      });
    } catch {
      // noop
    }

    leafletMap.on('moveend', agendarActualizacionParadas);
    leafletMap.on('zoomend', agendarActualizacionParadas);

    setupLongPressGuardarUbicacionEnMapa();
  }

  if (userMarker) {
    userMarker.setLatLng([coords.lat, coords.lng]);
  }

  if (typeof zoomObjetivo === 'number') {
    leafletMap.setView([coords.lat, coords.lng], zoomObjetivo);
  } else {
    leafletMap.setView([coords.lat, coords.lng], leafletMap.getZoom());
  }
}

function setupLongPressGuardarUbicacionEnMapa() {
  if (_longPressMapSetupDone) return;
  if (!leafletMap || typeof L === 'undefined') return;

  _longPressMapSetupDone = true;

  let timerId = null;
  let startLatLng = null;
  let fired = false;
  let lastOpenMs = 0;

  const abrirGuardadoEn = (latlng) => {
    if (!latlng || !Number.isFinite(latlng.lat) || !Number.isFinite(latlng.lng)) return;

    const nowMs = Date.now();
    // Evita dobles aperturas cuando coincide timer propio + contextmenu móvil.
    if (nowMs - lastOpenMs < 650) return;
    lastOpenMs = nowMs;

    try {
      const layerSel = asegurarSeleccionParadaLayer();
      if (layerSel) {
        layerSel.clearLayers();
        L.circleMarker(latlng, { radius: 7, weight: 2, color: '#007BFF', fillColor: '#ffffff', fillOpacity: 1 }).addTo(layerSel);
      }
    } catch {
      // noop
    }

    const nombre = makeNombre();
    abrirBottomSheetGuardarUbicacion(nombre, latlng.lat, latlng.lng, 'longpress');
  };

  const clear = () => {
    if (timerId != null) {
      clearTimeout(timerId);
      timerId = null;
    }
    startLatLng = null;
    fired = false;
  };

  const makeNombre = () => {
    return generarNombreUbicacionGuardada();
  };

  const start = (e) => {
    // Ignorar si el usuario está interactuando con controles del mapa (o si ya está arrastrando)
    if (!leafletMap) return;
    fired = false;

    const latlng = e?.latlng;
    if (!latlng || !Number.isFinite(latlng.lat) || !Number.isFinite(latlng.lng)) return;

    startLatLng = L.latLng(latlng.lat, latlng.lng);
    if (timerId != null) clearTimeout(timerId);

    timerId = setTimeout(() => {
      if (!leafletMap || !startLatLng) return;
      // Si el mapa se está arrastrando, no dispares
      if (leafletMap.dragging && leafletMap.dragging.enabled && leafletMap.dragging.enabled() && leafletMap.dragging._draggable?._moving) {
        return;
      }
      fired = true;
      abrirGuardadoEn(startLatLng);
    }, MAP_LONG_PRESS_MS);
  };

  const move = (e) => {
    if (!startLatLng || timerId == null || fired) return;
    const latlng = e?.latlng;
    if (!latlng || !Number.isFinite(latlng.lat) || !Number.isFinite(latlng.lng)) return;
    const current = L.latLng(latlng.lat, latlng.lng);
    const d = leafletMap.distance(startLatLng, current);
    if (Number.isFinite(d) && d > MAP_LONG_PRESS_MOVE_TOL_M) {
      clear();
    }
  };

  const end = () => {
    // Si ya disparó, dejamos que el usuario siga (no cerramos nada)
    if (timerId != null) {
      clearTimeout(timerId);
      timerId = null;
    }
    startLatLng = null;
  };

  leafletMap.on('mousedown', start);
  leafletMap.on('touchstart', start);
  leafletMap.on('mousemove', move);
  leafletMap.on('touchmove', move);
  leafletMap.on('mouseup', end);
  leafletMap.on('touchend', end);
  leafletMap.on('dragstart', clear);
  leafletMap.on('zoomstart', clear);

  // Fallback táctil nativo de Leaflet (en móvil long-press dispara contextmenu).
  leafletMap.on('contextmenu', (e) => {
    clear();
    const latlng = e?.latlng;
    if (!latlng) return;
    abrirGuardadoEn(L.latLng(latlng.lat, latlng.lng));
  });
}
function MostrarFavs(){
  abrirBottomSheetFavoritos();
}
function cargarFavos(){
  renderParadasFavs();
  renderLineasFavs();
  renderLugaresFavs();
}

// FUNCIONES DE BÚSQUEDA DE LUGARES
const STORAGE_LUGARES_FAVS_KEY = 'transitsj_lugares_favs_v1';
const MAX_LUGARES_FAVS = 5;

function obtenerLugaresFavs() {
  return leerJsonLocalStorage(STORAGE_LUGARES_FAVS_KEY, []);
}

function guardarLugaresFavs(arr) {
  guardarJsonLocalStorage(STORAGE_LUGARES_FAVS_KEY, arr);
}

function esMismoLugarGuardado(a, b) {
  if (!a || !b) return false;
  const latA = Number(a.lat);
  const lngA = Number(a.lng);
  const latB = Number(b.lat);
  const lngB = Number(b.lng);
  if (!Number.isFinite(latA) || !Number.isFinite(lngA) || !Number.isFinite(latB) || !Number.isFinite(lngB)) return false;
  const EPS = 0.000001;
  return Math.abs(latA - latB) <= EPS && Math.abs(lngA - lngB) <= EPS;
}

function eliminarLugarGuardado(nombre, lat, lng) {
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return;

  const favs = obtenerLugaresFavs();
  const nextFavs = favs.filter((f) => !esMismoLugarGuardado(f, { nombre, lat: latNum, lng: lngNum }));
  guardarLugaresFavs(nextFavs);
  renderLugaresFavs();
}

function abrirModalBusqueda() {
  const modal = document.getElementById('search-modal');
  if (modal) {
    modal.classList.add('active');
    posicionarModalBusqueda();
    document.getElementById('search-input')?.focus();
  }
}

function cerrarModalBusqueda() {
  const modal = document.getElementById('search-modal');
  if (modal) {
    modal.classList.remove('active');
  }
  document.getElementById('search-input').value = '';
  document.getElementById('search-results').innerHTML = '<p class="search-results-hint">Escribe para buscar</p>';

  if (searchTimeout) {
    clearTimeout(searchTimeout);
    searchTimeout = null;
  }
  if (searchAbortController) {
    try { searchAbortController.abort(); } catch { /* noop */ }
    searchAbortController = null;
  }
  lastSearchIssuedQuery = '';
}

let searchTimeout;
let searchAbortController = null;
let searchSeq = 0;
let lastSearchIssuedQuery = '';
let _lineasBusquedaCache = null;

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MIN_CHARS = 2;
const SAN_JUAN_BOUNDS = {
  minLat: -31.6,
  maxLat: -31.2,
  minLng: -68.7,
  maxLng: -68.3,
};

const SEARCH_LINEAS_MAX_RESULTS = 8;
const SEARCH_CALLES_MAX_RESULTS = 8;
const SEARCH_NOMINATIM_RAW_LIMIT = 24;

function normalizarTextoBusqueda(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function tokenizarBusqueda(texto) {
  return normalizarTextoBusqueda(texto)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function scoreTextoContraQuery(texto, queryNorm, tokens) {
  const txt = normalizarTextoBusqueda(texto);
  if (!txt) return 0;

  let score = 0;
  if (txt === queryNorm) score += 420;
  if (txt.startsWith(queryNorm)) score += 260;
  if (txt.includes(queryNorm)) score += 170;

  if (Array.isArray(tokens) && tokens.length > 0) {
    const words = txt.split(/\s+/).filter(Boolean);
    let matched = 0;
    for (const tk of tokens) {
      if (words.some((w) => w.startsWith(tk))) {
        score += 34;
        matched++;
      } else if (txt.includes(tk)) {
        score += 16;
        matched++;
      }
    }
    if (matched === tokens.length) score += 110;
    else score += matched * 5;
  }

  return score;
}

function obtenerCategoriaNominatim(item) {
  const clazz = normalizarTextoBusqueda(item?.class);
  const type = normalizarTextoBusqueda(item?.type);
  if (clazz === 'highway') return 'Calle';
  if (['road', 'residential', 'service', 'living_street', 'tertiary', 'secondary', 'primary', 'unclassified', 'pedestrian'].includes(type)) {
    return 'Calle';
  }
  if (clazz === 'amenity' || clazz === 'building' || clazz === 'office') return 'Lugar';
  if (clazz === 'boundary' || clazz === 'place') return 'Zona';
  return 'Lugar';
}

function claveUnicaResultadoNominatim(item) {
  const osm = `${String(item?.osm_type || '')}:${String(item?.osm_id || '')}`;
  if (osm !== ':') return osm;
  const lat = Number(item?.lat);
  const lng = Number(item?.lon);
  return `${lat.toFixed(6)},${lng.toFixed(6)}`;
}

function deduplicarResultadosNominatim(arr) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const key = claveUnicaResultadoNominatim(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function fetchNominatimSanJuan(query, signal, bounded = true) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', `${query}, San Juan, Argentina`);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', String(SEARCH_NOMINATIM_RAW_LIMIT));
  url.searchParams.set('countrycodes', 'ar');
  url.searchParams.set('dedupe', '1');
  url.searchParams.set('addressdetails', '0');
  if (bounded) {
    url.searchParams.set('viewbox', `${SAN_JUAN_BOUNDS.minLng},${SAN_JUAN_BOUNDS.maxLat},${SAN_JUAN_BOUNDS.maxLng},${SAN_JUAN_BOUNDS.minLat}`);
    url.searchParams.set('bounded', '1');
  }

  const response = await fetch(url.toString(), {
    signal,
    headers: {
      'Accept-Language': 'es',
    },
  });
  if (!response.ok) throw new Error('Error en búsqueda');
  const raw = await response.json();
  return Array.isArray(raw) ? raw : [];
}

function pareceBusquedaLinea(query) {
  const q = normalizarTextoBusqueda(query);
  if (!q) return false;
  if (/\b(linea|lineas|l)\b/.test(q)) return true;
  return /^\d{1,4}[a-z]?$/.test(q);
}

function extraerRefLineaDesdeQuery(query) {
  const q = normalizarTextoBusqueda(query);
  if (!q) return '';

  const m = q.match(/(?:^|\s)(?:linea|lineas|l)\s*([0-9]{1,4}[a-z]?)(?:\s|$)/);
  if (m && m[1]) return m[1].trim();

  if (/^[0-9]{1,4}[a-z]?$/.test(q)) return q;
  return '';
}

function obtenerCentroAproximadoDeGeometria(geometry) {
  const latLngs = extraerLatLngsDeGeometria(geometry);
  if (!Array.isArray(latLngs) || latLngs.length === 0) return null;
  const mid = latLngs[Math.floor(latLngs.length / 2)];
  if (!Array.isArray(mid) || mid.length < 2) return null;
  const lat = Number(mid[0]);
  const lng = Number(mid[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

async function obtenerLineasParaBusqueda() {
  if (_lineasBusquedaCache) return _lineasBusquedaCache;

  const data = await cargarParadasGeojson();
  if (!data || !Array.isArray(data.features)) {
    _lineasBusquedaCache = [];
    return _lineasBusquedaCache;
  }

  const porRef = new Map();
  for (const f of data.features) {
    const props = f?.properties;
    if (!props) continue;
    if (props.type !== 'route' || props.route !== 'bus') continue;

    const ref = typeof props.ref === 'string' ? props.ref.trim() : '';
    if (!ref) continue;
    const name = typeof props.name === 'string' ? props.name.trim() : '';

    if (!porRef.has(ref)) {
      porRef.set(ref, { ref, name, centro: obtenerCentroAproximadoDeGeometria(f.geometry) });
    } else if (!porRef.get(ref).name && name) {
      porRef.get(ref).name = name;
    }
  }

  const arr = Array.from(porRef.values());
  arr.sort((a, b) => {
    const aNum = Number.parseInt(a.ref, 10);
    const bNum = Number.parseInt(b.ref, 10);
    const aEsNum = Number.isFinite(aNum) && String(aNum) === a.ref;
    const bEsNum = Number.isFinite(bNum) && String(bNum) === b.ref;
    if (aEsNum && bEsNum) return aNum - bNum;
    return a.ref.localeCompare(b.ref, 'es');
  });

  _lineasBusquedaCache = arr;
  return _lineasBusquedaCache;
}

async function buscarLineasLocales(query) {
  const queryNorm = normalizarTextoBusqueda(query);
  if (!queryNorm) return [];

  const refQuery = extraerRefLineaDesdeQuery(queryNorm);
  const lineas = await obtenerLineasParaBusqueda();
  if (!Array.isArray(lineas) || lineas.length === 0) return [];

  const candidatos = [];
  for (const linea of lineas) {
    const refNorm = normalizarTextoBusqueda(linea.ref);
    const nameNorm = normalizarTextoBusqueda(linea.name);
    const labelNorm = normalizarTextoBusqueda(`linea ${linea.ref} ${linea.name || ''}`);

    let score = 0;
    if (refQuery && refNorm === refQuery) score += 400;
    if (refNorm === queryNorm) score += 300;
    if (refNorm.startsWith(queryNorm)) score += 200;
    if (nameNorm && nameNorm.includes(queryNorm)) score += 120;
    if (labelNorm.includes(queryNorm)) score += 90;

    if (score > 0) {
      candidatos.push({ ...linea, score });
    }
  }

  candidatos.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.ref).localeCompare(String(b.ref), 'es');
  });

  return candidatos.slice(0, SEARCH_LINEAS_MAX_RESULTS);
}

function esResultadoCalleNominatim(item) {
  const clazz = normalizarTextoBusqueda(item?.class);
  const type = normalizarTextoBusqueda(item?.type);

  if (clazz === 'highway') return true;
  if (['road', 'residential', 'service', 'living_street', 'tertiary', 'secondary', 'primary', 'unclassified', 'pedestrian'].includes(type)) {
    return true;
  }
  return false;
}

async function buscarCallesEnSanJuan(query, signal) {
  const queryNorm = normalizarTextoBusqueda(query);
  const tokens = tokenizarBusqueda(queryNorm);

  const baseBounded = await fetchNominatimSanJuan(queryNorm, signal, true);
  const baseUnbounded = baseBounded.length < 5
    ? await fetchNominatimSanJuan(queryNorm, signal, false)
    : [];

  const lugares = deduplicarResultadosNominatim([...baseBounded, ...baseUnbounded]);

  const enBounds = lugares.filter((lugar) => {
    const lat = Number(lugar?.lat);
    const lng = Number(lugar?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    return (
      lat >= SAN_JUAN_BOUNDS.minLat &&
      lat <= SAN_JUAN_BOUNDS.maxLat &&
      lng >= SAN_JUAN_BOUNDS.minLng &&
      lng <= SAN_JUAN_BOUNDS.maxLng
    );
  });

  const scoreados = enBounds
    .map((lugar) => {
      const name = String(lugar?.name || '');
      const display = String(lugar?.display_name || '');
      const categoria = obtenerCategoriaNominatim(lugar);

      let score = 0;
      score += scoreTextoContraQuery(name, queryNorm, tokens) * 1.2;
      score += scoreTextoContraQuery(display, queryNorm, tokens);
      if (categoria === 'Calle') score += 18;

      return { lugar, score, categoria };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, SEARCH_CALLES_MAX_RESULTS);

  return scoreados.map(({ lugar, categoria }) => {
    const lat = Number(lugar.lat);
    const lng = Number(lugar.lon);
    const nombre = String(lugar.name || lugar.display_name || 'Lugar');
    const tipo = String(lugar.type || lugar.class || 'Calle');
    return {
      tipoResultado: 'calle',
      lat,
      lng,
      nombre,
      detalle: tipo,
      categoria,
    };
  }).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
}

function renderResultadosBusqueda(resultados) {
  const resultsDiv = document.getElementById('search-results');
  if (!resultsDiv) return;

  resultsDiv.innerHTML = '';

  for (const item of resultados) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'search-result-item';

    if (item.tipoResultado === 'linea') {
      btn.dataset.resultType = 'linea';
      btn.dataset.lineaRef = String(item.ref || '');
      btn.dataset.lineaName = String(item.name || '');
      if (item.centro && Number.isFinite(item.centro.lat) && Number.isFinite(item.centro.lng)) {
        btn.dataset.lat = String(item.centro.lat);
        btn.dataset.lng = String(item.centro.lng);
      }

      const title = document.createElement('div');
      title.className = 'search-result-item-title';
      title.textContent = `Línea ${item.ref}`;

      const info = document.createElement('div');
      info.className = 'search-result-item-info';
      info.textContent = item.name ? `${item.name} · Mostrar recorrido` : 'Mostrar recorrido completo';

      btn.appendChild(title);
      btn.appendChild(info);
      resultsDiv.appendChild(btn);
      continue;
    }

    btn.dataset.resultType = 'calle';
    btn.dataset.lat = String(item.lat);
    btn.dataset.lng = String(item.lng);
    btn.dataset.nombre = String(item.nombre || 'Calle');

    const title = document.createElement('div');
    title.className = 'search-result-item-title';
    title.textContent = String(item.nombre || 'Calle');

    const info = document.createElement('div');
    info.className = 'search-result-item-info';
    const categoria = String(item.categoria || 'Calle');
    info.textContent = `${categoria} · ${String(item.detalle || 'San Juan')}`;

    btn.appendChild(title);
    btn.appendChild(info);
    resultsDiv.appendChild(btn);
  }
}

async function buscarLugaresEnTiempoReal() {
  const input = document.getElementById('search-input');
  const query = input?.value?.trim() || '';
  const modal = document.getElementById('search-modal');
  const resultsDiv = document.getElementById('search-results');
  
  // Limpiar timeout anterior
  if (searchTimeout) clearTimeout(searchTimeout);
  
  // Si está vacío, cerrar modal y cancelar búsquedas
  if (!query) {
    modal?.classList.remove('active');
    resultsDiv.innerHTML = '<p class="search-results-hint">Escribe para buscar</p>';
    if (searchAbortController) {
      try { searchAbortController.abort(); } catch { /* noop */ }
      searchAbortController = null;
    }
    lastSearchIssuedQuery = '';
    return;
  }
  
  // Abrir modal
  if (!modal.classList.contains('active')) {
    modal.classList.add('active');
  }
  posicionarModalBusqueda();
  
  // Evitar pedir demasiadas veces: exigir un mínimo de letras
  if (query.length < SEARCH_MIN_CHARS) {
    resultsDiv.innerHTML = `<p class="search-results-hint">Escribe al menos ${SEARCH_MIN_CHARS} letras</p>`;
    if (searchAbortController) {
      try { searchAbortController.abort(); } catch { /* noop */ }
      searchAbortController = null;
    }
    lastSearchIssuedQuery = '';
    return;
  }

  // Mostrar estado de búsqueda
  resultsDiv.innerHTML = '<p class="search-results-loading">Buscando calles y líneas...</p>';
  
  // Hacer búsqueda con debounce
  searchTimeout = setTimeout(() => buscarLugares(query), SEARCH_DEBOUNCE_MS);
}

async function buscarLugares(queryOverride = '') {
  const input = document.getElementById('search-input');
  const query = (queryOverride || input?.value?.trim() || '').trim();
  if (!query || query.length < SEARCH_MIN_CHARS) return;
  const queryNorm = normalizarTextoBusqueda(query);

  const resultsDiv = document.getElementById('search-results');
  if (!resultsDiv) return;

  // Evitar repetir la misma consulta
  if (queryNorm === lastSearchIssuedQuery) return;
  lastSearchIssuedQuery = queryNorm;

  // Cancelar request anterior
  if (searchAbortController) {
    try { searchAbortController.abort(); } catch { /* noop */ }
  }
  searchAbortController = new AbortController();
  const mySeq = ++searchSeq;

  try {
    const [lineas, calles] = await Promise.all([
      buscarLineasLocales(query),
      buscarCallesEnSanJuan(query, searchAbortController.signal),
    ]);

    if (mySeq !== searchSeq) return; // llegó tarde

    const primeroLineas = pareceBusquedaLinea(query);
    const resultados = primeroLineas
      ? [
          ...lineas.map((l) => ({ ...l, tipoResultado: 'linea' })),
          ...calles,
        ]
      : [
          ...calles,
          ...lineas.map((l) => ({ ...l, tipoResultado: 'linea' })),
        ];

    if (resultados.length === 0) {
      resultsDiv.innerHTML = '<p class="search-results-hint">No se encontraron calles ni líneas en San Juan</p>';
      return;
    }

    renderResultadosBusqueda(resultados);

  } catch (error) {
    // Abort es normal cuando el usuario sigue tipeando
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') return;
    console.error('Error en búsqueda:', error);
    resultsDiv.innerHTML = '<p class="search-results-error">Error al buscar. Intenta de nuevo.</p>';
  }
}

// Click en resultados de búsqueda (delegación)
const searchResultsEl = document.getElementById('search-results');
if (searchResultsEl) {
  searchResultsEl.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    const btn = target.closest('button.search-result-item');
    if (!(btn instanceof HTMLButtonElement)) return;

    const resultType = btn.dataset.resultType || 'calle';
    if (resultType === 'linea') {
      const ref = String(btn.dataset.lineaRef || '').trim();
      const name = String(btn.dataset.lineaName || '').trim();
      if (!ref) return;

      cerrarModalBusqueda();

      const lat = Number(btn.dataset.lat);
      const lng = Number(btn.dataset.lng);
      if (!leafletMap && Number.isFinite(lat) && Number.isFinite(lng)) {
        cargarLF({ lat, lng }, ZOOM_PARADAS_EN_VISTA);
      }

      void mostrarRecorridoDeLinea(ref, name);
      return;
    }

    const lat = Number(btn.dataset.lat);
    const lng = Number(btn.dataset.lng);
    const nombre = btn.dataset.nombre || btn.textContent || 'Calle';
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    centrarEnLugar(lat, lng, nombre);
  });
}

function centrarEnLugar(lat, lng, nombreLugar) {
  if (!leafletMap) {
    if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
      cargarLF({ lat: Number(lat), lng: Number(lng) }, ZOOM_CALLE);
    }
  }
  if (!leafletMap) return;
  
  cerrarModalBusqueda();
  centrarEnCoordenadas(lat, lng, ZOOM_CALLE);
  
  // Abrir bottom-sheet para ofrecer guardar la ubicación
  abrirBottomSheetGuardarUbicacion(nombreLugar, lat, lng, 'search');
}

function posicionarModalBusqueda() {
  const modal = document.getElementById('search-modal');
  const content = modal?.querySelector('.search-modal-content');
  const bar = document.querySelector('.search-bar-container');
  if (!modal || !content || !bar) return;

  const rect = bar.getBoundingClientRect();
  const viewportMargin = 8;
  const top = Math.max(viewportMargin, rect.bottom + 8);
  const width = Math.max(220, Math.min(rect.width, window.innerWidth - viewportMargin * 2));
  const left = Math.min(
    Math.max(viewportMargin, rect.left),
    Math.max(viewportMargin, window.innerWidth - viewportMargin - width)
  );
  const maxHeight = Math.max(220, Math.floor(window.innerHeight - top - 24));

  content.style.position = 'fixed';
  content.style.top = `${top}px`;
  content.style.left = `${left}px`;
  content.style.width = `${width}px`;
  content.style.maxWidth = `${width}px`;
  content.style.maxHeight = `${maxHeight}px`;
  content.style.margin = '0';
  content.style.transform = 'none';
}

window.addEventListener('resize', posicionarModalBusqueda);

function centrarEnCoordenadas(lat, lng, zoom = ZOOM_CALLE) {
  if (!leafletMap) return;
  const safeLat = Number(lat);
  const safeLng = Number(lng);
  if (!Number.isFinite(safeLat) || !Number.isFinite(safeLng)) return;

  // Si había un recorrido dibujado, lo limpiamos antes de mover la vista.
  limpiarRecorrido();
  leafletMap.setView([safeLat, safeLng], zoom);
}

function calcularDistancia(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function extraerLatLngsDeGeometria(geom) {
  if (!geom) return [];
  const type = geom.type;
  const coords = geom.coordinates;
  if (!Array.isArray(coords)) return [];

  const out = [];
  const pushCoord = (c) => {
    if (!Array.isArray(c) || c.length < 2) return;
    const lng = Number(c[0]);
    const lat = Number(c[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    out.push([lat, lng]);
  };

  if (type === 'LineString') {
    for (const c of coords) pushCoord(c);
  } else if (type === 'MultiLineString') {
    for (const line of coords) {
      if (!Array.isArray(line)) continue;
      for (const c of line) pushCoord(c);
    }
  }
  return out;
}

function distanciaMinimaPuntoACamino(lat, lng, latLngs) {
  if (!Array.isArray(latLngs) || latLngs.length === 0) return Infinity;

  // Muestreo para performance: límite ~250 puntos por geometría
  const maxSamples = 250;
  const step = Math.max(1, Math.ceil(latLngs.length / maxSamples));

  let min = Infinity;
  for (let i = 0; i < latLngs.length; i += step) {
    const p = latLngs[i];
    const d = calcularDistancia(lat, lng, p[0], p[1]);
    if (d < min) min = d;
  }
  return min;
}

function indiceMasCercanoEnCamino(lat, lng, latLngs) {
  if (!Array.isArray(latLngs) || latLngs.length === 0) return -1;

  const maxSamples = 500;
  const step = Math.max(1, Math.ceil(latLngs.length / maxSamples));

  let min = Infinity;
  let bestIndex = -1;
  for (let i = 0; i < latLngs.length; i += step) {
    const p = latLngs[i];
    const d = calcularDistancia(lat, lng, p[0], p[1]);
    if (d < min) {
      min = d;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function indiceMasCercanoEnCaminoPreciso(lat, lng, latLngs) {
  if (!Array.isArray(latLngs) || latLngs.length === 0) return -1;

  // 1) pasada gruesa (similar a indiceMasCercanoEnCamino)
  const maxSamples = 600;
  const step = Math.max(1, Math.ceil(latLngs.length / maxSamples));
  let min = Infinity;
  let approxIndex = -1;
  for (let i = 0; i < latLngs.length; i += step) {
    const p = latLngs[i];
    const d = calcularDistancia(lat, lng, p[0], p[1]);
    if (d < min) {
      min = d;
      approxIndex = i;
    }
  }
  if (approxIndex < 0) return -1;

  // 2) refinamiento local: busca alrededor del índice aproximado
  const window = Math.max(20, step * 4);
  const start = Math.max(0, approxIndex - window);
  const end = Math.min(latLngs.length - 1, approxIndex + window);
  let bestIndex = approxIndex;
  let bestDist = min;
  for (let i = start; i <= end; i++) {
    const p = latLngs[i];
    const d = calcularDistancia(lat, lng, p[0], p[1]);
    if (d < bestDist) {
      bestDist = d;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function distanciaAcumuladaEnCamino(latLngs, startIndex, endIndex) {
  if (!Array.isArray(latLngs) || latLngs.length < 2) return 0;
  const s = Number(startIndex);
  const e = Number(endIndex);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 0;
  if (s === e) return 0;

  const from = Math.min(s, e);
  const to = Math.max(s, e);
  let total = 0;
  for (let i = from; i < to; i++) {
    const a = latLngs[i];
    const b = latLngs[i + 1];
    if (!a || !b) continue;
    total += calcularDistancia(a[0], a[1], b[0], b[1]);
  }
  return total;
}

function estimarEsperaSegundos(frequencyRow) {
  // Mejor que headway/2: usa el próximo arribo estimado.
  if (!frequencyRow) return WAIT_FALLBACK_SECS;

  const inicio = horaASegundos(frequencyRow.start_time);
  const fin = horaASegundos(frequencyRow.end_time);
  const headway = Number(frequencyRow.headway_secs);
  if (!Number.isFinite(inicio) || !Number.isFinite(fin) || !Number.isFinite(headway) || headway <= 0) {
    return WAIT_FALLBACK_SECS;
  }

  const ahora = segundosActuales();
  if (ahora > fin) return WAIT_FALLBACK_SECS;

  let proximo;
  if (ahora < inicio) {
    proximo = inicio;
  } else {
    const transcurrido = ahora - inicio;
    const cicloActual = Math.floor(transcurrido / headway);
    proximo = inicio + (cicloActual + 1) * headway;
  }
  const espera = Math.max(0, proximo - ahora);
  // Si la espera queda absurda por datos raros, cae a headway/2.
  if (!Number.isFinite(espera) || espera < 0 || espera > 4 * 3600) {
    return Math.max(0, Math.round(headway / 2));
  }
  return espera;
}

function estimarTiempoTotalSegundos({ dO, dD, rideDist, waitSecs }) {
  const walkSecs = (Number(dO) + Number(dD)) / WALKING_SPEED_M_S;
  const rideSecs = Number(rideDist) / BUS_SPEED_M_S;
  const wait = Number(waitSecs);
  const total = walkSecs + rideSecs + (Number.isFinite(wait) ? wait : WAIT_FALLBACK_SECS);
  return Number.isFinite(total) ? total : Infinity;
}

async function verLineaMasCercanaDesdeActualHastaDestino(latDestino, lngDestino, nombreDestino = '', allowedRefs = null) {
  if (!leafletMap || typeof L === 'undefined') return;

  const latD = Number(latDestino);
  const lngD = Number(lngDestino);
  if (!Number.isFinite(latD) || !Number.isFinite(lngD)) return;

  // Asegurar ubicación actual
  if (!ubicacion || !Number.isFinite(ubicacion.lat) || !Number.isFinite(ubicacion.lng)) {
    try {
      const position = await obtenerPosicionActual();
      ubicacion = { lat: position.coords.latitude, lng: position.coords.longitude };
    } catch {
      alert('No se pudo obtener tu ubicación actual.');
      return;
    }
  }

  const latO = Number(ubicacion.lat);
  const lngO = Number(ubicacion.lng);
  if (!Number.isFinite(latO) || !Number.isFinite(lngO)) return;

  const data = await cargarParadasGeojson();
  if (!data || !Array.isArray(data.features)) return;

  // Cargar frequencies una sola vez para puntuar por tiempo (espera estimada)
  const frequencies = await cargarFrequencies();

  const allowedSet = Array.isArray(allowedRefs) && allowedRefs.length
    ? new Set(allowedRefs.map((r) => String(r)))
    : null;

  // Buscar la ruta (línea) con menor TIEMPO estimado (caminar + espera + viaje)
  let mejor = null;
  let mejorFeature = null;
  for (const f of data.features) {
    const props = f?.properties;
    if (!props) continue;
    if (props.type !== 'route') continue;
    if (props.route !== 'bus') continue;
    const ref = typeof props.ref === 'string' ? props.ref.trim() : '';
    if (!ref) continue;
    if (allowedSet && !allowedSet.has(ref)) continue;

    const latLngs = extraerLatLngsDeGeometria(f.geometry);
    if (latLngs.length === 0) continue;

    const dO = distanciaMinimaPuntoACamino(latO, lngO, latLngs);
    const dD = distanciaMinimaPuntoACamino(latD, lngD, latLngs);

    const iO = indiceMasCercanoEnCaminoPreciso(latO, lngO, latLngs);
    const iD = indiceMasCercanoEnCaminoPreciso(latD, lngD, latLngs);
    const rideDist = (iO >= 0 && iD >= 0) ? distanciaAcumuladaEnCamino(latLngs, iO, iD) : Infinity;

    const freqRow = buscarFrequencyDeLinea(frequencies, ref);
    const waitSecs = estimarEsperaSegundos(freqRow);
    const scoreSecs = estimarTiempoTotalSegundos({ dO, dD, rideDist, waitSecs });

    if (!mejor || scoreSecs < mejor.scoreSecs) {
      const name = typeof props.name === 'string' ? props.name.trim() : '';
      mejor = { ref, name, scoreSecs, dO, dD, iO, iD, rideDist, waitSecs };
      mejorFeature = f;
    }
  }

  if (!mejor) {
    alert('No se encontró una línea cercana.');
    return;
  }

  const colorLinea = (typeof colorPorLinea === 'object' && colorPorLinea)
    ? (colorPorLinea[mejor.ref] || '#007BFF')
    : '#007BFF';

  // Dibujar solo el tramo (ida) del recorrido entre origen y destino.
  // Importante: NO renderizar la ruta completa ni paradas adicionales.
  limpiarRecorrido();
  recorridoActivo = { ref: mejor.ref, name: mejor.name, planned: true };

  const layerRec = asegurarRecorridoLayer();
  layerRec?.clearLayers();

  // Evitar que se vean paradas (las capas de paradas se usan también para cercanas/en vista)
  const layerParadas = asegurarParadasLayer();
  layerParadas?.clearLayers();

  const origen = L.latLng(latO, lngO);
  const destino = L.latLng(latD, lngD);

  const latLngs = extraerLatLngsDeGeometria(mejorFeature?.geometry);
  const iO = Number.isFinite(mejor?.iO) ? mejor.iO : indiceMasCercanoEnCaminoPreciso(latO, lngO, latLngs);
  const iDMin = indiceMasCercanoEnCaminoPreciso(latD, lngD, latLngs);
  let startIndex = null;
  let endIndex = null;

  if (iO >= 0 && iDMin >= 0 && latLngs.length >= 2) {
    // Recorte “bien cortado”: termina en el punto más cercano al destino.
    // Si además se alcanza el umbral de cercanía, intentamos cortar en el primer punto que entra al umbral
    // y luego no sigue acercándose (evita que el trazado pase de largo).
    const forward = iO <= iDMin;
    const step = forward ? 1 : -1;
    let end = iDMin;

    // Buscar un punto de corte “suficientemente cerca” del destino
    let bestSeen = Infinity;
    let cutCandidate = null;
    for (let i = iO; forward ? i <= iDMin : i >= iDMin; i += step) {
      const p = latLngs[i];
      if (!p) continue;
      const d = calcularDistancia(latD, lngD, p[0], p[1]);
      if (d < bestSeen) bestSeen = d;
      // Si entramos al umbral, marcamos un candidato y seguimos un poco
      if (d <= DESTINO_UMBRAL_CORTE_M) {
        cutCandidate = i;
        // Si ya estamos prácticamente en el mínimo local, podemos cortar acá
        if (bestSeen <= DESTINO_UMBRAL_CORTE_M * 0.6) break;
      }
    }
    if (cutCandidate != null) end = cutCandidate;

    startIndex = Math.min(iO, end);
    endIndex = Math.max(iO, end);
    const tramo = latLngs.slice(startIndex, endIndex + 1);
    const tramoDir = forward ? tramo : tramo.slice().reverse();
    if (tramoDir.length >= 2) {
      L.polyline(tramoDir, { color: colorLinea, weight: 4, opacity: 0.95 }).addTo(layerRec);
    }
  }

  // Dibujar paradas de la línea seleccionada (por relación)
  try {
    const relIds = obtenerRelIdsDeRutas([mejorFeature]);
    if (relIds && relIds.size > 0) {
      if (startIndex != null && endIndex != null) {
        await dibujarParadasDelRecorridoRecortadas(relIds, latLngs, startIndex, endIndex);
      } else {
        await dibujarParadasDelRecorrido(relIds);
      }
    }
  } catch {
    // noop
  }

  // Marcadores origen/destino y conexión directa (opcional) en una capa separada.
  const layerSel = asegurarSeleccionParadaLayer();
  if (layerSel) {
    layerSel.clearLayers();
    L.circleMarker(origen, { radius: 6, weight: 2, color: colorLinea, fillColor: '#ffffff', fillOpacity: 1 }).addTo(layerSel);
    L.circleMarker(destino, { radius: 6, weight: 2, color: colorLinea, fillColor: '#ffffff', fillOpacity: 1 }).addTo(layerSel);
  }

  try {
    const bounds = L.latLngBounds([origen, destino]);
    const recBounds = layerRec?.getBounds?.();
    if (recBounds && recBounds.isValid && recBounds.isValid()) bounds.extend(recBounds);
    leafletMap.fitBounds(bounds, { padding: [20, 20] });
  } catch {
    // noop
  }

  if (nombreDestino) {
    // Mantener el nombre en memoria si luego se quiere reusar
    window._ultimoDestinoBusqueda = { nombre: String(nombreDestino), lat: latD, lng: lngD };
  }
}

async function verLineaMasCercanaHastaParadaSeleccionada(featureParada) {
  if (!featureParada || !featureParada.geometry || !Array.isArray(featureParada.geometry.coordinates)) {
    alert('No se pudo obtener la ubicación de la parada.');
    return;
  }

  const coords = featureParada.geometry.coordinates;
  const lng = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    alert('No se pudo obtener la ubicación de la parada.');
    return;
  }

  let allowedRefs = null;
  try {
    const lineas = obtenerLineasDetalleDesdeRelations(featureParada);
    if (Array.isArray(lineas) && lineas.length) {
      allowedRefs = lineas
        .map((l) => (l && l.ref != null ? String(l.ref).trim() : ''))
        .filter(Boolean);
    }
  } catch {
    // noop
  }

  const nombre = typeof obtenerEtiquetaParada === 'function'
    ? obtenerEtiquetaParada(featureParada)
    : ((featureParada.properties && (featureParada.properties.name || featureParada.properties.ref)) || 'la parada');

  return verLineaMasCercanaDesdeActualHastaDestino(lat, lng, nombre, allowedRefs);
}

async function irAParadaDelLugar(lat, lng, nombreLugar, paradaLat, paradaLng) {
  cerrarModalBusqueda();
  
  if (!leafletMap) return;
  
  leafletMap.setView([paradaLat, paradaLng], ZOOM_CALLE);
  
  const puntos = await cargarParadasPuntos();
  let feature = null;
  let closest = { dist: Infinity };
  
  for (const punto of puntos) {
    const dist = calcularDistancia(paradaLat, paradaLng, punto.lat, punto.lng);
    if (dist < closest.dist) {
      closest.dist = dist;
      feature = punto.feature;
    }
  }
  
  if (feature) {
    mostrarLineasEnContenedorParadas(feature);
  }
}

function agregarLugarAFavoritos(nombre, lat, lng) {
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return;

  const favs = obtenerLugaresFavs();
  const indice = favs.findIndex((f) => esMismoLugarGuardado(f, { nombre, lat: latNum, lng: lngNum }));
  
  if (indice !== -1) {
    favs.splice(indice, 1);
  } else {
    // Guardar coordenadas como números (evita strings en LocalStorage)
    favs.push({ nombre, lat: latNum, lng: lngNum });
    
    while (favs.length > MAX_LUGARES_FAVS) {
      favs.shift();
    }
  }
  
  guardarLugaresFavs(favs);
  renderLugaresFavs();
}

function renderLugaresFavs() {
  const favs = obtenerLugaresFavs();
  const container = document.getElementById('lugares_favs');
  
  if (!container) {
    const div = document.createElement('div');
    div.id = 'lugares_favs';
    document.getElementById('favoritos')?.appendChild(div);
  }
  
  const contLugares = document.getElementById('lugares_favs') || document.createElement('div');
  contLugares.innerHTML = '';
  
  if (favs.length === 0) {
    contLugares.innerHTML = '<p class="fav-empty">Sin lugares guardados</p>';
    return;
  }
  
  for (const lugar of favs) {
    const lat = Number(lugar?.lat);
    const lng = Number(lugar?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const wrapper = document.createElement('div');
    wrapper.className = 'fav-row';
    
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fav-main';
    btn.dataset.lugarNombre = String(lugar?.nombre || 'Lugar guardado');
    btn.dataset.lat = String(lat);
    btn.dataset.lng = String(lng);
    btn.textContent = lugar.nombre;
    
    const btnEliminar = document.createElement('button');
    btnEliminar.type = 'button';
    btnEliminar.textContent = '✕';
    btnEliminar.title = 'Eliminar lugar guardado';
    btnEliminar.className = 'btn-eliminar-fav';
    btnEliminar.dataset.lugarNombre = lugar.nombre;
    btnEliminar.dataset.lugarLat = String(lat);
    btnEliminar.dataset.lugarLng = String(lng);
    
    wrapper.appendChild(btn);
    wrapper.appendChild(btnEliminar);
    contLugares.appendChild(wrapper);
  }
}

window.onload = async () => {
  try {
    await Centrar();
    cargarFavos();
  } catch (error) {
    console.error('Error al obtener la ubicación inicial:', error.message ?? error);
  }
};