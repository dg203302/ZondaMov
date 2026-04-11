const mapa = document.getElementById('map');
const contenedorParadas = document.getElementById('contenedor_paradas');
const contLineasFavs = document.getElementById('lineas_favs');

let ubicacion = null;
let leafletMap = null;
let userMarker = null;
let userMarkerHalo = null;
let paradasGeojson = null;
let paradasLayer = null;
let paradasPuntos = null;
let actualizarParadasTimer = null;
let recorridoLayer = null;
let recorridoActivo = null;
let paradasRecorrido = null;
let paradasRecorridoMarkers = null;
let seleccionParadaLayer = null;
let _planeoParadasIndex = null; // Map(paradaId -> { feature, lat, lng }) para listas de paradas en planeo
let _indiceParadasApi = null; // Cache de nombres canónicos para arrivals API
let _paradasPorLinea = null; // Cache de Datos/paradas_por_linea.json
let _urlsPorLinea = null; // Cache de Datos/urls_por_linea.json
let _indicesParadasPorLinea = null; // Cache de índices normalizados por línea
let _correspondenciaParadas = null; // Cache de Datos/correspondencia_paradas.json
let arrivalsAbortController = null; // Permite abortar/renovar consultas de arrivals
let _lastParadasPorLineaError = ''; // Último error al cargar paradas_por_linea.json (para diagnóstico)
let _lastUrlsPorLineaError = ''; // Último error al cargar urls_por_linea.json (para diagnóstico)

// ─── Planeo de ruta (opciones / trasbordos) ─────────────────────────────────
let _routePlanTarget = null; // { feature, nombre, lat, lng, stopId }
let _indiceLineasPorStopId = null; // Map(stopId -> Set(refs)) (legacy; puede no coincidir con GeoJSON)
let _indiceParadasPuntosPorId = null; // Map(stopId -> { lat, lng, feature })
let _stopIdsSetPorLinea = null; // Map(ref -> Set(stopIds)) (legacy)
let _stopsIndexPorLinea = null; // Map(ref -> { ids:Set<string>, stops:Array<{id,lat,lng,feature}> })
let _routePlanLastAllowTransfer = false;
const ROUTE_NEARBY_STOPS_RADIUS_M = 1200;
const ROUTE_NEARBY_STOPS_MAX = 60;
const ROUTE_MAX_OPCIONES_DIRECTAS = 10;
const ROUTE_MAX_OPCIONES_TRASBORDO = 10;

const JSON_VERSION = '?v=3';
const PARADAS_GEOJSON_URL = encodeURI('Datos/DATOS SAN JUAN.geojson');
const RED_TULUM_PARADAS_URL = encodeURI('Datos/red_tulum_paradas.json' + JSON_VERSION);
const PARADAS_POR_LINEA_URL = encodeURI('Datos/paradas_por_linea.json' + JSON_VERSION);
const URLS_POR_LINEA_URL = encodeURI('Datos/urls_por_linea.json' + JSON_VERSION);
const CORRESPONDENCIA_PARADAS_URL = encodeURI('Datos/correspondencia_paradas.json' + JSON_VERSION);
const ARRIVALS_API_URL = 'https://proxyrt-production.up.railway.app/arrivals';
const ARRIVALS_TIMEOUT_MS = 30000;
const ARRIVALS_MAX_INTENTOS_PARADA = 3; // cuando hay paradas duplicadas por sufijos, probar varias variantes
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

// ─── Ads (bloque externo) ─────────────────────────────────────────────────
// Se monta en momentos puntuales (cargando arribos / mostrando líneas de parada)
// y se evita recargar el script o duplicar IDs en el DOM.
const TSJ_ADS_TOKEN = 'da8bd74959eaf231b990a00938209088';
const TSJ_ADS_SCRIPT_SRC = `https://pl29119669.profitablecpmratenetwork.com/${TSJ_ADS_TOKEN}/invoke.js`;
const TSJ_ADS_SCRIPT_ID = `tsj-ads-script-${TSJ_ADS_TOKEN}`;
const TSJ_ADS_WRAPPER_ID = `tsj-ads-wrapper-${TSJ_ADS_TOKEN}`;
const TSJ_ADS_CONTAINER_ID = `container-${TSJ_ADS_TOKEN}`;
const TSJ_ADS_PLACEHOLDER_ATTR = 'data-tsj-ads-placeholder';

function asegurarScriptAdsCargado() {
  if (document.getElementById(TSJ_ADS_SCRIPT_ID)) return;
  const s = document.createElement('script');
  s.id = TSJ_ADS_SCRIPT_ID;
  s.async = true;
  s.setAttribute('data-cfasync', 'false');
  s.src = TSJ_ADS_SCRIPT_SRC;
  document.body.appendChild(s);
}

function asegurarWrapperAds() {
  let wrapper = document.getElementById(TSJ_ADS_WRAPPER_ID);
  if (wrapper) return wrapper;

  wrapper = document.createElement('div');
  wrapper.id = TSJ_ADS_WRAPPER_ID;
  wrapper.style.display = 'none';

  const cont = document.createElement('div');
  cont.id = TSJ_ADS_CONTAINER_ID;
  wrapper.appendChild(cont);

  document.body.appendChild(wrapper);
  return wrapper;
}

function desmontarAdsDeBottomSheet() {
  const wrapper = document.getElementById(TSJ_ADS_WRAPPER_ID);
  if (!wrapper) return;
  if (wrapper.parentElement && wrapper.parentElement !== document.body) {
    document.body.appendChild(wrapper);
  }
  wrapper.style.display = 'none';
}

function montarAdsEnBottomSheetSiCorresponde() {
  const bsContentEl = document.getElementById('bs-content');
  if (!bsContentEl) {
    desmontarAdsDeBottomSheet();
    return;
  }

  const placeholder = bsContentEl.querySelector(`[${TSJ_ADS_PLACEHOLDER_ATTR}="${TSJ_ADS_TOKEN}"]`);
  if (!(placeholder instanceof HTMLElement)) {
    desmontarAdsDeBottomSheet();
    return;
  }

  const wrapper = asegurarWrapperAds();

  // Vaciar el placeholder y mover el wrapper (persistente) dentro.
  placeholder.textContent = '';
  placeholder.appendChild(wrapper);
  wrapper.style.display = '';

  // Cargar el script solo cuando se necesita el bloque.
  asegurarScriptAdsCargado();
}

// ─── Planeación de ruta (estimaciones) ───────────────────────────────────────
// Velocidades aproximadas (m/s). Se usan para puntuar por tiempo en lugar de solo distancia.
const WALKING_SPEED_M_S = 1.35; // ~4.9 km/h
const BUS_SPEED_M_S = 5.0; // ~18 km/h (estimación conservadora)
const DESTINO_UMBRAL_CORTE_M = 90; // cortar tramo si pasa a <= 90m del destino


// Long press en mapa para guardar ubicación
const MAP_LONG_PRESS_MS = 650;
const MAP_LONG_PRESS_MOVE_TOL_M = 25;
let _longPressMapSetupDone = false;

