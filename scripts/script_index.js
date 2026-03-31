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

const PARADAS_GEOJSON_URL = encodeURI('Datos/DATOS SAN JUAN.geojson');
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
const STORAGE_DARK_MODE_KEY = 'transitsj_dark_mode_v1';

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

function abrirBottomSheet(titulo, contenidoHtml, tipo = '') {
  const bs = document.getElementById('bottom-sheet');
  const bsTitle = document.getElementById('bs-title');
  const bsContent = document.getElementById('bs-content');
  const overlay = document.getElementById('bottom-sheet-overlay');
  const favBtn = document.getElementById('bs-fav-btn');
  
  bsTitle.textContent = titulo;
  bsContent.innerHTML = contenidoHtml;
  
  // Limpiar estilos transform previos
  bs.style.transform = '';
  bs.style.transition = '';
  
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
    }
  }
}

function cerrarBottomSheet() {
  const bs = document.getElementById('bottom-sheet');
  const overlay = document.getElementById('bottom-sheet-overlay');
  
  // Limpiar estilos y clases
  if (bs) {
    bs.classList.remove('active');
    bs.classList.remove('dragging');
    bs.style.transform = '';
    bs.style.transition = '';
  }
  
  overlay?.classList.remove('active');
  
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

  const handleDragStart = (e) => {
    isDragging = true;
    startY = e.type.includes('mouse') ? e.clientY : e.touches?.[0]?.clientY || 0;
    currentY = 0;
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
    if (currentY > 0) {
      bottomSheet.style.transform = `translateY(${currentY}px)`;
    }
  };

  const handleDragEnd = () => {
    if (!isDragging) return;
    isDragging = false;
    bottomSheet.classList.remove('dragging');
    document.body.style.userSelect = '';
    if (content) {
      content.style.pointerEvents = '';
    }
    
    // Cerrar si se arrastró más de 40px hacia abajo
    if (currentY > 40) {
      bottomSheet.style.transform = '';
      bottomSheet.style.transition = '';
      cerrarBottomSheet();
    } else {
      // Volver a la posición normal con animación suave
      bottomSheet.style.transition = 'transform 0.2s ease';
      bottomSheet.style.transform = '';
      // Restaurar transición después de la animación
      setTimeout(() => {
        bottomSheet.classList.remove('dragging');
      }, 200);
    }
    
    currentY = 0;
  };

  // Remover listeners previos para evitar duplicados
  handle.removeEventListener('mousedown', handleDragStart);
  handle.removeEventListener('touchstart', handleDragStart);
  document.removeEventListener('mousemove', handleDragMove);
  document.removeEventListener('mouseup', handleDragEnd);
  document.removeEventListener('touchmove', handleDragMove);
  document.removeEventListener('touchend', handleDragEnd);

  // Listener para el inicio del drag (solo en el handle)
  handle.addEventListener('mousedown', handleDragStart);
  handle.addEventListener('touchstart', handleDragStart, { passive: true });

  // Listeners globales para el movimiento y fin
  document.addEventListener('mousemove', handleDragMove, { passive: true });
  document.addEventListener('mouseup', handleDragEnd);
  document.addEventListener('touchmove', handleDragMove, { passive: true });
  document.addEventListener('touchend', handleDragEnd);
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

  const ahora = new Date();
  const opciones = { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' };
  const fechaHora = ahora.toLocaleDateString('es-AR', opciones).replace(/\//g, '/');
  const nombreLugar = `Mi ubicación - ${fechaHora}`;
  abrirBottomSheetGuardarUbicacion(nombreLugar, lat, lng);
}

function abrirBottomSheetGuardarUbicacion(nombreLugar, lat, lng) {
  // Abrir bottom-sheet para confirmar guardado
  const iconSaveDark = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBjbGFzcz0ibHVjaWRlIGx1Y2lkZS1zYXZlLWljb24gbHVjaWRlLXNhdmUiPjxwYXRoIGQ9Ik0xNS4yIDNhMiAyIDAgMCAxIDEuNC42bDMuOCAzLjhhMiAyIDAgMCAxIC42IDEuNFYxOWEyIDIgMCAwIDEtMiAySDVhMiAyIDAgMCAxLTItMlY1YTIgMiAwIDAgMSAyLTJ6Ii8+PHBhdGggZD0iTTE3IDIxdi03YTEgMSAwIDAgMC0xLTFIOGExIDEgMCAwIDAtMSAxdjciLz48cGF0aCBkPSJNNyAzdjRhMSAxIDAgMCAwIDEgMWg3Ii8+PC9zdmc+';
  const iconSaveLight = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBjbGFzcz0ibHVjaWRlIGx1Y2lkZS1zYXZlLWljb24gbHVjaWRlLXNhdmUiPjxwYXRoIGQ9Ik0xNS4yIDNhMiAyIDAgMCAxIDEuNC42bDMuOCAzLjhhMiAyIDAgMCAxIC42IDEuNFYxOWEyIDIgMCAwIDEtMiAySDVhMiAyIDAgMCAxLTItMlY1YTIgMiAwIDAgMSAyLTJ6Ii8+PHBhdGggZD0iTTE3IDIxdi03YTEgMSAwIDAgMC0xLTFIOGExIDEgMCAwIDAtMSAxdjciLz48cGF0aCBkPSJNNyAzdjRhMSAxIDAgMCAwIDEgMWg3Ii8+PC9zdmc+';

  const html = `
    <div class="save-location-sheet">
      <p class="save-location-label">Coordenadas:</p>
      <p class="save-location-coords">
        ${lat.toFixed(6)}, ${lng.toFixed(6)}
      </p>
      <div>
        <button type="button" class="btn-save-location" onclick="guardarUbicacionActualDesdeBottomSheet('${nombreLugar.replace(/'/g, "\\'")}', ${lat}, ${lng})">
          <img class="icon light" alt="" src="${iconSaveLight}" />
          <img class="icon dark" alt="" src="${iconSaveDark}" />
          <span>Guardar</span>
        </button>
      </div>
    </div>
  `;
  
  abrirBottomSheet('¿Guardar ubicación?', html);
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
    return rels.some((r) => (r?.role ?? '').toLowerCase() === 'stop');
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

  btn?.addEventListener('click', abrirSidepanelConfiguracion);
  overlay?.addEventListener('click', cerrarSidepanelConfiguracion);
  closeBtn?.addEventListener('click', cerrarSidepanelConfiguracion);

  const enabled = leerBoolLocalStorage(STORAGE_DARK_MODE_KEY, false);
  if (toggle instanceof HTMLInputElement) {
    toggle.checked = enabled;
    toggle.addEventListener('change', () => aplicarModoOscuro(toggle.checked));
  }
  aplicarModoOscuro(enabled);

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
    
    // Manejar botones de eliminar de favoritos
    const btnDeleteLugar = target.closest('.btn-eliminar-fav[data-lugar-nombre]');
    if (btnDeleteLugar instanceof HTMLButtonElement) {
      ev.stopPropagation();
      const nombre = btnDeleteLugar.dataset.lugarNombre || '';
      const lat = btnDeleteLugar.dataset.lugarLat ? Number(btnDeleteLugar.dataset.lugarLat) : 0;
      const lng = btnDeleteLugar.dataset.lugarLng ? Number(btnDeleteLugar.dataset.lugarLng) : 0;
      agregarLugarAFavoritos(nombre, lat, lng);
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
    L.marker([latNum, lngNum]).addTo(layerSel);
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

function renderListaParadasRecorrido() {
  if (!Array.isArray(paradasRecorrido) || paradasRecorrido.length === 0) return '';

  const items = paradasRecorrido
    .slice(0, MAX_PARADAS_RECORRIDO)
    .map((p, idx) => {
      const paradaId = p.paradaId || obtenerIdParada(p.feature);
      const etiqueta = obtenerEtiquetaParada(p.feature);
      return `<li><button type="button" data-parada-id="${escapeHtml(paradaId)}">${escapeHtml(etiqueta)} (${idx + 1})</button></li>`;
    })
    .join('');

  return `<h4>Paradas del recorrido</h4><ul>${items}</ul>`;
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
    const marker = L.marker([item.lat, item.lng]).addTo(layerParadas);
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

  const titulo = ref ? `Línea ${escapeHtml(ref)}` : 'Línea';
  const detalle = name ? ` — ${escapeHtml(name)}` : '';
  const listaParadasHtml = renderListaParadasRecorrido();
  const html = `
    <p style="margin-bottom: 8px; font-size: 14px; color: #666;">${titulo}${detalle}</p>
    ${listaParadasHtml}
  `;
  window._currentLineaRef = ref;
  window._currentLineaName = name;
  abrirBottomSheet('Recorrido', html, 'linea');
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

  const puntos = [];
  for (const feature of data.features) {
    if (!esFeatureParada(feature)) continue;
    const coords = feature.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;

    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    puntos.push({ feature, lat, lng });
  }

  paradasPuntos = puntos;
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
    const marker = L.marker([item.lat, item.lng]).addTo(layer);
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
    const marker = L.marker([item.lat, item.lng]).addTo(layer);
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

    userMarker = L.marker([coords.lat, coords.lng]).addTo(leafletMap);
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

function abrirModalBusqueda() {
  const modal = document.getElementById('search-modal');
  if (modal) {
    modal.classList.add('active');
    document.getElementById('search-input')?.focus();
  }
}

function cerrarModalBusqueda() {
  const modal = document.getElementById('search-modal');
  if (modal) {
    modal.classList.remove('active');
  }
  document.getElementById('search-input').value = '';
  document.getElementById('search-results').innerHTML = '<p style="color: #999; text-align: center; padding: 20px;">Escribe para buscar</p>';

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

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MIN_CHARS = 2;
const SAN_JUAN_BOUNDS = {
  minLat: -31.6,
  maxLat: -31.2,
  minLng: -68.7,
  maxLng: -68.3,
};

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
    resultsDiv.innerHTML = '<p style="color: #999; text-align: center; padding: 20px;">Escribe para buscar</p>';
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
  
  // Evitar pedir demasiadas veces: exigir un mínimo de letras
  if (query.length < SEARCH_MIN_CHARS) {
    resultsDiv.innerHTML = `<p style="color: #999; text-align: center; padding: 20px;">Escribe al menos ${SEARCH_MIN_CHARS} letras</p>`;
    if (searchAbortController) {
      try { searchAbortController.abort(); } catch { /* noop */ }
      searchAbortController = null;
    }
    lastSearchIssuedQuery = '';
    return;
  }

  // Mostrar estado de búsqueda
  resultsDiv.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">Buscando...</p>';
  
  // Hacer búsqueda con debounce
  searchTimeout = setTimeout(() => buscarLugares(query), SEARCH_DEBOUNCE_MS);
}

async function buscarLugares(queryOverride = '') {
  const input = document.getElementById('search-input');
  const query = (queryOverride || input?.value?.trim() || '').trim();
  if (!query || query.length < SEARCH_MIN_CHARS) return;

  const resultsDiv = document.getElementById('search-results');
  if (!resultsDiv) return;

  // Evitar repetir la misma consulta
  if (query === lastSearchIssuedQuery) return;
  lastSearchIssuedQuery = query;

  // Cancelar request anterior
  if (searchAbortController) {
    try { searchAbortController.abort(); } catch { /* noop */ }
  }
  searchAbortController = new AbortController();
  const mySeq = ++searchSeq;

  try {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '10');
    url.searchParams.set('countrycodes', 'ar');
    url.searchParams.set('dedupe', '1');
    url.searchParams.set('addressdetails', '0');
    // Restringir la búsqueda a San Juan por viewbox (mejora mucho el autocompletado)
    url.searchParams.set(
      'viewbox',
      `${SAN_JUAN_BOUNDS.minLng},${SAN_JUAN_BOUNDS.maxLat},${SAN_JUAN_BOUNDS.maxLng},${SAN_JUAN_BOUNDS.minLat}`
    );
    url.searchParams.set('bounded', '1');

    const response = await fetch(url.toString(), {
      signal: searchAbortController.signal,
      headers: {
        'Accept-Language': 'es',
      },
    });

    if (!response.ok) throw new Error('Error en búsqueda');
    const lugaresRaw = await response.json();
    if (mySeq !== searchSeq) return; // llegó tarde

    let lugares = Array.isArray(lugaresRaw) ? lugaresRaw : [];
    // Filtro de seguridad por bounds (por si Nominatim devuelve algo fuera del viewbox)
    lugares = lugares.filter((lugar) => {
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

    if (lugares.length === 0) {
      resultsDiv.innerHTML = '<p style="color: #999; text-align: center; padding: 20px;">No se encontraron resultados en San Juan</p>';
      return;
    }

    // Render seguro (sin onclick inline)
    resultsDiv.innerHTML = '';
    for (const lugar of lugares) {
      const lat = Number(lugar.lat);
      const lng = Number(lugar.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const nombreLugar = String(lugar.name || lugar.display_name || 'Lugar');
      const tipoLugar = String(lugar.type || lugar.class || 'Lugar');

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'search-result-item';
      btn.dataset.lat = String(lat);
      btn.dataset.lng = String(lng);
      btn.dataset.nombre = nombreLugar;
      btn.style.cssText = 'width: 100%; text-align: left; padding: 12px 14px; border: none; background: transparent; cursor: pointer; border-bottom: 1px solid rgba(0,0,0,0.06);';

      const title = document.createElement('div');
      title.className = 'search-result-item-title';
      title.textContent = nombreLugar;
      title.style.cssText = 'font-weight: 600; font-size: 14px; color: #222;';

      const info = document.createElement('div');
      info.className = 'search-result-item-info';
      info.textContent = tipoLugar;
      info.style.cssText = 'font-size: 12px; color: #666; margin-top: 4px;';

      btn.appendChild(title);
      btn.appendChild(info);
      resultsDiv.appendChild(btn);
    }

    // Quitar borde del último
    const last = resultsDiv.lastElementChild;
    if (last instanceof HTMLElement) {
      last.style.borderBottom = 'none';
    }
  } catch (error) {
    // Abort es normal cuando el usuario sigue tipeando
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') return;
    console.error('Error en búsqueda:', error);
    resultsDiv.innerHTML = '<p style="color: #c00; text-align: center; padding: 20px;">Error al buscar. Intenta de nuevo.</p>';
  }
}

// Click en resultados de búsqueda (delegación)
const searchResultsEl = document.getElementById('search-results');
if (searchResultsEl) {
  searchResultsEl.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    const btn = target.closest('button.search-result-item[data-lat][data-lng]');
    if (!(btn instanceof HTMLButtonElement)) return;
    const lat = Number(btn.dataset.lat);
    const lng = Number(btn.dataset.lng);
    const nombre = btn.dataset.nombre || btn.textContent || 'Lugar';
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    centrarEnLugar(lat, lng, nombre);
  });
}

function centrarEnLugar(lat, lng, nombreLugar) {
  if (!leafletMap) return;
  
  cerrarModalBusqueda();
  centrarEnCoordenadas(lat, lng, ZOOM_CALLE);
  
  // Abrir bottom-sheet para ofrecer guardar la ubicación
  abrirBottomSheetGuardarUbicacion(nombreLugar, lat, lng);
}

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
  const favs = obtenerLugaresFavs();
  const indice = favs.findIndex(f => f.nombre === nombre);
  
  if (indice !== -1) {
    favs.splice(indice, 1);
  } else {
    // Guardar coordenadas como números (evita strings en LocalStorage)
    favs.push({ nombre, lat: Number(lat), lng: Number(lng) });
    
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