const PARADA_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="#ffffff" stroke="#007BFF" stroke-width="3"/><circle cx="12" cy="12" r="2.5" fill="#007BFF"/></svg>';
const PARADA_ICON_URL = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(PARADA_ICON_SVG)}`;
const USER_WAYPOINT_ICON_URL = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMyIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBjbGFzcz0ibHVjaWRlIGx1Y2lkZS1tYXAtcGluLWljb24gbHVjaWRlLW1hcC1waW4iPjxwYXRoIGQ9Ik0yMCAxMGMwIDQuOTkzLTUuNTM5IDEwLjE5My03LjM5OSAxMS43OTlhMSAxIDAgMCAxLTEuMjAyIDBDOS41MzkgMjAuMTkzIDQgMTQuOTkzIDQgMTBhOCA4IDAgMCAxIDE2IDAiLz48Y2lyY2xlIGN4PSIxMiIgY3k9IjEwIiByPSIzIi8+PC9zdmc+';
let _iconoParadaLeaflet = null;
let _iconoUserWaypointLeaflet = null;

function obtenerIconoParadaLeaflet() {
  if (!leafletMap || typeof L === 'undefined') return null;
  if (_iconoParadaLeaflet) return _iconoParadaLeaflet;

  _iconoParadaLeaflet = L.icon({
    iconUrl: PARADA_ICON_URL,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -11],
  });
  return _iconoParadaLeaflet;
}

function asegurarMarcadorUsuario(lat, lng) {
  if (!leafletMap || typeof L === 'undefined') return;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  const latLng = [lat, lng];

  if (!userMarkerHalo) {
    userMarkerHalo = L.circleMarker(latLng, {
      radius: 18,
      weight: 0,
      color: '#007BFF',
      fillColor: '#007BFF',
      fillOpacity: 0.18,
      interactive: false,
    }).addTo(leafletMap);
  } else {
    userMarkerHalo.setLatLng(latLng);
  }

  if (!userMarker) {
    userMarker = L.circleMarker(latLng, {
      radius: 7,
      weight: 3,
      color: '#ffffff',
      fillColor: '#007BFF',
      fillOpacity: 1,
    }).addTo(leafletMap);
  } else {
    userMarker.setLatLng(latLng);
  }
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

function deberiaMostrarBotonRegresarPlanearRuta(titulo) {
  if (!recorridoActivo || !recorridoActivo.planned) return false;
  if (!_routePlanTarget) return false;
  const t = String(titulo || '').trim().toLowerCase();
  if (t === 'opciones de ruta') return false;
  return true;
}

function inyectarFilasNavegacionBottomSheet(titulo, tipo, contenidoHtml) {
  const html = String(contenidoHtml || '');
  const navRows = [];
  const sheetTipo = String(tipo || '').trim();

  // En vistas de arribos (tipo='linea'), NO mostrar 'Regresar a planear ruta'
  // para evitar doble navegación: ahí debe primar 'Volver a paradas'.
  const showBackPlanner = sheetTipo !== 'linea'
    && deberiaMostrarBotonRegresarPlanearRuta(titulo)
    && !html.includes('data-route-back="planner"');
  const showBackStops = Boolean(recorridoActivo?.planned)
    && sheetTipo === 'linea'
    && !html.includes('data-route-back="stops"');

  if (showBackPlanner) {
    navRows.push('<li><button type="button" class="btn-nav-row" data-route-back="planner">← Regresar a planear ruta</button></li>');
  }
  if (showBackStops) {
    navRows.push('<li><button type="button" class="btn-nav-row" data-route-back="stops">← Volver a paradas</button></li>');
  }

  if (!navRows.length) return html;
  const extraClass = navRows.length === 2 ? ' bs-nav-rows--two' : '';
  return `<ul class="bs-nav-rows${extraClass}">${navRows.join('')}</ul>${html}`;
}

function abrirBottomSheet(titulo, contenidoHtml, tipo = '', subtitulo = '') {
  const bs = document.getElementById('bottom-sheet');
  const bsTitle = document.getElementById('bs-title');
  const bsSubtitle = document.getElementById('bs-subtitle');
  const bsContent = document.getElementById('bs-content');
  const overlay = document.getElementById('bottom-sheet-overlay');
  const favBtn = document.getElementById('bs-fav-btn');
  const planBtn = document.getElementById('bs-plan-btn');

  // Evita que el wrapper del anuncio se destruya al hacer bsContent.innerHTML = ...
  desmontarAdsDeBottomSheet();
  
  if (bsTitle) bsTitle.textContent = titulo;
  if (bsSubtitle) {
    const s = typeof subtitulo === 'string' ? subtitulo.trim() : '';
    bsSubtitle.textContent = s;
    bsSubtitle.style.display = s ? '' : 'none';
  }
  if (bsContent) bsContent.innerHTML = inyectarFilasNavegacionBottomSheet(titulo, tipo, contenidoHtml);

  // Montar anuncio si el HTML incluyó el placeholder.
  montarAdsEnBottomSheetSiCorresponde();
  
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
        iniciarPlaneoRutaHastaParadaSeleccionada(window._currentFeature || null);
      };
    } else {
      planBtn.style.display = 'none';
      planBtn.onclick = null;
    }
  }
}

let _confirmCloseRouteOnConfirm = null;
let _confirmCloseRouteKeydownBound = false;

function ocultarModalConfirmCerrarRuta() {
  const overlay = document.getElementById('confirm-close-route-overlay');
  if (!overlay) return;
  overlay.classList.remove('active');
  overlay.setAttribute('aria-hidden', 'true');
  _confirmCloseRouteOnConfirm = null;
}

function mostrarModalConfirmCerrarRuta(onConfirm) {
  const overlay = document.getElementById('confirm-close-route-overlay');
  const okBtn = document.getElementById('confirm-close-route-ok');
  if (!overlay || !okBtn) {
    // Fallback defensivo por si el markup no existe.
    const ok = confirm('Hay un recorrido planeado en el mapa. ¿Querés cerrarlo?');
    if (ok && typeof onConfirm === 'function') onConfirm();
    return;
  }
  _confirmCloseRouteOnConfirm = typeof onConfirm === 'function' ? onConfirm : null;
  overlay.classList.add('active');
  overlay.setAttribute('aria-hidden', 'false');

  const cancelBtn = document.getElementById('confirm-close-route-cancel');
  setTimeout(() => {
    (cancelBtn || okBtn).focus?.();
  }, 0);
}

function setupModalConfirmCerrarRuta() {
  const overlay = document.getElementById('confirm-close-route-overlay');
  const cancelBtn = document.getElementById('confirm-close-route-cancel');
  const okBtn = document.getElementById('confirm-close-route-ok');
  if (!overlay || !cancelBtn || !okBtn) return;

  overlay.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'confirm-close-route-overlay') {
      ocultarModalConfirmCerrarRuta();
    }
  });
  cancelBtn.addEventListener('click', () => {
    ocultarModalConfirmCerrarRuta();
  });
  okBtn.addEventListener('click', () => {
    const cb = _confirmCloseRouteOnConfirm;
    ocultarModalConfirmCerrarRuta();
    if (typeof cb === 'function') cb();
  });

  if (!_confirmCloseRouteKeydownBound) {
    _confirmCloseRouteKeydownBound = true;
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const active = document.getElementById('confirm-close-route-overlay')?.classList.contains('active');
      if (active) ocultarModalConfirmCerrarRuta();
    });
  }
}

function cerrarBottomSheet(force = false) {
  const bs = document.getElementById('bottom-sheet');
  const overlay = document.getElementById('bottom-sheet-overlay');
  const favBtn = document.getElementById('bs-fav-btn');
  const planBtn = document.getElementById('bs-plan-btn');

  // Si hay un recorrido planeado activo, confirmar antes de cerrarlo.
  if (!force && recorridoActivo && recorridoActivo.planned) {
    mostrarModalConfirmCerrarRuta(() => cerrarBottomSheet(true));
    return;
  }
  
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

async function mostrarArribosParaParadaYLinea(paradaFeature, lineaRef, lineaNombre = '') {
  const ref = String(lineaRef || '').trim();
  if (!ref) return;
  const name = String(lineaNombre || '').trim();

  const paradaNombreBase = obtenerNombreParadaBase(paradaFeature);
  const subtitulo = paradaNombreBase ? `Parada: ${paradaNombreBase}` : '';

  try {
    const loadingHtml = renderEstadoCargaArribos(ref, name);
    abrirBottomSheet(`Línea ${ref}`, loadingHtml, 'linea', subtitulo);
  } catch {
    // noop
  }

  try {
    const arrivalsResp = await consultarArribosApi(ref, paradaNombreBase, { paradaFeature });
    const html = renderHorariosLlegada(
      arrivalsResp.horarios,
      ref,
      name,
      Number(arrivalsResp.headwaySecs) > 0 ? Number(arrivalsResp.headwaySecs) : 0,
      false,
      {
        tipoDatos: arrivalsResp.tipoDatos,
        apiFallo: Boolean(arrivalsResp.apiFallo),
        paradaConsultada: arrivalsResp.paradaConsultada,
        mensajeApi: arrivalsResp.mensajeApi,
        horarioEstimado: arrivalsResp.horarioEstimado,
        debugArrivals: arrivalsResp.debugArrivals,
      }
    );
    abrirBottomSheet(`Línea ${ref}`, html, 'linea', subtitulo);
  } catch {
    const errHtml = '<p style="text-align:center; color: var(--text-secondary,#666);">No se pudieron consultar los arribos.</p>';
    abrirBottomSheet(`Línea ${ref}`, errHtml, 'linea', subtitulo);
  }
}

async function dibujarParadasDeLineaCercanasAlOrigen(relIds, origenLat, origenLng, lineaRef, lineaNombre = '', opts = {}) {
  if (!leafletMap || typeof L === 'undefined') return;
  if (!relIds || relIds.size === 0) return;

  const latO = Number(origenLat);
  const lngO = Number(origenLng);
  if (!Number.isFinite(latO) || !Number.isFinite(lngO)) return;

  const layerParadas = asegurarParadasLayer();
  if (!layerParadas) return;
  const shouldClear = !(opts && typeof opts === 'object' && opts.clear === false);
  if (shouldClear) layerParadas.clearLayers();

  const puntos = await cargarParadasPuntos();
  if (!Array.isArray(puntos) || puntos.length === 0) return;

  const originLL = L.latLng(latO, lngO);
  const cercanas = [];
  for (const p of puntos) {
    if (!p || !p.feature) continue;
    if (!featurePerteneceAAlgunaRelacion(p.feature, relIds)) continue;
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const d = leafletMap.distance(originLL, L.latLng(p.lat, p.lng));
    if (d <= RADIO_PARADAS_METROS) {
      cercanas.push({ feature: p.feature, lat: p.lat, lng: p.lng, d });
    }
  }

  cercanas.sort((a, b) => a.d - b.d);
  const seleccion = cercanas.slice(0, MAX_PARADAS_MOSTRAR);

  for (const item of seleccion) {
    const icon = obtenerIconoParadaLeaflet();
    const marker = L.marker([item.lat, item.lng], icon ? { icon } : undefined).addTo(layerParadas);
    marker.on('click', () => {
      // Consultar arribos directamente al tocar la parada.
      const ref = String(lineaRef || '').trim() || String(recorridoActivo?.ref || '').trim();
      const name = String(lineaNombre || '').trim() || String(recorridoActivo?.name || '').trim();
      void mostrarArribosParaParadaYLinea(item.feature, ref, name);
    });
  }

  return seleccion;
}

function abrirBottomSheetFavoritos() {
  const contParadas = document.getElementById('paradas_favs');
  const contLineas = document.getElementById('lineas_favs');
  const contLugares = document.getElementById('lugares_favs');
  const paradasHtml = contParadas?.innerHTML || '<p class="fav-empty">Sin paradas favoritas</p>';
  const lineasHtml = contLineas?.innerHTML || '<p class="fav-empty">Sin líneas favoritas</p>';
  const lugaresHtml = contLugares?.innerHTML || '<p class="fav-empty">Sin lugares guardados</p>';
  
  const html = `
    <h3 style="margin-top: 0; margin-bottom: 18px; font-size: 20px; font-weight: 700; color: var(--text-primary, #222);">📍 Paradas Favoritas</h3>
    <div style="margin-bottom: 28px;">${paradasHtml}</div>
    <h3 style="margin-bottom: 18px; font-size: 20px; font-weight: 700; color: var(--text-primary, #222);">🚌 Líneas Favoritas</h3>
    <div style="margin-bottom: 28px;">${lineasHtml}</div>
    <h3 style="margin-bottom: 18px; font-size: 20px; font-weight: 700; color: var(--text-primary, #222);">📌 Lugares Guardados</h3>
    <div>${lugaresHtml}</div>
  `;
  abrirBottomSheet('Favoritos', html);
}

// Funcionalidad de drag en el handle del bottom-sheet
function setupBottomSheetDrag() {
  const header = document.querySelector('.bottom-sheet-header');
  const bottomSheet = document.getElementById('bottom-sheet');
  const content = document.getElementById('bs-content');
  
  if (!header || !bottomSheet) return;
  
  let isDragging = false;
  let startY = 0;
  let currentY = 0;
  let startState = BOTTOM_SHEET_STATE_HALF;
  let startHeightPx = 0;

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const getHalfHeightPx = () => Math.round((window.innerHeight || 0) * 0.5);
  const getFullHeightPx = () => Math.round((window.innerHeight || 0) * 1.0);

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
    // No iniciar drag si el click es en un botón
    if (e.target.closest('button') || e.target.closest('svg') || e.target.closest('img')) {
      return;
    }
    
    if (!bottomSheet.classList.contains('active')) return;
    isDragging = true;
    startY = e.type.includes('mouse') ? e.clientY : e.touches?.[0]?.clientY || 0;
    currentY = 0;
    startState = getBottomSheetState();
    startHeightPx = Math.round(bottomSheet.getBoundingClientRect().height || 0);
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

    // En lugar de mover el sheet (que deja hueco abajo), ajustar su altura.
    // deltaY < 0 => arrastra hacia arriba => aumenta altura
    // deltaY > 0 => arrastra hacia abajo => reduce altura
    const halfPx = getHalfHeightPx();
    const fullPx = getFullHeightPx();
    const minPx = startState === BOTTOM_SHEET_STATE_HALF ? Math.max(140, halfPx - 260) : halfPx;
    const maxPx = Math.max(fullPx, halfPx);

    const nextHeight = clamp(startHeightPx - currentY, minPx, maxPx);
    bottomSheet.style.height = `${nextHeight}px`;
    bottomSheet.style.transform = '';
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
      bottomSheet.style.height = '';
      cerrarBottomSheet();
    } else {
      setBottomSheetState(targetState);
      // Animar el ajuste de altura al estado final.
      const halfPx = getHalfHeightPx();
      const fullPx = getFullHeightPx();
      const targetHeight = targetState === BOTTOM_SHEET_STATE_FULL ? fullPx : halfPx;
      bottomSheet.style.transition = 'height 0.2s ease';
      bottomSheet.style.height = `${targetHeight}px`;
      bottomSheet.style.transform = '';
      setTimeout(() => {
        bottomSheet.classList.remove('dragging');
        // Volver a control por CSS (responsive) luego de la animación.
        bottomSheet.style.transition = '';
        bottomSheet.style.height = '';
      }, 200);
    }
    
    currentY = 0;
    startHeightPx = 0;
  };

  // Remover listeners previos para evitar duplicados
  const prevHandlers = header._bottomSheetDragHandlers;
  if (prevHandlers) {
    header.removeEventListener('mousedown', prevHandlers.handleDragStart);
    header.removeEventListener('touchstart', prevHandlers.handleDragStart);
    document.removeEventListener('mousemove', prevHandlers.handleDragMove);
    document.removeEventListener('mouseup', prevHandlers.handleDragEnd);
    document.removeEventListener('touchmove', prevHandlers.handleDragMove);
    document.removeEventListener('touchend', prevHandlers.handleDragEnd);
  }

  // Listener para el inicio del drag (en toda la cabecera)
  header.addEventListener('mousedown', handleDragStart);
  header.addEventListener('touchstart', handleDragStart, { passive: false });

  // Listeners globales para el movimiento y fin
  document.addEventListener('mousemove', handleDragMove, { passive: true });
  document.addEventListener('mouseup', handleDragEnd);
  document.addEventListener('touchmove', handleDragMove, { passive: true });
  document.addEventListener('touchend', handleDragEnd);

  header._bottomSheetDragHandlers = {
    handleDragStart,
    handleDragMove,
    handleDragEnd,
  };
}

// Inicializar cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setupBottomSheetDrag();
    setupModalConfirmCerrarRuta();
    setupSidepanelConfiguracion();
  });
} else {
  setupBottomSheetDrag();
  setupModalConfirmCerrarRuta();
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
  const html = `
    <div class="save-location-sheet">
      <p class="save-location-title">¿Guardar este lugar?</p>
      <p class="save-location-name">${escapeHtml(nombreLugar)}</p>
      <p class="save-location-description">Acceso rápido desde favoritos</p>
      <div class="save-location-buttonarea">
        <button
          type="button"
          class="btn-save-location-primary"
          data-save-lugar="1"
          data-lugar-nombre="${escapeHtml(nombreLugar)}"
          data-lat="${String(lat)}"
          data-lng="${String(lng)}"
        >
          <img class="icon light" alt="" src="${iconSaveLight}" />
          <img class="icon dark" alt="" src="${iconSaveDark}" />
          <span>Guardar lugar</span>
        </button>
      </div>
    </div>
  `;
  
  abrirBottomSheet('Guardar lugar', html);
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

    const btnBackStops = target.closest('button[data-route-back="stops"]');
    if (btnBackStops instanceof HTMLButtonElement) {
      ev.stopPropagation();
      mostrarParadasPlaneadasEnBottomSheet();
      return;
    }

    const btnBackPlanner = target.closest('button[data-route-back="planner"]');
    if (btnBackPlanner instanceof HTMLButtonElement) {
      ev.stopPropagation();
      void mostrarOpcionesRutaParaTarget(true);
      return;
    }

    const btnBackOpciones = target.closest('button[data-route-back="options"]');
    if (btnBackOpciones instanceof HTMLButtonElement) {
      ev.stopPropagation();
      void mostrarOpcionesRutaParaTarget(_routePlanLastAllowTransfer);
      return;
    }

    const btnPref = target.closest('button[data-route-pref]');
    if (btnPref instanceof HTMLButtonElement) {
      ev.stopPropagation();
      const pref = (btnPref.dataset.routePref || '').toLowerCase();
      const permitirTrasbordo = pref === 'transfer' || pref === 'trasbordo' || pref === 'si' || pref === '1';
      void mostrarOpcionesRutaParaTarget(permitirTrasbordo);
      return;
    }

    const btnLineaOpcion = target.closest('button[data-route-line-ref]');
    if (btnLineaOpcion instanceof HTMLButtonElement) {
      ev.stopPropagation();
      const ref = (btnLineaOpcion.dataset.routeLineRef || '').trim();
      const nombre = (btnLineaOpcion.dataset.routeLineName || '').trim();
      const latD = _routePlanTarget?.lat;
      const lngD = _routePlanTarget?.lng;
      const nombreD = _routePlanTarget?.nombre || '';
      if (!ref || !Number.isFinite(latD) || !Number.isFinite(lngD)) return;
      try {
        abrirBottomSheet(
          'Ruta',
          '<div class="bottom-sheet-loading" role="status" aria-live="polite" aria-busy="true">'
            + '<div class="bottom-sheet-loading-spinner" aria-hidden="true"></div>'
            + '<p class="bottom-sheet-loading-title">Cargando paradas...</p>'
            + '</div>',
          '',
          `Línea ${escapeHtml(ref)}`,
        );
      } catch {
        // noop
      }
      void (async () => {
        await verLineaMasCercanaDesdeActualHastaDestino(latD, lngD, nombreD, [ref]);
        mostrarParadasPlaneoActualEnBottomSheet({ ref, name: nombre });
      })();
      return;
    }

    const btnCombo = target.closest('button[data-route-combo="1"][data-linea-a][data-linea-b]');
    if (btnCombo instanceof HTMLButtonElement) {
      ev.stopPropagation();
      const a = (btnCombo.dataset.lineaA || '').trim();
      const b = (btnCombo.dataset.lineaB || '').trim();
      const tLat = Number(btnCombo.dataset.transferLat);
      const tLng = Number(btnCombo.dataset.transferLng);
      const tName = btnCombo.dataset.transferName || 'trasbordo';
      if (!a || !b || !Number.isFinite(tLat) || !Number.isFinite(tLng)) return;

      const destNombre = _routePlanTarget?.nombre || '';
      const destLat = _routePlanTarget?.lat;
      const destLng = _routePlanTarget?.lng;
      if (!Number.isFinite(destLat) || !Number.isFinite(destLng)) return;

      try {
        abrirBottomSheet(
          'Ruta',
          '<div class="bottom-sheet-loading" role="status" aria-live="polite" aria-busy="true">'
            + '<div class="bottom-sheet-loading-spinner" aria-hidden="true"></div>'
            + '<p class="bottom-sheet-loading-title">Calculando trasbordo...</p>'
            + '</div>',
          '',
          tName ? `Trasbordo en: ${escapeHtml(String(tName))}` : '',
        );
      } catch {
        // noop
      }

      void planearRutaConTrasbordo({
        lineaA: a,
        lineaB: b,
        transfer: { lat: tLat, lng: tLng, name: tName },
        destino: { lat: Number(destLat), lng: Number(destLng), nombre: String(destNombre || '') },
      });
      return;
    }

    const btnPlaneoStop = target.closest('button[data-plane-stop-id][data-plane-line-ref]');
    if (btnPlaneoStop instanceof HTMLButtonElement) {
      ev.stopPropagation();
      const stopId = (btnPlaneoStop.dataset.planeStopId || '').trim();
      const lineaRef = (btnPlaneoStop.dataset.planeLineRef || '').trim();
      const lineaName = (btnPlaneoStop.dataset.planeLineName || '').trim();
      if (!stopId || !lineaRef) return;
      const info = _planeoParadasIndex?.get(stopId) || null;
      if (!info || !info.feature) return;

      try {
        if (leafletMap && Number.isFinite(info.lat) && Number.isFinite(info.lng)) {
          leafletMap.setView([info.lat, info.lng], leafletMap.getZoom());
        }
      } catch {
        // noop
      }

      void mostrarArribosParaParadaYLinea(info.feature, lineaRef, lineaName);
      return;
    }

    const btnLeg = target.closest('button[data-route-leg][data-linea-ref]');
    if (btnLeg instanceof HTMLButtonElement) {
      ev.stopPropagation();
      const leg = btnLeg.dataset.routeLeg || '';
      const ref = (btnLeg.dataset.lineaRef || '').trim();
      if (!ref) return;

      if (leg === '1') {
        const toLat = Number(btnLeg.dataset.toLat);
        const toLng = Number(btnLeg.dataset.toLng);
        if (!Number.isFinite(toLat) || !Number.isFinite(toLng)) return;
        void verLineaMasCercanaDesdeActualHastaDestino(toLat, toLng, 'trasbordo', [ref]);
        return;
      }

      if (leg === '2') {
        const fromLat = Number(btnLeg.dataset.fromLat);
        const fromLng = Number(btnLeg.dataset.fromLng);
        const destLat = _routePlanTarget?.lat;
        const destLng = _routePlanTarget?.lng;
        const destNombre = _routePlanTarget?.nombre || '';
        if (!Number.isFinite(fromLat) || !Number.isFinite(fromLng)) return;
        if (!Number.isFinite(destLat) || !Number.isFinite(destLng)) return;
        void verLineaMasCercanaDesdeActualHastaDestino(destLat, destLng, destNombre, [ref], { lat: fromLat, lng: fromLng });
        return;
      }
    }

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
    // Para lugares guardados: mostrar el mismo "punto" que el long-press (sin pin ni texto)
    L.circleMarker(
      [latNum, lngNum],
      { radius: 7, weight: 2, color: '#007BFF', fillColor: '#ffffff', fillOpacity: 1 },
    ).addTo(layerSel);
    const z = typeof leafletMap.getMaxZoom === 'function' ? leafletMap.getMaxZoom() : ZOOM_CALLE;
    leafletMap.setView([latNum, lngNum], Number.isFinite(z) ? z : ZOOM_CALLE);
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

  const total = paradasRecorrido.length;
  const listaParadas = mostrarTodas
    ? paradasRecorrido
    : paradasRecorrido.slice(0, MAX_PARADAS_RECORRIDO);

  const items = listaParadas
    .map((p, idx) => {
      const paradaId = p.paradaId || obtenerIdParada(p.feature);
      const calle = p?.feature?.properties?.['addr:street'];
      const etiqueta = (typeof calle === 'string' && calle.trim()) ? calle.trim() : obtenerEtiquetaParada(p.feature);
      return `<li><button type="button" class="btn-recorrido-parada" data-parada-id="${escapeHtml(paradaId)}">${escapeHtml(etiqueta)}</button></li>`;
    })
    .join('');

  const indice = `
    <div class="recorrido-indice">
      <span class="recorrido-indice-left">Paradas del recorrido</span>
      <span class="recorrido-indice-right">${total} paradas</span>
    </div>
  `;

  return `${indice}<ul class="recorrido-stops">${items}</ul>`;
}

function obtenerNombreParadaBase(feature) {
  const props = feature?.properties || {};

  const name = props.name;
  if (typeof name === 'string' && name.trim()) return name.trim();

  const street = props['addr:street'];
  if (typeof street === 'string' && street.trim()) return street.trim();

  const ref = props.ref;
  if (typeof ref === 'string' && ref.trim()) return ref.trim();

  return obtenerEtiquetaParada(feature);
}

function extraerVarianteDesdeLinea(linea) {
  const txt = String(linea || '').trim();
  const m = txt.match(/([ABC])$/);
  return m ? m[1] : '';
}

function extraerDireccionDesdeNombreParada(nombreParada) {
  const txt = String(nombreParada || '').trim();
  // Soporta sufijos del estilo: "... S", "... S -A", "... S-A".
  const m = txt.match(/\s([SNEO])(?:\s*-\s*[ABCD])?\s*$/i);
  return m ? String(m[1]).toUpperCase() : '';
}

function normalizarNombreParadaSinSufijos(nombreParada) {
  // Normaliza quitando sufijos que NO queremos considerar para resolver (según requerimiento):
  // - Dirección: N/S/E/O o Norte/Sur/Este/Oeste
  // - Variante: -A/-B/-C/-D
  let txt = String(nombreParada || '').trim().replace(/\s+/g, ' ');
  if (!txt) return '';

  let prev = '';
  while (txt && txt !== prev) {
    prev = txt;
    txt = txt
      // Variante al final: "... -A"
      .replace(/\s*-\s*[ABCD]\s*$/i, '')
      // Dirección en palabra al final: "... Oeste"
      .replace(/\s+(norte|sur|este|oeste)\s*$/i, '')
      // Dirección abreviada al final: "... O"
      .replace(/\s+[SNEO]\s*$/i, '')
      .trim();
  }

  return txt;
}

function normalizarLineaParaLookup(linea) {
  return String(linea || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

function obtenerClavesLineaLookup(linea) {
  const base = normalizarLineaParaLookup(linea);
  if (!base) return [];

  const claves = [base];
  const sinVariante = base.replace(/([ABC])$/, '');
  if (sinVariante && sinVariante !== base) claves.push(sinVariante);
  return claves;
}

function crearClaveParadaApi(texto) {
  let txt = String(texto || '').trim().toLowerCase();
  if (!txt) return '';

  txt = txt
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // Conectores típicos en esquinas: unificar para mejorar matching.
    .replace(/\s*&\s*/g, ' y ')
    .replace(/\s*\/\s*/g, ' y ')
    .replace(/\bconmplejo\b/g, 'complejo')
    .replace(/\bcomplejo\s+universitario\b/g, 'complejo')
    .replace(/\bavenida\s+ignacio\b/g, 'av ignacio')
    .replace(/\bav\.?\s+ig\.?\b/g, 'av ignacio')
    // Variantes de apellidos/calles frecuentes en fuentes distintas.
    .replace(/\birigoyen\b/g, 'yrigoyen')
    .replace(/\byrigoyen\b/g, 'yrigoyen')
    // Unificar "Hipólito" (GeoJSON) con abreviaturas tipo "H." (JSON).
    .replace(/\bhipolito\b/g, 'h')
    // Unificar títulos/abreviaturas frecuentes.
    .replace(/\bdoctor\b/g, 'dr')
    .replace(/\bdr\.?\b/g, 'dr')
    .replace(/\bcomandante\b/g, 'cmte')
    .replace(/\bcmte\.?\b/g, 'cmte')
    .replace(/\bsargento\b/g, 'sgto')
    .replace(/\bsgto\.?\b/g, 'sgto')
    .replace(/\balmirante\b/g, 'almte')
    .replace(/\balmte\.?\b/g, 'almte')
    // Unificar Boulevard/Bulevar con abreviatura "Blvd.".
    .replace(/\bboulevard\b/g, 'blvd')
    .replace(/\bbulevar\b/g, 'blvd')
    .replace(/\bblvd\.?\b/g, 'blvd')
    // Unificar "Boulogne" (GeoJSON) con variantes mal escritas en datos.
    .replace(/\bboulonge\b/g, 'boulogne')
    // Algunas fuentes incluyen "Sur Mer" y otras solo "Sur".
    .replace(/\bsur\s+mer\b/g, 'sur')
    // Normalizar puntos cardinales cuando aparecen como sufijo (dirección de parada).
    // Ej: "... Boulevard Oeste" -> "... blvd o" (para que coincida con "... blvd. O").
    .replace(/\s+norte\b/g, ' n')
    .replace(/\s+sur\b/g, ' s')
    .replace(/\s+este\b/g, ' e')
    .replace(/\s+oeste\b/g, ' o')
    // Abreviaturas comunes.
    .replace(/\bgral\.?\b/g, 'general')
    .replace(/\bdiag\.?\b/g, 'diagonal')
    // Algunas fuentes incluyen "Diag. General ..." y otras no.
    .replace(/\bdiagonal\s+general\s+/g, 'diagonal ')
    // Normalizar "Ruta Nac." / "RN".
    .replace(/\bruta\s+nac\.?\b/g, 'ruta nacional')
    .replace(/\brn\b/g, 'ruta nacional')
    // Normalizar "Ruta P." / "RP" / "Ruta Provincial". En el GeoJSON suele venir como "Ruta 60".
    .replace(/\bruta\s+provincial\b/g, 'ruta')
    .replace(/\bruta\s+p\.?\b/g, 'ruta')
    .replace(/\brp\b/g, 'ruta')
    // Normalizar indicadores de número: N°20, N° 20, Nº20, Nro. 20, etc.
    .replace(/\bnro\.?\b/g, 'n')
    .replace(/\bn[°º]\s*/g, 'n ')
    // Normalizar "Barrio" con abreviaturas tipo "B°" (reduce falsos negativos).
    .replace(/\bbarrio\b/g, 'b')
    .replace(/\bavenida\b/g, 'av')
    .replace(/\bavda\b/g, 'av')
    .replace(/\bav\./g, 'av')
    // Remover símbolos residuales (por ejemplo el signo de número °/º) y
    // separar letras/dígitos para que "n20" y "n 20" coincidan.
    .replace(/[°º]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();

  return txt;
}

async function cargarParadasPorLinea({ noCache = false } = {}) {
  if (_paradasPorLinea && !noCache) return _paradasPorLinea;

  try {
    const resp = await fetch(PARADAS_POR_LINEA_URL, { cache: noCache ? 'no-store' : 'force-cache' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const payload = await resp.json();
    _paradasPorLinea = payload && typeof payload === 'object' ? payload : {};
    _indicesParadasPorLinea = null;
    _lastParadasPorLineaError = '';
    try {
      const teo2Check = _paradasPorLinea['TEO2']?.paradas ? Object.keys(_paradasPorLinea['TEO2'].paradas).length : 0;
      console.debug(`[paradas] Cargadas paradas_por_linea.json: ${Object.keys(_paradasPorLinea).length} líneas, TEO2=${teo2Check} paradas, noCache=${noCache}`);
    } catch {}
    return _paradasPorLinea;
  } catch (err) {
    console.warn('No se pudo cargar paradas_por_linea.json:', err);
    _lastParadasPorLineaError = err?.message ? String(err.message) : String(err);
    _paradasPorLinea = {};
    _indicesParadasPorLinea = null;
    return _paradasPorLinea;
  }
}

async function cargarCorrespondenciaParadas({ noCache = false } = {}) {
  if (_correspondenciaParadas && !noCache) return _correspondenciaParadas;

  try {
    const resp = await fetch(CORRESPONDENCIA_PARADAS_URL, { cache: noCache ? 'no-store' : 'force-cache' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const payload = await resp.json();
    _correspondenciaParadas = payload && typeof payload === 'object' ? payload : {};
    console.debug(`[correspondencia] Cargado correspondencia_paradas.json: ${Object.keys(_correspondenciaParadas).length} líneas`);
    return _correspondenciaParadas;
  } catch (err) {
    console.warn('No se pudo cargar correspondencia_paradas.json:', err);
    _correspondenciaParadas = {};
    return _correspondenciaParadas;
  }
}

/**
 * Busca el stop-ID de una parada directamente en la tabla de correspondencia.
 * Retorna el stop-ID (ej. "stop-43299592-33") o null si no encuentra.
 * @param {string} linea  - Ref de la línea (ej. "2", "100", "440-a")
 * @param {string} nombre - Nombre de la parada tal como viene del GeoJSON
 */
async function buscarEnCorrespondencia(linea, nombre) {
  const corr = await cargarCorrespondenciaParadas();
  if (!corr || !linea || !nombre) return null;

  const rawLinea = String(linea);

  // Normalizar variantes de clave ("440A" → "440-a", etc.)
  const candidatosLinea = [rawLinea, rawLinea.toLowerCase(), rawLinea.toUpperCase()];
  const m = rawLinea.match(/^(\d+)([A-Za-z])$/);
  if (m) {
    candidatosLinea.push(`${m[1]}-${m[2].toLowerCase()}`);
    candidatosLinea.push(`${m[1]}-${m[2].toUpperCase()}`);
  }

  // Match flexible por lookup (ignora espacios, guiones y puntuación).
  // Esto resuelve casos comunes: "TEO 2" vs "TEO2", "440A" vs "440-a".
  const targetLookups = new Set();
  const addLookup = (value) => {
    const lk = normalizarLineaParaLookup(value);
    if (lk) targetLookups.add(lk);
  };
  for (const c of candidatosLinea) addLookup(c);
  addLookup(normalizarLineaParaApi(rawLinea));

  let lineaKeyFlexible = '';
  for (const k of Object.keys(corr)) {
    const lk = normalizarLineaParaLookup(k);
    if (lk && targetLookups.has(lk)) {
      lineaKeyFlexible = k;
      break;
    }
  }
  if (lineaKeyFlexible && !candidatosLinea.includes(lineaKeyFlexible)) {
    candidatosLinea.unshift(lineaKeyFlexible);
  }

  for (const lk of candidatosLinea) {
    const entrada = corr[lk];
    if (!entrada) continue;
    const paradas = entrada.paradas;
    if (!paradas) continue;

    // Búsqueda exacta primero
    if (Object.prototype.hasOwnProperty.call(paradas, nombre)) {
      return paradas[nombre] || null;
    }

    // Búsqueda case-insensitive / sin espacios extra
    const nombreNorm = nombre.trim().toLowerCase().replace(/\s+/g, ' ');
    for (const [k, v] of Object.entries(paradas)) {
      if (k.trim().toLowerCase().replace(/\s+/g, ' ') === nombreNorm) {
        return v || null;
      }
    }
  }

  return null;
}

async function cargarUrlsPorLinea({ noCache = false } = {}) {
  if (_urlsPorLinea && !noCache) return _urlsPorLinea;

  try {
    const resp = await fetch(URLS_POR_LINEA_URL, { cache: noCache ? 'no-store' : 'force-cache' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const payload = await resp.json();
    _urlsPorLinea = payload && typeof payload === 'object' ? payload : {};
    _lastUrlsPorLineaError = '';
    return _urlsPorLinea;
  } catch (err) {
    console.warn('No se pudo cargar urls_por_linea.json:', err);
    _lastUrlsPorLineaError = err?.message ? String(err.message) : String(err);
    _urlsPorLinea = {};
    return _urlsPorLinea;
  }
}

function resolverKeyLineaEnObjeto(obj, linea) {
  const raw = String(linea || '').trim();
  if (!obj || typeof obj !== 'object' || !raw) return '';

  if (Object.prototype.hasOwnProperty.call(obj, raw)) return raw;

  const target = raw.toLowerCase();
  for (const k of Object.keys(obj)) {
    if (String(k).toLowerCase() === target) return k;
  }

  // Fallback flexible: ignorar espacios/guiones/puntuación.
  // Ejemplos:
  // - "TEO 1" (GeoJSON) vs "TEO1" (JSON)
  // - "440A" vs "440-a"
  const targetLookups = new Set();
  const addLookup = (value) => {
    const lk = normalizarLineaParaLookup(value);
    if (lk) targetLookups.add(lk);
  };

  addLookup(raw);
  addLookup(normalizarLineaParaApi(raw));

  const m = raw.match(/^(\d+)([A-Z])$/);
  if (m) addLookup(`${m[1]}-${m[2].toLowerCase()}`);

  for (const k of Object.keys(obj)) {
    const kLookup = normalizarLineaParaLookup(k);
    if (kLookup && targetLookups.has(kLookup)) {
      try { console.debug(`[resolverKeyLinea] Encontró: "${raw}" -> "${k}" (lookups: ${Array.from(targetLookups).join(', ')})` ); } catch {}
      return k;
    }
  }
  try { console.debug(`[resolverKeyLinea] NO encontró: "${raw}" (intentó: ${Array.from(targetLookups).join(', ')})` ); } catch {}
  return '';
}

function normalizarLineaParaApi(linea) {
  const raw = String(linea || '').trim();
  if (!raw) return '';

  // Formato con guion y letra: "440-a", "440-b", "441-c", "441-d", "441-e" → "440", "441"
  // También acepta mayúsculas: "440-A", "441-B"
  const matchGuion = raw.match(/^(\d+)-[A-Za-z]$/);
  if (matchGuion) {
    return matchGuion[1];
  }

  // Formato sin guion pero con letra al final: "440A" → "440"
  // Solo aplica cuando hay dígito antes de la letra final (evita recortar refs como "TNS", "TEO1").
  if (/[A-Z]$/.test(raw) && /\d/.test(raw.slice(0, -1))) {
    return raw.slice(0, -1).trim();
  }

  return raw;
}

function construirIndiceParadasLinea(paradasObj) {
  // claveNormalizada -> nombreParada.
  // Importante: cuando ignoramos sufijos (N/S/E/O, -A/-B/-C/-D) pueden aparecer
  // duplicados por sentido. En ese caso, nos quedamos con la primera ocurrencia
  // para evitar falsos negativos (mejor devolver algún id_p que no devolver ninguno).
  const indice = new Map();

  for (const nombre of Object.keys(paradasObj || {})) {
    const base = normalizarNombreParadaSinSufijos(nombre);
    const clave = crearClaveParadaApi(base);
    if (!clave) continue;
    if (!indice.has(clave)) {
      indice.set(clave, nombre);
    }
  }

  return indice;
}

async function resolverUrlDesdeJson(linea) {
  let urls = await cargarUrlsPorLinea();
  let lk = resolverKeyLineaEnObjeto(urls, linea);
  if (!lk) {
    // Si se editaron los JSON en caliente, puede haber quedado cacheado en memoria.
    urls = await cargarUrlsPorLinea({ noCache: true });
    lk = resolverKeyLineaEnObjeto(urls, linea);
  }
  return lk ? String(urls[lk] || '') : '';
}

function obtenerIndiceParadasLineaDesdeCache(lineaKey, paradasObj) {
  if (!_indicesParadasPorLinea) _indicesParadasPorLinea = new Map();
  if (_indicesParadasPorLinea.has(lineaKey)) return _indicesParadasPorLinea.get(lineaKey);
  const idx = construirIndiceParadasLinea(paradasObj);
  _indicesParadasPorLinea.set(lineaKey, idx);
  return idx;
}

async function resolverParadaDesdeJson(linea, nombreParada) {
  const original = String(nombreParada || '').trim().replace(/\s+/g, ' ');
  if (!original) return { id_p: '', paradaResuelta: '' };

  // 0) Consultar la tabla de correspondencia precomputada (GeoJSON → stop-ID).
  //    Es la fuente más directa y evita fuzzy matching innecesario.
  const idCorrespondencia = await buscarEnCorrespondencia(linea, original);
  if (idCorrespondencia) {
    return { id_p: idCorrespondencia, paradaResuelta: original };
  }

  let data = await cargarParadasPorLinea();
  let lk = resolverKeyLineaEnObjeto(data, linea);
  if (!lk) {
    data = await cargarParadasPorLinea({ noCache: true });
    lk = resolverKeyLineaEnObjeto(data, linea);
  }
  const entry = lk ? data[lk] : null;
  const paradasObj = entry?.paradas && typeof entry.paradas === 'object' ? entry.paradas : {};

  const baseOriginal = normalizarNombreParadaSinSufijos(original);

  // 1) Match exacto por nombre tal cual está en el JSON.
  if (Object.prototype.hasOwnProperty.call(paradasObj, original)) {
    return { id_p: String(paradasObj[original] || ''), paradaResuelta: original };
  }

  // 2) Match por normalización dentro de la línea (único).
  const indice = obtenerIndiceParadasLineaDesdeCache(lk || String(linea || ''), paradasObj);

  const sinSufijos = baseOriginal;

  for (const candidato of [original, sinSufijos]) {
    const clave = crearClaveParadaApi(candidato);
    const nombreMatch = clave ? indice.get(clave) : '';
    if (nombreMatch && Object.prototype.hasOwnProperty.call(paradasObj, nombreMatch)) {
      return { id_p: String(paradasObj[nombreMatch] || ''), paradaResuelta: nombreMatch };
    }
  }

  // 3) Fallback por tokens (si hay 1 único candidato).
  const indiceTokens = new Map();
  for (const nombre of Object.keys(paradasObj)) {
    const base = normalizarNombreParadaSinSufijos(nombre);
    const clave = crearClaveParadaApi(base);
    if (clave) indiceTokens.set(clave, nombre);
  }
  const claveQuery = crearClaveParadaApi(sinSufijos || original);
  const nombreTokens = resolverCanonicoPorTokensEnIndice(indiceTokens, claveQuery);
  if (nombreTokens && Object.prototype.hasOwnProperty.call(paradasObj, nombreTokens)) {
    return { id_p: String(paradasObj[nombreTokens] || ''), paradaResuelta: nombreTokens };
  }

  // 4) Fallback por score: elegir el candidato con mejor cobertura de tokens.
  const nombreScore = resolverCanonicoPorTokensMejorScore(indiceTokens, claveQuery);
  if (nombreScore && Object.prototype.hasOwnProperty.call(paradasObj, nombreScore)) {
    return { id_p: String(paradasObj[nombreScore] || ''), paradaResuelta: nombreScore };
  }

  return { id_p: '', paradaResuelta: '' };
}

function registrarParadaCanonicaEnIndice(indice, nombreParada) {
  if (!(indice instanceof Map)) return;

  const canonica = String(nombreParada || '').trim().replace(/\s+/g, ' ');
  if (!canonica) return;

  const clave = crearClaveParadaApi(canonica);
  if (!clave) return;

  if (!indice.has(clave)) {
    indice.set(clave, canonica);
  }
}

function tokenizarClaveParadaApi(clave) {
  const ignorar = new Set([
    'y',
    'de',
    'del',
    'la',
    'el',
    'los',
    'las',
    'av',
    'ruta',
    'nacional',
    'diagonal',
    'general',
    'n',
  ]);

  return String(clave || '')
    .split(' ')
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t.length > 1)
    .filter((t) => !ignorar.has(t));
}

function resolverCanonicoPorTokensEnIndice(indiceLinea, clave) {
  if (!(indiceLinea instanceof Map)) return '';

  const tokens = tokenizarClaveParadaApi(clave);
  if (tokens.length === 0) return '';

  let canonica = '';
  let matches = 0;

  for (const [k, v] of indiceLinea.entries()) {
    const tset = new Set(tokenizarClaveParadaApi(k));

    let ok = true;
    for (const t of tokens) {
      if (!tset.has(t)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    matches += 1;
    canonica = v;
    if (matches > 1) return '';
  }

  return matches === 1 ? canonica : '';
}

function resolverCanonicoPorTokensMejorScore(indiceLinea, clave) {
  if (!(indiceLinea instanceof Map)) return '';

  const tokens = tokenizarClaveParadaApi(clave);
  if (tokens.length === 0) return '';

  let bestCanonica = '';
  let bestScore = 0;
  let bestMatchCount = 0;

  for (const [k, v] of indiceLinea.entries()) {
    const candTokens = tokenizarClaveParadaApi(k);
    if (candTokens.length === 0) continue;

    const tset = new Set(candTokens);
    let matchCount = 0;
    for (const t of tokens) {
      if (tset.has(t)) matchCount += 1;
    }
    if (matchCount === 0) continue;

    const coverage = matchCount / tokens.length;
    const lengthPenalty = candTokens.length > 0 ? (tokens.length / candTokens.length) : 0;
    const score = coverage * 0.85 + lengthPenalty * 0.15;

    if (score > bestScore || (score === bestScore && matchCount > bestMatchCount)) {
      bestCanonica = v;
      bestScore = score;
      bestMatchCount = matchCount;
    }
  }

  // Para queries muy cortas (1–2 tokens útiles), un umbral alto suele impedir
  // resolver paradas cuando el GeoJSON trae nombres genéricos (ej. "Terminal")
  // pero el JSON de paradas tiene nombres más largos ("Terminal de ... Acceso B").
  // Bajamos el umbral solo en esos casos para evitar falsos negativos.
  const minScore = tokens.length <= 1 ? 0.75 : tokens.length === 2 ? 0.85 : 0.6;
  return bestScore >= minScore ? bestCanonica : '';
}

function resolverCanonicoPorTokensMejorScoreDetallado(indiceLinea, clave) {
  if (!(indiceLinea instanceof Map)) return { canonica: '', score: 0, matchCount: 0, tokensLen: 0 };

  const tokens = tokenizarClaveParadaApi(clave);
  if (tokens.length === 0) return { canonica: '', score: 0, matchCount: 0, tokensLen: 0 };

  let bestCanonica = '';
  let bestScore = 0;
  let bestMatchCount = 0;

  for (const [k, v] of indiceLinea.entries()) {
    const candTokens = tokenizarClaveParadaApi(k);
    if (candTokens.length === 0) continue;

    const tset = new Set(candTokens);
    let matchCount = 0;
    for (const t of tokens) {
      if (tset.has(t)) matchCount += 1;
    }
    if (matchCount === 0) continue;

    const coverage = matchCount / tokens.length;
    const lengthPenalty = candTokens.length > 0 ? (tokens.length / candTokens.length) : 0;
    const score = coverage * 0.85 + lengthPenalty * 0.15;

    if (score > bestScore || (score === bestScore && matchCount > bestMatchCount)) {
      bestCanonica = v;
      bestScore = score;
      bestMatchCount = matchCount;
    }
  }

  return { canonica: bestCanonica, score: bestScore, matchCount: bestMatchCount, tokensLen: tokens.length };
}

function construirIndiceParadasApi(payload) {
  const global = new Map();
  const porLinea = new Map();

  const departamentos = payload?.red_tulum?.departamentos;
  if (!departamentos || typeof departamentos !== 'object') {
    return { global, porLinea };
  }

  for (const dep of Object.values(departamentos)) {
    const lineas = dep?.lineas;
    if (!lineas || typeof lineas !== 'object') continue;

    for (const [lineaCodigo, lineaInfo] of Object.entries(lineas)) {
      const lineaClave = normalizarLineaParaLookup(lineaCodigo);
      if (lineaClave && !porLinea.has(lineaClave)) {
        porLinea.set(lineaClave, new Map());
      }

      // Alias: permitir resolver con o sin variante (A/B/C) sin mezclar
      // cuando la base ya existe como línea propia.
      if (lineaClave) {
        const sinVariante = lineaClave.replace(/([ABC])$/, '');
        if (sinVariante && sinVariante !== lineaClave && !porLinea.has(sinVariante)) {
          porLinea.set(sinVariante, porLinea.get(lineaClave));
        }
      }

      const indiceLinea = lineaClave ? porLinea.get(lineaClave) : null;
      const recorridos = Array.isArray(lineaInfo?.recorridos) ? lineaInfo.recorridos : [];

      for (const rec of recorridos) {
        const paradas = Array.isArray(rec?.paradas) ? rec.paradas : [];
        for (const parada of paradas) {
          registrarParadaCanonicaEnIndice(global, parada);
          registrarParadaCanonicaEnIndice(indiceLinea, parada);
        }
      }
    }
  }

  return { global, porLinea };
}

async function cargarIndiceParadasApi() {
  if (_indiceParadasApi) return _indiceParadasApi;

  try {
    const resp = await fetch(RED_TULUM_PARADAS_URL, { cache: 'force-cache' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const payload = await resp.json();
    _indiceParadasApi = construirIndiceParadasApi(payload);
    return _indiceParadasApi;
  } catch (err) {
    console.warn('No se pudo cargar red_tulum_paradas.json para normalizar paradas:', err);
    _indiceParadasApi = { global: new Map(), porLinea: new Map() };
    return _indiceParadasApi;
  }
}

async function resolverNombreParadaCanonicoParaApi(nombreParada, linea = '') {
  const txt = String(nombreParada || '').trim().replace(/\s+/g, ' ');
  if (!txt) return '';

  const indice = await cargarIndiceParadasApi();
  const clave = crearClaveParadaApi(txt);
  if (!clave) return txt;

  const clavesLinea = obtenerClavesLineaLookup(linea);
  const indicesLineaCandidatos = [];
  for (const lk of clavesLinea) {
    const idxLinea = indice.porLinea.get(lk);
    if (idxLinea instanceof Map) indicesLineaCandidatos.push(idxLinea);
    const canonicaLinea = idxLinea?.get(clave);
    if (canonicaLinea) return canonicaLinea;
  }

  // Fallback: si no hubo match exacto, intentar resolver por tokens dentro
  // de la línea (ayuda con abreviaturas y variantes leves).
  for (const idxLinea of indicesLineaCandidatos) {
    const canonicaTokens = resolverCanonicoPorTokensEnIndice(idxLinea, clave);
    if (canonicaTokens) return canonicaTokens;
  }

  const canonicaGlobal = indice.global.get(clave);
  return canonicaGlobal || txt;
}

async function normalizarNombreParadaParaApi(nombreParada, linea = '') {
  let txt = String(nombreParada || '').trim().replace(/\s+/g, ' ');
  if (!txt) return '';

  const direccion = extraerDireccionDesdeNombreParada(txt);

  // Limpia sufijos de orientación/variante para mejorar matching en backend.
  txt = txt
    .replace(/\s+[SNEO]\s*-\s*[ABC]\s*$/i, '')
    .replace(/\s+[SNEO]\s*$/i, '')
    .replace(/\s*-\s*[ABC]\s*$/i, '')
    .trim();

  // Correcciones puntuales de escritura y normalización de nombres frecuentes.
  txt = txt
    .replace(/\bconmplejo\b/gi, 'complejo')
    .replace(/\bcomplejo\s+universitario\b/gi, 'complejo')
    .replace(/\bavenida\s+ignacio\b/gi, 'Av. Ig.')
    .replace(/\bavenida\b/gi, 'Av.')
    .replace(/\s+/g, ' ')
    .trim();

  txt = await resolverNombreParadaCanonicoParaApi(txt, linea);

  const variante = extraerVarianteDesdeLinea(linea);
  if (variante) {
    const sufijo = direccion ? ` ${direccion} -${variante}` : ` -${variante}`;
    const re = direccion
      ? new RegExp(`\\s${direccion}\\s*-\\s*${variante}$`, 'i')
      : new RegExp(`\\s-\\s*${variante}$`, 'i');
    if (!re.test(txt)) txt = `${txt}${sufijo}`;
  }

  return txt;
}

function formatearHoraDesdeEpochMs(epochMs) {
  const n = Number(epochMs);
  if (!Number.isFinite(n)) return '';
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function normalizarHoraTexto(valor) {
  const txt = String(valor || '').trim();
  if (!txt) return '';

  const hhmmss = txt.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (hhmmss) {
    const hh = String(Number(hhmmss[1])).padStart(2, '0');
    const mm = hhmmss[2];
    return `${hh}:${mm}`;
  }

  if (/^\d{12,}$/.test(txt)) {
    return formatearHoraDesdeEpochMs(Number(txt));
  }

  return '';
}

function recolectarTiempoRealDesdeNodo(nodo, salida) {
  if (!nodo) return;

  if (Array.isArray(nodo)) {
    for (const item of nodo) recolectarTiempoRealDesdeNodo(item, salida);
    return;
  }

  if (typeof nodo !== 'object') return;

  const arrivalsDirectas = nodo?.lineArrivals?.arrivals;
  if (Array.isArray(arrivalsDirectas)) {
    for (const a of arrivalsDirectas) {
      const epochMs = Number(a?.rtEtdUTC ?? a?.staticEtdUTC);
      const hora = formatearHoraDesdeEpochMs(epochMs);
      if (hora) salida.push({ hora, epochMs });
    }
  }

  const arrivalsNodo = nodo?.arrivals;
  if (Array.isArray(arrivalsNodo)) {
    for (const a of arrivalsNodo) {
      const epochMs = Number(a?.rtEtdUTC ?? a?.staticEtdUTC);
      const hora = formatearHoraDesdeEpochMs(epochMs);
      if (hora) salida.push({ hora, epochMs });
    }
  }

  // Soporta estructuras donde las llegadas vienen dentro de `raw`.
  if (nodo.raw != null) {
    recolectarTiempoRealDesdeNodo(nodo.raw, salida);
  }
}

function extraerMensajeDesdePayload(payload) {
  if (payload == null) return '';

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const m = extraerMensajeDesdePayload(item);
      if (m) return m;
    }
    return '';
  }

  if (typeof payload === 'object') {
    const message = payload.message;
    if (typeof message === 'string' && message.trim()) return message.trim();
    if (payload.raw != null) return extraerMensajeDesdePayload(payload.raw);
    return '';
  }

  return '';
}

function extraerHorarioEstimadoDesdePayload(payload, _seen = null) {
  if (payload == null) return '';

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const h = extraerHorarioEstimadoDesdePayload(item, _seen);
      if (h) return h;
    }
    return '';
  }

  if (typeof payload === 'object') {
    const seen = _seen instanceof Set ? _seen : new Set();
    if (seen.has(payload)) return '';
    seen.add(payload);

    const he = payload.horario_estimado;
    if (typeof he === 'string' && he.trim()) return he.trim();
    if (typeof he === 'number' && Number.isFinite(he)) return String(he);

    if (payload.raw != null) {
      const h = extraerHorarioEstimadoDesdePayload(payload.raw, seen);
      if (h) return h;
    }

    for (const v of Object.values(payload)) {
      const h = extraerHorarioEstimadoDesdePayload(v, seen);
      if (h) return h;
    }
  }

  return '';
}

function extraerHorariosDesdePayloadArrivals(payload) {
  const salidaTiempoReal = [];
  const mensajeApi = extraerMensajeDesdePayload(payload);
  const horarioEstimado = extraerHorarioEstimadoDesdePayload(payload);
  recolectarTiempoRealDesdeNodo(payload, salidaTiempoReal);

  if (salidaTiempoReal.length > 0) {
    salidaTiempoReal.sort((a, b) => a.epochMs - b.epochMs);
    const dedup = [];
    const seen = new Set();
    for (const it of salidaTiempoReal) {
      if (seen.has(it.hora)) continue;
      seen.add(it.hora);
      dedup.push(it.hora);
      if (dedup.length >= MAX_HORARIOS_MOSTRAR) break;
    }
    return { horarios: dedup, tipoDatos: 'tiempo_real', mensajeApi, horarioEstimado };
  }

  const esperados = [];
  const pushExpected = (value) => {
    if (value == null) return;

    if (Array.isArray(value)) {
      for (const v of value) pushExpected(v);
      return;
    }

    if (typeof value === 'object') {
      pushExpected(value.horario);
      pushExpected(value.hora);
      pushExpected(value.message);
      pushExpected(value.expected);
      pushExpected(value.arrival);
      pushExpected(value.arrivals);
      pushExpected(value.raw);
      return;
    }

    const hora = normalizarHoraTexto(value);
    if (hora) esperados.push(hora);
  };

  pushExpected(payload);

  if (esperados.length > 0) {
    const dedup = [];
    const seen = new Set();
    for (const h of esperados) {
      if (seen.has(h)) continue;
      seen.add(h);
      dedup.push(h);
      if (dedup.length >= MAX_HORARIOS_MOSTRAR) break;
    }
    return { horarios: dedup, tipoDatos: 'esperado', mensajeApi, horarioEstimado };
  }

  return { horarios: [], tipoDatos: 'esperado', mensajeApi, horarioEstimado };
}

function obtenerCandidatosNombreParada(feature, nombreBase = '') {
  const props = feature?.properties || {};
  const seen = new Set();
  const out = [];
  const add = (value) => {
    const s = typeof value === 'string' ? value.trim() : '';
    if (!s) return;
    const key = s.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);

    // Variante sin sufijos de dirección/variante (-A/-B/-C/-D, N/S/E/O, Norte/Sur/Este/Oeste)
    // para mejorar matching sin depender de esos detalles.
    const base = normalizarNombreParadaSinSufijos(s);
    const keyBase = base ? base.toLowerCase() : '';
    if (base && !seen.has(keyBase)) {
      seen.add(keyBase);
      out.push(base);
    }
  };

  add(nombreBase);
  add(props.name);
  add(props['name:es']);
  add(props.alt_name);
  add(props.official_name);
  add(props.description);
  add(props['addr:street']);
  add(props.ref);
  add(obtenerEtiquetaParada(feature));

  return out;
}

async function resolverParadaDesdeJsonConCandidatos(linea, candidatos) {
  const arr = Array.isArray(candidatos) ? candidatos : [];
  for (const c of arr) {
    const res = await resolverParadaDesdeJson(linea, c);
    if (res?.id_p) return { ...res, paradaInput: c };
  }
  return { id_p: '', paradaResuelta: '', paradaInput: '' };
}

function extraerDireccionYSufijoParada(nombre) {
  const raw = String(nombre || '').trim();
  if (!raw) return { dir: '', var: '' };

  // Dirección: letra suelta al final (N/S/E/O) o palabra completa.
  const mDirLetra = raw.match(/\s([NSEO])\s*(?:-\s*[A-D])?\s*$/i);
  const dir = mDirLetra ? String(mDirLetra[1] || '').toUpperCase() : '';

  // Variante: -A/-B/-C/-D al final.
  const mVar = raw.match(/-\s*([A-D])\s*$/i);
  const vari = mVar ? String(mVar[1] || '').toUpperCase() : '';

  return { dir, var: vari };
}

async function obtenerCandidatosIdParadaParaArrivals(linea, paradaInput, paradaResueltaPreferida) {
  // Devuelve una lista ordenada de { paradaResuelta, id_p } para intentar en la API.
  const out = [];
  const refLinea = String(linea || '').trim();
  if (!refLinea) return out;

  let data = await cargarParadasPorLinea();
  let lk = resolverKeyLineaEnObjeto(data, refLinea);
  if (!lk) {
    data = await cargarParadasPorLinea({ noCache: true });
    lk = resolverKeyLineaEnObjeto(data, refLinea);
  }
  const entry = lk ? data[lk] : null;
  const paradasObj = entry?.paradas && typeof entry.paradas === 'object' ? entry.paradas : {};

  const preferida = String(paradaResueltaPreferida || '').trim();
  const base = normalizarNombreParadaSinSufijos(preferida || paradaInput);
  const baseKey = crearClaveParadaApi(base);
  if (!baseKey) {
    if (preferida && Object.prototype.hasOwnProperty.call(paradasObj, preferida)) {
      out.push({ paradaResuelta: preferida, id_p: String(paradasObj[preferida] || '') });
    }
    return out.filter((c) => Boolean(c.id_p));
  }

  const inputInfo = extraerDireccionYSufijoParada(paradaInput);

  // Recolectar todas las paradas que colisionan por base (ignorando sufijos).
  for (const nombre of Object.keys(paradasObj)) {
    const b = normalizarNombreParadaSinSufijos(nombre);
    const k = crearClaveParadaApi(b);
    if (k && k === baseKey) {
      out.push({ paradaResuelta: nombre, id_p: String(paradasObj[nombre] || '') });
    }
  }

  // Asegurar que la preferida quede primera si existe.
  out.sort((a, b) => {
    const aName = String(a?.paradaResuelta || '');
    const bName = String(b?.paradaResuelta || '');
    if (preferida) {
      const aIsPref = aName === preferida;
      const bIsPref = bName === preferida;
      if (aIsPref !== bIsPref) return aIsPref ? -1 : 1;
    }

    // Luego, priorizar coincidencia de dirección/variante presentes en el input.
    const aInfo = extraerDireccionYSufijoParada(aName);
    const bInfo = extraerDireccionYSufijoParada(bName);
    const aScore = (inputInfo.dir && aInfo.dir === inputInfo.dir ? 2 : 0) + (inputInfo.var && aInfo.var === inputInfo.var ? 1 : 0);
    const bScore = (inputInfo.dir && bInfo.dir === inputInfo.dir ? 2 : 0) + (inputInfo.var && bInfo.var === inputInfo.var ? 1 : 0);
    if (aScore !== bScore) return bScore - aScore;

    // Estable para no “saltar” siempre distinto.
    return aName.localeCompare(bName, 'es');
  });

  // Deduplicar por id_p.
  const seen = new Set();
  const dedup = [];
  for (const c of out) {
    const id = String(c?.id_p || '').trim();
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    dedup.push({ paradaResuelta: String(c.paradaResuelta || '').trim(), id_p: id });
  }

  return dedup;
}

async function consultarArribosApi(linea, paradaNombre, opts = {}) {
  const lineaNorm = String(linea || '').trim();
  const paradaTxt = String(paradaNombre || '').trim();
  if (!lineaNorm || !paradaTxt) {
    return { horarios: [], tipoDatos: 'esperado', paradaConsultada: '' };
  }

  // Normalizar línea para la API (por ejemplo "440A" -> "440").
  const lineaApi = normalizarLineaParaApi(lineaNorm);

  const paradaFeature = opts?.paradaFeature || null;
  const candidatosParada = paradaFeature
    ? obtenerCandidatosNombreParada(paradaFeature, paradaTxt)
    : [paradaTxt];

  const lineaCandidatas = [];
  for (const v of [lineaNorm, lineaApi]) {
    const s = String(v || '').trim();
    if (s && !lineaCandidatas.includes(s)) lineaCandidatas.push(s);
  }

  // Intentar primero con la ref original (permite resolver "TEO 1" -> "TEO1", etc.),
  // probando múltiples candidatos de nombre de parada.
  let url = '';
  let paradaRes = { id_p: '', paradaResuelta: '', paradaInput: '' };

  for (const l of lineaCandidatas) {
    url = url || await resolverUrlDesdeJson(l);
    if (!paradaRes?.id_p) {
      paradaRes = await resolverParadaDesdeJsonConCandidatos(l, candidatosParada);
    }
    if (url && paradaRes?.id_p) break;
  }

  let id_p_resuelto = String(paradaRes?.id_p || '').trim();
  let paradaResueltaFinal = String(paradaRes?.paradaResuelta || '').trim();

  // Información extra de diagnóstico: si el JSON de paradas no cargó o no se encontró
  // la key de la línea, nunca se va a poder resolver id_p.
  let paradasLineaKey = '';
  let paradasLineaCount = 0;
  let paradasObjLinea = {};
  try {
    let dataParadas = await cargarParadasPorLinea();
    paradasLineaKey = resolverKeyLineaEnObjeto(dataParadas, lineaNorm) || resolverKeyLineaEnObjeto(dataParadas, lineaApi) || '';
    let entry = paradasLineaKey ? dataParadas[paradasLineaKey] : null;
    paradasObjLinea = entry?.paradas && typeof entry.paradas === 'object' ? entry.paradas : {};
    paradasLineaCount = Object.keys(paradasObjLinea).length;

    // Si no se resolvió la key o count es 0, reintentar sin cache (JSON puede estar viejo o corrupto en cache)
    if (!paradasLineaKey || paradasLineaCount === 0) {
      dataParadas = await cargarParadasPorLinea({ noCache: true });
      paradasLineaKey = resolverKeyLineaEnObjeto(dataParadas, lineaNorm) || resolverKeyLineaEnObjeto(dataParadas, lineaApi) || '';
      entry = paradasLineaKey ? dataParadas[paradasLineaKey] : null;
      paradasObjLinea = entry?.paradas && typeof entry.paradas === 'object' ? entry.paradas : {};
      paradasLineaCount = Object.keys(paradasObjLinea).length;
    }
  } catch {
    paradasObjLinea = {};
  }

  // Fallback permisivo: si hay URL pero no se resolvió id_p, intentar match por tokens
  // contra todas las paradas de la línea (útil cuando el GeoJSON trae nombres cortos).
  let fallbackScore = 0;
  let fallbackMatchCount = 0;
  if (url && !id_p_resuelto && paradasObjLinea && typeof paradasObjLinea === 'object' && Object.keys(paradasObjLinea).length > 0) {
    const indiceTokens = new Map();
    for (const nombre of Object.keys(paradasObjLinea)) {
      const base = normalizarNombreParadaSinSufijos(nombre);
      const clave = crearClaveParadaApi(base);
      if (clave) indiceTokens.set(clave, nombre);
    }

    let best = { canonica: '', score: 0, matchCount: 0, tokensLen: 0, input: '' };
    for (const c of candidatosParada) {
      const baseQ = normalizarNombreParadaSinSufijos(c);
      const claveQ = crearClaveParadaApi(baseQ);
      const det = resolverCanonicoPorTokensMejorScoreDetallado(indiceTokens, claveQ);
      if (det.score > best.score || (det.score === best.score && det.matchCount > best.matchCount)) {
        best = { ...det, input: String(c || '') };
      }
    }

    // Aceptar si el match es razonable (evitar falsos positivos):
    // - 2+ tokens coincidentes, o cobertura alta; y score mínimo.
    const coverage = best.tokensLen > 0 ? (best.matchCount / best.tokensLen) : 0;
    const ok = (best.matchCount >= 2 || coverage >= 0.67) && best.score >= 0.45;
    if (ok && best.canonica && Object.prototype.hasOwnProperty.call(paradasObjLinea, best.canonica)) {
      id_p_resuelto = String(paradasObjLinea[best.canonica] || '').trim();
      paradaResueltaFinal = String(best.canonica || '').trim();
      fallbackScore = best.score;
      fallbackMatchCount = best.matchCount;
    }
  }

  const debugArrivals = {
    linea: lineaNorm,
    lineaApi,
    lineaCandidatas,
    paradaBase: paradaTxt,
    paradaInput: paradaRes?.paradaInput || '',
    paradaResuelta: paradaResueltaFinal || '',
    url,
    id_p_resuelto: String(id_p_resuelto || ''),
    requestIntentada: false,
    intentos: [],
    candidatosParada: Array.isArray(candidatosParada) ? candidatosParada.slice(0, 8) : [],
    paradasJsonError: _lastParadasPorLineaError,
    urlsJsonError: _lastUrlsPorLineaError,
    paradasLineaKey,
    paradasLineaCount,
    fallbackIdP: fallbackScore > 0 ? { score: fallbackScore, matchCount: fallbackMatchCount } : null,
  };

  if (!url || !id_p_resuelto) {
    console.warn('[arrivals] ERROR: Falta resolver datos antes de fetch', {
      linea: lineaNorm,
      urlOk: Boolean(url),
      urlResuelto: url ? url.substring(0, 80) : '(no encontrada)',
      idPOk: Boolean(id_p_resuelto),
      id_pResuelto: id_p_resuelto,
      paradaBase: paradaTxt,
      paradaResuelta: paradaResueltaFinal || '(no resuelta)',
      lineaCandidatas,
      paradasLineaKey,
      paradasLineaCount,
    });
    return {
      horarios: [],
      headwaySecs: 0,
      tipoDatos: 'error',
      paradaConsultada: paradaResueltaFinal || paradaTxt,
      mensajeApi: !url 
        ? `🔴 No se encontró URL para línea: ${lineaNorm}` 
        : `🔴 No se encontró parada: ${paradaTxt}`,
      apiFallo: true,
      linea: lineaNorm,
      debugArrivals,
    };
  }

  try {
    try {
      const candidatosIdP = await obtenerCandidatosIdParadaParaArrivals(lineaNorm, paradaTxt, paradaResueltaFinal || paradaTxt);
      const listaCandidatos = candidatosIdP.length
        ? candidatosIdP
        : [{ paradaResuelta: paradaResueltaFinal || paradaTxt, id_p: id_p_resuelto }];

      let bestParsed = null;
      let bestScore = -1;
      const maxIntentos = Math.max(1, Math.min(ARRIVALS_MAX_INTENTOS_PARADA, listaCandidatos.length));

      for (let i = 0; i < maxIntentos; i++) {
        const cand = listaCandidatos[i];
        const idTry = String(cand?.id_p || '').trim();
        const paradaTry = String(cand?.paradaResuelta || '').trim();
        if (!idTry) continue;

        // Registrar el intento incluso si el fetch falla antes de responder.
        debugArrivals.intentos.push({
          parada: paradaTry,
          id_p: idTry,
          http: '',
          horariosLen: 0,
          horarioEstimado: '',
          mensajeApi: '',
        });
        const intentoIndex = debugArrivals.intentos.length - 1;

        try {
          try {
            console.debug('[arrivals] POST /arrivals', {
              linea: lineaNorm,
              url: url.substring(0, 100),
              id_p: idTry,
              parada: paradaTry,
              intento: i + 1,
              total: maxIntentos,
              timeout: ARRIVALS_TIMEOUT_MS,
            });
          } catch {
            // noop
          }

          debugArrivals.requestIntentada = true;

          console.debug('[arrivals] Enviando fetch a API', {
            endpoint: ARRIVALS_API_URL,
            url: url.substring(0, 80),
            id_p: idTry,
            payload: { url: url.substring(0, 80), id_p: idTry },
          });

          // Crear AbortController POR FETCH, con timeout individual
          const fetchController = new AbortController();
          const fetchTimeoutId = setTimeout(() => {
            console.warn('[arrivals] Timeout en fetch individual, abortando...');
            try { fetchController.abort(); } catch { /* noop */ }
          }, ARRIVALS_TIMEOUT_MS);

          let resp;
          try {
            resp = await fetch(ARRIVALS_API_URL, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
              },
              body: JSON.stringify({
                url,
                id_p: idTry,
              }),
              cache: 'no-store',
              signal: fetchController.signal,
            });
            clearTimeout(fetchTimeoutId);
            console.debug('[arrivals] Fetch completado, esperando respuesta...');
          } catch (e) {
            clearTimeout(fetchTimeoutId);
            console.error('[arrivals] Error durante fetch (antes de respuesta)', {
              errorName: e?.name,
              errorMessage: e?.message,
              isAbort: e?.name === 'AbortError',
            });
            throw e;
          }

          const httpInfo = resp.ok ? 'ok' : `HTTP ${resp.status}`;
          if (!resp.ok) {
            console.warn('[arrivals] Response error HTTP', {
              status: resp.status,
              statusText: resp.statusText,
              linea: lineaNorm,
              id_p: idTry,
            });
            debugArrivals.intentos[intentoIndex] = { ...debugArrivals.intentos[intentoIndex], http: httpInfo, error: httpInfo };
            continue;
          }

          const payload = await resp.json();
          console.debug('[arrivals] Respuesta recibida', {
            linea: lineaNorm,
            id_p: idTry,
            payloadKeys: Object.keys(payload),
            horariosLen: payload?.horarios?.length || 0,
            tieneHorarioEstimado: !!payload?.horario_estimado,
          });
          const parsed = extraerHorariosDesdePayloadArrivals(payload);

          const horariosArr = Array.isArray(parsed?.horarios) ? parsed.horarios : [];
          const horarioEstimado = typeof parsed?.horarioEstimado === 'string' ? parsed.horarioEstimado.trim() : '';
          const mensajeApi = typeof parsed?.mensajeApi === 'string' ? parsed.mensajeApi.trim() : '';

          debugArrivals.intentos[intentoIndex] = {
            ...debugArrivals.intentos[intentoIndex],
            http: httpInfo,
            horariosLen: horariosArr.length,
            horarioEstimado,
            mensajeApi,
          };

          const score = (horariosArr.length * 100) + (horarioEstimado ? 10 : 0) + (mensajeApi ? 5 : 0);
          if (score > bestScore) {
            bestScore = score;
            bestParsed = { ...parsed, paradaConsultada: paradaTry || paradaResuelta || paradaTxt };
          }

          // Si encontramos horarios concretos, nos quedamos con este intento.
          if (horariosArr.length > 0) break;
        } catch (errTry) {
          const msg = (errTry && String(errTry.name) === 'AbortError')
            ? 'AbortError'
            : (errTry?.message ? String(errTry.message) : String(errTry));
          console.error('[arrivals] ERROR en fetch/parse', {
            errorName: errTry?.name,
            errorMessage: msg,
            linea: lineaNorm,
            id_p: idTry,
            intento: i + 1,
          });
          debugArrivals.intentos[intentoIndex] = { ...debugArrivals.intentos[intentoIndex], error: msg };
          if (errTry && String(errTry.name) === 'AbortError') throw errTry;
        }
      }

      if (!bestParsed) {
        console.error('[arrivals] No se pudo obtener respuesta exitosa de API', {
          linea: lineaNorm,
          intentosTotales: debugArrivals.intentos.length,
          paradasIntentadas: debugArrivals.intentos.map(it => `${it.parada || 'unknown'} (${it.id_p})`),
        });
        return {
          horarios: [],
          headwaySecs: 0,
          tipoDatos: 'error',
          paradaConsultada: paradaResueltaFinal || paradaTxt,
          mensajeApi: '🔴 No se pudo obtener datos de la API de arrivals',
          apiFallo: true,
          linea: lineaNorm,
          debugArrivals,
        };
      }

      const horariosArr = Array.isArray(bestParsed?.horarios) ? bestParsed.horarios : [];
      const horarioEstimado = typeof bestParsed?.horarioEstimado === 'string' ? bestParsed.horarioEstimado.trim() : '';
      const mensajeApi = typeof bestParsed?.mensajeApi === 'string' ? bestParsed.mensajeApi.trim() : '';

      // Si la API responde pero viene sin datos (arrivals vacío) y tampoco aporta
      // un horario estimado o mensaje aprovechable, mostramos horarios aproximados.
      if (horariosArr.length === 0 && !horarioEstimado && !mensajeApi) {
        return {
          ...bestParsed,
          horarios: [],
          headwaySecs: 0,
          tipoDatos: 'error',
          mensajeApi: 'No hay datos de arrivals disponibles',
          apiFallo: true,
          linea: lineaNorm,
          paradaConsultada: bestParsed.paradaConsultada || paradaResueltaFinal || paradaTxt,
          debugArrivals,
        };
      }

      return { ...bestParsed, debugArrivals };
    } finally {
      // Limpieza general (ya no se usan AbortControllers globales)
    }
  } catch (err) {
    console.warn('No se pudo consultar arrivals API:', err);
    const msgAbort = (err && String(err.name) === 'AbortError') ? 'Tiempo de espera agotado al consultar arrivals API.' : 'Error consultando arrivals API.';
    return {
      horarios: [],
      headwaySecs: 0,
      tipoDatos: 'error',
      paradaConsultada: paradaResueltaFinal || paradaTxt,
      mensajeApi: msgAbort,
      apiFallo: true,
      linea: lineaNorm,
      debugArrivals,
    };
  }
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
function renderHorariosLlegada(horarios, lineaRef, lineaNombre, headwaySecs = 0, mostrarVolverParada = false, opts = {}) {
  const titulo = lineaRef ? `Línea ${escapeHtml(lineaRef)}` : 'Línea';
  const detalle = lineaNombre ? ` — ${escapeHtml(lineaNombre)}` : '';
  const headwayMins = headwaySecs > 0 ? Math.round(headwaySecs / 60) : 0;
  const tipoDatos = opts?.tipoDatos === 'tiempo_real' ? 'tiempo_real' : (opts?.tipoDatos === 'error' ? 'error' : 'esperado');
  const apiFallo = Boolean(opts?.apiFallo);
  const esTiempoReal = tipoDatos === 'tiempo_real';
  const esError = tipoDatos === 'error';
  const colorPrincipal = esTiempoReal ? '#1E8E3E' : '#007BFF';
  const subtituloProximo = esTiempoReal ? '🟢 Tiempo real' : '⏱ Horario esperado';
  const textoPie = esTiempoReal
    ? 'Datos en tiempo real obtenidos desde arrivals API'
    : 'Horarios esperados obtenidos desde arrivals API';
  const mensajeApi = typeof opts?.mensajeApi === 'string' ? opts.mensajeApi.trim() : '';
  const horarioEstimado = typeof opts?.horarioEstimado === 'string' ? opts.horarioEstimado.trim() : '';

  const volverHtml = mostrarVolverParada
    ? '<ul class="bs-nav-rows"><li><button type="button" class="btn-nav-row" data-volver-parada="1">← Volver a líneas de la parada</button></li></ul>'
    : '';

  const paradaInfoHtml = opts?.paradaConsultada
    ? `<p style="margin: 0 0 8px 0; font-size: 12px; color: var(--text-muted, #777);">Parada: ${escapeHtml(opts.paradaConsultada)}</p>`
    : '';

  // Si falló la API, mostrar mensaje de error
  if (esError && apiFallo) {
    return `
      ${volverHtml}
      <p style="margin: 0 0 14px 0; font-size: 16px; color: var(--text-primary, #333); font-weight: 600;">${titulo}</p>
      ${paradaInfoHtml}
      <div style="
        padding: 16px 14px;
        border-radius: 10px;
        background: rgba(220, 38, 38, 0.08);
        border: 1px solid rgba(220, 38, 38, 0.3);
        margin: 12px 0;
      ">
        <p style="margin: 0 0 8px 0; font-size: 14px; color: var(--text-primary, #333); font-weight: 600;">❌ Fallo en la consulta de API</p>
        <p style="margin: 0; font-size: 13px; color: var(--text-secondary, #666);">${escapeHtml(mensajeApi)}</p>
      </div>
      <p style="margin: 12px 0 0 0; font-size: 12px; color: var(--text-muted, #aaa); text-align: center;">Por favor, intenta de nuevo en unos momentos.</p>
    `;
  }

  const mensajeMinMatch = mensajeApi.match(/^\s*(\d+)\s*min(?:utos?)?\s*$/i);
  const mensajeHoraMatch = mensajeApi.match(/^\s*(\d{1,2}:\d{2})\s*$/);
  const mensajeComoLlegadaHtml = mensajeMinMatch
    ? `
      <li style="
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 16px 14px;
        border-radius: 10px;
        background: rgba(30,142,62,0.10);
        border: 1px solid rgba(30,142,62,0.35);
        margin-bottom: 10px;
      ">
        <span style="font-size: 36px; font-weight: 700; color: #1E8E3E; min-width: 70px;">${escapeHtml(mensajeApi)}</span>
        <span style="font-size: 13px; color: var(--text-secondary, #888);">🟢 Próxima llegada</span>
      </li>
    `
    : (mensajeHoraMatch
      ? `
        <li style="
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 16px 14px;
          border-radius: 10px;
          background: rgba(120,120,120,0.10);
          border: 1px solid rgba(120,120,120,0.35);
          margin-bottom: 10px;
        ">
          <span style="font-size: 36px; font-weight: 700; color: #5f6368; min-width: 70px;">${escapeHtml(mensajeHoraMatch[1])}</span>
          <span style="font-size: 13px; color: var(--text-secondary, #888);">⏱ Horario esperado</span>
        </li>
      `
      : '');

  const estimadoMinMatch = horarioEstimado.match(/^\s*(\d+)\s*min(?:utos?)?\s*$/i);
  const estimadoHoraMatch = horarioEstimado.match(/^\s*(\d{1,2}:\d{2})\s*$/);
  const estimadoComoLlegadaHtml = estimadoMinMatch
    ? `
      <li style="
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 16px 14px;
        border-radius: 10px;
        background: rgba(120,120,120,0.10);
        border: 1px solid rgba(120,120,120,0.35);
        margin-bottom: 10px;
      ">
        <span style="font-size: 36px; font-weight: 700; color: #5f6368; min-width: 70px;">${escapeHtml(horarioEstimado)}</span>
        <span style="font-size: 13px; color: var(--text-secondary, #888);">⏱ Estimado</span>
      </li>
    `
    : (estimadoHoraMatch
      ? `
        <li style="
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 16px 14px;
          border-radius: 10px;
          background: rgba(120,120,120,0.10);
          border: 1px solid rgba(120,120,120,0.35);
          margin-bottom: 10px;
        ">
          <span style="font-size: 36px; font-weight: 700; color: #5f6368; min-width: 70px;">${escapeHtml(estimadoHoraMatch[1])}</span>
          <span style="font-size: 13px; color: var(--text-secondary, #888);">⏱ Estimado</span>
        </li>
      `
      : '');


  // Bloque de anuncios (igual que en el spinner y lista de líneas)
  const adsHtml = `<div class="tsj-ad-slot" data-tsj-ads-placeholder="da8bd74959eaf231b990a00938209088"></div>`;

  if (!horarios || horarios.length === 0) {
    if (mensajeComoLlegadaHtml) {
      return `
        ${volverHtml}
        <p style="margin-bottom: 12px; font-size: 16px; color: var(--text-primary, #333); font-weight: 600;">${titulo}</p>
        ${paradaInfoHtml}
        <h4 style="margin: 0 0 14px 0; font-size: 18px; font-weight: 700; color: var(--text-primary, #222); text-transform: uppercase; letter-spacing: 0.5px;">🚌 Próximas llegadas</h4>
        <ul style="list-style: none; padding: 0; margin: 0;">${mensajeComoLlegadaHtml}</ul>
        ${adsHtml}
        <p style="margin: 14px 0 0 0; font-size: 11px; color: var(--text-muted, #aaa); text-align: center;">${textoPie}</p>
      `;
    }

    if (estimadoComoLlegadaHtml) {
      return `
        ${volverHtml}
        <p style="margin-bottom: 12px; font-size: 16px; color: var(--text-primary, #333); font-weight: 600;">${titulo}</p>
        ${paradaInfoHtml}
        <h4 style="margin: 0 0 14px 0; font-size: 18px; font-weight: 700; color: var(--text-primary, #222); text-transform: uppercase; letter-spacing: 0.5px;">🚌 Próximas llegadas</h4>
        <ul style="list-style: none; padding: 0; margin: 0;">${estimadoComoLlegadaHtml}</ul>
        ${adsHtml}
        <p style="margin: 14px 0 0 0; font-size: 11px; color: var(--text-muted, #aaa); text-align: center;">${textoPie}</p>
      `;
    }

    return `
      ${volverHtml}
      <p style="margin-bottom: 12px; font-size: 16px; color: var(--text-primary, #333); font-weight: 600;">${titulo}</p>
      ${paradaInfoHtml}
      ${adsHtml}
      <p style="font-size: 14px; color: var(--text-muted, #999); text-align: center; padding: 14px 0;">Sin datos de horarios disponibles.</p>
    `;
  }

  const itemsHorarios = horarios.map((h, i) => {
    const esProximo = i === 0;
    const subtitulo = esProximo
      ? subtituloProximo
      : headwayMins > 0
        ? `En ~${headwayMins * i} min`
        : '';
    return `
      <li style="
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 16px 14px;
        border-radius: 10px;
        background: ${esProximo ? (esTiempoReal ? 'rgba(30,142,62,0.10)' : 'rgba(0,123,255,0.08)') : 'transparent'};
        border: 1px solid ${esProximo ? (esTiempoReal ? 'rgba(30,142,62,0.35)' : 'rgba(0,123,255,0.25)') : 'rgba(0,0,0,0.07)'};
        margin-bottom: 10px;
      ">
        <span style="font-size: 32px; font-weight: 700; color: ${esProximo ? colorPrincipal : 'var(--text-primary, #333)'}; min-width: 70px;">${escapeHtml(h)}</span>
        <span style="font-size: 13px; color: var(--text-secondary, #888);">${subtitulo}</span>
      </li>
    `;
  }).join('');

  const items = `${mensajeComoLlegadaHtml}${itemsHorarios}`;

  return `
    ${volverHtml}
    <p style="margin: 0 0 14px 0; font-size: 16px; color: var(--text-primary, #333); font-weight: 600;">${titulo}</p>
    ${paradaInfoHtml}
    <h4 style="margin: 0 0 14px 0; font-size: 18px; font-weight: 700; color: var(--text-primary, #222); text-transform: uppercase; letter-spacing: 0.5px;">🚌 Próximas llegadas</h4>
    <ul style="list-style: none; padding: 0; margin: 0;">${items}</ul>
    ${adsHtml}
    <p style="margin: 14px 0 0 0; font-size: 11px; color: var(--text-muted, #aaa); text-align: center;">${textoPie}</p>
  `;
}

function renderEstadoCargaArribos(lineaRef, lineaNombre) {
  const titulo = lineaRef ? `Línea ${escapeHtml(lineaRef)}` : 'Línea';
  const detalle = lineaNombre ? ` — ${escapeHtml(lineaNombre)}` : '';
  return `
    <div class="bottom-sheet-loading" role="status" aria-live="polite" aria-busy="true">
      <div class="bottom-sheet-loading-spinner" aria-hidden="true"></div>
      <p class="bottom-sheet-loading-title">Consultando arribos...</p>
      <p class="bottom-sheet-loading-subtitle">${titulo}${detalle}</p>
      <div class="tsj-ad-slot" ${TSJ_ADS_PLACEHOLDER_ATTR}="${TSJ_ADS_TOKEN}"></div>
    </div>
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

  let rutas = obtenerRutasDeLinea(data, ref);
  if (!rutas.length) {
    const refBase = normalizarLineaParaApi(ref);
    if (refBase && refBase !== ref) {
      rutas = obtenerRutasDeLinea(data, refBase);
    }
  }
  if (!rutas.length) {
    const tituloLinea = ref ? `Línea ${escapeHtml(ref)}` : (name ? escapeHtml(name) : 'Línea');
    abrirBottomSheet(tituloLinea, `<p>No se encontró el recorrido para esta línea.</p>`);
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
    abrirBottomSheet(`Línea ${escapeHtml(ref)}`, renderEstadoCargaArribos(ref, name), 'linea');

    const paradaNombreBase = obtenerNombreParadaBase(paradaOrigen);
    const arrivalsResp = await consultarArribosApi(ref, paradaNombreBase, { paradaFeature: paradaOrigen, rutas });
    const html = renderHorariosLlegada(
      arrivalsResp.horarios,
      ref,
      name,
      Number(arrivalsResp.headwaySecs) > 0 ? Number(arrivalsResp.headwaySecs) : 0,
      true,
      {
        tipoDatos: arrivalsResp.tipoDatos,
        apiFallo: Boolean(arrivalsResp.apiFallo),
        paradaConsultada: arrivalsResp.paradaConsultada,
        mensajeApi: arrivalsResp.mensajeApi,
        horarioEstimado: arrivalsResp.horarioEstimado,
        debugArrivals: arrivalsResp.debugArrivals,
      }
    );
    abrirBottomSheet(`Línea ${escapeHtml(ref)}`, html, 'linea');
  } else {
    // Sin parada de origen: mostrar recorrido con paradas (comportamiento anterior)
    const tituloLinea = ref ? `Línea ${escapeHtml(ref)}` : (name ? escapeHtml(name) : 'Línea');
    const listaParadasHtml = renderListaParadasRecorrido({ mostrarTodas: true });
    const html = `
      ${listaParadasHtml}
    `;
    abrirBottomSheet(tituloLinea, html, 'linea');
  }
}

function mostrarLineasEnContenedorParadas(feature) {
  const lineas = obtenerLineasDetalleDesdeRelations(feature);
  if (!lineas.length) {
    abrirBottomSheet('Parada', '<p>No hay líneas disponibles para esta parada.</p>');
    return;
  }

  // Obtener nombre de la parada desde el feature
  const paradaNombre = feature?.properties?.name || feature?.properties?.['name:es'] || 'Parada desconocida';

  const itemsHtml = lineas
    .map((l) => {
      const ref = l.ref ? escapeHtml(l.ref) : (l.name ? escapeHtml(l.name) : 'Línea');
      const name = l.name ? escapeHtml(l.name) : '';
      const refAttr = escapeHtml(l.ref || '');
      const nameAttr = escapeHtml(l.name || '');
      const nameDisplay = name ? `<span class="linea-button-name">${name}</span>` : '';
      return `<li><button type="button" class="btn-linea" data-linea-ref="${refAttr}" data-linea-name="${nameAttr}"><span class="linea-button-ref">${ref}</span>${nameDisplay}</button></li>`;
    })
    .join('');

  const listaParadasHtml = recorridoActivo ? renderListaParadasRecorrido() : '';
  
  const html = `
    <ul class="lineas-list">${itemsHtml}</ul>
    <div class="tsj-ad-slot" ${TSJ_ADS_PLACEHOLDER_ATTR}="${TSJ_ADS_TOKEN}"></div>
    ${listaParadasHtml}
  `;
  window._currentFeature = feature;
  abrirBottomSheet(escapeHtml(paradaNombre), html, 'parada');
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

    asegurarMarcadorUsuario(coords.lat, coords.lng);
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

  asegurarMarcadorUsuario(coords.lat, coords.lng);

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
    document.querySelector('.search-bar-container')?.classList.add('is-open');
    posicionarModalBusqueda();
    const input = document.getElementById('search-input');
    input?.focus();
    const q = String(input?.value || '').trim();
    if (!q) renderHistorialBusqueda();
  }
}

const STORAGE_SEARCH_HISTORY_KEY = 'transitsj_search_history_v1';
const MAX_SEARCH_HISTORY = 5;

function obtenerHistorialBusqueda() {
  const arr = leerJsonLocalStorage(STORAGE_SEARCH_HISTORY_KEY, []);
  return Array.isArray(arr) ? arr : [];
}

function guardarHistorialBusqueda(arr) {
  guardarJsonLocalStorage(STORAGE_SEARCH_HISTORY_KEY, Array.isArray(arr) ? arr : []);
}

function claveHistorialBusqueda(entry) {
  const tipo = String(entry?.tipo || '').toLowerCase();
  if (tipo === 'linea') {
    const ref = String(entry?.ref || '').trim();
    return ref ? `linea:${ref}` : 'linea:?';
  }
  const lat = Number(entry?.lat);
  const lng = Number(entry?.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return `calle:${lat.toFixed(6)},${lng.toFixed(6)}`;
  const nombre = String(entry?.nombre || '').trim();
  return `calle:${nombre.toLowerCase()}`;
}

function agregarAHistorialBusqueda(entry) {
  if (!entry) return;
  const tipo = String(entry?.tipo || '').toLowerCase();
  if (tipo !== 'linea' && tipo !== 'calle') return;

  const next = obtenerHistorialBusqueda();
  const key = claveHistorialBusqueda(entry);
  const sinDup = next.filter((x) => claveHistorialBusqueda(x) !== key);
  sinDup.unshift({
    tipo,
    ref: tipo === 'linea' ? String(entry?.ref || '').trim() : undefined,
    name: tipo === 'linea' ? String(entry?.name || '').trim() : undefined,
    nombre: tipo === 'calle' ? String(entry?.nombre || '').trim() : undefined,
    lat: Number.isFinite(Number(entry?.lat)) ? Number(entry?.lat) : undefined,
    lng: Number.isFinite(Number(entry?.lng)) ? Number(entry?.lng) : undefined,
    ts: Date.now(),
  });

  while (sinDup.length > MAX_SEARCH_HISTORY) sinDup.pop();
  guardarHistorialBusqueda(sinDup);
}

function renderHistorialBusqueda() {
  const resultsDiv = document.getElementById('search-results');
  if (!resultsDiv) return;

  const hist = obtenerHistorialBusqueda()
    .filter(Boolean)
    .slice(0, MAX_SEARCH_HISTORY);

  if (!hist.length) {
    resultsDiv.innerHTML = '<p class="search-results-hint">Escribe para buscar</p>';
    return;
  }

  resultsDiv.innerHTML = '';
  const hint = document.createElement('p');
  hint.className = 'search-results-hint';
  hint.textContent = 'Búsquedas recientes';
  resultsDiv.appendChild(hint);

  for (const item of hist) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'search-result-item';

    const tipo = String(item?.tipo || '').toLowerCase();
    if (tipo === 'linea') {
      const ref = String(item?.ref || '').trim();
      const name = String(item?.name || '').trim();
      if (!ref) continue;

      btn.dataset.resultType = 'linea';
      btn.dataset.lineaRef = ref;
      btn.dataset.lineaName = name;
      if (Number.isFinite(Number(item?.lat)) && Number.isFinite(Number(item?.lng))) {
        btn.dataset.lat = String(Number(item.lat));
        btn.dataset.lng = String(Number(item.lng));
      }

      const title = document.createElement('div');
      title.className = 'search-result-item-title';
      title.textContent = `Línea ${ref}`;

      btn.appendChild(title);
      resultsDiv.appendChild(btn);
      continue;
    }

    const nombre = String(item?.nombre || '').trim() || 'Calle';
    const lat = Number(item?.lat);
    const lng = Number(item?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    btn.dataset.resultType = 'calle';
    btn.dataset.lat = String(lat);
    btn.dataset.lng = String(lng);
    btn.dataset.nombre = nombre;

    const title = document.createElement('div');
    title.className = 'search-result-item-title';
    title.textContent = nombre;

    btn.appendChild(title);
    resultsDiv.appendChild(btn);
  }
}

function cerrarModalBusqueda() {
  const modal = document.getElementById('search-modal');
  if (modal) {
    modal.classList.remove('active');
  }
  document.querySelector('.search-bar-container')?.classList.remove('is-open');
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

      btn.appendChild(title);
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

    btn.appendChild(title);
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
    // Mostrar historial cuando no hay texto
    if (modal && !modal.classList.contains('active')) modal.classList.add('active');
    document.querySelector('.search-bar-container')?.classList.add('is-open');
    posicionarModalBusqueda();
    renderHistorialBusqueda();
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
  document.querySelector('.search-bar-container')?.classList.add('is-open');
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

// Abrir modal con historial al tocar la barra (sin texto)
const searchInputEl = document.getElementById('search-input');
if (searchInputEl) {
  const openIfNeeded = () => {
    const q = String(searchInputEl.value || '').trim();
    const modal = document.getElementById('search-modal');
    if (!modal) return;
    if (!modal.classList.contains('active')) modal.classList.add('active');
    document.querySelector('.search-bar-container')?.classList.add('is-open');
    posicionarModalBusqueda();
    if (!q) {
      renderHistorialBusqueda();
    } else if (q.length >= SEARCH_MIN_CHARS) {
      void buscarLugares(q);
    }
  };

  // En móvil, abrir en touchstart puede hacer que el mismo tap termine cerrando el modal.
  // Abrimos en focus/click, y en click lo diferimos un tick para evitar carreras con el tap.
  searchInputEl.addEventListener('focus', openIfNeeded);
  searchInputEl.addEventListener('click', () => setTimeout(openIfNeeded, 0));
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

      agregarAHistorialBusqueda({
        tipo: 'linea',
        ref,
        name,
        lat: btn.dataset.lat ? Number(btn.dataset.lat) : undefined,
        lng: btn.dataset.lng ? Number(btn.dataset.lng) : undefined,
      });

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

    agregarAHistorialBusqueda({ tipo: 'calle', nombre: String(nombre || '').trim(), lat, lng });
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
  // Pegado a la barra: que parezca una extensión (sin hueco)
  const top = Math.max(viewportMargin, rect.bottom - 1);
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

function estimarTiempoTotalSegundos({ dO, dD, rideDist, waitSecs }) {
  const walkSecs = (Number(dO) + Number(dD)) / WALKING_SPEED_M_S;
  const rideSecs = Number(rideDist) / BUS_SPEED_M_S;
  const wait = Number(waitSecs);
  const total = walkSecs + rideSecs + (Number.isFinite(wait) ? wait : 0);
  return Number.isFinite(total) ? total : Infinity;
}

async function verLineaMasCercanaDesdeActualHastaDestino(latDestino, lngDestino, nombreDestino = '', allowedRefs = null, origenOverride = null) {
  if (!leafletMap || typeof L === 'undefined') return;

  const latD = Number(latDestino);
  const lngD = Number(lngDestino);
  if (!Number.isFinite(latD) || !Number.isFinite(lngD)) return;

  let latO = NaN;
  let lngO = NaN;

  // Permite dibujar un tramo desde un origen alternativo (ej. trasbordo)
  if (origenOverride && typeof origenOverride === 'object') {
    latO = Number(origenOverride.lat);
    lngO = Number(origenOverride.lng);
  }

  // Si no hay override válido, usar ubicación actual
  if (!Number.isFinite(latO) || !Number.isFinite(lngO)) {
    if (!ubicacion || !Number.isFinite(ubicacion.lat) || !Number.isFinite(ubicacion.lng)) {
      try {
        const position = await obtenerPosicionActual();
        ubicacion = { lat: position.coords.latitude, lng: position.coords.longitude };
      } catch {
        alert('No se pudo obtener tu ubicación actual.');
        return;
      }
    }
    latO = Number(ubicacion.lat);
    lngO = Number(ubicacion.lng);
  }

  if (!Number.isFinite(latO) || !Number.isFinite(lngO)) return;

  const data = await cargarParadasGeojson();
  if (!data || !Array.isArray(data.features)) return;

  const allowedSet = Array.isArray(allowedRefs) && allowedRefs.length
    ? new Set(allowedRefs.map((r) => String(r)))
    : null;

  // Buscar la ruta (línea) con menor TIEMPO estimado (caminar + viaje).
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

    const scoreSecs = estimarTiempoTotalSegundos({ dO, dD, rideDist, waitSecs: 0 });

    if (!mejor || scoreSecs < mejor.scoreSecs) {
      const name = typeof props.name === 'string' ? props.name.trim() : '';
      mejor = { ref, name, scoreSecs, dO, dD, iO, iD, rideDist, waitSecs: 0 };
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
  recorridoActivo = {
    ref: mejor.ref,
    name: mejor.name,
    planned: true,
    origen: { lat: latO, lng: lngO },
    destino: { lat: latD, lng: lngD, nombre: String(nombreDestino || '') },
    relIds: null,
    nearbyStops: [],
  };

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
    if (recorridoActivo) recorridoActivo.relIds = relIds;
    if (relIds && relIds.size > 0) {
      // En planeo de ruta: mostrar paradas cercanas al origen (usuario o trasbordo)
      const seleccion = await dibujarParadasDeLineaCercanasAlOrigen(relIds, latO, lngO, mejor.ref, mejor.name);
      if (recorridoActivo && Array.isArray(seleccion)) recorridoActivo.nearbyStops = seleccion;
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

function setPlaneoParadasIndex(stops) {
  const map = new Map();
  for (const s of Array.isArray(stops) ? stops : []) {
    const paradaId = String(s?.paradaId || '').trim();
    if (!paradaId) continue;
    if (!map.has(paradaId)) {
      map.set(paradaId, { feature: s.feature, lat: s.lat, lng: s.lng });
    }
  }
  _planeoParadasIndex = map;
}

function normalizarParadasSeleccionParaLista(seleccion, lineaRef, lineaName) {
  const ref = String(lineaRef || '').trim();
  const name = String(lineaName || '').trim();
  const out = [];
  for (const p of Array.isArray(seleccion) ? seleccion : []) {
    const paradaId = obtenerIdParada(p.feature);
    if (!paradaId) continue;
    const etiqueta = obtenerNombreParadaBase(p.feature);
    out.push({
      paradaId,
      feature: p.feature,
      lat: p.lat,
      lng: p.lng,
      etiqueta,
      lineaRef: ref,
      lineaName: name,
    });
  }
  return out;
}

function renderListaParadasPlaneo({ tituloIzq = 'Paradas cercanas', stops = [], totalLabel = '' } = {}) {
  const total = Array.isArray(stops) ? stops.length : 0;
  const right = totalLabel ? escapeHtml(String(totalLabel)) : `${total}`;
  const left = escapeHtml(String(tituloIzq || 'Paradas'));

  const items = (Array.isArray(stops) ? stops : [])
    .map((p) => {
      const paradaId = p.paradaId || obtenerIdParada(p.feature);
      const etiqueta = p.etiqueta || obtenerEtiquetaParada(p.feature);
      const lineaRef = p.lineaRef || '';
      const lineaName = p.lineaName || '';
      const refLabel = lineaRef ? `Línea ${String(lineaRef)}` : 'Línea';
      const nameLabel = lineaName ? ` — ${String(lineaName)}` : '';
      return `<li><button type="button" class="btn-linea btn-parada-planeo" data-plane-stop-id="${escapeHtml(String(paradaId))}" data-plane-line-ref="${escapeHtml(String(lineaRef))}" data-plane-line-name="${escapeHtml(String(lineaName))}"><span class="linea-button-ref">${escapeHtml(String(etiqueta))}</span><span class="linea-button-name">${escapeHtml(refLabel + nameLabel)}</span></button></li>`;
    })
    .join('');

  return `
    <div class="recorrido-indice">
      <span class="recorrido-indice-left">${left}</span>
      <span class="recorrido-indice-right">${right}</span>
    </div>
    <ul class="lineas-list planeo-paradas-list">${items}</ul>
  `;
}

function mostrarParadasPlaneoActualEnBottomSheet({ ref, name } = {}) {
  const lineaRef = String(ref || recorridoActivo?.ref || '').trim();
  const lineaName = String(name || recorridoActivo?.name || '').trim();
  const seleccion = recorridoActivo?.planned ? (recorridoActivo?.nearbyStops || []) : [];

  const stops = normalizarParadasSeleccionParaLista(seleccion, lineaRef, lineaName);
  setPlaneoParadasIndex(stops);

  const subtitulo = lineaRef ? `Línea ${lineaRef}${lineaName ? ` — ${lineaName}` : ''}` : '';
  const html = stops.length
    ? `${renderListaParadasPlaneo({ tituloIzq: 'Paradas cercanas', stops, totalLabel: `${stops.length} paradas` })}
       <p style="margin: 14px 0 0 0; font-size: 12px; color: var(--text-muted, #888); text-align: center;">Tocá una parada para ver arribos.</p>`
    : `<p style="margin: 0; font-size: 14px; color: var(--text-secondary, #666); text-align: center;">No se encontraron paradas cercanas para esta línea.</p>`;

  abrirBottomSheet('Ruta', html, '', subtitulo);
}

function mostrarParadasPlaneadasEnBottomSheet() {
  if (!recorridoActivo || !recorridoActivo.planned) return;

  if (recorridoActivo.mode === 'transfer' && Array.isArray(recorridoActivo.legs) && recorridoActivo.legs.length >= 2) {
    const leg1 = recorridoActivo.legs[0] || {};
    const leg2 = recorridoActivo.legs[1] || {};
    const aRef = String(leg1.ref || '').trim();
    const bRef = String(leg2.ref || '').trim();
    const stops1 = normalizarParadasSeleccionParaLista(leg1.nearbyStops || [], aRef, String(leg1.name || ''));
    const stops2 = normalizarParadasSeleccionParaLista(leg2.nearbyStops || [], bRef, String(leg2.name || ''));
    setPlaneoParadasIndex([...stops1, ...stops2]);

    const tName = String(recorridoActivo.transferName || '').trim();
    const subtitulo = tName ? `Trasbordo en: ${tName}` : '';
    const html = `
      <p style="margin: 0 0 10px 0; font-size: 17px; font-weight: 900; color: var(--text-primary, #222); text-align: center;">Opción con trasbordo</p>
      <p style="margin: 0 0 14px 0; font-size: 12px; color: var(--text-muted, #888); text-align: center;">Tocá una parada para ver arribos.</p>
      <p style="margin: 0 0 8px 0; font-size: 17px; font-weight: 900; color: var(--text-primary, #222); text-align: center;">Tramo 1 — Línea ${escapeHtml(aRef)}</p>
      ${stops1.length ? renderListaParadasPlaneo({ tituloIzq: 'Paradas cercanas', stops: stops1, totalLabel: `${stops1.length} paradas` }) : '<p style="margin:0 0 12px 0; font-size:14px; color: var(--text-secondary,#666); text-align:center;">Sin paradas cercanas para el tramo 1.</p>'}
      <p style="margin: 16px 0 8px 0; font-size: 17px; font-weight: 900; color: var(--text-primary, #222); text-align: center;">Tramo 2 — Línea ${escapeHtml(bRef)}</p>
      ${stops2.length ? renderListaParadasPlaneo({ tituloIzq: 'Paradas cercanas', stops: stops2, totalLabel: `${stops2.length} paradas` }) : '<p style="margin:0; font-size:14px; color: var(--text-secondary,#666); text-align:center;">Sin paradas cercanas para el tramo 2.</p>'}
    `;
    abrirBottomSheet('Ruta', html, '', subtitulo);
    return;
  }

  // Directa
  mostrarParadasPlaneoActualEnBottomSheet({ ref: recorridoActivo.ref, name: recorridoActivo.name });
}

async function elegirMejorRutaFeatureEntre(latO, lngO, latD, lngD, allowedRefs) {
  const data = await cargarParadasGeojson();
  if (!data || !Array.isArray(data.features)) return null;

  const allowedSet = Array.isArray(allowedRefs) && allowedRefs.length
    ? new Set(allowedRefs.map((r) => String(r).trim()).filter(Boolean))
    : null;

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

    const scoreSecs = estimarTiempoTotalSegundos({ dO, dD, rideDist, waitSecs: 0 });
    if (!mejor || scoreSecs < mejor.scoreSecs) {
      const name = typeof props.name === 'string' ? props.name.trim() : '';
      mejor = { ref, name, scoreSecs, dO, dD, iO, iD, rideDist };
      mejorFeature = f;
    }
  }

  if (!mejor || !mejorFeature) return null;
  return { mejor, feature: mejorFeature };
}

function calcularTramoRecortado(latO, lngO, latD, lngD, feature, mejor) {
  const latLngs = extraerLatLngsDeGeometria(feature?.geometry);
  if (!Array.isArray(latLngs) || latLngs.length < 2) return null;

  const iO = Number.isFinite(mejor?.iO) ? mejor.iO : indiceMasCercanoEnCaminoPreciso(latO, lngO, latLngs);
  const iDMin = indiceMasCercanoEnCaminoPreciso(latD, lngD, latLngs);
  if (iO < 0 || iDMin < 0) return null;

  const forward = iO <= iDMin;
  const step = forward ? 1 : -1;
  let end = iDMin;

  let bestSeen = Infinity;
  let cutCandidate = null;
  for (let i = iO; forward ? i <= iDMin : i >= iDMin; i += step) {
    const p = latLngs[i];
    if (!p) continue;
    const d = calcularDistancia(latD, lngD, p[0], p[1]);
    if (d < bestSeen) bestSeen = d;
    if (d <= DESTINO_UMBRAL_CORTE_M) {
      cutCandidate = i;
      if (bestSeen <= DESTINO_UMBRAL_CORTE_M * 0.6) break;
    }
  }
  if (cutCandidate != null) end = cutCandidate;

  const startIndex = Math.min(iO, end);
  const endIndex = Math.max(iO, end);
  const tramo = latLngs.slice(startIndex, endIndex + 1);
  const tramoDir = forward ? tramo : tramo.slice().reverse();
  if (tramoDir.length < 2) return null;
  return tramoDir;
}

async function planearRutaConTrasbordo({ lineaA, lineaB, transfer, destino }) {
  if (!leafletMap || typeof L === 'undefined') return;

  // asegurar ubicación actual
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
  const tLat = Number(transfer?.lat);
  const tLng = Number(transfer?.lng);
  const dLat = Number(destino?.lat);
  const dLng = Number(destino?.lng);
  if (!Number.isFinite(latO) || !Number.isFinite(lngO) || !Number.isFinite(tLat) || !Number.isFinite(tLng) || !Number.isFinite(dLat) || !Number.isFinite(dLng)) return;

  const aRef = String(lineaA || '').trim();
  const bRef = String(lineaB || '').trim();
  if (!aRef || !bRef) return;

  const tramo1 = await elegirMejorRutaFeatureEntre(latO, lngO, tLat, tLng, [aRef]);
  const tramo2 = await elegirMejorRutaFeatureEntre(tLat, tLng, dLat, dLng, [bRef]);
  if (!tramo1 || !tramo2) {
    alert('No se pudo calcular la ruta con trasbordo.');
    return;
  }

  const colorA = (typeof colorPorLinea === 'object' && colorPorLinea) ? (colorPorLinea[aRef] || '#007BFF') : '#007BFF';
  const colorB = (typeof colorPorLinea === 'object' && colorPorLinea) ? (colorPorLinea[bRef] || '#007BFF') : '#007BFF';

  limpiarRecorrido();
  recorridoActivo = { planned: true, mode: 'transfer', legs: [], transferName: String(transfer?.name || '').trim() };

  const layerRec = asegurarRecorridoLayer();
  layerRec?.clearLayers();
  const layerParadas = asegurarParadasLayer();
  layerParadas?.clearLayers();

  const latLngs1 = calcularTramoRecortado(latO, lngO, tLat, tLng, tramo1.feature, tramo1.mejor);
  const latLngs2 = calcularTramoRecortado(tLat, tLng, dLat, dLng, tramo2.feature, tramo2.mejor);
  if (Array.isArray(latLngs1) && latLngs1.length >= 2) L.polyline(latLngs1, { color: colorA, weight: 4, opacity: 0.95 }).addTo(layerRec);
  if (Array.isArray(latLngs2) && latLngs2.length >= 2) L.polyline(latLngs2, { color: colorB, weight: 4, opacity: 0.95 }).addTo(layerRec);

  const relIds1 = obtenerRelIdsDeRutas([tramo1.feature]);
  const relIds2 = obtenerRelIdsDeRutas([tramo2.feature]);

  const sel1 = (relIds1 && relIds1.size > 0)
    ? await dibujarParadasDeLineaCercanasAlOrigen(relIds1, latO, lngO, aRef, tramo1.mejor?.name || '', { clear: true })
    : [];
  const sel2 = (relIds2 && relIds2.size > 0)
    ? await dibujarParadasDeLineaCercanasAlOrigen(relIds2, tLat, tLng, bRef, tramo2.mejor?.name || '', { clear: false })
    : [];

  recorridoActivo.legs = [
    { ref: aRef, name: tramo1.mejor?.name || '', relIds: relIds1, origen: { lat: latO, lng: lngO }, destino: { lat: tLat, lng: tLng }, nearbyStops: sel1 || [] },
    { ref: bRef, name: tramo2.mejor?.name || '', relIds: relIds2, origen: { lat: tLat, lng: tLng }, destino: { lat: dLat, lng: dLng }, nearbyStops: sel2 || [] },
  ];

  const layerSel = asegurarSeleccionParadaLayer();
  if (layerSel) {
    layerSel.clearLayers();
    L.circleMarker([latO, lngO], { radius: 6, weight: 2, color: colorA, fillColor: '#ffffff', fillOpacity: 1 }).addTo(layerSel);
    L.circleMarker([tLat, tLng], { radius: 6, weight: 2, color: '#007BFF', fillColor: '#ffffff', fillOpacity: 1 }).addTo(layerSel);
    L.circleMarker([dLat, dLng], { radius: 6, weight: 2, color: colorB, fillColor: '#ffffff', fillOpacity: 1 }).addTo(layerSel);
  }

  try {
    const bounds = L.latLngBounds([[latO, lngO], [dLat, dLng]]);
    bounds.extend([tLat, tLng]);
    const recBounds = layerRec?.getBounds?.();
    if (recBounds && recBounds.isValid && recBounds.isValid()) bounds.extend(recBounds);
    leafletMap.fitBounds(bounds, { padding: [20, 20] });
  } catch {
    // noop
  }

  const stops1 = normalizarParadasSeleccionParaLista(sel1 || [], aRef, tramo1.mejor?.name || '');
  const stops2 = normalizarParadasSeleccionParaLista(sel2 || [], bRef, tramo2.mejor?.name || '');
  setPlaneoParadasIndex([...stops1, ...stops2]);

  const tName = String(transfer?.name || '').trim();
  const subtitulo = tName ? `Trasbordo en: ${tName}` : '';
  const html = `
    <p style="margin: 0 0 10px 0; font-size: 17px; font-weight: 900; color: var(--text-primary, #222); text-align: center;">Opción con trasbordo</p>
    <p style="margin: 0 0 14px 0; font-size: 12px; color: var(--text-muted, #888); text-align: center;">Tocá una parada para ver arribos.</p>
    <p style="margin: 0 0 8px 0; font-size: 17px; font-weight: 900; color: var(--text-primary, #222); text-align: center;">Tramo 1 — Línea ${escapeHtml(aRef)}</p>
    ${stops1.length ? renderListaParadasPlaneo({ tituloIzq: 'Paradas cercanas', stops: stops1, totalLabel: `${stops1.length} paradas` }) : '<p style="margin:0 0 12px 0; font-size:14px; color: var(--text-secondary,#666); text-align:center;">Sin paradas cercanas para el tramo 1.</p>'}
    <p style="margin: 16px 0 8px 0; font-size: 17px; font-weight: 900; color: var(--text-primary, #222); text-align: center;">Tramo 2 — Línea ${escapeHtml(bRef)}</p>
    ${stops2.length ? renderListaParadasPlaneo({ tituloIzq: 'Paradas cercanas', stops: stops2, totalLabel: `${stops2.length} paradas` }) : '<p style="margin:0; font-size:14px; color: var(--text-secondary,#666); text-align:center;">Sin paradas cercanas para el tramo 2.</p>'}
  `;
  abrirBottomSheet('Ruta', html, '', subtitulo);
}

async function obtenerIndiceParadasPuntosPorId() {
  if (_indiceParadasPuntosPorId) return _indiceParadasPuntosPorId;
  const map = new Map();
  try {
    const puntos = await cargarParadasPuntos();
    if (Array.isArray(puntos)) {
      for (const p of puntos) {
        const id = obtenerIdParada(p.feature);
        if (!id || map.has(id)) continue;
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
        map.set(id, { lat: p.lat, lng: p.lng, feature: p.feature });
      }
    }
  } catch {
    // noop
  }
  _indiceParadasPuntosPorId = map;
  return _indiceParadasPuntosPorId;
}

async function obtenerIndiceLineasPorStopId() {
  if (_indiceLineasPorStopId) return _indiceLineasPorStopId;

  const data = await cargarParadasPorLinea();
  const map = new Map();
  _stopIdsSetPorLinea = new Map();

  for (const ref of Object.keys(data || {})) {
    const paradasObj = data?.[ref]?.paradas;
    if (!paradasObj || typeof paradasObj !== 'object') continue;

    const set = new Set();
    for (const stopId of Object.values(paradasObj)) {
      const sid = typeof stopId === 'string' ? stopId.trim() : '';
      if (!sid) continue;
      set.add(sid);
      const prev = map.get(sid);
      if (prev) prev.add(ref);
      else map.set(sid, new Set([ref]));
    }
    _stopIdsSetPorLinea.set(ref, set);
  }

  _indiceLineasPorStopId = map;
  return _indiceLineasPorStopId;
}

async function obtenerStopsIndexPorLinea() {
  if (_stopsIndexPorLinea) return _stopsIndexPorLinea;
  const idxByLine = new Map();

  try {
    const puntos = await cargarParadasPuntos();
    if (Array.isArray(puntos)) {
      for (const p of puntos) {
        const feature = p.feature;
        const id = obtenerIdParada(feature);
        if (!id) continue;
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;

        const lineas = obtenerLineasDetalleDesdeRelations(feature);
        if (!Array.isArray(lineas) || lineas.length === 0) continue;

        for (const l of lineas) {
          const ref = typeof l?.ref === 'string' ? l.ref.trim() : '';
          if (!ref) continue;

          let entry = idxByLine.get(ref);
          if (!entry) {
            entry = { ids: new Set(), stops: [] };
            idxByLine.set(ref, entry);
          }
          if (entry.ids.has(id)) continue;
          entry.ids.add(id);
          entry.stops.push({ id, lat: p.lat, lng: p.lng, feature });
        }
      }
    }
  } catch {
    // noop
  }

  _stopsIndexPorLinea = idxByLine;
  return _stopsIndexPorLinea;
}

function stopIdsDeLinea(ref) {
  const r = String(ref || '').trim();
  if (!r) return new Set();
  const set = _stopIdsSetPorLinea?.get(r);
  return set instanceof Set ? set : new Set();
}

function stopIdsDeLineaRelations(ref) {
  const r = String(ref || '').trim();
  if (!r) return new Set();
  const entry = _stopsIndexPorLinea?.get(r);
  return entry?.ids instanceof Set ? entry.ids : new Set();
}

function obtenerParadaPorIdRelations(stopId) {
  const id = String(stopId || '').trim();
  if (!id) return null;
  return _indiceParadasPuntosPorId?.get(id) || null;
}

async function obtenerParadasCercanasA(lat, lng, radiusM, maxCount) {
  const latO = Number(lat);
  const lngO = Number(lng);
  if (!Number.isFinite(latO) || !Number.isFinite(lngO)) return [];

  const puntos = await cargarParadasPuntos();
  if (!Array.isArray(puntos)) return [];

  const res = [];
  for (const p of puntos) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const d = typeof calcularDistancia === 'function'
      ? calcularDistancia(latO, lngO, p.lat, p.lng)
      : Infinity;
    if (d <= radiusM) {
      const id = obtenerIdParada(p.feature);
      if (!id) continue;
      res.push({ id, lat: p.lat, lng: p.lng, d, feature: p.feature });
    }
  }

  res.sort((a, b) => a.d - b.d);
  return res.slice(0, maxCount);
}

function iniciarPlaneoRutaHastaParadaSeleccionada(featureParada) {
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

  const stopId = obtenerIdParada(featureParada);
  const nombre = typeof obtenerEtiquetaParada === 'function'
    ? obtenerEtiquetaParada(featureParada)
    : ((featureParada.properties && (featureParada.properties.name || featureParada.properties.ref)) || 'la parada');

  _routePlanTarget = { feature: featureParada, nombre: String(nombre || ''), lat, lng, stopId };

  // Directo: mostrar opciones como "con trasbordo" (incluye directas + combinaciones)
  void mostrarOpcionesRutaParaTarget(true);
}

async function mostrarOpcionesRutaParaTarget(permitirTrasbordo) {
  _routePlanLastAllowTransfer = Boolean(permitirTrasbordo);
  if (!_routePlanTarget || !Number.isFinite(_routePlanTarget.lat) || !Number.isFinite(_routePlanTarget.lng)) {
    alert('No hay destino seleccionado.');
    return;
  }

  const destinoNombre = _routePlanTarget.nombre || '';
  const subtitulo = destinoNombre ? `Destino: ${destinoNombre}` : '';

  // Feedback inmediato mientras se calculan opciones
  try {
    abrirBottomSheet(
      'Opciones de ruta',
      '<div class="bottom-sheet-loading" role="status" aria-live="polite" aria-busy="true">'
        + '<div class="bottom-sheet-loading-spinner" aria-hidden="true"></div>'
        + '<p class="bottom-sheet-loading-title">Calculando opciones...</p>'
        + '</div>',
      '',
      subtitulo,
    );
  } catch {
    // noop
  }

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

  await obtenerIndiceParadasPuntosPorId();
  await obtenerStopsIndexPorLinea();

  const origenStops = await obtenerParadasCercanasA(ubicacion.lat, ubicacion.lng, ROUTE_NEARBY_STOPS_RADIUS_M, ROUTE_NEARBY_STOPS_MAX);
  const origenRefs = new Set();
  for (const s of origenStops) {
    const lineas = obtenerLineasDetalleDesdeRelations(s.feature);
    if (!Array.isArray(lineas)) continue;
    for (const l of lineas) {
      const ref = typeof l?.ref === 'string' ? l.ref.trim() : '';
      if (ref) origenRefs.add(ref);
    }
  }

  // Líneas que pasan por la parada destino
  const detalleDestino = obtenerLineasDetalleDesdeRelations(_routePlanTarget.feature);
  const refToName = new Map();
  for (const l of detalleDestino) {
    if (l?.ref) refToName.set(String(l.ref).trim(), String(l.name || '').trim());
  }
  let destinoRefs = detalleDestino
    .map((l) => (l && l.ref != null ? String(l.ref).trim() : ''))
    .filter(Boolean);

  // Si no hay relations, no hay forma confiable de listar líneas para esa parada.

  // "Sin trasbordo" = cualquier línea que pase por la parada destino.
  // La optimización por cercanía al origen se hace al tocar el botón (ahí se calcula/dibuja).
  destinoRefs = Array.from(new Set(destinoRefs));
  const directLimited = destinoRefs.slice(0, ROUTE_MAX_OPCIONES_DIRECTAS);

  const combos = [];
  if (permitirTrasbordo && destinoRefs.length && origenRefs.size) {
    const destinoSet = new Set(destinoRefs);
    let count = 0;
    const latO = Number(ubicacion.lat);
    const lngO = Number(ubicacion.lng);
    const latD = Number(_routePlanTarget.lat);
    const lngD = Number(_routePlanTarget.lng);

    for (const a of origenRefs) {
      const setA = stopIdsDeLineaRelations(a);
      if (!(setA instanceof Set) || setA.size === 0) continue;

      for (const b of destinoSet) {
        if (a === b) continue;
        const setB = stopIdsDeLineaRelations(b);
        if (!(setB instanceof Set) || setB.size === 0) continue;

        // Buscar el mejor stop compartido (minimiza caminata origen->T + T->dest)
        let best = null;
        const iterSmall = setA.size <= setB.size ? setA : setB;
        const other = iterSmall === setA ? setB : setA;

        for (const sid of iterSmall) {
          if (!other.has(sid)) continue;
          const p = obtenerParadaPorIdRelations(sid);
          if (!p) continue;
          const d1 = typeof calcularDistancia === 'function' ? calcularDistancia(latO, lngO, p.lat, p.lng) : Infinity;
          const d2 = typeof calcularDistancia === 'function' ? calcularDistancia(p.lat, p.lng, latD, lngD) : Infinity;
          const score = Number(d1) + Number(d2);
          if (!best || score < best.score) {
            const tName = typeof obtenerEtiquetaParada === 'function' ? obtenerEtiquetaParada(p.feature) : sid;
            best = { id: sid, lat: p.lat, lng: p.lng, name: tName, score };
          }
        }

        if (!best) continue;
        combos.push({ a, b, transfer: { id: best.id, lat: best.lat, lng: best.lng, name: best.name } });
        count++;
        if (count >= ROUTE_MAX_OPCIONES_TRASBORDO) break;
      }
      if (count >= ROUTE_MAX_OPCIONES_TRASBORDO) break;
    }
  }

  // Render: usar el estilo de botones de líneas (igual que en paradas)
  const directItems = directLimited
    .map((ref) => {
      const name = refToName.get(ref) || '';
      const refAttr = escapeHtml(ref);
      const nameAttr = escapeHtml(name);
      const nameDisplay = name ? `<span class="linea-button-name">${escapeHtml(name)}</span>` : '';
      return `<li><button type="button" class="btn-linea" data-route-line-ref="${refAttr}" data-route-line-name="${nameAttr}"><span class="linea-button-ref">${escapeHtml(ref)}</span>${nameDisplay}</button></li>`;
    })
    .join('');

  const directHtml = directItems
    ? `<ul class="lineas-list">${directItems}</ul>`
    : `<p style="margin: 0; font-size: 14px; color: var(--text-secondary, #666); text-align: center;">No se encontraron líneas para esta parada.</p>`;

  const combosItems = combos
    .map((c) => {
      const labelRef = `${c.a} + ${c.b}`;
      const transferName = String(c.transfer.name || c.transfer.id || '').trim();
      const nameDisplay = transferName ? `<span class="linea-button-name">Trasbordo: ${escapeHtml(transferName)}</span>` : '';
      return `<li><button type="button" class="btn-linea" data-route-combo="1" data-linea-a="${escapeHtml(c.a)}" data-linea-b="${escapeHtml(c.b)}" data-transfer-lat="${String(c.transfer.lat)}" data-transfer-lng="${String(c.transfer.lng)}" data-transfer-name="${escapeHtml(transferName)}"><span class="linea-button-ref">${escapeHtml(labelRef)}</span>${nameDisplay}</button></li>`;
    })
    .join('');

  const combosHtml = permitirTrasbordo
    ? (combosItems
      ? `<ul class="lineas-list">${combosItems}</ul>`
      : `<p style="margin: 0; font-size: 14px; color: var(--text-secondary, #666); text-align: center;">No se encontraron combinaciones con 1 trasbordo.</p>`)
    : '';

  const html = `
    <p style="margin: 0 0 10px 0; font-size: 17px; font-weight: 900; color: var(--text-primary, #222); text-align: center;">Sin trasbordo</p>
    ${directHtml}
    <p style="margin: 14px 0 10px 0; font-size: 17px; font-weight: 900; color: var(--text-primary, #222); text-align: center;">Con trasbordo</p>
    ${combosHtml}
    <p style="margin: 14px 0 0 0; font-size: 12px; color: var(--text-muted, #888); text-align: center;">Tocá una opción para dibujar la ruta.</p>
  `;
  abrirBottomSheet('Opciones de ruta', html, '', subtitulo);
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