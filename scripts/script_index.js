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
let _cargaDiferidaParadasHandler = null; // listener 'zoomend' pendiente para dibujar paradas de línea al hacer zoom
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
let _horariosAproximadosPorLinea = null; // Cache: Map(lineaKey -> entrada de línea) de redtulum_lineas_horarios_aproximados.json
let _horariosAproximadosPromise = null; // Promise en vuelo mientras se carga el JSON de horarios aproximados

// ─── Planeo de ruta (opciones / trasbordos) ─────────────────────────────────
let _routePlanTarget = null; // { feature, nombre, lat, lng, stopId }
let _routePlanOrigin = null; // { lat, lng, nombre } | null (null = usar mi ubicación GPS)
let _pickingOrigenEnMapa = false; // true mientras se espera que el usuario toque un punto del mapa
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
const HORARIOS_APROXIMADOS_URL = encodeURI('Datos/redtulum_lineas_horarios_aproximados.json' + JSON_VERSION);
const ARRIVALS_API_URL = '/api/arrivals';
const ARRIVALS_TIMEOUT_MS = 30000;
const ARRIVALS_MAX_INTENTOS_PARADA = 3; // cuando hay paradas duplicadas por sufijos, probar varias variantes
const RADIO_PARADAS_METROS = 700;
const MAX_PARADAS_MOSTRAR = 40;
const MAX_PARADAS_MOSTRAR_EN_VISTA = 200;
const EVENTO_PARADAS_DEBOUNCE_MS = 150;
const ZOOM_CALLE = 18;
// Zoom mínimo al que queda el mapa cuando se enfoca UN punto concreto (una parada, un
// lugar guardado, un resultado de búsqueda). Antes estas navegaciones conservaban el
// zoom que hubiera en ese momento, así que si venías de ver una línea entera —que se
// aleja para que entre todo el recorrido— tocar una parada guardada te dejaba igual de
// lejos y no se veía a qué esquina correspondía. Los encuadres que abarcan varias
// coordenadas (recorrido completo, origen + destino del planificador) siguen usando
// fitBounds y no pasan por acá.
const ZOOM_PUNTO_ENFOCADO = ZOOM_CALLE;
// Al elegir origen o destino conviene un zoom algo más abierto que el de calle: se ve
// el pin recién puesto pero también las cuadras de alrededor, que es lo que hace falta
// para darse cuenta de si el punto elegido es el correcto.
const ZOOM_PLANEO_CONTEXTO = 16;
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

const REALTIME_CENTER_INTERVAL_MS = 10000;
const REALTIME_CENTER_LONG_PRESS_MS = 600;

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
const CAMINATA_EXCESIVA_UMBRAL_M = 500; // a partir de acá, caminar hasta el origen de la ruta se penaliza
const CAMINATA_EXCESIVA_PENALIZACION = 1.8; // multiplicador de tiempo aplicado a esa caminata


// Long press en mapa para guardar ubicación
const MAP_LONG_PRESS_MS = 650;
const MAP_LONG_PRESS_MOVE_TOL_M = 25;
let _longPressMapSetupDone = false;

const USER_WAYPOINT_ICON_URL = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMyIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBjbGFzcz0ibHVjaWRlIGx1Y2lkZS1tYXAtcGluLWljb24gbHVjaWRlLW1hcC1waW4iPjxwYXRoIGQ9Ik0yMCAxMGMwIDQuOTkzLTUuNTM5IDEwLjE5My03LjM5OSAxMS43OTlhMSAxIDAgMCAxLTEuMjAyIDBDOS41MzkgMjAuMTkzIDQgMTQuOTkzIDQgMTBhOCA4IDAgMCAxIDE2IDAiLz48Y2lyY2xlIGN4PSIxMiIgY3k9IjEwIiByPSIzIi8+PC9zdmc+';
let _iconoUserWaypointLeaflet = null;

const _iconosParadaLeafletCache = new Map();

function obtenerIconoParadaLeaflet(colorHex = '#007BFF') {
  if (!leafletMap || typeof L === 'undefined') return null;
  if (_iconosParadaLeafletCache.has(colorHex)) return _iconosParadaLeafletCache.get(colorHex);

  const filterId = 'pStopSh_' + String(colorHex).replace(/[^a-zA-Z0-9]/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <defs>
      <filter id="${filterId}" x="-25%" y="-25%" width="150%" height="150%">
        <feDropShadow dx="0" dy="1.8" stdDeviation="1.8" flood-color="#000000" flood-opacity="0.38"/>
      </filter>
    </defs>
    <g filter="url(#${filterId})">
      <circle cx="16" cy="16" r="13" fill="#ffffff" stroke="${colorHex}" stroke-width="3.2"/>
      <path d="M11 9 C11 8 11.8 7.2 12.8 7.2 L19.2 7.2 C20.2 7.2 21 8 21 9 L21 17.5 C21 18.5 20.2 19.2 19.2 19.2 L19.2 20.8 C19.2 21.4 18.4 21.4 18.4 20.8 L18.4 19.2 L13.6 19.2 L13.6 20.8 C13.6 21.4 12.8 21.4 12.8 20.8 L12.8 19.2 C11.8 19.2 11 18.5 11 17.5 Z M12.5 9.2 L19.5 9.2 C19.8 9.2 20 9.4 20 9.8 L20 13.2 L12 13.2 L12 9.8 C12 9.4 12.2 9.2 12.5 9.2 Z M13.5 16.5 A 0.9 0.9 0 1 0 13.5 14.7 A 0.9 0.9 0 1 0 13.5 16.5 Z M18.5 16.5 A 0.9 0.9 0 1 0 18.5 14.7 A 0.9 0.9 0 1 0 18.5 16.5 Z" fill="${colorHex}"/>
    </g>
  </svg>`;
  const url = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;

  const icon = L.icon({
    iconUrl: url,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -15],
  });
  _iconosParadaLeafletCache.set(colorHex, icon);
  return icon;
}

let _marcadorDestacadoActivo = null;

function crearIconoParadaDestacada(nombre = '') {
  const safeNombre = typeof escapeHtml === 'function' ? escapeHtml(nombre) : nombre;
  const tooltipHtml = safeNombre ? `<div class="map-highlight-tooltip-tag">${safeNombre}</div>` : '';
  return L.divIcon({
    className: 'map-highlight-marker-wrap',
    iconSize: [46, 46],
    iconAnchor: [23, 23],
    popupAnchor: [0, -23],
    html: `
      <div class="map-highlight-marker">
        <div class="map-highlight-beacon"></div>
        <div class="map-highlight-pin" title="${safeNombre || 'Parada'}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
        </div>
        ${tooltipHtml}
      </div>
    `
  });
}

let _userWaypointVisible = false;

function destacarParadaEnMapa(lat, lng, nombre = '') {
  limpiarMarcadoresSeleccion();
}

let _iconoDestinoMarcadorLeaflet = null;
let _iconoOrigenMarcadorLeaflet = null;
let _origenMarcadorActivo = null;

function crearIconoMarcadorSeleccion(gradFrom, gradTo, gradId, claseCss) {
  return L.divIcon({
    className: claseCss,
    iconSize: [32, 40],
    iconAnchor: [16, 38],
    popupAnchor: [0, -36],
    html: `
      <svg width="32" height="40" viewBox="0 0 34 42" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;">
        <defs>
          <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="${gradFrom}"/>
            <stop offset="100%" stop-color="${gradTo}"/>
          </linearGradient>
        </defs>
        <path d="M17 1 C8.16 1 1 8.16 1 17 C1 27.5 17 41 17 41 C17 41 33 27.5 33 17 C33 8.16 25.84 1 17 1 Z" fill="url(#${gradId})" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="round"/>
        <circle cx="17" cy="17" r="7" fill="#ffffff"/>
      </svg>
    `,
  });
}

function obtenerIconoDestinoMarcador() {
  if (_iconoDestinoMarcadorLeaflet) return _iconoDestinoMarcadorLeaflet;
  _iconoDestinoMarcadorLeaflet = crearIconoMarcadorSeleccion('#ff735c', '#e6351d', 'destinoPinGrad', 'destino-marker-icon');
  return _iconoDestinoMarcadorLeaflet;
}

function obtenerIconoOrigenMarcador() {
  if (_iconoOrigenMarcadorLeaflet) return _iconoOrigenMarcadorLeaflet;
  _iconoOrigenMarcadorLeaflet = crearIconoMarcadorSeleccion('#60a5fa', '#1d4ed8', 'origenPinGrad', 'origen-marker-icon');
  return _iconoOrigenMarcadorLeaflet;
}

// Marcadores de "punto elegido": origen y destino son independientes entre sí (así se ven
// los dos juntos al planificar un viaje) y a propósito no se usan para paradas de colectivo,
// que ya tienen su propio ícono en el mapa — ver destacarParadaEnMapa/limpiarMarcadoresSeleccion.
function mostrarMarcadorDestino(lat, lng, nombre = '') {
  if (!leafletMap || typeof L === 'undefined') return;
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return;

  const layerSel = typeof asegurarSeleccionParadaLayer === 'function' ? asegurarSeleccionParadaLayer() : null;
  if (!layerSel) return;

  if (_marcadorDestacadoActivo) {
    try { layerSel.removeLayer(_marcadorDestacadoActivo); } catch { /* noop */ }
  }
  const marker = L.marker([latNum, lngNum], { icon: obtenerIconoDestinoMarcador(), keyboard: false }).addTo(layerSel);
  const nombreTexto = String(nombre || '').trim();
  if (nombreTexto) {
    marker.bindTooltip(nombreTexto, { direction: 'top', offset: [0, -34] });
  }
  _marcadorDestacadoActivo = marker;
}

function mostrarMarcadorOrigen(lat, lng, nombre = '') {
  if (!leafletMap || typeof L === 'undefined') return;
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return;

  const layerSel = typeof asegurarSeleccionParadaLayer === 'function' ? asegurarSeleccionParadaLayer() : null;
  if (!layerSel) return;

  if (_origenMarcadorActivo) {
    try { layerSel.removeLayer(_origenMarcadorActivo); } catch { /* noop */ }
  }
  const marker = L.marker([latNum, lngNum], { icon: obtenerIconoOrigenMarcador(), keyboard: false }).addTo(layerSel);
  const nombreTexto = String(nombre || '').trim();
  if (nombreTexto) {
    marker.bindTooltip(nombreTexto, { direction: 'top', offset: [0, -34] });
  }
  _origenMarcadorActivo = marker;
}

function limpiarMarcadoresSeleccion() {
  const layerSel = typeof asegurarSeleccionParadaLayer === 'function' ? asegurarSeleccionParadaLayer() : null;
  if (layerSel) layerSel.clearLayers();
  _marcadorDestacadoActivo = null;
  _origenMarcadorActivo = null;
}

function limpiarMarcadorOrigen() {
  const layerSel = typeof asegurarSeleccionParadaLayer === 'function' ? asegurarSeleccionParadaLayer() : null;
  if (layerSel && _origenMarcadorActivo) {
    try { layerSel.removeLayer(_origenMarcadorActivo); } catch { /* noop */ }
  }
  _origenMarcadorActivo = null;
}

// Deja el marcador de "mi ubicación" fijo en el mapa. Una vez mostrado ya no se
// vuelve a esconder: antes existía una ocultarMarcadorUsuario() que lo sacaba cada
// vez que el mapa se centraba en otra cosa, y planificar un viaje terminaba sin
// ninguna referencia visual de dónde estaba el usuario.
function mostrarMarcadorUsuario() {
  _userWaypointVisible = true;
  document.body.classList.remove('hide-user-marker');

  if (userMarker && leafletMap && !leafletMap.hasLayer(userMarker)) {
    try {
      userMarker.addTo(leafletMap);
    } catch {}
  }
  if (userMarkerHalo && leafletMap && !leafletMap.hasLayer(userMarkerHalo)) {
    try {
      userMarkerHalo.addTo(leafletMap);
    } catch {}
  }
  document.querySelectorAll('.user-waypoint-marker-icon, .user-marker-halo').forEach((el) => {
    el.style.display = '';
  });
}

function obtenerIconoUserWaypoint() {
  if (_iconoUserWaypointLeaflet) return _iconoUserWaypointLeaflet;

  _iconoUserWaypointLeaflet = L.divIcon({
    className: 'user-waypoint-marker-icon',
    iconSize: [36, 44],
    iconAnchor: [18, 42],
    popupAnchor: [0, -42],
    html: `
      <div class="user-waypoint-wrap" title="Tu ubicación actual">
        <div class="user-waypoint-radar-ring"></div>
        <div class="user-waypoint-pin">
          <svg width="34" height="42" viewBox="0 0 34 42" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;">
            <defs>
              <linearGradient id="userPinGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#ff735c"/>
                <stop offset="100%" stop-color="#e6351d"/>
              </linearGradient>
            </defs>
            <path d="M17 1 C8.16 1 1 8.16 1 17 C1 27.5 17 41 17 41 C17 41 33 27.5 33 17 C33 8.16 25.84 1 17 1 Z" fill="url(#userPinGrad)" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="round"/>
            <circle cx="17" cy="17" r="8" fill="#ffffff"/>
            <circle cx="17" cy="17" r="4.5" fill="#e6351d"/>
            <circle cx="17" cy="17" r="2" fill="#ff735c"/>
          </svg>
        </div>
      </div>
    `
  });
  return _iconoUserWaypointLeaflet;
}

function asegurarMarcadorUsuario(lat, lng) {
  if (!leafletMap || typeof L === 'undefined') return;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  const latLng = [lat, lng];

  if (!userMarkerHalo) {
    userMarkerHalo = L.circleMarker(latLng, {
      radius: 18,
      weight: 0,
      color: '#ff472e',
      fillColor: '#ff472e',
      fillOpacity: 0.2,
      interactive: false,
      className: 'user-marker-halo',
    });
    userMarkerHalo.addTo(leafletMap);
  } else {
    userMarkerHalo.setLatLng(latLng);
    if (typeof _realtimeCenterActive !== 'undefined' && _realtimeCenterActive) {
      const el = userMarkerHalo.getElement ? userMarkerHalo.getElement() : null;
      if (el) el.classList.add('pulse-halo');
    }
    if (!leafletMap.hasLayer(userMarkerHalo)) {
      userMarkerHalo.addTo(leafletMap);
    }
  }

  if (!userMarker) {
    userMarker = L.marker(latLng, {
      icon: obtenerIconoUserWaypoint(),
      zIndexOffset: 1200,
    });
    userMarker.addTo(leafletMap);
  } else {
    userMarker.setLatLng(latLng);
    if (!leafletMap.hasLayer(userMarker)) {
      userMarker.addTo(leafletMap);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Vista activa del mapa (punto o bounds): un único estado compartido que
// reemplaza al viejo `window._activeMapCenter`. El bug de "queda centrado en
// lo anterior" pasaba porque cada acción (centrar una parada, un lugar guardado,
// mostrar una línea) reprogramaba varios setTimeout que aplicaban la posición
// que tenían "capturada" en ese momento; si el usuario disparaba una acción nueva
// mientras los timeouts de la anterior todavía no terminaban, el último en
// ejecutarse podía pisar la posición correcta con una vieja. Ahora los timeouts
// no capturan nada: siempre leen `window._activeMapView` en el momento en que
// se ejecutan, así que una acción más nueva siempre gana sin importar el orden.
function establecerVistaMapaPunto(lat, lng, zoom) {
  const safeLat = Number(lat);
  const safeLng = Number(lng);
  if (!Number.isFinite(safeLat) || !Number.isFinite(safeLng)) return;
  const z = Number.isFinite(Number(zoom)) ? Number(zoom) : ZOOM_CALLE;
  window._activeMapView = { type: 'point', lat: safeLat, lng: safeLng, zoom: z };
}

function establecerVistaMapaBounds(bounds, fitOpts = { padding: [20, 20] }) {
  if (!bounds) return;
  window._activeMapView = { type: 'bounds', bounds, fitOpts: fitOpts || { padding: [20, 20] } };
}

function reaplicarVistaMapaActiva({ invalidateSize = true } = {}) {
  if (!leafletMap) return;
  if (invalidateSize && typeof leafletMap.invalidateSize === 'function') {
    leafletMap.invalidateSize({ animate: false });
  }
  const v = window._activeMapView;
  if (!v) return;
  if (v.type === 'bounds' && v.bounds) {
    try {
      leafletMap.fitBounds(v.bounds, { ...(v.fitOpts || { padding: [20, 20] }), animate: false });
    } catch {
      // noop
    }
    return;
  }
  if (v.type === 'point' && Number.isFinite(v.lat) && Number.isFinite(v.lng)) {
    const z = Number.isFinite(v.zoom) ? v.zoom : (typeof leafletMap.getZoom === 'function' ? leafletMap.getZoom() : ZOOM_CALLE);
    leafletMap.setView([v.lat, v.lng], z, { animate: false });
  }
}

function centrarMapaEnPunto(lat, lng, zoom = ZOOM_CALLE) {
  const safeLat = Number(lat);
  const safeLng = Number(lng);
  if (!Number.isFinite(safeLat) || !Number.isFinite(safeLng)) return;

  const z = Number.isFinite(Number(zoom)) ? Number(zoom) : ZOOM_CALLE;
  establecerVistaMapaPunto(safeLat, safeLng, z);

  if (!leafletMap) return;

  reaplicarVistaMapaActiva();
  requestAnimationFrame(() => reaplicarVistaMapaActiva());
  setTimeout(() => reaplicarVistaMapaActiva(), 50);
  setTimeout(() => reaplicarVistaMapaActiva(), 150);
  setTimeout(() => reaplicarVistaMapaActiva(), 250);
  setTimeout(() => reaplicarVistaMapaActiva(), 380);
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
    esFavorita = favs.some((f) => (f?.ref && ref && f.ref === ref) || (typeof f === 'string' && f === ref));
  } else if (favBtn.dataset.tipo === 'lugar' || favBtn.dataset.tipo === 'ubicacion') {
    const lugar = window._currentLugar;
    if (lugar && Number.isFinite(lugar.lat) && Number.isFinite(lugar.lng)) {
      const favs = obtenerLugaresFavs();
      esFavorita = favs.some((f) => esMismoLugarGuardado(f, lugar) || f.nombre === lugar.nombre);
    }
  }

  if (esFavorita) {
    favBtn.style.display = '';
    favBtn.classList.add('is-fav');
    favBtn.style.opacity = '1';
    favBtn.style.cursor = 'pointer';
    favBtn.setAttribute('aria-label', 'Quitar de guardados');
  } else {
    favBtn.style.display = 'none';
    favBtn.classList.remove('is-fav');
    favBtn.setAttribute('aria-label', 'Guardar en favoritos');
  }

  // Actualizar subtítulo del bottom sheet según corresponda
  const bsSub = document.getElementById('bs-subtitle');
  if (bsSub) {
    if (favBtn.dataset.tipo === 'parada') {
      bsSub.textContent = esFavorita ? 'Parada guardada' : '';
      bsSub.style.display = esFavorita ? '' : 'none';
    } else if (favBtn.dataset.tipo === 'linea') {
      bsSub.textContent = esFavorita ? 'Línea guardada' : '';
      bsSub.style.display = esFavorita ? '' : 'none';
    } else if (favBtn.dataset.tipo === 'lugar' || favBtn.dataset.tipo === 'ubicacion') {
      bsSub.textContent = esFavorita ? 'Ubicación guardada' : '';
      bsSub.style.display = esFavorita ? '' : 'none';
    }
  }

  // Sincronizar contenedores de guardado en el cuerpo
  const saveBoxLugar = document.getElementById('save-lugar-container');
  if (saveBoxLugar) saveBoxLugar.style.display = esFavorita ? 'none' : 'flex';
  const saveBoxLinea = document.getElementById('save-linea-container');
  if (saveBoxLinea) saveBoxLinea.style.display = esFavorita ? 'none' : 'flex';
  const saveBoxParada = document.getElementById('save-parada-container');
  if (saveBoxParada) saveBoxParada.style.display = esFavorita ? 'none' : 'flex';
}

function setBottomSheetState(state) {
  const bs = document.getElementById('bottom-sheet');
  if (!bs) return;
  bs.setAttribute('data-sheet-state', state);
  // Añadir clase al body para indicar que un sheet está en estado full (útil para aplicar desenfoque)
  if (state === BOTTOM_SHEET_STATE_FULL) {
    try { document.body.classList.add('bottom-sheet-full'); } catch (e) { /* noop */ }
  } else {
    try { document.body.classList.remove('bottom-sheet-full'); } catch (e) { /* noop */ }
  }
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

// Fila "← Volver a líneas de la parada". Devuelve '' cuando no corresponde.
//
// Dentro de un viaje ya planificado esta fila sobra: ahí la navegación es
// planificador → paradas del tramo → línea, y inyectarFilasNavegacionBottomSheet()
// ya pone "← Volver a paradas", que es el paso real hacia atrás. Mostrar las dos
// juntas daba dos botones de volver apilados que llevaban a lugares distintos.
function htmlFilaVolverALineasDeParada(corresponde = true) {
  if (!corresponde) return '';
  if (recorridoActivo?.planned) return '';
  return '<ul class="bs-nav-rows"><li><button type="button" class="btn-nav-row" data-volver-parada="1">← Volver a líneas de la parada</button></li></ul>';
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
  if (bsContent) {
    bsContent.innerHTML = inyectarFilasNavegacionBottomSheet(titulo, tipo, contenidoHtml);
    // Volver al inicio del contenido al cambiar de vista
    bsContent.scrollTop = 0;
  }

  // Montar anuncio si el HTML incluyó el placeholder.
  montarAdsEnBottomSheetSiCorresponde();

  if (bs) {
    bs.classList.add('active');
  }

  const hud = document.getElementById('map-nearest-stop-hud');
  if (hud) hud.classList.remove('visible');

  const viewMap = document.getElementById('view-map');
  viewMap?.classList.add('has-detail-open');

  // Actualizar icono en cabecera según el tipo
  const iconEl = document.getElementById('panel-header-icon');
  if (iconEl) {
    if (tipo === 'parada') {
      iconEl.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg><span class="panel-btn-label" id="panel-header-badge-label">Parada</span>';
    } else if (tipo === 'linea') {
      iconEl.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.2 6 18.1 6H5.9C4.8 6 3.9 6.8 3.6 7.8l-1.4 5c-.1.4-.2.8-.2 1.2 0 .4.1.8.2 1.2.3 1.1.8 2.8.8 2.8h3"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg><span class="panel-btn-label" id="panel-header-badge-label">Línea</span>';
    } else {
      iconEl.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"></polygon><line x1="9" x2="9" y1="3" y2="18"></line><line x1="15" x2="15" y1="6" y2="21"></line></svg><span class="panel-btn-label" id="panel-header-badge-label">Lugar</span>';
    }
  }

  const recentrarFeature = () => {
    // Reaplica lo que haya vigente en window._activeMapView (un punto o, si se está
    // mostrando una línea, sus bounds) — nunca una posición vieja capturada de antes.
    if (window._activeMapView) {
      reaplicarVistaMapaActiva();
      return;
    }
    const coords = window._currentFeature?.geometry?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      const targetLat = Number(coords[1]);
      const targetLng = Number(coords[0]);
      if (Number.isFinite(targetLat) && Number.isFinite(targetLng)) {
        centrarMapaEnPunto(targetLat, targetLng, leafletMap && typeof leafletMap.getZoom === 'function' ? leafletMap.getZoom() : ZOOM_CALLE);
        return;
      }
    }
    if (leafletMap && typeof leafletMap.invalidateSize === 'function') {
      leafletMap.invalidateSize({ animate: false });
    }
  };

  requestAnimationFrame(recentrarFeature);
  setTimeout(recentrarFeature, 60);
  setTimeout(recentrarFeature, 160);
  setTimeout(recentrarFeature, 260);

  // Mostrar/ocultar botón de favoritos según el tipo y estado de guardado
  if (favBtn) {
    if (tipo === 'parada') {
      favBtn.dataset.tipo = 'parada';
      favBtn.onclick = () => {
        agregarParadaAFavoritos(window._currentFeature || {});
        actualizarEstadoBotonFavoritos();
      };
      actualizarEstadoBotonFavoritos();
    } else if (tipo === 'linea') {
      favBtn.dataset.tipo = 'linea';
      favBtn.onclick = () => {
        const ref = window._currentLineaRef || '';
        const name = window._currentLineaName || '';
        agregarLineaAFavoritos({ ref, name });
        actualizarEstadoBotonFavoritos();
      };
      actualizarEstadoBotonFavoritos();
    } else if (tipo === 'ubicacion' || tipo === 'lugar') {
      favBtn.dataset.tipo = 'lugar';
      favBtn.onclick = () => {
        if (window._currentLugar) {
          agregarLugarAFavoritos(window._currentLugar.nombre, window._currentLugar.lat, window._currentLugar.lng);
          actualizarEstadoBotonFavoritos();
        }
      };
      actualizarEstadoBotonFavoritos();
    } else {
      favBtn.style.display = 'none';
      favBtn.classList.remove('is-fav');
      favBtn.removeAttribute('data-tipo');
      favBtn.setAttribute('aria-label', 'Guardar en favoritos');
      favBtn.onclick = null;
    }
  }

  // Botón Planear ruta en cabecera desactivado (se usa el botón descriptivo en el cuerpo)
  if (planBtn) {
    planBtn.style.display = 'none';
    planBtn.onclick = null;
  }
}

let _confirmCloseRouteOnConfirm = null;
let _confirmCloseRouteKeydownBound = false;
let _confirmRealtimeCenterOnConfirm = null;
let _confirmRealtimeCenterKeydownBound = false;
let _realtimeCenterIntervalId = null;
let _realtimeCenterBusy = false;
let _realtimeCenterLongPressTimer = null;
let _realtimeCenterSuppressNextClick = false;
let _realtimeCenterActive = false;
let _arrivalsAbortController = null; // AbortController activo mientras se consulta la API de arribos

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

let _confirmCloseArrivalsOnConfirm = null;

function ocultarModalConfirmCerrarArribos() {
  const overlay = document.getElementById('confirm-close-arrivals-overlay');
  if (!overlay) return;
  overlay.classList.remove('active');
  overlay.setAttribute('aria-hidden', 'true');
  _confirmCloseArrivalsOnConfirm = null;
}

function mostrarModalConfirmCerrarArribos(onConfirm) {
  const overlay = document.getElementById('confirm-close-arrivals-overlay');
  const okBtn = document.getElementById('confirm-close-arrivals-ok');
  if (!overlay || !okBtn) {
    const ok = confirm('Hay una consulta de arribos en curso. ¿Querés cancelarla y cerrar?');
    if (ok && typeof onConfirm === 'function') onConfirm();
    return;
  }
  _confirmCloseArrivalsOnConfirm = typeof onConfirm === 'function' ? onConfirm : null;
  overlay.classList.add('active');
  overlay.setAttribute('aria-hidden', 'false');

  const cancelBtn = document.getElementById('confirm-close-arrivals-cancel');

  const onOk = () => {
    overlay.removeEventListener('click', onOverlay);
    cancelBtn?.removeEventListener('click', onCancel);
    okBtn.removeEventListener('click', onOk);
    const cb = _confirmCloseArrivalsOnConfirm;
    ocultarModalConfirmCerrarArribos();
    if (typeof cb === 'function') cb();
  };
  const onCancel = () => {
    overlay.removeEventListener('click', onOverlay);
    okBtn.removeEventListener('click', onOk);
    cancelBtn?.removeEventListener('click', onCancel);
    ocultarModalConfirmCerrarArribos();
  };
  const onOverlay = (e) => {
    if (e.target && e.target.id === 'confirm-close-arrivals-overlay') onCancel();
  };

  overlay.addEventListener('click', onOverlay);
  cancelBtn?.addEventListener('click', onCancel);
  okBtn.addEventListener('click', onOk);

  setTimeout(() => { (cancelBtn || okBtn).focus?.(); }, 0);
}

function ocultarModalConfirmCentradoTiempoReal() {
  const overlay = document.getElementById('confirm-realtime-center-overlay');
  if (!overlay) return;
  overlay.classList.remove('active');
  overlay.setAttribute('aria-hidden', 'true');
  _confirmRealtimeCenterOnConfirm = null;
}

function actualizarModalConfirmCentradoTiempoReal(activando) {
  const title = document.getElementById('confirm-realtime-center-title');
  const message = document.getElementById('confirm-realtime-center-message');
  const warning = document.getElementById('confirm-realtime-center-warning');
  const okBtn = document.getElementById('confirm-realtime-center-ok');
  if (!title || !message || !warning || !okBtn) return;

  if (activando) {
    title.textContent = 'Activar centrado en tiempo real';
    message.textContent = 'Cada 10 segundos se consultará tu ubicación para recentrar el mapa.';
    warning.textContent = 'Advertencia: este modo puede consumir más datos y batería.';
    okBtn.textContent = 'Activar';
  } else {
    title.textContent = 'Desactivar centrado en tiempo real';
    message.textContent = 'El mapa dejará de seguir tu ubicación automáticamente.';
    warning.textContent = 'Podés volver a activarlo manteniendo presionado el botón de centrar.';
    okBtn.textContent = 'Desactivar';
  }
}

function mostrarModalConfirmCentradoTiempoReal(onConfirm, activando) {
  const overlay = document.getElementById('confirm-realtime-center-overlay');
  const okBtn = document.getElementById('confirm-realtime-center-ok');
  if (!overlay || !okBtn) {
    const ok = confirm(
      activando
        ? 'Se consultará tu ubicación cada 10 segundos para recentrar el mapa. Puede consumir más datos y batería. ¿Activar?'
        : 'El mapa dejará de seguir tu ubicación automáticamente. ¿Desactivar?'
    );
    if (ok && typeof onConfirm === 'function') onConfirm();
    return;
  }

  actualizarModalConfirmCentradoTiempoReal(Boolean(activando));
  _confirmRealtimeCenterOnConfirm = typeof onConfirm === 'function' ? onConfirm : null;
  overlay.classList.add('active');
  overlay.setAttribute('aria-hidden', 'false');

  const cancelBtn = document.getElementById('confirm-realtime-center-cancel');
  setTimeout(() => {
    (cancelBtn || okBtn).focus?.();
  }, 0);
}

function setupModalConfirmCentradoTiempoReal() {
  const overlay = document.getElementById('confirm-realtime-center-overlay');
  const cancelBtn = document.getElementById('confirm-realtime-center-cancel');
  const okBtn = document.getElementById('confirm-realtime-center-ok');
  if (!overlay || !cancelBtn || !okBtn) return;

  overlay.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'confirm-realtime-center-overlay') {
      ocultarModalConfirmCentradoTiempoReal();
    }
  });
  cancelBtn.addEventListener('click', () => {
    ocultarModalConfirmCentradoTiempoReal();
  });
  okBtn.addEventListener('click', () => {
    const cb = _confirmRealtimeCenterOnConfirm;
    ocultarModalConfirmCentradoTiempoReal();
    if (typeof cb === 'function') cb();
  });

  if (!_confirmRealtimeCenterKeydownBound) {
    _confirmRealtimeCenterKeydownBound = true;
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const active = document.getElementById('confirm-realtime-center-overlay')?.classList.contains('active');
      if (active) ocultarModalConfirmCentradoTiempoReal();
    });
  }
}

function actualizarEstadoBotonCentradoTiempoReal(activo) {
  const btns = document.querySelectorAll('.btn-centrar-trigger, #btn-centrar, #btn-centrar-nav, #btn-centrar-container');
  btns.forEach((btn) => {
    btn.classList.toggle('is-realtime-active', Boolean(activo));
    btn.setAttribute('aria-pressed', activo ? 'true' : 'false');
    btn.setAttribute('title', activo ? 'Centrado en tiempo real activo' : 'Recentrar ubicación');
    btn.setAttribute('aria-label', activo ? 'Desactivar centrado en tiempo real' : 'Recentrar ubicación');
  });

  if (typeof userMarkerHalo !== 'undefined' && userMarkerHalo && userMarkerHalo.getElement) {
    const el = userMarkerHalo.getElement();
    if (el) {
      el.classList.toggle('pulse-halo', Boolean(activo));
    }
  }
}

async function ejecutarCentradoTiempoReal() {
  if (_realtimeCenterBusy) return;
  _realtimeCenterBusy = true;
  try {
    await Centrar();
  } finally {
    _realtimeCenterBusy = false;
  }
}

function activarModoCentradoTiempoReal() {
  if (_realtimeCenterIntervalId) {
    clearInterval(_realtimeCenterIntervalId);
    _realtimeCenterIntervalId = null;
  }

  _realtimeCenterActive = true;
  actualizarEstadoBotonCentradoTiempoReal(true);
  ejecutarCentradoTiempoReal();
  _realtimeCenterIntervalId = setInterval(() => {
    ejecutarCentradoTiempoReal();
  }, REALTIME_CENTER_INTERVAL_MS);
}

function desactivarModoCentradoTiempoReal() {
  if (_realtimeCenterIntervalId) {
    clearInterval(_realtimeCenterIntervalId);
    _realtimeCenterIntervalId = null;
  }

  _realtimeCenterActive = false;
  actualizarEstadoBotonCentradoTiempoReal(false);
}

function setupBotonCentrarTiempoReal() {
  const btns = document.querySelectorAll('.btn-centrar-trigger, #btn-centrar, #btn-centrar-nav, #btn-centrar-container');
  if (!btns.length) return;

  btns.forEach((btn) => {
    const prevHandlers = btn._realtimeCenterHandlers;
    if (prevHandlers) {
      btn.removeEventListener('pointerdown', prevHandlers.handlePointerDown);
      btn.removeEventListener('pointerup', prevHandlers.handlePointerUp);
      btn.removeEventListener('pointercancel', prevHandlers.handlePointerCancel);
      btn.removeEventListener('pointerleave', prevHandlers.handlePointerLeave);
      btn.removeEventListener('click', prevHandlers.handleClick);
    }

    const clearLongPress = () => {
      if (_realtimeCenterLongPressTimer) {
        clearTimeout(_realtimeCenterLongPressTimer);
        _realtimeCenterLongPressTimer = null;
      }
    };

    const handlePointerDown = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      clearLongPress();
      _realtimeCenterSuppressNextClick = false;

      _realtimeCenterLongPressTimer = setTimeout(() => {
        _realtimeCenterSuppressNextClick = true;
        const activando = !_realtimeCenterActive;
        mostrarModalConfirmCentradoTiempoReal(() => {
          if (activando) {
            activarModoCentradoTiempoReal();
          } else {
            desactivarModoCentradoTiempoReal();
          }
        }, activando);
      }, REALTIME_CENTER_LONG_PRESS_MS);
    };

    const handlePointerUp = () => {
      clearLongPress();
    };

    const handlePointerCancel = () => {
      clearLongPress();
      _realtimeCenterSuppressNextClick = false;
    };

    const handlePointerLeave = () => {
      clearLongPress();
    };

    const handleClick = (e) => {
      if (_realtimeCenterSuppressNextClick) {
        e.preventDefault();
        e.stopImmediatePropagation();
        _realtimeCenterSuppressNextClick = false;
        return;
      }
      CentrarYOferécerGuardar();
    };

    btn.addEventListener('pointerdown', handlePointerDown);
    btn.addEventListener('pointerup', handlePointerUp);
    btn.addEventListener('pointercancel', handlePointerCancel);
    btn.addEventListener('pointerleave', handlePointerLeave);
    btn.addEventListener('click', handleClick);

    btn._realtimeCenterHandlers = {
      handlePointerDown,
      handlePointerUp,
      handlePointerCancel,
      handlePointerLeave,
      handleClick,
    };
  });

  actualizarEstadoBotonCentradoTiempoReal(false);
}

function cerrarBottomSheet(force = false) {
  const bs = document.getElementById('bottom-sheet');
  const overlay = document.getElementById('bottom-sheet-overlay');
  const favBtn = document.getElementById('bs-fav-btn');
  const planBtn = document.getElementById('bs-plan-btn');

  // Si hay una petición de arribos en curso, pedir confirmación antes de cerrar.
  if (!force && _arrivalsAbortController) {
    mostrarModalConfirmCerrarArribos(() => {
      try { _arrivalsAbortController?.abort(); } catch { }
      _arrivalsAbortController = null;
      cerrarBottomSheet(true);
    });
    return;
  }

  // Si hay un recorrido planeado activo, confirmar antes de cerrarlo.
  if (!force && recorridoActivo && recorridoActivo.planned) {
    mostrarModalConfirmCerrarRuta(() => cerrarBottomSheet(true));
    return;
  }

  // Limpiar estilos y clases
  if (bs) {
    bs.classList.remove('active');
  }

  const viewMap = document.getElementById('view-map');
  viewMap?.classList.remove('has-detail-open');

  const reajustarMapa = () => {
    if (leafletMap && typeof leafletMap.invalidateSize === 'function') {
      leafletMap.invalidateSize({ animate: false });
    }
  };

  requestAnimationFrame(reajustarMapa);
  setTimeout(reajustarMapa, 120);
  setTimeout(reajustarMapa, 290);

  overlay?.classList.remove('active');

  if (favBtn) {
    favBtn.onclick = null;
  }
  if (planBtn) {
    planBtn.onclick = null;
    planBtn.style.display = 'none';
  }

  // Limpiar recorrido activo y ruta GPS al cerrar
  limpiarRecorrido();
  if (typeof limpiarRutaGpsActiva === 'function') limpiarRutaGpsActiva();
  volverVistaGeneral();
  asegurarVistaMenuEnEscritorio();

  setTimeout(() => {
    void actualizarHudParadaMasCercana();
  }, 280);
}

// SOLO afecta el layout de escritorio (>=1024px, ver el @media al final de index.html).
// Ahí el mapa se interactúa directamente (tocar una parada, el HUD, etc.) sin pasar
// nunca por "Inicio"/"Guardados", así que al cerrar el panel de detalle la columna
// izquierda podía quedar completamente vacía (ninguna vista de menú activa). En mobile
// esto nunca pasa: cerrar el panel simplemente te deja viendo el mapa a pantalla completa,
// que ahí sí es un estado válido.
function asegurarVistaMenuEnEscritorio() {
  if (!window.matchMedia('(min-width: 1024px)').matches) return;

  const dash = document.getElementById('view-dashboard');
  const guardados = document.getElementById('view-guardados');
  const bs = document.getElementById('bottom-sheet');

  const hayMenuActivo = Boolean(dash?.classList.contains('active') || guardados?.classList.contains('active'));
  const hayDetalleAbierto = Boolean(bs?.classList.contains('active'));

  if (!hayMenuActivo && !hayDetalleAbierto) {
    cambiarVista('view-dashboard');
  }
}

/**
 * Carga (y cachea) Datos/redtulum_lineas_horarios_aproximados.json y lo indexa
 * por línea (clave normalizada) para búsqueda rápida.
 */
async function cargarHorariosAproximados() {
  if (_horariosAproximadosPorLinea) return _horariosAproximadosPorLinea;
  if (_horariosAproximadosPromise) return _horariosAproximadosPromise;

  _horariosAproximadosPromise = (async () => {
    const mapa = new Map();
    try {
      const resp = await fetch(HORARIOS_APROXIMADOS_URL, { cache: 'force-cache' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const payload = await resp.json();
      const lineas = Array.isArray(payload?.lines) ? payload.lines : [];
      for (const linea of lineas) {
        const key = normalizarLineaParaLookup(linea?.line);
        if (key && !mapa.has(key)) mapa.set(key, linea);
      }
    } catch (err) {
      console.warn('No se pudo cargar redtulum_lineas_horarios_aproximados.json:', err);
    }
    _horariosAproximadosPorLinea = mapa;
    return mapa;
  })();

  return _horariosAproximadosPromise;
}

function buscarLineaEnHorariosAproximados(mapaLineas, lineaRef) {
  if (!(mapaLineas instanceof Map)) return null;
  for (const clave of obtenerClavesLineaLookup(lineaRef)) {
    if (mapaLineas.has(clave)) return mapaLineas.get(clave);
  }
  return null;
}

/**
 * Busca, dentro de la secuencia de paradas de una línea (dataset aproximado),
 * la parada que mejor coincide con los nombres candidatos de la parada tocada
 * en el mapa (misma lógica de tokens/Jaccard usada para matching de paradas).
 */
function buscarParadaEnLineaAproximada(lineaEntry, candidatosNombre) {
  const stops = Array.isArray(lineaEntry?.stops) ? lineaEntry.stops : [];
  if (!stops.length) return null;

  const candidatos = (Array.isArray(candidatosNombre) ? candidatosNombre : [])
    .filter((c) => typeof c === 'string' && c.trim());
  if (!candidatos.length) return null;

  const normSimple = (s) => String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');

  for (const cand of candidatos) {
    const candNorm = normSimple(cand);
    const stopExacto = stops.find((s) => normSimple(s?.name) === candNorm);
    if (stopExacto) return stopExacto;
  }

  let mejor = null;
  let mejorScore = 0;
  for (const cand of candidatos) {
    const tokensCand = tokenizarNombreParada(cand);
    for (const stop of stops) {
      const score = calcularSimilitudJaccard(tokensCand, tokenizarNombreParada(stop?.name));
      if (score > mejorScore) {
        mejorScore = score;
        mejor = stop;
      }
    }
  }

  return mejorScore >= 0.3 ? mejor : null;
}

const DIAS_SEMANA_HORARIOS_APROX = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

function horaTextoAMinutos(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function minutosATextoHora(mins) {
  const total = Math.round(mins);
  const h = Math.floor(total / 60) % 24;
  const m = ((total % 60) + 60) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Genera las próximas salidas estimadas de una línea en una parada puntual,
 * a partir del horario semanal aproximado (ventana + frecuencia, o salida
 * única, por día) y el offset en minutos de esa parada dentro del recorrido.
 * Es una estimación sintética (interpolación lineal de duración), NO datos
 * en tiempo real ni GPS de la unidad — ver Datos/redtulum_gtfs_aproximado_v2/README.txt.
 */
function generarProximasLlegadasAproximadas(lineaEntry, offsetMin, ahora = new Date(), maxResultados = MAX_HORARIOS_MOSTRAR) {
  const resultados = [];
  const offset = Number.isFinite(offsetMin) ? offsetMin : 0;
  const medianocheHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const minutosDesdeMedianoche = (ahora.getTime() - medianocheHoy.getTime()) / 60000;

  for (let dayOffset = 0; dayOffset < 8 && resultados.length < maxResultados; dayOffset++) {
    const fecha = new Date(medianocheHoy.getTime() + dayOffset * 86400000);
    const diaKey = DIAS_SEMANA_HORARIOS_APROX[fecha.getDay()];
    const sched = lineaEntry?.weekly_schedule?.[diaKey];
    if (!sched || typeof sched !== 'object') continue; // sin servicio ese día

    const salidasBase = [];
    if (sched.type === 'single') {
      const t = horaTextoAMinutos(sched.time);
      if (t != null) salidasBase.push(t);
    } else if (sched.type === 'range') {
      const s = horaTextoAMinutos(sched.start);
      let e = horaTextoAMinutos(sched.end);
      const freq = Number(sched.freq_min);
      if (s != null && e != null && freq > 0) {
        if (e < s) e += 1440; // el servicio cruza la medianoche
        for (let t = s; t <= e + 0.001; t += freq) {
          salidasBase.push(t);
        }
      }
    }

    for (const base of salidasBase) {
      const arriboMin = base + offset; // minutos desde medianoche de "fecha", ya en la parada consultada
      const arriboAbsoluto = dayOffset * 1440 + arriboMin; // minutos desde medianoche de HOY
      if (arriboAbsoluto >= minutosDesdeMedianoche - 0.5) {
        resultados.push({
          minutosDesdeAhora: arriboAbsoluto - minutosDesdeMedianoche,
          dayOffset,
          horaTexto: minutosATextoHora(arriboMin),
        });
      }
    }
  }

  resultados.sort((a, b) => a.minutosDesdeAhora - b.minutosDesdeAhora);
  return resultados.slice(0, maxResultados);
}

function etiquetaDiaRelativoHorarios(dayOffset) {
  if (dayOffset === 0) return '';
  if (dayOffset === 1) return 'mañana ';
  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + dayOffset);
  return `${dias[fecha.getDay()]} `;
}

function renderArribosAproximadosHtml(items, lineaRef, paradaNombre, opts = {}) {
  const titulo = lineaRef ? `Línea ${escapeHtml(lineaRef)}` : 'Línea';
  const volverHtml = htmlFilaVolverALineasDeParada();
  const paradaInfoHtml = paradaNombre
    ? `<p style="margin: 0 0 8px 0; font-size: 12px; color: var(--text-muted, #777);">Parada: ${escapeHtml(paradaNombre)}</p>`
    : '';
  const adsHtml = `<div class="tsj-ad-slot" data-tsj-ads-placeholder="${TSJ_ADS_TOKEN}"></div>`;
  const avisoHtml = `
    <div style="
      padding: 12px 14px;
      border-radius: 10px;
      background: rgba(0, 123, 255, 0.08);
      border: 1px solid rgba(0, 123, 255, 0.25);
      margin: 0 0 14px 0;
    ">
      <p style="margin: 0; font-size: 12px; color: var(--text-secondary, #666); line-height: 1.5;">
        ⏱ Horario aproximado calculado a partir del horario semanal publicado de la línea (no es tiempo real ni GPS de la unidad).
      </p>
    </div>
  `;

  if (opts?.sinDatos) {
    return `
      ${volverHtml}
      <p style="margin: 0 0 14px 0; font-size: 16px; color: var(--text-primary, #333); font-weight: 600;">${titulo}</p>
      ${paradaInfoHtml}
      <p style="font-size: 14px; color: var(--text-muted, #999); text-align: center; padding: 14px 0;">${escapeHtml(opts.mensaje || 'No hay horario aproximado disponible para esta línea.')}</p>
    `;
  }

  if (!items || items.length === 0) {
    return `
      ${volverHtml}
      <p style="margin: 0 0 14px 0; font-size: 16px; color: var(--text-primary, #333); font-weight: 600;">${titulo}</p>
      ${paradaInfoHtml}
      ${avisoHtml}
      <p style="font-size: 14px; color: var(--text-muted, #999); text-align: center; padding: 14px 0;">Sin más servicios programados por ahora.</p>
    `;
  }

  const itemsHtml = items.map((item, i) => {
    const esProximo = i === 0;
    const minRedondeado = Math.max(0, Math.round(item.minutosDesdeAhora));
    const diaTxt = etiquetaDiaRelativoHorarios(item.dayOffset);
    const esPronto = !diaTxt && minRedondeado <= 60;
    const principal = diaTxt ? `${diaTxt}${item.horaTexto}` : (esPronto ? `${minRedondeado} min` : item.horaTexto);
    const subtitulo = diaTxt
      ? 'Próximo día con servicio'
      : (esPronto ? item.horaTexto : (esProximo ? 'Próxima salida estimada' : ''));

    return `
      <li style="
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 16px 14px;
        border-radius: 10px;
        background: ${esProximo ? 'rgba(0,123,255,0.08)' : 'transparent'};
        border: 1px solid ${esProximo ? 'rgba(0,123,255,0.25)' : 'rgba(0,0,0,0.07)'};
        margin-bottom: 10px;
      ">
        <span style="font-size: 28px; font-weight: 700; color: ${esProximo ? '#007BFF' : 'var(--text-primary, #333)'}; min-width: 84px;">${escapeHtml(principal)}</span>
        <span style="font-size: 13px; color: var(--text-secondary, #888);">${escapeHtml(subtitulo)}</span>
      </li>
    `;
  }).join('');

  return `
    ${volverHtml}
    <p style="margin: 0 0 14px 0; font-size: 16px; color: var(--text-primary, #333); font-weight: 600;">${titulo}</p>
    ${paradaInfoHtml}
    ${avisoHtml}
    <h4 style="margin: 0 0 14px 0; font-size: 18px; font-weight: 700; color: var(--text-primary, #222); text-transform: uppercase; letter-spacing: 0.5px;">🚌 Próximas llegadas</h4>
    <ul style="list-style: none; padding: 0; margin: 0;">${itemsHtml}</ul>
    ${adsHtml}
    <p style="margin: 14px 0 0 0; font-size: 11px; color: var(--text-muted, #aaa); text-align: center;">Horario estimado según datos públicos de la línea (Moovit), sin tiempo real.</p>
  `;
}

/**
 * Tarjeta compacta de "próximas llegadas" para insertar dentro de la vista de
 * recorrido completo de una línea (cuando se llegó ahí desde una parada puntual).
 */
function renderArribosPreviewHtml(items, paradaNombre, sinDatos = false) {
  const paradaTxt = paradaNombre ? ` en ${escapeHtml(paradaNombre)}` : '';

  if (sinDatos || !items || items.length === 0) {
    const msg = sinDatos
      ? 'Todavía no tenemos horario aproximado para esta línea.'
      : 'Sin más servicios programados por ahora.';
    return `
      <div style="padding: 14px; border-radius: 12px; background: var(--glass-bg-strong); border: 1px solid var(--glass-border); margin: 12px 0; text-align: center;">
        <p style="margin: 0; font-size: 13px; color: var(--glass-fg); font-weight: 500;">⏱ ${escapeHtml(msg)}</p>
      </div>
    `;
  }

  const chips = items.map((item, i) => {
    const minRedondeado = Math.max(0, Math.round(item.minutosDesdeAhora));
    const diaTxt = etiquetaDiaRelativoHorarios(item.dayOffset);
    const label = diaTxt ? `${diaTxt}${item.horaTexto}` : (minRedondeado <= 60 ? `${minRedondeado} min` : item.horaTexto);
    const esProximo = i === 0;
    return `
      <span style="
        display: inline-flex;
        align-items: center;
        padding: 8px 12px;
        border-radius: 10px;
        background: ${esProximo ? 'rgba(0,123,255,0.12)' : 'rgba(0,0,0,0.05)'};
        border: 1px solid ${esProximo ? 'rgba(0,123,255,0.3)' : 'rgba(0,0,0,0.08)'};
      ">
        <span style="font-size: ${esProximo ? '18px' : '15px'}; font-weight: 700; color: ${esProximo ? '#007BFF' : 'var(--glass-fg)'};">${escapeHtml(label)}</span>
      </span>
    `;
  }).join('');

  return `
    <div style="padding: 12px 14px; border-radius: 12px; background: var(--glass-bg-strong); border: 1px solid var(--glass-border); margin: 12px 0;">
      <p style="margin: 0 0 10px 0; font-size: 12px; color: var(--text-muted, #888); font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px;">⏱ Próximas llegadas${paradaTxt}</p>
      <div style="display: flex; gap: 8px; flex-wrap: wrap;">${chips}</div>
      <p style="margin: 10px 0 0 0; font-size: 10.5px; color: var(--text-muted, #999);">Estimado según horario publicado, no es tiempo real.</p>
    </div>
  `;
}

async function mostrarArribosParaParadaYLinea(paradaFeature, lineaRef, lineaNombre = '') {
  const ref = String(lineaRef || '').trim();
  const name = String(lineaNombre || '').trim();
  const feature = paradaFeature || window._currentFeature;
  const paradaNombreBase = obtenerNombreParadaBase(feature);
  const subtitulo = paradaNombreBase ? `Parada: ${paradaNombreBase}` : '';
  const titulo = `Línea ${ref}`;

  abrirBottomSheet(titulo, renderEstadoCargaArribos(ref, name), 'linea', subtitulo);

  try {
    const mapaHorarios = await cargarHorariosAproximados();
    const lineaEntry = buscarLineaEnHorariosAproximados(mapaHorarios, ref);

    if (!lineaEntry) {
      abrirBottomSheet(titulo, renderArribosAproximadosHtml([], ref, paradaNombreBase, {
        sinDatos: true,
        mensaje: 'Todavía no tenemos horario aproximado cargado para esta línea.',
      }), 'linea', subtitulo);
      return;
    }

    const candidatos = obtenerCandidatosNombreParada(feature, paradaNombreBase);
    const stopMatch = buscarParadaEnLineaAproximada(lineaEntry, candidatos);
    const offsetMin = Number(stopMatch?.est_offset_min) || 0;

    const items = generarProximasLlegadasAproximadas(lineaEntry, offsetMin, new Date());
    abrirBottomSheet(titulo, renderArribosAproximadosHtml(items, ref, paradaNombreBase), 'linea', subtitulo);
  } catch (err) {
    console.warn('Error calculando horario aproximado de arribos:', err);
    abrirBottomSheet(titulo, renderArribosAproximadosHtml([], ref, paradaNombreBase, {
      sinDatos: true,
      mensaje: 'No se pudo calcular el horario aproximado. Intenta de nuevo.',
    }), 'linea', subtitulo);
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

  const shouldDraw = !(opts && typeof opts === 'object' && opts.draw === false);
  if (shouldDraw) {
    const cColor = getColorForLinea(lineaRef || recorridoActivo?.ref);
    for (const item of seleccion) {
      const icon = obtenerIconoParadaLeaflet(cColor);
      const marker = L.marker([item.lat, item.lng], icon ? { icon } : undefined).addTo(layerParadas);
      marker.on('click', () => {
        // Consultar arribos directamente al tocar la parada.
        const ref = String(lineaRef || '').trim() || String(recorridoActivo?.ref || '').trim();
        const name = String(lineaNombre || '').trim() || String(recorridoActivo?.name || '').trim();
        void mostrarArribosParaParadaYLinea(item.feature, ref, name);
      });
    }
  }

  return seleccion;
}

function abrirBottomSheetFavoritos() {
  cambiarVista('view-guardados');
}

// Funcionalidad previa de drag purgada: el panel ahora usa la vista dividida fluida
function setupBottomSheetDrag() {
  // Purged: No se requieren controladores de arrastre en la vista dividida
}

function iniciarCarruselHeroDashboard() {
  const slides = document.querySelectorAll('.hero-bg-slide');
  if (!slides || slides.length <= 1) return;

  let slideIndex = 0;
  setInterval(() => {
    slides[slideIndex]?.classList.remove('active');
    slideIndex = (slideIndex + 1) % slides.length;
    slides[slideIndex]?.classList.add('active');
  }, 5500);
}

// Inicializar cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setupBottomSheetDrag();
    setupModalConfirmCerrarRuta();
    setupModalConfirmCentradoTiempoReal();
    setupBotonCentrarTiempoReal();
    setupNavegacion();
    setupDashboardSearch();
    setupGuardadosSearch();
    setupPreferenciaHudParada();
    setupTarjetaParadaCercanaDashboard();
    setupToggleTemaOscuro();
    renderHistorialDashboard();
    renderSeccionGuardados();
    renderAccesosRapidosDashboard();
    void actualizarTarjetaParadaCercanaDashboard();
    iniciarCarruselHeroDashboard();
  });
} else {
  setupBottomSheetDrag();
  setupModalConfirmCerrarRuta();
  setupModalConfirmCentradoTiempoReal();
  setupBotonCentrarTiempoReal();
  setupNavegacion();
  setupDashboardSearch();
  setupGuardadosSearch();
  setupPreferenciaHudParada();
  setupTarjetaParadaCercanaDashboard();
  setupToggleTemaOscuro();
  renderHistorialDashboard();
  renderSeccionGuardados();
  renderAccesosRapidosDashboard();
  void actualizarTarjetaParadaCercanaDashboard();
  iniciarCarruselHeroDashboard();
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

async function Centrar(esRecentradoManual = false) {
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
    cargarLF(ubicacion, ZOOM_CALLE);
    asegurarMarcadorUsuario(ubicacion.lat, ubicacion.lng);
    mostrarMarcadorUsuario();
    await dibujarParadasCercanas(ubicacion);
    void actualizarHudParadaMasCercana();
  } catch (error) {
    console.error('Error:', error.message ?? error);
  }
}

async function CentrarYOferécerGuardar() {
  const btns = document.querySelectorAll('.btn-centrar-trigger, #btn-centrar, #btn-centrar-nav, #btn-centrar-container');
  btns.forEach((btn) => btn.classList.add('is-loading'));
  try {
    await Centrar(true);
  } finally {
    btns.forEach((btn) => btn.classList.remove('is-loading'));
  }
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

  const nombreLugar = generarNombreUbicacionGuardada('current');
  abrirBottomSheetGuardarUbicacion(nombreLugar, lat, lng, 'current');
}

function generarNombreUbicacionGuardada(contexto = 'punto') {
  const ahora = new Date();
  const dia = ahora.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
  const hora = ahora.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (contexto === 'current') {
    return `Mi ubicación (${dia}, ${hora} hs)`;
  }
  return `Punto en el mapa (${dia}, ${hora} hs)`;
}

function abrirBottomSheetGuardarUbicacion(nombreLugar, lat, lng, contexto = 'current', paradaCercana = null) {
  const safeLat = Number(lat);
  const safeLng = Number(lng);
  if (Number.isFinite(safeLat) && Number.isFinite(safeLng)) {
    const z = (leafletMap && typeof leafletMap.getZoom === 'function') ? leafletMap.getZoom() : ZOOM_CALLE;
    establecerVistaMapaPunto(safeLat, safeLng, z);
    window._currentFeature = null;
    centrarMapaEnPunto(safeLat, safeLng, z);
  }

  window._currentLugar = { nombre: nombreLugar, lat: safeLat, lng: safeLng };

  let tituloHeader = 'Guardar ubicación';
  let subtituloHeader = 'Punto seleccionado en el mapa';

  if (contexto === 'search') {
    tituloHeader = nombreLugar || 'Lugar encontrado';
    subtituloHeader = 'Lugar encontrado';
  } else if (contexto === 'current') {
    tituloHeader = 'Tu ubicación';
    subtituloHeader = 'Ubicación actual';
  } else if (contexto === 'longpress') {
    tituloHeader = 'Punto en el mapa';
    subtituloHeader = 'Punto seleccionado';
  }

  const lineasCercanas = paradaCercana?.feature ? obtenerLineasDetalleDesdeRelations(paradaCercana.feature) : [];
  let lineasHtml = '';
  if (lineasCercanas.length) {
    const itemsHtml = lineasCercanas.map((l) => renderBotonLineaHtml({ ref: l.ref, name: l.name })).join('');

    const paradaNombre = paradaCercana.feature?.properties?.name || 'Parada cercana';
    const distMetros = Number.isFinite(paradaCercana.lat) && Number.isFinite(paradaCercana.lng)
      ? Math.round(calcularDistancia(safeLat, safeLng, paradaCercana.lat, paradaCercana.lng))
      : null;
    const distTexto = distMetros != null ? ` (a ${distMetros}m)` : '';

    lineasHtml = `
      <div style="margin: 4px 0 10px 0;">
        <p style="margin: 0 0 10px 0; font-size: 14px; font-weight: 700; color: #93c5fd;">Líneas en ${escapeHtml(paradaNombre)}${distTexto}:</p>
        <ul class="lineas-list">${itemsHtml}</ul>
      </div>
    `;
  }

  const favsLugares = obtenerLugaresFavs();
  const esLugarFav = favsLugares.some((f) => esMismoLugarGuardado(f, { lat: safeLat, lng: safeLng }) || f.nombre === nombreLugar);
  const saveLugarHtml = `
    <div class="save-location-sheet" id="save-lugar-container" style="${esLugarFav ? 'display: none;' : ''}">
      <p class="save-location-title">¿Guardar esta ubicación?</p>
      <p class="save-location-description">
        Podrás acceder rápidamente desde tu sección de <strong>Guardados</strong> y planificar viajes cuando quieras.
      </p>
      <div class="save-location-field">
        <label for="input-nombre-lugar" class="save-location-label">
          Nombre o referencia
        </label>
        <input
          id="input-nombre-lugar"
          type="text"
          class="save-location-input"
          value="${escapeHtml(nombreLugar)}"
          placeholder="Ej: Casa, Trabajo, Gimnasio..."
          maxlength="60"
          onkeydown="if(event.key==='Enter'){event.preventDefault();document.querySelector('button[data-save-lugar=\\'1\\']')?.click();}"
        />
      </div>
      <div class="save-location-buttonarea">
        <button
          type="button"
          class="btn-save-location-primary"
          data-save-lugar="1"
          data-lugar-nombre="${escapeHtml(nombreLugar)}"
          data-lat="${String(safeLat)}"
          data-lng="${String(safeLng)}"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"></path>
          </svg>
          <span>Guardar en mis lugares</span>
        </button>
      </div>
    </div>
  `;

  const html = `
    <div style="display: flex; flex-direction: column; gap: 12px; padding: 4px 0 16px 0;">
      <ul class="bs-nav-rows">
        <li>
          <button type="button" class="btn-nav-row" onclick="iniciarPlaneoRutaHaciaCoordenadas('${escapeHtml(nombreLugar)}', ${safeLat}, ${safeLng})">
            🎯 Planificar viaje en colectivo hasta aquí
          </button>
        </li>
      </ul>

      ${lineasHtml}

      ${saveLugarHtml}

      <div class="tsj-ad-slot" ${TSJ_ADS_PLACEHOLDER_ATTR}="${TSJ_ADS_TOKEN}"></div>
    </div>
  `;

  abrirBottomSheet(escapeHtml(tituloHeader), html, 'ubicacion', esLugarFav ? 'Ubicación guardada' : subtituloHeader);
}

function iniciarPlaneoRutaHaciaCoordenadas(nombre, lat, lng) {
  _routePlanTarget = { feature: null, nombre: String(nombre || 'Destino'), lat: Number(lat), lng: Number(lng), stopId: null };
  void mostrarOpcionesRutaParaTarget(true);
}

function abrirBottomSheetLugarGuardado(nombreLugar, lat, lng, paradaCercana = null) {
  const safeLat = Number(lat);
  const safeLng = Number(lng);
  if (Number.isFinite(safeLat) && Number.isFinite(safeLng)) {
    establecerVistaMapaPunto(safeLat, safeLng, leafletMap?.getZoom() || ZOOM_CALLE);
    window._currentFeature = null;
  }

  window._currentLugar = { nombre: nombreLugar, lat: safeLat, lng: safeLng };

  const lineasCercanas = paradaCercana?.feature ? obtenerLineasDetalleDesdeRelations(paradaCercana.feature) : [];
  let lineasHtml = '';
  if (lineasCercanas.length) {
    const itemsHtml = lineasCercanas.map((l) => renderBotonLineaHtml({ ref: l.ref, name: l.name })).join('');

    const paradaNombre = paradaCercana.feature?.properties?.name || 'Parada cercana';
    const distMetros = Number.isFinite(paradaCercana.lat) && Number.isFinite(paradaCercana.lng)
      ? Math.round(calcularDistancia(safeLat, safeLng, paradaCercana.lat, paradaCercana.lng))
      : null;
    const distTexto = distMetros != null ? ` (a ${distMetros}m)` : '';

    lineasHtml = `
      <div style="margin: 4px 0 10px 0;">
        <p style="margin: 0 0 10px 0; font-size: 14px; font-weight: 700; color: #93c5fd;">Líneas en ${escapeHtml(paradaNombre)}${distTexto}:</p>
        <ul class="lineas-list">${itemsHtml}</ul>
      </div>
    `;
  }

  const favsLugares = obtenerLugaresFavs();
  const esLugarFav = favsLugares.some((f) => esMismoLugarGuardado(f, { lat: safeLat, lng: safeLng }) || f.nombre === nombreLugar);
  const saveLugarHtml = `
    <div class="save-location-sheet" id="save-lugar-container" style="${esLugarFav ? 'display: none;' : ''}">
      <p class="save-location-title">¿Guardar esta ubicación?</p>
      <p class="save-location-description">
        Podrás acceder rápidamente desde tu sección de <strong>Guardados</strong> y planificar viajes cuando quieras.
      </p>
      <div class="save-location-field">
        <label for="input-nombre-lugar" class="save-location-label">
          Nombre o referencia
        </label>
        <input
          id="input-nombre-lugar"
          type="text"
          class="save-location-input"
          value="${escapeHtml(nombreLugar)}"
          placeholder="Ej: Casa, Trabajo, Gimnasio..."
          maxlength="60"
          onkeydown="if(event.key==='Enter'){event.preventDefault();document.querySelector('button[data-save-lugar=\\'1\\']')?.click();}"
        />
      </div>
      <div class="save-location-buttonarea">
        <button
          type="button"
          class="btn-save-location-primary"
          data-save-lugar="1"
          data-lugar-nombre="${escapeHtml(nombreLugar)}"
          data-lat="${String(safeLat)}"
          data-lng="${String(safeLng)}"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"></path>
          </svg>
          <span>Guardar en mis lugares</span>
        </button>
      </div>
    </div>
  `;

  const html = `
    <div style="display: flex; flex-direction: column; gap: 10px; padding: 4px 0 16px 0;">
      <ul class="bs-nav-rows">
        <li>
          <button type="button" class="btn-nav-row" onclick="iniciarPlaneoRutaHaciaCoordenadas('${escapeHtml(nombreLugar)}', ${safeLat}, ${safeLng})">
            🎯 Planificar viaje en colectivo hasta aquí
          </button>
        </li>
      </ul>
      ${lineasHtml}
      ${saveLugarHtml}
      <div class="tsj-ad-slot" ${TSJ_ADS_PLACEHOLDER_ATTR}="${TSJ_ADS_TOKEN}"></div>
    </div>
  `;

  abrirBottomSheet(escapeHtml(nombreLugar), html, 'ubicacion', esLugarFav ? 'Ubicación guardada' : '');
}

function guardarUbicacionActualDesdeBottomSheet(nombreLugar, lat, lng) {
  agregarLugarAFavoritos(nombreLugar, lat, lng, true);
  const btn = document.querySelector('button[data-save-lugar="1"]');
  if (btn) {
    btn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 6 9 17l-5-5"></path>
      </svg>
      <span>¡Guardado en tus lugares!</span>
    `;
    btn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
  }
  setTimeout(() => {
    actualizarEstadoBotonFavoritos();
  }, 450);
}

function guardarLineaActualDesdeBottomSheet(ref, name) {
  agregarLineaAFavoritos({ ref, name }, true);
  const btn = document.querySelector('button[data-save-linea="1"]');
  if (btn) {
    btn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 6 9 17l-5-5"></path>
      </svg>
      <span>¡Guardada en tus líneas!</span>
    `;
    btn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
  }
  setTimeout(() => {
    actualizarEstadoBotonFavoritos();
  }, 450);
}

function guardarParadaActualDesdeBottomSheet(feature, customLabel = '') {
  if (!feature) return;
  const finalLabel = (typeof customLabel === 'string' && customLabel.trim() && customLabel.trim().toLowerCase() !== 'parada desconocida')
    ? customLabel.trim()
    : (typeof obtenerNombreParadaCompleto === 'function' ? obtenerNombreParadaCompleto(feature) : obtenerEtiquetaParada(feature));
  agregarParadaAFavoritos(feature, finalLabel);
  const btn = document.querySelector('button[data-save-parada="1"]');
  if (btn) {
    btn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 6 9 17l-5-5"></path>
      </svg>
      <span>¡Guardada en tus paradas!</span>
    `;
    btn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
  }
  setTimeout(() => {
    actualizarEstadoBotonFavoritos();
  }, 450);
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

function getTextColorForBg(hex) {
  if (hex === '#fbc02d' || hex === '#8bc34a' || hex === '#03a9f4') return '#111827';
  return '#ffffff';
}

function getColorForLinea(ref) {
  if (!ref) return '#7c7c7cff';
  const refStr = String(ref).toUpperCase().trim();

  if (refStr.startsWith('TEO')) return '#8bc34a'; // Verde (Troncal Este-Oeste)
  if (refStr.startsWith('TNS') || refStr === 'T' || refStr.startsWith('T-') || refStr.startsWith('T ')) return '#e53935'; // Rojo (Troncal Norte-Sur)
  if (refStr === 'A' || refStr.startsWith('A-') || refStr.startsWith('A ')) return '#8e24aa'; // Violeta (Corredor Interhospitalario)

  const match = refStr.match(/\d+/);
  if (match) {
    const num = parseInt(match[0], 10);
    if (num === 10 || num === 20) return '#fbc02d'; // Amarillo (Perimetrales Suroeste/Sureste)
    if (num === 30) return '#03a9f4'; // Celeste (Perimetral Este)
    if (num === 40) return '#8bc34a'; // Verde manzana (Perimetral Norte)

    if (num >= 100 && num <= 130) return '#e91e63';
    if (num >= 140 && num <= 162) return '#8e24aa';
    if (num >= 200 && num <= 266) return '#fbc02d';
    if (num >= 300 && num <= 364) return '#03a9f4';
    if (num >= 400 && num <= 462) return '#8bc34a';
    if (num >= 500 && num <= 850) return '#ff9800';
  }

  return '#007BFF'; // Default fallback
}

function formatBadgeLinea(ref) {
  let r = String(ref || '').trim();
  if (!r) return '';
  // Eliminar prefijo 'L' o 'l' si estuviera presente (ej: 'L129' -> '129')
  if (/^l\s*\d+/i.test(r)) {
    r = r.replace(/^l\s*/i, '');
  }
  return r;
}

function renderBotonLineaHtml({ ref, name, extraAttrs = '', extraBadgeClass = '' } = {}) {
  const refClean = String(ref || '').trim();
  const nameClean = String(name || '').trim();
  const refDisplay = refClean ? escapeHtml(refClean) : (nameClean ? escapeHtml(nameClean) : 'Línea');
  const refAttr = escapeHtml(refClean);
  const nameAttr = escapeHtml(nameClean);
  const nameDisplay = nameClean ? `<span class="linea-button-name">${escapeHtml(nameClean)}</span>` : '';
  const c = getColorForLinea(refClean);
  const tc = getTextColorForBg(c);
  const badgeText = formatBadgeLinea(refClean);
  const badgeClass = extraBadgeClass ? `linea-button-badge ${extraBadgeClass}` : 'linea-button-badge';

  return `<li><button type="button" class="btn-linea" style="--line-color: ${c}; --line-text: ${tc};" data-linea-ref="${refAttr}" data-linea-name="${nameAttr}" ${extraAttrs}><span class="${badgeClass}" style="background-color: ${c}; color: ${tc};">${escapeHtml(badgeText)}</span><div class="linea-rail-col"><div class="linea-tube-seg"><span class="linea-dot"></span></div></div><div class="linea-button-info"><span class="linea-button-ref">Línea ${refDisplay}</span>${nameDisplay}</div><svg class="linea-button-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></button></li>`;
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

function aplicarModoOscuro() {
  document.documentElement.classList.add('dark-mode');
  document.documentElement.classList.remove('no-transparency');
  document.head.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#f3f1ec');
}

function aplicarTransparencia() {
  document.documentElement.classList.remove('no-transparency');
}

const THEME_COLOR_CLARO = '#f3f1ec';
const THEME_COLOR_OSCURO = '#141419';

/**
 * Alterna entre el tema claro (por defecto) y un modo oscuro real: agrega/quita
 * la clase zm-theme-dark en <html> (paleta oscura definida en el CSS), y con
 * ella el mapa aplica el filtro que lo oscurece "gratis" (ver CSS de
 * #map .leaflet-tile-pane). En modo claro las tiles de OSM van sin filtro.
 */
function aplicarPreferenciaTemaOscuro(activo) {
  const esOscuro = Boolean(activo);
  document.documentElement.classList.toggle('zm-theme-dark', esOscuro);
  document.head.querySelector('meta[name="theme-color"]')?.setAttribute('content', esOscuro ? THEME_COLOR_OSCURO : THEME_COLOR_CLARO);

  const btn = document.getElementById('btn-theme-toggle');
  if (btn) {
    btn.setAttribute('aria-pressed', esOscuro ? 'true' : 'false');
    const label = esOscuro ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }
}

function setupToggleTemaOscuro() {
  const btn = document.getElementById('btn-theme-toggle');
  aplicarPreferenciaTemaOscuro(leerBoolLocalStorage(STORAGE_DARK_MODE_KEY, false));

  btn?.addEventListener('click', () => {
    const esOscuro = !document.documentElement.classList.contains('zm-theme-dark');
    aplicarPreferenciaTemaOscuro(esOscuro);
    guardarBoolLocalStorage(STORAGE_DARK_MODE_KEY, esOscuro);
  });
}

function cambiarVista(vistaId) {
  if (vistaId !== 'view-map') {
    // Solo cerrar si en verdad hay algo abierto: cerrarBottomSheet() termina llamando a
    // asegurarVistaMenuEnEscritorio(), que en escritorio puede volver a llamar a
    // cambiarVista('view-dashboard') si no hay ningún menú activo todavía (porque esta
    // misma función no marcó la vista como activa hasta más abajo). Sin esta guarda,
    // esas dos funciones se llaman entre sí sin parar y revientan el call stack.
    const bsAbierto = document.getElementById('bottom-sheet')?.classList.contains('active');
    if (bsAbierto && typeof cerrarBottomSheet === 'function') cerrarBottomSheet(true);
    if (_pickingOrigenEnMapa) cancelarSeleccionOrigenEnMapa();
  }

  const vistas = document.querySelectorAll('.app-view');
  vistas.forEach((v) => {
    if (v.id === vistaId) {
      v.classList.add('active');
    } else {
      v.classList.remove('active');
    }
  });

  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach((tab) => {
    if (tab.dataset.view === vistaId) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  if (vistaId === 'view-map') {
    requestAnimationFrame(() => reaplicarVistaMapaActiva());
    setTimeout(() => reaplicarVistaMapaActiva(), 50);
    setTimeout(() => reaplicarVistaMapaActiva(), 150);
    setTimeout(() => reaplicarVistaMapaActiva(), 260);
    setTimeout(() => { void actualizarHudParadaMasCercana(); }, 320);
  } else {
    document.getElementById('map-nearest-stop-hud')?.classList.remove('visible');
    if (typeof limpiarRutaGpsActiva === 'function') limpiarRutaGpsActiva();
    if (vistaId === 'view-guardados') {
      renderSeccionGuardados();
    } else if (vistaId === 'view-dashboard') {
      // Volver al dashboard cierra la sesión de planeo: la próxima ruta arranca de nuevo desde el GPS.
      _routePlanOrigin = null;
      renderHistorialDashboard();
      renderAccesosRapidosDashboard();
      void actualizarTarjetaParadaCercanaDashboard();
    }
  }
}

// ─── Ir al mapa deslizando en horizontal ───────────────────────────────────
// Sigue el orden de los tabs (Inicio · Mapa · Guardados): desde Inicio el mapa está a
// la derecha, así que se llega deslizando hacia la izquierda; desde Guardados está a
// la izquierda y se llega deslizando hacia la derecha.
//
// A propósito NO se engancha en la vista del mapa: ahí el arrastre horizontal es para
// mover el mapa, y un gesto que además cambiara de pantalla lo haría inusable.
const SWIPE_NAV_UMBRAL_PX = 64;
const SWIPE_NAV_ARRASTRE_MAX_PX = 120;

// Momento del último cambio de vista por gesto. Un arrastre que termina encima de un
// botón dispara igual su click: se descarta el que llegue justo después de navegar.
let _swipeNavUltimaNavegacion = 0;

function swipeNavHabilitado() {
  // En escritorio el mapa ya ocupa de forma permanente la mitad derecha y la pestaña
  // "Mapa" ni siquiera se muestra, así que el gesto no tendría a dónde llevar.
  return window.matchMedia('(max-width: 1023px)').matches;
}

// Scroller horizontal bajo el dedo al que todavía le queda recorrido hacia ese lado
// (la fila de accesos rápidos del inicio, la de filtros de guardados). Si lo hay, el
// gesto le pertenece a él y no tiene que cambiar de pantalla.
function scrollerHorizontalConRecorrido(target, dx) {
  let el = target instanceof Element ? target : null;
  while (el && el !== document.body) {
    const max = el.scrollWidth - el.clientWidth;
    if (max > 1) {
      if (dx > 0 && el.scrollLeft > 1) return el;
      if (dx < 0 && el.scrollLeft < max - 1) return el;
    }
    el = el.parentElement;
  }
  return null;
}

// Desplaza a mano una de esas filas. Hace falta porque el contenedor declara
// touch-action: pan-y para poder quedarse con el gesto horizontal, y eso le saca a
// sus hijos el panning horizontal nativo.
function arrastrarScrollerHorizontal(el, scrollInicial, dx) {
  if (!el) return;
  const max = el.scrollWidth - el.clientWidth;
  el.scrollLeft = Math.max(0, Math.min(max, scrollInicial - dx));
}

function setupNavegacionPorDeslizamiento() {
  const vistas = [
    // direccion: hacia qué lado hay que deslizar para llegar al mapa.
    { el: document.getElementById('view-dashboard'), direccion: -1 },
    { el: document.getElementById('view-guardados'), direccion: 1 },
  ];

  for (const { el, direccion } of vistas) {
    if (!el) continue;

    let inicioX = 0;
    let inicioY = 0;
    let siguiendo = false;
    let esHorizontal = false;
    // Fila horizontal que el gesto está moviendo, si arrancó sobre una.
    let scrollerArrastrado = null;
    let scrollerInicial = 0;

    const soltar = () => {
      siguiendo = false;
      esHorizontal = false;
      scrollerArrastrado = null;
      el.classList.remove('is-swiping');
      document.body.classList.remove('is-swiping-to-map');
      // Se limpian los estilos en línea para que vuelva a mandar el CSS de .app-view.
      el.style.transform = '';
    };

    el.addEventListener('pointerdown', (ev) => {
      if (!swipeNavHabilitado()) return;
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      siguiendo = true;
      esHorizontal = false;
      inicioX = ev.clientX;
      inicioY = ev.clientY;
    });

    el.addEventListener('pointermove', (ev) => {
      if (!siguiendo) return;
      const dx = ev.clientX - inicioX;
      const dy = ev.clientY - inicioY;

      // Si el gesto es de una fila horizontal, se la desplaza y no se navega.
      if (scrollerArrastrado) {
        arrastrarScrollerHorizontal(scrollerArrastrado, scrollerInicial, dx);
        return;
      }

      // El eje se decide una sola vez, apenas el gesto se define.
      if (!esHorizontal) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        // Gesto vertical: es scroll de la lista, se lo deja al navegador.
        if (Math.abs(dx) <= Math.abs(dy) * 1.2) {
          siguiendo = false;
          return;
        }
        const fila = scrollerHorizontalConRecorrido(ev.target, dx);
        if (fila) {
          scrollerArrastrado = fila;
          scrollerInicial = fila.scrollLeft;
          arrastrarScrollerHorizontal(fila, scrollerInicial, dx);
          return;
        }
        esHorizontal = true;
        el.classList.add('is-swiping');
        // Deja ver el mapa por detrás mientras se arrastra: sin esto el hueco que va
        // quedando muestra el fondo pelado y no se entiende a dónde lleva el gesto.
        document.body.classList.add('is-swiping-to-map');
      }

      // Hacia el lado del mapa la vista sigue al dedo; hacia el otro no hay nada, así
      // que apenas se mueve (resistencia) para que se note que ahí no hay camino.
      // Sin tocar la opacidad: la vista se mueve opaca, como una tarjeta que se corre
      // y destapa el mapa. Si se la va transparentando, las dos capas se superponen a
      // media transición y no se lee ni una ni la otra.
      const avance = dx * direccion > 0 ? dx : dx * 0.18;
      const limitado = Math.max(-SWIPE_NAV_ARRASTRE_MAX_PX, Math.min(SWIPE_NAV_ARRASTRE_MAX_PX, avance));
      el.style.transform = `translateX(${limitado}px)`;
    });

    const terminarGestoVista = (ev) => {
      if (!siguiendo) {
        soltar();
        return;
      }
      const dx = ev.clientX - inicioX;
      const llegaAlMapa = esHorizontal
        && dx * direccion > 0
        && Math.abs(dx) >= SWIPE_NAV_UMBRAL_PX;

      soltar();

      if (llegaAlMapa) {
        _swipeNavUltimaNavegacion = Date.now();
        cambiarVista('view-map');
      }
    };

    el.addEventListener('pointerup', terminarGestoVista);
    // pointercancel llega cuando el navegador se queda con el gesto para hacer scroll:
    // ahí no hay nada que decidir, solo volver la vista a su lugar.
    el.addEventListener('pointercancel', soltar);
  }

  // Un arrastre que termina sobre una tarjeta o un botón dispara su click igual. Se
  // descarta en fase de captura el click inmediatamente posterior a haber navegado.
  document.addEventListener('click', (ev) => {
    if (Date.now() - _swipeNavUltimaNavegacion > 350) return;
    ev.stopPropagation();
    ev.preventDefault();
  }, true);
}

function setupNavegacion() {
  setupNearestStopHud();
  setupMapPickingBanner();
  setupNavegacionPorDeslizamiento();

  const tabs = document.querySelectorAll('.nav-tab[data-view]');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const targetView = tab.dataset.view;
      if (targetView) cambiarVista(targetView);
    });
  });

  const btnQuickMap = document.getElementById('btn-quick-map');
  btnQuickMap?.addEventListener('click', () => {
    cambiarVista('view-map');
  });
}

let dashSearchTimeout = null;
let dashSearchAbort = null;
let dashSearchSeq = 0;
let _dashSearchFilter = 'todo'; // 'todo' | 'linea' | 'parada' | 'calle'

function setupDashboardSearch() {
  const input = document.getElementById('dash-search-input');
  const clearBtn = document.getElementById('dash-search-clear');
  const resultsDiv = document.getElementById('dash-search-results');
  const filtersDiv = document.getElementById('dash-search-filters');
  const clearHistoryBtn = document.getElementById('btn-clear-recent-searches');

  clearHistoryBtn?.addEventListener('click', () => {
    guardarHistorialBusqueda([]);
    renderHistorialDashboard();
  });

  clearBtn?.addEventListener('click', () => {
    if (input) input.value = '';
    clearBtn.style.display = 'none';
    if (resultsDiv) {
      resultsDiv.style.display = 'none';
      resultsDiv.innerHTML = '';
    }
  });

  const placeholdersPorFiltro = {
    todo: 'Buscar líneas, paradas o calles...',
    linea: 'Buscar una línea por número o nombre...',
    calle: 'Buscar una calle o dirección...',
    parada: 'Buscar una parada por nombre...',
  };

  filtersDiv?.querySelectorAll('button[data-search-filter]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const filtro = chip.dataset.searchFilter || 'todo';
      // Tocar el filtro ya activo lo desactiva y vuelve a buscar en todas las categorías.
      _dashSearchFilter = filtro === _dashSearchFilter ? 'todo' : filtro;

      filtersDiv.querySelectorAll('button[data-search-filter]').forEach((c) => {
        const activo = c.dataset.searchFilter === _dashSearchFilter;
        c.classList.toggle('active', activo);
        c.setAttribute('aria-pressed', activo ? 'true' : 'false');
      });

      if (input) input.placeholder = placeholdersPorFiltro[_dashSearchFilter] || placeholdersPorFiltro.todo;

      const val = input?.value.trim() || '';
      if (val.length >= 2) {
        if (dashSearchTimeout) clearTimeout(dashSearchTimeout);
        ejecutarBusquedaDashboard(val);
      }
    });
  });

  if (!input) return;

  input.addEventListener('input', () => {
    const val = input.value.trim();
    if (clearBtn) clearBtn.style.display = val ? 'flex' : 'none';

    if (dashSearchTimeout) clearTimeout(dashSearchTimeout);

    if (!val) {
      if (resultsDiv) {
        resultsDiv.style.display = 'none';
        resultsDiv.innerHTML = '';
      }
      return;
    }

    if (val.length < 2) {
      if (resultsDiv) {
        resultsDiv.style.display = 'flex';
        resultsDiv.innerHTML = '<p class="search-results-hint">Escribe al menos 2 letras</p>';
      }
      return;
    }

    // Búsqueda local (líneas/paradas) sin debounce: es instantánea porque no pega a la red.
    dashSearchTimeout = setTimeout(() => {
      ejecutarBusquedaDashboard(val);
    }, 120);
  });
}

function crearBotonResultadoBusquedaDashboard(item, resultsDiv) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'search-unified-item';

  const cerrarYLimpiar = () => {
    resultsDiv.style.display = 'none';
    const inp = document.getElementById('dash-search-input');
    if (inp) inp.value = '';
    const clr = document.getElementById('dash-search-clear');
    if (clr) clr.style.display = 'none';
  };

  if (item.tipoResultado === 'linea') {
    const ref = String(item.ref || '').trim();
    const name = String(item.name || '').trim();
    const c = getColorForLinea(ref);
    const tc = getTextColorForBg(c);

    btn.innerHTML = `
      <div class="search-unified-item-main">
        <span class="search-unified-item-title">${escapeHtml(name || `Línea ${ref}`)}</span>
        <span class="search-unified-item-sub">Línea RedTulum</span>
      </div>
      <span class="search-badge-line" style="background-color: ${c}; color: ${tc};">${escapeHtml(ref)}</span>
    `;

    btn.addEventListener('click', () => {
      agregarAHistorialBusqueda({ tipo: 'linea', ref, name });
      cerrarYLimpiar();
      cambiarVista('view-map');
      void mostrarRecorridoDeLinea(ref, name);
    });
  } else if (item.tipoResultado === 'parada') {
    const nombre = String(item.nombre || 'Parada').trim();
    const lat = Number(item.lat);
    const lng = Number(item.lng);
    const paradaId = item.paradaId || '';

    btn.innerHTML = `
      <div class="search-unified-item-main">
        <span class="search-unified-item-title">${escapeHtml(nombre)}</span>
        <span class="search-unified-item-sub">Parada de colectivos</span>
      </div>
      <span style="color: #38bdf8; font-size: 14px;">🚏</span>
    `;

    btn.addEventListener('click', () => {
      agregarAHistorialBusqueda({ tipo: 'parada', nombre, lat, lng });
      cerrarYLimpiar();
      void centrarEnParadaGuardada({ id: paradaId, nombre, lat, lng });
    });
  } else {
    const nombre = String(item.nombre || item.display_name || 'Lugar').trim();
    const lat = Number(item.lat);
    const lng = Number(item.lng || item.lon);

    btn.innerHTML = `
      <div class="search-unified-item-main">
        <span class="search-unified-item-title">${escapeHtml(nombre)}</span>
        <span class="search-unified-item-sub">Calle / Ubicación</span>
      </div>
      <span style="color: #71717a; font-size: 14px;">📍</span>
    `;

    btn.addEventListener('click', () => {
      agregarAHistorialBusqueda({ tipo: 'calle', nombre, lat, lng });
      cerrarYLimpiar();
      cambiarVista('view-map');
      centrarEnLugar(lat, lng, nombre);
    });
  }

  return btn;
}

function ordenarResultadosBusquedaDashboard({ lineas = [], paradas = [], calles = [] }, query) {
  const items = [
    ...lineas.map((l) => ({ ...l, tipoResultado: 'linea' })),
    ...paradas.map((p) => ({ ...p, tipoResultado: 'parada' })),
    ...calles,
  ];
  if (pareceBusquedaLinea(query)) {
    items.sort((a, b) => (a.tipoResultado === 'linea' ? -1 : 0) - (b.tipoResultado === 'linea' ? -1 : 0));
  }
  return items;
}

function renderResultadosBusquedaDashboard(items, resultsDiv, { pendienteCalles = false } = {}) {
  if (!items.length && !pendienteCalles) {
    resultsDiv.innerHTML = '<p class="search-results-hint">No se encontraron resultados en San Juan</p>';
    return;
  }

  resultsDiv.innerHTML = '';
  for (const item of items) {
    resultsDiv.appendChild(crearBotonResultadoBusquedaDashboard(item, resultsDiv));
  }

  if (pendienteCalles) {
    const loading = document.createElement('p');
    loading.className = 'search-results-loading';
    loading.textContent = 'Buscando lugares y calles...';
    resultsDiv.appendChild(loading);
  }
}

async function ejecutarBusquedaDashboard(query) {
  const resultsDiv = document.getElementById('dash-search-results');
  if (!resultsDiv) return;

  if (dashSearchAbort) {
    try { dashSearchAbort.abort(); } catch { /* noop */ }
  }
  dashSearchAbort = new AbortController();
  const mySeq = ++dashSearchSeq;
  const filtro = _dashSearchFilter;

  const wantLineas = filtro === 'todo' || filtro === 'linea';
  const wantParadas = filtro === 'todo' || filtro === 'parada';
  const wantCalles = filtro === 'todo' || filtro === 'calle';

  // Paso 1: resultados locales (líneas/paradas ya están cacheadas en memoria, sin red).
  let lineas = [];
  let paradas = [];
  try {
    [lineas, paradas] = await Promise.all([
      wantLineas ? buscarLineasLocales(query) : Promise.resolve([]),
      wantParadas ? buscarParadasLocales(query) : Promise.resolve([]),
    ]);
  } catch {
    // noop
  }

  if (mySeq !== dashSearchSeq) return;

  renderResultadosBusquedaDashboard(
    ordenarResultadosBusquedaDashboard({ lineas, paradas }, query),
    resultsDiv,
    { pendienteCalles: wantCalles },
  );

  if (!wantCalles) return;

  // Paso 2: calles/lugares vía Nominatim (red). Se agregan cuando llegan, sin bloquear lo anterior.
  try {
    const calles = await buscarCallesEnSanJuan(query, dashSearchAbort.signal);
    if (mySeq !== dashSearchSeq) return;
    renderResultadosBusquedaDashboard(
      ordenarResultadosBusquedaDashboard({ lineas, paradas, calles }, query),
      resultsDiv,
    );
  } catch (error) {
    if (error && error.name === 'AbortError') return;
    console.error('Error en búsqueda dashboard:', error);
    if (!lineas.length && !paradas.length) {
      resultsDiv.innerHTML = '<p class="search-results-error">Error al buscar. Intenta de nuevo.</p>';
    }
  }
}

function renderHistorialDashboard() {
  const container = document.getElementById('recent-searches-list');
  if (!container) return;

  const historial = obtenerHistorialBusqueda().filter(Boolean);
  if (!historial.length) {
    container.innerHTML = '<p class="recent-empty-hint">No hay búsquedas recientes</p>';
    return;
  }

  container.innerHTML = '';
  historial.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'recent-item-btn';

    const tipo = String(item.tipo || '').toLowerCase();
    let icon = '📍';
    let label = item.nombre || 'Ubicación';

    if (tipo === 'linea') {
      icon = '🚌';
      label = item.name || `Línea ${item.ref}`;
    }

    row.innerHTML = `
      <div class="recent-item-content">
        <span>${icon}</span>
        <span class="recent-item-text">${label}</span>
      </div>
      <button type="button" class="recent-delete-btn" aria-label="Eliminar de historial" title="Eliminar">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    `;

    const contentDiv = row.querySelector('.recent-item-content');
    contentDiv?.addEventListener('click', () => {
      cambiarVista('view-map');
      if (tipo === 'linea') {
        void mostrarRecorridoDeLinea(item.ref, item.name);
      } else if (Number.isFinite(item.lat) && Number.isFinite(item.lng)) {
        centrarEnLugar(item.lat, item.lng, item.nombre);
      }
    });

    const delBtn = row.querySelector('.recent-delete-btn');
    delBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const next = obtenerHistorialBusqueda().filter((_, i) => i !== index);
      guardarHistorialBusqueda(next);
      renderHistorialDashboard();
    });

    container.appendChild(row);
  });
}

let favFiltroActual = 'all';

function renderSeccionGuardados() {
  const container = document.getElementById('guardados-list-container');
  if (!container) return;

  const lineas = obtenerLineasFavs();
  const paradas = obtenerParadasFavs();
  const lugares = obtenerLugaresFavs();

  const total = lineas.length + paradas.length + lugares.length;

  // Actualizar contadores en la barra de filtros
  const countAll = document.getElementById('count-fav-all');
  if (countAll) countAll.textContent = String(total);
  const countLineas = document.getElementById('count-fav-lineas');
  if (countLineas) countLineas.textContent = String(lineas.length);
  const countParadas = document.getElementById('count-fav-paradas');
  if (countParadas) countParadas.textContent = String(paradas.length);
  const countLugares = document.getElementById('count-fav-lugares');
  if (countLugares) countLugares.textContent = String(lugares.length);

  if (total === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 16px; color: #71717a;">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 12px; opacity: 0.5;"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"></path></svg>
        <p style="font-size: 16px; font-weight: 600; color: #f4f4f6; margin-bottom: 6px;">Aún no tienes elementos guardados</p>
        <p style="font-size: 14px; margin: 0;">Usa el buscador superior para buscar y guardar tus líneas o paradas favoritas.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';

  if (favFiltroActual === 'all' || favFiltroActual === 'lineas') {
    if (lineas.length > 0) {
      const header = document.createElement('div');
      header.className = 'guardados-section-header';
      header.innerHTML = `
        <div class="guardados-section-title-wrap">
          <span class="guardados-section-icon">🚌</span>
          <h3 class="guardados-section-title">Líneas favoritas</h3>
        </div>
        <span class="guardados-section-badge">${lineas.length}</span>
      `;
      container.appendChild(header);

      lineas.forEach((linea) => {
        const ref = String(linea.ref || linea.linea || '').trim();
        const name = String(linea.name || linea.nombre || `Línea ${ref}`).trim();
        const c = getColorForLinea(ref);
        const tc = getTextColorForBg(c);

        const card = document.createElement('div');
        card.className = 'fav-card-item';
        card.innerHTML = `
          <div class="fav-card-info">
            <span class="search-badge-line" style="background-color: ${c}; color: ${tc};">${ref}</span>
            <div class="fav-card-texts">
              <span class="fav-card-title">${escapeHtml(name)}</span>
              <span class="fav-card-sub">Línea RedTulum</span>
            </div>
          </div>
          <div class="fav-card-actions">
            <button type="button" class="btn-fav-action btn-fav-map">Ver mapa</button>
            <button type="button" class="btn-fav-action btn-fav-remove" title="Eliminar de guardados">✕</button>
          </div>
        `;

        const irALinea = () => {
          cambiarVista('view-map');
          void mostrarRecorridoDeLinea(ref, name);
        };

        card.addEventListener('click', (e) => {
          if (e.target.closest('.btn-fav-remove')) return;
          irALinea();
        });

        card.querySelector('.btn-fav-remove')?.addEventListener('click', (e) => {
          e.stopPropagation();
          const next = obtenerLineasFavs().filter((l) => (l.ref || l.linea) !== ref);
          guardarLineasFavs(next);
          renderSeccionGuardados();
        });

        container.appendChild(card);
      });
    }
  }

  if (favFiltroActual === 'all' || favFiltroActual === 'paradas') {
    if (paradas.length > 0) {
      const header = document.createElement('div');
      header.className = 'guardados-section-header';
      header.innerHTML = `
        <div class="guardados-section-title-wrap">
          <span class="guardados-section-icon">📍</span>
          <h3 class="guardados-section-title">Paradas guardadas</h3>
        </div>
        <span class="guardados-section-badge">${paradas.length}</span>
      `;
      container.appendChild(header);

      paradas.forEach((parada) => {
        const paradaId = parada.id;
        const nombre = parada.nombre || parada.label || (paradaId ? `Parada #${paradaId.replace(/^(node|relation|way)\//i, '')}` : 'Parada');
        const lat = parada.lat;
        const lng = parada.lng;

        const card = document.createElement('div');
        card.className = 'fav-card-item';
        card.innerHTML = `
          <div class="fav-card-info">
            <span class="fav-parada-icon-badge" style="margin-right: 0;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
            </span>
            <div class="fav-card-texts">
              <span class="fav-card-title">${escapeHtml(nombre)}</span>
              <span class="fav-card-sub">
                <span>Parada de colectivos</span>
                ${parada.lineas ? `<span style="color: #38bdf8;">• Líneas: ${escapeHtml(parada.lineas)}</span>` : ''}
              </span>
            </div>
          </div>
          <div class="fav-card-actions">
            <button type="button" class="btn-fav-action btn-fav-map">Ver mapa</button>
            <button type="button" class="btn-fav-action btn-fav-remove" title="Eliminar de guardados">✕</button>
          </div>
        `;

        const irAParada = () => {
          void centrarEnParadaGuardada(parada);
        };

        card.addEventListener('click', (e) => {
          if (e.target.closest('.btn-fav-remove')) return;
          irAParada();
        });

        card.querySelector('.btn-fav-map')?.addEventListener('click', (e) => {
          e.stopPropagation();
          irAParada();
        });

        card.querySelector('.btn-fav-remove')?.addEventListener('click', (e) => {
          e.stopPropagation();
          const next = obtenerParadasFavs().filter((p) => p.id !== paradaId);
          guardarParadasFavs(next);
          renderSeccionGuardados();
        });

        container.appendChild(card);
      });
    }
  }

  if (favFiltroActual === 'all' || favFiltroActual === 'lugares') {
    if (lugares.length > 0) {
      const header = document.createElement('div');
      header.className = 'guardados-section-header';
      header.innerHTML = `
        <div class="guardados-section-title-wrap">
          <span class="guardados-section-icon">📌</span>
          <h3 class="guardados-section-title">Lugares guardados</h3>
        </div>
        <span class="guardados-section-badge">${lugares.length}</span>
      `;
      container.appendChild(header);

      lugares.forEach((lugar) => {
        const nombre = lugar.nombre || 'Lugar guardado';
        const lat = lugar.lat;
        const lng = lugar.lng;

        const card = document.createElement('div');
        card.className = 'fav-card-item';
        card.innerHTML = `
          <div class="fav-card-info">
            <span class="fav-parada-icon-badge" style="margin-right: 0; background: rgba(245, 158, 11, 0.15); border-color: rgba(245, 158, 11, 0.3); color: #fbbf24;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"></polygon>
                <line x1="9" x2="9" y1="3" y2="18"></line>
                <line x1="15" x2="15" y1="6" y2="21"></line>
              </svg>
            </span>
            <div class="fav-card-texts">
              <span class="fav-card-title">${escapeHtml(nombre)}</span>
              <span class="fav-card-sub">Ubicación guardada</span>
            </div>
          </div>
          <div class="fav-card-actions">
            <button type="button" class="btn-fav-action btn-fav-map">Ver mapa</button>
            <button type="button" class="btn-fav-action btn-fav-remove" title="Eliminar de guardados">✕</button>
          </div>
        `;

        const irAlLugar = () => {
          if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
            void centrarEnLugarGuardado({ nombre, lat: Number(lat), lng: Number(lng) });
          }
        };

        card.addEventListener('click', (e) => {
          if (e.target.closest('.btn-fav-remove')) return;
          irAlLugar();
        });

        card.querySelector('.btn-fav-remove')?.addEventListener('click', (e) => {
          e.stopPropagation();
          const next = obtenerLugaresFavs().filter((l) => l.nombre !== nombre);
          guardarLugaresFavs(next);
          renderSeccionGuardados();
        });

        container.appendChild(card);
      });
    }
  }
}

let favSearchTimeout = null;

function setupGuardadosSearch() {
  const input = document.getElementById('fav-search-input');
  const clearBtn = document.getElementById('fav-search-clear');
  const resultsDiv = document.getElementById('fav-search-results');

  const filterContainer = document.getElementById('guardados-filters-bar') || document.querySelector('.guardados-filters');
  if (filterContainer && !filterContainer._hasFilterListener) {
    filterContainer._hasFilterListener = true;
    filterContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('.guardados-filter-btn');
      if (!btn) return;
      filterContainer.querySelectorAll('.guardados-filter-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      favFiltroActual = btn.dataset.filter || 'all';
      renderSeccionGuardados();
    });
  }

  clearBtn?.addEventListener('click', () => {
    if (input) input.value = '';
    clearBtn.style.display = 'none';
    if (resultsDiv) {
      resultsDiv.style.display = 'none';
      resultsDiv.innerHTML = '';
    }
  });

  if (!input) return;

  input.addEventListener('input', () => {
    const val = input.value.trim();
    if (clearBtn) clearBtn.style.display = val ? 'flex' : 'none';

    if (favSearchTimeout) clearTimeout(favSearchTimeout);

    if (!val) {
      if (resultsDiv) {
        resultsDiv.style.display = 'none';
        resultsDiv.innerHTML = '';
      }
      return;
    }

    if (val.length < 2) {
      if (resultsDiv) {
        resultsDiv.style.display = 'flex';
        resultsDiv.innerHTML = '<p class="search-results-hint">Escribe al menos 2 letras para buscar</p>';
      }
      return;
    }

    if (resultsDiv) {
      resultsDiv.style.display = 'flex';
      resultsDiv.innerHTML = '<p class="search-results-loading">Buscando líneas y paradas...</p>';
    }

    favSearchTimeout = setTimeout(() => {
      ejecutarBusquedaParaGuardar(val);
    }, 250);
  });
}

async function ejecutarBusquedaParaGuardar(query) {
  const resultsDiv = document.getElementById('fav-search-results');
  if (!resultsDiv) return;

  try {
    const lineas = await buscarLineasLocales(query);

    const queryNorm = normalizarTextoBusqueda(query);
    const paradasMatch = (typeof todasLasParadas !== 'undefined' && Array.isArray(todasLasParadas))
      ? todasLasParadas
        .filter((p) => normalizarTextoBusqueda(p.nombre || p.name || '').includes(queryNorm))
        .slice(0, 10)
      : [];

    const totalRes = lineas.length + paradasMatch.length;
    if (totalRes === 0) {
      resultsDiv.innerHTML = '<p class="search-results-hint">No se encontraron líneas ni paradas</p>';
      return;
    }

    resultsDiv.innerHTML = '';

    lineas.forEach((l) => {
      const ref = String(l.ref || '').trim();
      const name = String(l.name || '').trim();
      const c = getColorForLinea(ref);
      const tc = getTextColorForBg(c);

      const item = document.createElement('div');
      item.className = 'search-unified-item';
      item.innerHTML = `
        <div class="search-unified-item-main">
          <span class="search-unified-item-title">${name || `Línea ${ref}`}</span>
          <span class="search-unified-item-sub">Línea RedTulum</span>
        </div>
        <button type="button" class="search-badge-add">+ Guardar</button>
      `;

      item.querySelector('.search-badge-add')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const favs = obtenerLineasFavs();
        if (!favs.some((x) => (x.ref || x.linea) === ref)) {
          favs.unshift({ ref, name });
          guardarLineasFavs(favs);
          renderSeccionGuardados();
          e.target.textContent = '✓ Guardado';
          e.target.style.background = 'rgba(34, 197, 94, 0.2)';
          e.target.style.color = '#4ade80';
        } else {
          e.target.textContent = 'Ya guardada';
        }
      });

      resultsDiv.appendChild(item);
    });

    paradasMatch.forEach((p) => {
      const pId = p.id;
      const pNom = p.nombre || p.name || `Parada #${pId}`;
      const lat = p.lat;
      const lng = p.lng || p.lon;

      const item = document.createElement('div');
      item.className = 'search-unified-item';
      item.innerHTML = `
        <div class="search-unified-item-main">
          <span class="search-unified-item-title">${pNom}</span>
          <span class="search-unified-item-sub">Parada</span>
        </div>
        <button type="button" class="search-badge-add">+ Guardar</button>
      `;

      item.querySelector('.search-badge-add')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const favs = obtenerParadasFavs();
        if (!favs.some((x) => x.id === pId)) {
          favs.unshift({ id: pId, nombre: pNom, label: pNom, lat, lng });
          guardarParadasFavs(favs);
          renderSeccionGuardados();
          e.target.textContent = '✓ Guardado';
          e.target.style.background = 'rgba(34, 197, 94, 0.2)';
          e.target.style.color = '#4ade80';
        } else {
          e.target.textContent = 'Ya guardada';
        }
      });

      resultsDiv.appendChild(item);
    });

  } catch (err) {
    console.error('Error al buscar para guardar:', err);
    resultsDiv.innerHTML = '<p class="search-results-error">Error al buscar.</p>';
  }
}

function obtenerLineasFavs() {
  const arr = leerJsonLocalStorage(STORAGE_LINEAS_FAVS_KEY, []);
  return Array.isArray(arr) ? arr : [];
}

function guardarLineasFavs(arr) {
  guardarJsonLocalStorage(STORAGE_LINEAS_FAVS_KEY, arr);
  if (typeof renderSeccionGuardados === 'function') renderSeccionGuardados();
  if (typeof renderAccesosRapidosDashboard === 'function') renderAccesosRapidosDashboard();
}

function obtenerParadasFavs() {
  const arr = leerJsonLocalStorage(STORAGE_PARADAS_FAVS_KEY, []);
  if (!Array.isArray(arr)) return [];
  return arr.map((f) => {
    if (!f || typeof f !== 'object') return f;
    let label = f.nombre || f.label || '';
    if (!label || label.startsWith('Parada #node/') || label === 'Parada desconocida') {
      if (f.label && !f.label.startsWith('Parada #node/') && f.label !== 'Parada desconocida') {
        label = f.label;
      } else if (f.id && typeof f.id === 'string') {
        const cleanId = f.id.replace(/^(node|relation|way)\//i, '');
        label = `Parada #${cleanId}`;
      } else {
        label = 'Parada';
      }
    }
    return {
      ...f,
      nombre: label,
      label: label
    };
  });
}

function guardarParadasFavs(arr) {
  guardarJsonLocalStorage(STORAGE_PARADAS_FAVS_KEY, arr);
  if (typeof renderSeccionGuardados === 'function') renderSeccionGuardados();
  if (typeof renderAccesosRapidosDashboard === 'function') renderAccesosRapidosDashboard();
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

    const btnCambiarOrigen = target.closest('button[data-route-change-origin="1"]');
    if (btnCambiarOrigen instanceof HTMLButtonElement) {
      ev.stopPropagation();
      mostrarSelectorUbicacionRuta('origen');
      return;
    }

    const btnTripPick = target.closest('button[data-trip-pick]');
    if (btnTripPick instanceof HTMLButtonElement) {
      ev.stopPropagation();
      const modo = btnTripPick.dataset.tripPick === 'destino' ? 'destino' : 'origen';
      mostrarSelectorUbicacionRuta(modo);
      return;
    }

    const btnOrigenGps = target.closest('button[data-origin-pick="gps"]');
    if (btnOrigenGps instanceof HTMLButtonElement) {
      ev.stopPropagation();
      usarMiUbicacionComoOrigenPlaneo();
      return;
    }

    const btnOrigenMapa = target.closest('button[data-origin-pick="mapa"]');
    if (btnOrigenMapa instanceof HTMLButtonElement) {
      ev.stopPropagation();
      activarSeleccionEnMapa(_ubicacionPickerModo || 'origen');
      return;
    }

    const btnOrigenResultado = target.closest('button[data-origin-lat][data-origin-lng]');
    if (btnOrigenResultado instanceof HTMLButtonElement) {
      ev.stopPropagation();
      const lat = Number(btnOrigenResultado.dataset.originLat);
      const lng = Number(btnOrigenResultado.dataset.originLng);
      const nombre = btnOrigenResultado.dataset.originNombre || 'Punto de partida';
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        if (_ubicacionPickerModo === 'destino') {
          establecerDestinoPlaneo(lat, lng, nombre);
        } else {
          establecerOrigenPlaneo(lat, lng, nombre);
        }
      }
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
          // El recorrido planificado se ve entero y por lo tanto lejos; para mirar una
          // parada concreta hay que acercarse a ella. Volver a la lista de paradas
          // restaura el encuadre del viaje completo.
          const zoomActual = typeof leafletMap.getZoom === 'function' ? leafletMap.getZoom() : ZOOM_PUNTO_ENFOCADO;
          centrarMapaEnPunto(info.lat, info.lng, Math.max(zoomActual, ZOOM_PUNTO_ENFOCADO));
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
      const inputCustom = document.getElementById('input-nombre-lugar');
      const nombre = (inputCustom?.value || '').trim() || btnGuardarLugar.dataset.lugarNombre || 'Lugar guardado';
      const lat = Number(btnGuardarLugar.dataset.lat);
      const lng = Number(btnGuardarLugar.dataset.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      guardarUbicacionActualDesdeBottomSheet(nombre, lat, lng);
      return;
    }

    const btnGuardarLinea = target.closest('button[data-save-linea="1"][data-linea-ref]');
    if (btnGuardarLinea instanceof HTMLButtonElement) {
      ev.stopPropagation();
      const inputCustom = document.getElementById('input-nombre-linea');
      const ref = btnGuardarLinea.dataset.lineaRef || '';
      const defaultName = btnGuardarLinea.dataset.lineaName || '';
      const customName = (inputCustom?.value || '').trim() || defaultName || `Línea ${ref}`;
      guardarLineaActualDesdeBottomSheet(ref, customName);
      return;
    }

    const btnGuardarParada = target.closest('button[data-save-parada="1"][data-parada-id]');
    if (btnGuardarParada instanceof HTMLButtonElement) {
      ev.stopPropagation();
      const inputCustom = document.getElementById('input-nombre-parada');
      const feature = window._currentFeature || null;
      const customName = (inputCustom?.value || '').trim();
      guardarParadaActualDesdeBottomSheet(feature, customName);
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
          const zoomActualLista = typeof leafletMap?.getZoom === 'function' ? leafletMap.getZoom() : ZOOM_PUNTO_ENFOCADO;
          leafletMap?.setView([found.lat, found.lng], Math.max(zoomActualLista, ZOOM_PUNTO_ENFOCADO));
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

    // Marcar si esta línea se abrió desde una parada (para mostrar botón volver y
    // para mantener esa parada a la vista en vez de encuadrar todo el recorrido).
    const currentTipo = document.getElementById('bs-fav-btn')?.dataset?.tipo || '';
    const paradaDeOrigen = currentTipo === 'parada' ? (window._currentFeature || null) : null;

    void mostrarRecorridoDeLinea(ref, name, null, false, paradaDeOrigen);
  });
}

async function centrarEnLugarGuardado({ nombre, lat, lng }) {
  const latNum = typeof lat === 'number' ? lat : Number(lat);
  const lngNum = typeof lng === 'number' ? lng : Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return;

  cambiarVista('view-map');

  if (!leafletMap) {
    cargarLF({ lat: latNum, lng: lngNum }, ZOOM_CALLE);
  }
  if (!leafletMap || typeof L === 'undefined') return;

  limpiarRecorrido();

  const z = typeof leafletMap.getMaxZoom === 'function' ? leafletMap.getMaxZoom() : ZOOM_CALLE;
  const zoomTarget = Number.isFinite(z) ? Math.min(z, 18) : ZOOM_CALLE;
  establecerVistaMapaPunto(latNum, lngNum, zoomTarget);

  mostrarMarcadorDestino(latNum, lngNum, nombre);
  centrarMapaEnPunto(latNum, lngNum, zoomTarget);

  // Abrir panel con la información del lugar guardado
  abrirBottomSheetLugarGuardado(nombre, latNum, lngNum, null);

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
      abrirBottomSheetLugarGuardado(nombre, latNum, lngNum, paradaCercana);
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
    item.innerHTML = `
      <span class="fav-parada-icon-badge">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
          <circle cx="12" cy="10" r="3"/>
        </svg>
      </span>
      <span class="fav-parada-label">${escapeHtml(label)}</span>
    `;

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

async function centrarEnParadaGuardada(parada) {
  if (!parada) return;
  const latNum = typeof parada.lat === 'number' ? parada.lat : Number(parada.lat);
  const lngNum = typeof parada.lng === 'number' ? parada.lng : Number(parada.lng);
  const paradaId = parada.id || '';
  const nombre = parada.nombre || parada.label || 'Parada';

  cambiarVista('view-map');

  if (!leafletMap) {
    if (Number.isFinite(latNum) && Number.isFinite(lngNum)) {
      cargarLF({ lat: latNum, lng: lngNum }, ZOOM_CALLE);
    }
  }
  if (!leafletMap || typeof L === 'undefined') return;

  limpiarRecorrido();

  if (Number.isFinite(latNum) && Number.isFinite(lngNum)) {
    const z = Math.min(typeof leafletMap.getMaxZoom === 'function' ? leafletMap.getMaxZoom() : 18, ZOOM_PUNTO_ENFOCADO);
    establecerVistaMapaPunto(latNum, lngNum, z);
    if (typeof leafletMap.flyTo === 'function') {
      leafletMap.flyTo([latNum, lngNum], z, { duration: 0.8 });
    } else {
      leafletMap.setView([latNum, lngNum], z);
    }
    destacarParadaEnMapa(latNum, lngNum, nombre);
  }

  try {
    const puntos = await cargarParadasPuntos();
    let found = null;
    if (Array.isArray(puntos)) {
      if (paradaId) {
        found = puntos.find((p) => p.feature && obtenerIdParada(p.feature) === paradaId);
      }
      if (!found && Number.isFinite(latNum) && Number.isFinite(lngNum)) {
        let minDist = Infinity;
        for (const p of puntos) {
          const d = calcularDistancia(latNum, lngNum, p.lat, p.lng);
          if (d < 35 && d < minDist) {
            minDist = d;
            found = p;
          }
        }
      }
    }

    if (found && found.feature) {
      mostrarLineasEnContenedorParadas(found.feature);
    } else if (Number.isFinite(latNum) && Number.isFinite(lngNum)) {
      const fallbackHtml = `
        <div style="padding: 12px 0;">
          <p style="color: #94a3b8; font-size: 14px; margin-bottom: 12px;">Parada guardada en tus favoritos.</p>
          ${parada.lineas ? `<p style="font-size: 13px; color: #38bdf8;"><strong>Líneas asociadas:</strong> ${escapeHtml(parada.lineas)}</p>` : ''}
          <ul class="bs-nav-rows" style="margin-top: 14px;">
            <li>
              <button type="button" class="btn-nav-row" onclick="iniciarPlaneoRutaHaciaPunto(${latNum}, ${lngNum}, '${escapeHtml(nombre).replace(/'/g, "\\'")}')">
                🎯 Planificar viaje hacia esta parada
              </button>
            </li>
          </ul>
        </div>
      `;
      abrirBottomSheet(escapeHtml(nombre), fallbackHtml, 'parada', 'Parada guardada');
    }
  } catch (err) {
    console.error('Error al centrar en parada guardada:', err);
  }
}

async function centrarEnParadaFavorita({ id, label, lat, lng }) {
  return centrarEnParadaGuardada({ id, nombre: label, label, lat, lng });
}

function obtenerNombreParadaCompleto(feature) {
  if (!feature) return 'Parada';
  const props = feature.properties || {};

  const name = props.name || props['name:es'];
  if (typeof name === 'string' && name.trim() && name.trim().toLowerCase() !== 'parada desconocida') {
    return name.trim();
  }

  const street = props['addr:street'];
  if (typeof street === 'string' && street.trim()) {
    return `Parada en ${street.trim()}`;
  }

  const ref = props.ref;
  if (typeof ref === 'string' && ref.trim()) {
    return `Parada #${ref.trim()}`;
  }

  const relations = props['@relations'];
  if (Array.isArray(relations) && relations.length > 0) {
    const refs = [];
    for (const rel of relations) {
      const r = rel?.reltags?.ref;
      if (r && !refs.includes(r)) refs.push(r);
    }
    if (refs.length > 0) {
      return `Parada (Líneas ${refs.slice(0, 3).join(', ')})`;
    }
    for (const rel of relations) {
      const reltags = rel?.reltags || {};
      if (typeof reltags.from === 'string' && reltags.from.trim()) {
        return `Parada hacia ${reltags.to || reltags.from}`;
      }
    }
  }

  const et = obtenerEtiquetaParada(feature);
  if (et && et !== 'Parada' && !et.startsWith('node/')) return et;

  const id = props['@id'];
  if (typeof id === 'string' && id.trim()) {
    const cleanId = id.replace(/^(node|relation|way)\//i, '');
    return `Parada #${cleanId}`;
  }

  return 'Parada';
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

function toggleGuardarLineaSheet(btn) {
  const container = btn?.closest('.save-location-sheet');
  const body = container?.querySelector('.save-location-body');
  if (!body) return;

  const isCollapsed = body.classList.contains('collapsed');
  if (isCollapsed) {
    body.classList.remove('collapsed');
    btn.setAttribute('aria-expanded', 'true');
  } else {
    body.classList.add('collapsed');
    btn.setAttribute('aria-expanded', 'false');
  }
}

function toggleTransitTimeline(btn) {
  const container = btn?.closest('.transit-timeline-track');
  const list = container?.querySelector('.transit-intermediate-stops');
  const icon = btn?.querySelector('.transit-accordion-icon');
  if (!list) return;

  const isCollapsed = list.classList.contains('collapsed');
  if (isCollapsed) {
    list.classList.remove('collapsed');
    btn.setAttribute('aria-expanded', 'true');
    if (icon) icon.style.transform = 'rotate(0deg)';
  } else {
    list.classList.add('collapsed');
    btn.setAttribute('aria-expanded', 'false');
    if (icon) icon.style.transform = 'rotate(180deg)';
  }
}

function renderListaParadasRecorrido({ mostrarTodas = true } = {}) {
  if (!Array.isArray(paradasRecorrido) || paradasRecorrido.length === 0) return '';

  const total = paradasRecorrido.length;
  const ref = recorridoActivo?.ref || window._currentLineaRef || '';
  const name = recorridoActivo?.name || window._currentLineaName || '';
  const lineColor = getColorForLinea(ref) || '#ef4444';
  const textColor = getTextColorForBg(lineColor);

  const getStopName = (p, idx) => {
    const calle = p?.feature?.properties?.['addr:street'];
    if (typeof calle === 'string' && calle.trim()) return calle.trim();
    const et = obtenerEtiquetaParada(p?.feature);
    if (et && et !== 'Parada') return et;
    const n = p?.feature?.properties?.name;
    if (typeof n === 'string' && n.trim()) return n.trim();
    return `Parada ${idx + 1}`;
  };

  const getStopId = (p) => p.paradaId || obtenerIdParada(p.feature) || '';

  const badgeText = formatBadgeLinea(ref) || '1';

  if (total === 1) {
    const p = paradasRecorrido[0];
    const pId = getStopId(p);
    const pName = getStopName(p, 0);
    return `
      <div class="transit-timeline-container" style="--line-color: ${lineColor};">
        <div class="transit-timeline-track">
          <div class="transit-faint-dot"></div>
          <div class="transit-row transit-row-origin">
            <div class="transit-badge-col">
              <span class="transit-line-pill-badge" style="background-color: ${lineColor}; color: ${textColor};">${escapeHtml(badgeText)}</span>
            </div>
            <div class="transit-rail-col">
              <div class="transit-tube-seg" style="top: 14px; border-radius: 9999px;">
                <span class="transit-dot"></span>
              </div>
            </div>
            <button type="button" class="transit-stop-btn btn-recorrido-parada" data-parada-id="${escapeHtml(pId)}">
              <span class="transit-stop-icon-badge">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
                  <circle cx="12" cy="10" r="3"/>
                </svg>
              </span>
              <div class="transit-stop-info">
                <span class="transit-stop-name transit-stop-name-primary">${escapeHtml(pName)}</span>
                <span class="transit-stop-meta">Cabecera / Única parada</span>
              </div>
            </button>
          </div>
          <div class="transit-faint-dot"></div>
          <div class="transit-faint-dot"></div>
        </div>
      </div>
    `;
  }

  const firstStop = paradasRecorrido[0];
  const lastStop = paradasRecorrido[total - 1];
  const intermediateStops = paradasRecorrido.slice(1, total - 1);
  const intermediateCount = intermediateStops.length;

  const firstId = getStopId(firstStop);
  const firstName = getStopName(firstStop, 0);

  const lastId = getStopId(lastStop);
  const lastName = getStopName(lastStop, total - 1);

  const destinoText = lastName ? `➔ ${lastName}` : '➔ Recorrido';

  let intermediateHtml = '';
  if (intermediateCount > 0) {
    const rowsHtml = intermediateStops.map((p, idx) => {
      const pId = getStopId(p);
      const pName = getStopName(p, idx + 1);
      return `
        <div class="transit-row transit-row-intermediate">
          <div class="transit-badge-col"></div>
          <div class="transit-rail-col">
            <div class="transit-tube-seg">
              <span class="transit-dot"></span>
            </div>
          </div>
          <button type="button" class="transit-stop-btn btn-recorrido-parada" data-parada-id="${escapeHtml(pId)}">
            <span class="transit-stop-icon-badge">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
            </span>
            <div class="transit-stop-info">
              <span class="transit-stop-name">${escapeHtml(pName)}</span>
            </div>
          </button>
        </div>
      `;
    }).join('');

    intermediateHtml = `
      <div class="transit-row transit-accordion-row">
        <div class="transit-badge-col"></div>
        <div class="transit-rail-col">
          <div class="transit-tube-seg">
            <span class="transit-dot"></span>
          </div>
        </div>
        <button type="button" class="transit-accordion-btn" onclick="toggleTransitTimeline(this)" aria-expanded="true">
          <div class="transit-accordion-left">
            <span class="transit-accordion-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m8 14 4-4 4 4"/></svg>
            </span>
            <span class="transit-accordion-label">${intermediateCount} paradas en el trayecto</span>
          </div>
        </button>
      </div>
      <div class="transit-intermediate-stops" id="transit-intermediate-list">
        ${rowsHtml}
      </div>
    `;
  }

  return `
    <div class="transit-timeline-container" style="--line-color: ${lineColor};">
      <div class="transit-timeline-track">
        <!-- Punto tenue previo -->
        <div class="transit-faint-dot"></div>

        <!-- Primera Parada (Origen) -->
        <div class="transit-row transit-row-origin">
          <div class="transit-badge-col">
            <span class="transit-line-pill-badge" style="background-color: ${lineColor}; color: ${textColor};">${escapeHtml(badgeText)}</span>
          </div>
          <div class="transit-rail-col">
            <div class="transit-tube-seg">
              <span class="transit-dot"></span>
            </div>
          </div>
          <button type="button" class="transit-stop-btn btn-recorrido-parada" data-parada-id="${escapeHtml(firstId)}">
            <span class="transit-stop-icon-badge">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
            </span>
            <div class="transit-stop-info">
              <span class="transit-stop-name transit-stop-name-primary">${escapeHtml(firstName)}</span>
              <span class="transit-stop-meta">
                ${escapeHtml(destinoText)}
              </span>
            </div>
          </button>
        </div>

        <!-- Paradas intermedias -->
        ${intermediateHtml}

        <!-- Última Parada (Destino) -->
        <div class="transit-row transit-row-dest">
          <div class="transit-badge-col"></div>
          <div class="transit-rail-col">
            <div class="transit-tube-seg">
              <span class="transit-dot"></span>
            </div>
          </div>
          <button type="button" class="transit-stop-btn btn-recorrido-parada" data-parada-id="${escapeHtml(lastId)}">
            <span class="transit-stop-icon-badge">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
            </span>
            <div class="transit-stop-info">
              <span class="transit-stop-name transit-stop-name-primary">${escapeHtml(lastName)}</span>
              <span class="transit-stop-meta">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>
                Destino final
              </span>
            </div>
          </button>
        </div>

        <!-- Puntos tenues posteriores -->
        <div class="transit-faint-dot"></div>
        <div class="transit-faint-dot"></div>
      </div>
    </div>
  `;
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


const STOP_WORDS_PARADA = new Set([
  'y', 'de', 'del', 'la', 'las', 'el', 'los', 'en',
  'av', 'avenida', 'avda', 'calle', 'ruta', 'rn', 'rp', 'nacional', 'provincial',
  'n', 's', 'e', 'o', 'b', 'barrio', 'villa', 'poblacion', 'loteo',
  'dr', 'doctor', 'gral', 'general', 'ig', 'ignacio',
  'blvd', 'boulevard', 'nro', 'km', 'esq', 'esquina',
  'cmte', 'comandante', 'almte', 'almirante', 'sgto', 'sargento',
  'h', 'hipolito', 'pte', 'presidente'
]);

function tokenizarNombreParada(nombre) {
  let txt = String(nombre || '').trim().toLowerCase();

  // Limpiar sufijos direccionales o variantes al final
  txt = txt
    .replace(/\s+[nseo]\s*(?:-\s*[abcd])?$/gi, '')
    .replace(/\s*-\s*[abcd]$/gi, '');

  // Simplificar acentos
  txt = txt.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Quitar puntuación y dejar solo alfanuméricos
  txt = txt.replace(/[^\w\s]/g, ' ');

  const tokens = new Set();
  const parts = txt.split(/\s+/);
  for (const t of parts) {
    if (t.length > 1 && !STOP_WORDS_PARADA.has(t)) {
      tokens.add(t);
    }
  }
  return tokens;
}

function calcularSimilitudJaccard(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0;
  if (setA.size === 0 || setB.size === 0) return 0;

  let matchCount = 0;
  for (const t of setA) {
    if (setB.has(t)) matchCount++;
  }

  const unionSize = setA.size + setB.size - matchCount;
  return matchCount / unionSize;
}

function obtenerClavesLineaLookup(linea) {
  const base = normalizarLineaParaLookup(linea);
  if (!base) return [];

  const claves = [base];
  const sinVariante = base.replace(/([ABC])$/, '');
  if (sinVariante && sinVariante !== base) claves.push(sinVariante);
  return claves;
}

function resolverKeyLineaEnObjeto(objeto, linea) {
  if (!objeto || typeof objeto !== 'object') return null;
  const clavesLookup = obtenerClavesLineaLookup(linea);

  // 1. Opciones principales primero (_opcion_0 o _ida)
  for (const kLookup of clavesLookup) {
    for (const key of Object.keys(objeto)) {
      const normKey = normalizarLineaParaLookup(key);
      if (normKey === kLookup || normKey.startsWith(kLookup + 'OPCION0') || normKey.startsWith(kLookup + 'IDA')) return key;
    }
  }
  // 2. Fallback general
  for (const kLookup of clavesLookup) {
    for (const key of Object.keys(objeto)) {
      if (normalizarLineaParaLookup(key).includes(kLookup)) return key;
    }
  }
  return null;
}

function agregarParadasDeTodasLasOpciones(dataParadas, lineaRef) {
  const paradasAgregadas = {};
  if (!dataParadas || typeof dataParadas !== 'object') return paradasAgregadas;

  const lineaNorm = normalizarLineaParaLookup(lineaRef);
  if (!lineaNorm) return paradasAgregadas;

  const targetPrefix = lineaNorm.replace(/([ABC])$/, '');

  for (const [key, lineData] of Object.entries(dataParadas)) {
    if (!lineData?.paradas) continue;

    let keyNorm = normalizarLineaParaLookup(key);
    keyNorm = keyNorm.replace(/OPCION[0-9]+$/i, '');

    if (keyNorm === targetPrefix || keyNorm === lineaNorm) {
      for (const [pName, pId] of Object.entries(lineData.paradas)) {
        if (!paradasAgregadas[pName]) paradasAgregadas[pName] = pId;
      }
    }
  }

  return paradasAgregadas;
}

async function resolverParadaDesdeJson(linea, nombreParada) {
  const original = String(nombreParada || '').trim();
  if (!original) return { id_p: '', paradaResuelta: '' };

  let data = await cargarParadasPorLinea();
  if (!data || Object.keys(data).length === 0) {
    data = await cargarParadasPorLinea({ noCache: true });
  }

  const paradasObj = agregarParadasDeTodasLasOpciones(data, linea);

  if (Object.keys(paradasObj).length === 0) {
    console.warn(`[resolverParada] Sin paradas para línea "${linea}"`);
    return { id_p: '', paradaResuelta: '' };
  }

  // 1) Match exacto
  if (Object.prototype.hasOwnProperty.call(paradasObj, original)) {
    return { id_p: String(paradasObj[original] || ''), paradaResuelta: original };
  }

  // 2) Match por Token Jaccard Similarity
  const tokensQuery = tokenizarNombreParada(original);
  let bestMatch = '';
  let bestScore = 0;

  for (const cand of Object.keys(paradasObj)) {
    const tokensCand = tokenizarNombreParada(cand);
    const score = calcularSimilitudJaccard(tokensQuery, tokensCand);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = cand;
    }
  }

  if (bestScore >= 0.5 && bestMatch) {
    return { id_p: String(paradasObj[bestMatch] || ''), paradaResuelta: bestMatch };
  }

  return { id_p: '', paradaResuelta: '' };
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

async function obtenerCandidatosIdParadaParaArrivals(linea, paradaInput, paradaResueltaPreferida) {
  const out = [];
  const refLinea = String(linea || '').trim();
  if (!refLinea) return out;

  let data = await cargarParadasPorLinea();
  if (!data || Object.keys(data).length === 0) {
    data = await cargarParadasPorLinea({ noCache: true });
  }

  const paradasObj = agregarParadasDeTodasLasOpciones(data, refLinea);
  const preferida = String(paradaResueltaPreferida || '').trim();

  if (preferida && Object.prototype.hasOwnProperty.call(paradasObj, preferida)) {
    out.push({ paradaResuelta: preferida, id_p: String(paradasObj[preferida] || '') });
  }

  const tokensQuery = tokenizarNombreParada(paradaInput);
  const matchedList = [];

  for (const cand of Object.keys(paradasObj)) {
    if (cand === preferida) continue;
    const tokensCand = tokenizarNombreParada(cand);
    const score = calcularSimilitudJaccard(tokensQuery, tokensCand);
    if (score >= 0.5) {
      matchedList.push({ cand, score });
    }
  }

  matchedList.sort((a, b) => b.score - a.score);

  for (const m of matchedList) {
    out.push({ paradaResuelta: m.cand, id_p: String(paradasObj[m.cand] || '') });
  }

  const seen = new Set();
  const dedup = [];
  for (const c of out) {
    const id = String(c?.id_p || '').trim();
    if (!id || seen.has(id)) continue;
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

  let paradasLineaCount = 0;
  try {
    let dataParadas = await cargarParadasPorLinea();
    const paradasObj = agregarParadasDeTodasLasOpciones(dataParadas, lineaNorm);
    paradasLineaCount = Object.keys(paradasObj).length;
  } catch { }

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
    paradasJsonError: typeof _lastParadasPorLineaError !== 'undefined' ? _lastParadasPorLineaError : '',
    urlsJsonError: typeof _lastUrlsPorLineaError !== 'undefined' ? _lastUrlsPorLineaError : '',
    paradasLineaCount,
  };

  if (!url || !id_p_resuelto) {
    console.warn('[arrivals] ERROR: Falta resolver datos antes de fetch', { ...debugArrivals });
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
        debugArrivals.requestIntentada = true;

        const fetchController = new AbortController();
        _arrivalsAbortController = fetchController;
        const fetchTimeoutId = setTimeout(() => {
          try { fetchController.abort(); } catch { }
        }, ARRIVALS_TIMEOUT_MS);

        let resp;
        try {
          resp = await fetch(ARRIVALS_API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: JSON.stringify({ url, id_p: idTry }),
            cache: 'no-store',
            signal: fetchController.signal,
          });
          clearTimeout(fetchTimeoutId);
          _arrivalsAbortController = null;
        } catch (e) {
          clearTimeout(fetchTimeoutId);
          _arrivalsAbortController = null;
          throw e;
        }

        const httpInfo = resp.ok ? 'ok' : `HTTP ${resp.status}`;
        if (!resp.ok) {
          debugArrivals.intentos[intentoIndex] = { ...debugArrivals.intentos[intentoIndex], http: httpInfo, error: httpInfo };
          continue;
        }

        const payload = await resp.json();
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
          bestParsed = { ...parsed, paradaConsultada: paradaTry || paradaResueltaFinal || paradaTxt };
        }

        if (horariosArr.length > 0) break;
      } catch (errTry) {
        const msg = (errTry && String(errTry.name) === 'AbortError')
          ? 'AbortError'
          : (errTry?.message ? String(errTry.message) : String(errTry));
        debugArrivals.intentos[intentoIndex] = { ...debugArrivals.intentos[intentoIndex], error: msg };
        if (errTry && String(errTry.name) === 'AbortError') throw errTry;
      }
    }

    if (!bestParsed) {
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
  } catch (err) {
    const msgAbort = (err && String(err.name) === 'AbortError') ? 'Tiempo de espera agotado al consult...' : 'Error consultando arrivals API.';
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



function normalizarLineaParaLookup(linea) {
  return String(linea || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9]/g, '');
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
    } catch { }
    return _paradasPorLinea;
  } catch (err) {
    console.warn('No se pudo cargar paradas_por_linea.json:', err);
    _lastParadasPorLineaError = err?.message ? String(err.message) : String(err);
    _paradasPorLinea = {};
    _indicesParadasPorLinea = null;
    return _paradasPorLinea;
  }
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


async function resolverParadaDesdeJsonConCandidatos(linea, candidatos) {
  const arr = Array.isArray(candidatos) ? candidatos : [];
  for (const c of arr) {
    const res = await resolverParadaDesdeJson(linea, c);
    if (res?.id_p) return { ...res, paradaInput: c };
  }
  return { id_p: '', paradaResuelta: '', paradaInput: '' };
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

  const volverHtml = htmlFilaVolverALineasDeParada(mostrarVolverParada);

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
  if (!feature) return [];
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
    recorridoLayer = L.featureGroup().addTo(leafletMap);
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
  limpiarCargaDiferidaParadasRecorrido();
  document.body.classList.remove('is-viewing-linea-map');
  if (recorridoLayer) recorridoLayer.clearLayers();
  if (typeof limpiarRutaGpsActiva === 'function') limpiarRutaGpsActiva();
}

// Dibuja los markers de las paradas de la línea recién que el usuario hace zoom lo
// suficiente (misma referencia que zoomEsSuficiente()/ZOOM_PARADAS_EN_VISTA que ya usa
// el resto del mapa): al mostrar una línea, el fitBounds suele alejar la vista para que
// entre todo el recorrido, y crear de entrada un marker por cada parada ahí ya no aporta
// (no se distinguen) y cuesta rendimiento en líneas con muchas paradas. La lista de
// paradas del panel no se ve afectada: `seleccion` ya viene calculada de antes.
function programarCargaDiferidaParadasRecorrido(seleccion) {
  limpiarCargaDiferidaParadasRecorrido();
  if (!leafletMap) return;

  if (zoomEsSuficiente()) {
    dibujarMarkersParadasRecorrido(seleccion);
    return;
  }

  const layerParadas = asegurarParadasLayer();
  layerParadas?.clearLayers();
  paradasRecorridoMarkers = new Map();

  _cargaDiferidaParadasHandler = () => {
    if (!zoomEsSuficiente()) return;
    limpiarCargaDiferidaParadasRecorrido();
    dibujarMarkersParadasRecorrido(seleccion);
  };
  leafletMap.on('zoomend', _cargaDiferidaParadasHandler);
}

function limpiarCargaDiferidaParadasRecorrido() {
  if (_cargaDiferidaParadasHandler && leafletMap) {
    leafletMap.off('zoomend', _cargaDiferidaParadasHandler);
  }
  _cargaDiferidaParadasHandler = null;
}

function volverVistaGeneral() {
  limpiarRecorrido();
  if (typeof limpiarRutaGpsActiva === 'function') limpiarRutaGpsActiva();
  limpiarMarcadoresSeleccion();
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

// Calcula y ordena las paradas de la línea (para la lista del panel, que tiene que estar
// completa de una) sin tocar el mapa. dibujarMarkersParadasRecorrido() es la parte "cara"
// (crear un marker de Leaflet por parada) que sí conviene diferir según el zoom.
async function calcularParadasDelRecorrido(relIds, featureRuta = null, invertido = false) {
  const puntos = await cargarParadasPuntos();
  if (!puntos) {
    paradasRecorrido = [];
    return paradasRecorrido;
  }

  const seleccion = [];
  for (const p of puntos) {
    if (featurePerteneceAAlgunaRelacion(p.feature, relIds)) {
      const paradaId = obtenerIdParada(p.feature);
      seleccion.push({ ...p, paradaId });
    }
  }

  // Ordenar paradas secuencialmente siguiendo la geometría de la ruta
  if (featureRuta) {
    let latLngsRuta = extraerLatLngsDeGeometria(featureRuta.geometry || featureRuta);
    if (invertido) latLngsRuta = [...latLngsRuta].reverse();
    if (latLngsRuta.length >= 2) {
      seleccion.sort((a, b) => {
        const ia = indiceMasCercanoEnCaminoPreciso(a.lat, a.lng, latLngsRuta);
        const ib = indiceMasCercanoEnCaminoPreciso(b.lat, b.lng, latLngsRuta);
        return ia - ib;
      });
    }
  }

  paradasRecorrido = seleccion;
  return seleccion;
}

function dibujarMarkersParadasRecorrido(seleccion) {
  if (!leafletMap || typeof L === 'undefined') return;
  const layerParadas = asegurarParadasLayer();
  if (!layerParadas) return;
  layerParadas.clearLayers();

  paradasRecorridoMarkers = new Map();
  if (!Array.isArray(seleccion) || seleccion.length === 0) return;

  const cColor = getColorForLinea(recorridoActivo?.ref);
  for (const item of seleccion) {
    const icon = obtenerIconoParadaLeaflet(cColor);
    const marker = L.marker([item.lat, item.lng], icon ? { icon } : undefined).addTo(layerParadas);
    marker.on('click', () => mostrarLineasEnContenedorParadas(item.feature));
    if (paradasRecorridoMarkers && item.paradaId) {
      paradasRecorridoMarkers.set(item.paradaId, marker);
    }
  }
}

// Mantenido por compatibilidad: calcula y dibuja de una (comportamiento previo).
async function dibujarParadasDelRecorrido(relIds, featureRuta = null, invertido = false) {
  const seleccion = await calcularParadasDelRecorrido(relIds, featureRuta, invertido);
  dibujarMarkersParadasRecorrido(seleccion);
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

  const cColor = getColorForLinea(recorridoActivo?.ref);
  for (const item of seleccion) {
    const icon = obtenerIconoParadaLeaflet(cColor);
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

function agregarLineaAFavoritos(linea, isFromCard = false) {
  const ref = typeof linea?.ref === 'string' ? linea.ref.trim() : '';
  const name = typeof linea?.name === 'string' ? linea.name.trim() : '';
  const key = ref || name;
  if (!key) return;

  const favs = obtenerLineasFavs();
  const indice = favs.findIndex((f) => (f?.ref && ref && f.ref === ref) || (f?.name && name && f.name === name));

  if (indice !== -1 && !isFromCard) {
    favs.splice(indice, 1);
  } else if (indice !== -1 && isFromCard) {
    favs[indice].name = name;
  } else {
    favs.push({ ref, name });
  }

  guardarLineasFavs(favs);
  renderLineasFavs();
  actualizarEstadoBotonFavoritos();
}

function agregarParadaAFavoritos(feature, customLabel = '') {
  const id = obtenerIdParada(feature);
  const defaultLabel = typeof obtenerNombreParadaCompleto === 'function'
    ? obtenerNombreParadaCompleto(feature)
    : obtenerEtiquetaParada(feature);
  const label = (typeof customLabel === 'string' && customLabel.trim() && customLabel.trim().toLowerCase() !== 'parada desconocida')
    ? customLabel.trim()
    : defaultLabel;
  if (!id) return;

  const coords = feature?.geometry?.coordinates;
  const lng = Array.isArray(coords) && coords.length >= 2 ? Number(coords[0]) : null;
  const lat = Array.isArray(coords) && coords.length >= 2 ? Number(coords[1]) : null;

  const lineas = typeof obtenerLineasDesdeRelations === 'function' ? obtenerLineasDesdeRelations(feature) : [];
  const lineasTexto = lineas.length > 0 ? lineas.join(', ') : '';

  const favs = obtenerParadasFavs();
  const indice = favs.findIndex((f) => f?.id === id);

  if (indice !== -1 && !customLabel) {
    favs.splice(indice, 1);
  } else if (indice !== -1 && customLabel) {
    favs[indice].nombre = label;
    favs[indice].label = label;
    if (lineasTexto) favs[indice].lineas = lineasTexto;
  } else {
    favs.push({
      id,
      nombre: label,
      label,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      lineas: lineasTexto
    });
    while (favs.length > MAX_PARADAS_FAVS) {
      favs.shift();
    }
  }
  guardarParadasFavs(favs);
  renderParadasFavs();
  actualizarEstadoBotonFavoritos();
}

function calcularRumboGrados(lat1, lng1, lat2, lng2) {
  const toRad = Math.PI / 180;
  const dLng = (lng2 - lng1) * toRad;
  const phi1 = lat1 * toRad;
  const phi2 = lat2 * toRad;
  const y = Math.sin(dLng) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng);
  const brng = (Math.atan2(y, x) * 180) / Math.PI;
  return (brng + 360) % 360;
}

function generarFlechasDireccionEnRuta(puntosLatLng, layerDestino) {
  if (!Array.isArray(puntosLatLng) || puntosLatLng.length < 2 || !layerDestino) return;

  const INTERVALO_METROS = 135;
  const DISTANCIA_MIN_INICIO = 45;
  let acumuladoDesdeUltima = INTERVALO_METROS - DISTANCIA_MIN_INICIO;
  let flechasColocadas = 0;

  for (let i = 0; i < puntosLatLng.length - 1; i++) {
    const p1 = puntosLatLng[i];
    const p2 = puntosLatLng[i + 1];
    if (!p1 || !p2) continue;

    const segDist = typeof calcularDistancia === 'function'
      ? calcularDistancia(p1[0], p1[1], p2[0], p2[1])
      : 0;
    if (segDist <= 3) continue;

    let distEnSeg = 0;
    while (distEnSeg + (INTERVALO_METROS - acumuladoDesdeUltima) <= segDist) {
      const avance = INTERVALO_METROS - acumuladoDesdeUltima;
      distEnSeg += avance;
      acumuladoDesdeUltima = 0;

      const ratio = distEnSeg / segDist;
      const latFlecha = p1[0] + (p2[0] - p1[0]) * ratio;
      const lngFlecha = p1[1] + (p2[1] - p1[1]) * ratio;
      const rumbo = Math.round(calcularRumboGrados(p1[0], p1[1], p2[0], p2[1]));

      const arrowIcon = L.divIcon({
        className: 'route-direction-arrow-icon',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
        html: `<svg viewBox="0 0 16 16" width="14" height="14" style="display:block; transform: rotate(${rumbo}deg); transform-origin: 7px 7px; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.6)); pointer-events:none;">
          <path d="M 8 2.5 L 13.5 13 L 8 10.3 L 2.5 13 Z" fill="#ffffff" stroke="rgba(0,0,0,0.4)" stroke-width="0.9" stroke-linejoin="round" />
        </svg>`
      });

      L.marker([latFlecha, lngFlecha], {
        icon: arrowIcon,
        interactive: false,
        keyboard: false
      }).addTo(layerDestino);
      flechasColocadas++;
    }

    acumuladoDesdeUltima += (segDist - distEnSeg);
  }

  if (flechasColocadas === 0 && puntosLatLng.length >= 2) {
    const midIdx = Math.floor((puntosLatLng.length - 1) / 2);
    const p1 = puntosLatLng[midIdx];
    const p2 = puntosLatLng[midIdx + 1] || puntosLatLng[puntosLatLng.length - 1];
    if (p1 && p2) {
      const rumbo = Math.round(calcularRumboGrados(p1[0], p1[1], p2[0], p2[1]));
      const latFlecha = (p1[0] + p2[0]) / 2;
      const lngFlecha = (p1[1] + p2[1]) / 2;
      const arrowIcon = L.divIcon({
        className: 'route-direction-arrow-icon',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
        html: `<svg viewBox="0 0 16 16" width="14" height="14" style="display:block; transform: rotate(${rumbo}deg); transform-origin: 7px 7px; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.6)); pointer-events:none;">
          <path d="M 8 2.5 L 13.5 13 L 8 10.3 L 2.5 13 Z" fill="#ffffff" stroke="rgba(0,0,0,0.4)" stroke-width="0.9" stroke-linejoin="round" />
        </svg>`
      });
      L.marker([latFlecha, lngFlecha], {
        icon: arrowIcon,
        interactive: false,
        keyboard: false
      }).addTo(layerDestino);
    }
  }
}

function extraerSegmentosLineasDeFeature(feature) {
  if (!feature) return [];
  const geom = feature.geometry || feature;
  if (!geom || !geom.coordinates) return [];

  const type = geom.type;
  const coords = geom.coordinates;
  const segmentos = [];

  const parsearPuntos = (arr) => {
    if (!Array.isArray(arr)) return [];
    return arr
      .map((c) => {
        if (!Array.isArray(c) || c.length < 2) return null;
        const lng = Number(c[0]);
        const lat = Number(c[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return [lat, lng];
      })
      .filter(Boolean);
  };

  if (type === 'LineString') {
    const pts = parsearPuntos(coords);
    if (pts.length >= 2) segmentos.push(pts);
  } else if (type === 'MultiLineString') {
    for (const linea of coords) {
      const pts = parsearPuntos(linea);
      if (pts.length >= 2) segmentos.push(pts);
    }
  }

  return segmentos;
}

function dibujarTrazoRecorridoConFlechas(layer, latLngs, colorLinea) {
  if (!layer || !Array.isArray(latLngs) || latLngs.length < 2) return;

  const color = colorLinea || '#ec4899';

  // 1. Trazado exterior oscuro para dar alto contraste y relieve visual (~9.5px)
  L.polyline(latLngs, {
    color: 'rgba(0, 0, 0, 0.35)',
    weight: 9.5,
    opacity: 0.85,
    lineCap: 'round',
    lineJoin: 'round',
    interactive: false
  }).addTo(layer);

  // 2. Trazo principal más grueso (~6.5px) con el color oficial de la línea
  L.polyline(latLngs, {
    color: color,
    weight: 6.5,
    opacity: 0.96,
    lineCap: 'round',
    lineJoin: 'round',
    interactive: false
  }).addTo(layer);

  // 3. Flechas de orientación espaciadas a lo largo de la ruta
  generarFlechasDireccionEnRuta(latLngs, layer);
}

function dibujarFeatureRecorridoConFlechas(layer, feature, colorLinea, invertido = false) {
  if (!layer || !feature) return;

  // Importante: no dibujar cada segmento crudo del MultiLineString por separado.
  // OSM/Overpass no garantiza que todos los segmentos de una relación de ruta estén
  // orientados en el mismo sentido, así que dibujarlos "tal como vienen" produce
  // flechas de dirección que apuntan al revés en algunos tramos. `extraerLatLngsDeGeometria`
  // ya cose los segmentos en un único camino continuo y coherente (misma lógica que usa
  // el algoritmo de planeo de rutas), así que reutilizamos eso acá también.
  let latLngs = extraerLatLngsDeGeometria(feature.geometry || feature);
  if (!Array.isArray(latLngs) || latLngs.length < 2) return;
  if (invertido) latLngs = [...latLngs].reverse();
  dibujarTrazoRecorridoConFlechas(layer, latLngs, colorLinea);
}

// paradaOrigenFeature: la parada desde la que se abrió la línea, o null si se llegó
// por el buscador / favoritos / lista de líneas. Es un parámetro explícito (y ya no un
// flag global que cada punto de entrada tenía que acordarse de limpiar) porque si
// quedaba pegado de una navegación anterior, abrir una línea completa seguía centrando
// el mapa en una parada vieja en vez de encuadrar todo el recorrido.
async function mostrarRecorridoDeLinea(ref, name = '', rutaIndex = null, invertido = false, paradaOrigenFeature = null) {
  if (!leafletMap || typeof L === 'undefined') return;

  // De dónde se abrió la línea: se guarda tambien en el global porque el boton
  // "volver a la parada" del panel lo lee despues, desde otro manejador.
  window._lineaDesdeParadaFeature = paradaOrigenFeature || null;
  const paradaOrigen = window._lineaDesdeParadaFeature;

  limpiarMarcadoresSeleccion();

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

  // Determinar la variante/sentido específico a dibujar para no superponer trayectos opuestos
  let indexElegido = 0;
  if (typeof rutaIndex === 'number' && rutaIndex >= 0 && rutaIndex < rutas.length) {
    indexElegido = rutaIndex;
  } else if (name && rutas.length > 1) {
    const nameNorm = name.toLowerCase().trim();
    const idx = rutas.findIndex((r) => {
      const rn = (r.properties?.name || '').toLowerCase().trim();
      const rf = (r.properties?.from || '').toLowerCase().trim();
      const rt = (r.properties?.to || '').toLowerCase().trim();
      return rn.includes(nameNorm) || nameNorm.includes(rn) || (rf && nameNorm.includes(rf)) || (rt && nameNorm.includes(rt));
    });
    if (idx !== -1) indexElegido = idx;
  }

  const featureElegido = rutas[indexElegido];
  const nombreVariante = featureElegido.properties?.name || (name || `Línea ${ref}`);

  recorridoActivo = { ref: String(ref), name: String(nombreVariante), feature: featureElegido, invertido: Boolean(invertido) };
  document.body.classList.add('is-viewing-linea-map');
  const relIds = obtenerRelIdsDeRutas([featureElegido]);

  const layerRec = asegurarRecorridoLayer();
  layerRec?.clearLayers();

  const layerParadas = asegurarParadasLayer();
  layerParadas?.clearLayers();

  const lineColor = getColorForLinea(ref);
  dibujarFeatureRecorridoConFlechas(layerRec, featureElegido, lineColor, Boolean(invertido));

  try {
    // Si la línea se abrió desde una parada específica, centrar el mapa en esa
    // parada (no en todo el recorrido) para que el usuario la vea de inmediato.
    // El encuadre a todo el recorrido queda reservado para cuando se llega
    // buscando la línea o viendo el recorrido completo (sin parada de origen).
    const coordsOrigen = paradaOrigen?.geometry?.coordinates;
    const latOrigen = Array.isArray(coordsOrigen) ? Number(coordsOrigen[1]) : NaN;
    const lngOrigen = Array.isArray(coordsOrigen) ? Number(coordsOrigen[0]) : NaN;

    if (Number.isFinite(latOrigen) && Number.isFinite(lngOrigen)) {
      const zoomActual = typeof leafletMap.getZoom === 'function' ? leafletMap.getZoom() : ZOOM_CALLE;
      centrarMapaEnPunto(latOrigen, lngOrigen, Math.max(zoomActual, ZOOM_CALLE));
    } else {
      const bounds = layerRec.getBounds?.();
      if (bounds && bounds.isValid && bounds.isValid()) {
        leafletMap.fitBounds(bounds, { padding: [20, 20] });
        establecerVistaMapaBounds(bounds, { padding: [20, 20] });
      }
    }
  } catch {
    // noop
  }

  // La lista de paradas del panel necesita los datos ya (se calculan siempre), pero los
  // markers en el mapa —la parte cara— se dibujan de una solo si ya se está lo bastante
  // cerca; si el fitBounds alejó la vista para que entre todo el recorrido, se dibujan
  // recién cuando el usuario haga zoom (ver programarCargaDiferidaParadasRecorrido).
  const paradasCalculadas = await calcularParadasDelRecorrido(relIds, featureElegido, Boolean(invertido));
  programarCargaDiferidaParadasRecorrido(paradasCalculadas);

  window._currentLineaRef = ref;
  window._currentLineaName = nombreVariante;
  window._currentLineaIdx = indexElegido;
  window._currentLineaInvertido = Boolean(invertido);

  // Selector de sentido / variante
  const totalVariantes = rutas.length;
  const textoSentido = nombreVariante.replace(/^Línea\s+[^:]+:\s*/i, '');
  const selectorSentidoHtml = `
    <div class="route-direction-card">
      <div class="route-direction-left">
        <span class="route-direction-badge">Trayecto ${indexElegido + 1} de ${totalVariantes}${invertido ? ' • Orientación invertida' : ''}</span>
        <span class="route-direction-text" title="${escapeHtml(textoSentido)}">${escapeHtml(textoSentido || 'Recorrido oficial')}</span>
      </div>
      ${totalVariantes > 1 ? `
        <button type="button" class="btn-route-switch-dir" onclick="cambiarSentidoRecorrido('${escapeHtml(String(ref))}', ${(indexElegido + 1) % totalVariantes}, false)">
          ⇄ Alternar sentido
        </button>
      ` : ''}
    </div>
  `;

  // Mostrar recorrido con paradas y botón de volver si venimos desde una parada
  const tituloLinea = ref ? `Línea ${escapeHtml(ref)}` : escapeHtml(nombreVariante);
  const listaParadasHtml = renderListaParadasRecorrido({ mostrarTodas: true });

  const volverHtml = htmlFilaVolverALineasDeParada(Boolean(paradaOrigen));

  let infoArribosHtml = '';
  if (paradaOrigen) {
    try {
      const paradaOrigenNombre = obtenerNombreParadaBase(paradaOrigen);
      const mapaHorarios = await cargarHorariosAproximados();
      const lineaEntryArribos = buscarLineaEnHorariosAproximados(mapaHorarios, ref);
      if (!lineaEntryArribos) {
        infoArribosHtml = renderArribosPreviewHtml([], paradaOrigenNombre, true);
      } else {
        const candidatosArribos = obtenerCandidatosNombreParada(paradaOrigen, paradaOrigenNombre);
        const stopMatchArribos = buscarParadaEnLineaAproximada(lineaEntryArribos, candidatosArribos);
        const offsetMinArribos = Number(stopMatchArribos?.est_offset_min) || 0;
        const itemsArribos = generarProximasLlegadasAproximadas(lineaEntryArribos, offsetMinArribos, new Date(), 3);
        infoArribosHtml = renderArribosPreviewHtml(itemsArribos, paradaOrigenNombre, false);
      }
    } catch (err) {
      console.warn('Error calculando horario aproximado en recorrido de línea:', err);
      infoArribosHtml = renderArribosPreviewHtml([], obtenerNombreParadaBase(paradaOrigen), true);
    }
  }

  const favsLineas = obtenerLineasFavs();
  const esLineaFav = favsLineas.some((f) => (f?.ref && ref && f.ref === ref) || (typeof f === 'string' && f === ref));

  const saveLineaHtml = `
    <div class="save-location-sheet" id="save-linea-container" style="${esLineaFav ? 'display: none;' : ''}">
      <button type="button" class="save-location-toggle" onclick="toggleGuardarLineaSheet(this)" aria-expanded="false" aria-controls="save-linea-body">
        <span class="save-location-toggle-icon" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"></path>
          </svg>
        </span>
        <span class="save-location-toggle-text">¿Guardar esta línea?</span>
        <svg class="save-location-toggle-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m6 9 6 6 6-6"></path>
        </svg>
      </button>
      <div class="save-location-body collapsed" id="save-linea-body">
        <p class="save-location-description">
          Podrás acceder rápidamente al recorrido y paradas desde tu sección de <strong>Guardados</strong>.
        </p>
        <div class="save-location-field">
          <label for="input-nombre-linea" class="save-location-label">
            Nombre o referencia
          </label>
          <input
            id="input-nombre-linea"
            type="text"
            class="save-location-input"
            value="${escapeHtml(nombreVariante ? `Línea ${ref} - ${nombreVariante}` : `Línea ${ref}`)}"
            placeholder="Ej: Mi colectivo, Línea ${ref}..."
            maxlength="60"
            onkeydown="if(event.key==='Enter'){event.preventDefault();document.querySelector('button[data-save-linea=\\'1\\']')?.click();}"
          />
        </div>
        <div class="save-location-buttonarea">
          <button
            type="button"
            class="btn-save-location-primary"
            data-save-linea="1"
            data-linea-ref="${escapeHtml(String(ref))}"
            data-linea-name="${escapeHtml(String(nombreVariante))}"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"></path>
            </svg>
            <span>Guardar en mis líneas</span>
          </button>
        </div>
      </div>
    </div>
  `;

  const html = `
    ${volverHtml}
    ${infoArribosHtml}
    ${saveLineaHtml}
    ${selectorSentidoHtml}
    ${listaParadasHtml}
  `;
  abrirBottomSheet(tituloLinea, html, 'linea', esLineaFav ? 'Línea guardada' : '');
}

window.cambiarSentidoRecorrido = (ref, nextIdx, isInverted = false) => {
  const data = paradasGeojson;
  if (!data) return;
  const rutas = obtenerRutasDeLinea(data, ref);
  const nextRuta = rutas[nextIdx] || rutas[0];
  const nextName = nextRuta?.properties?.name || '';
  // Cambiar de sentido/variante no cambia de dónde se abrió la línea: se conserva.
  void mostrarRecorridoDeLinea(ref, nextName, nextIdx, isInverted, window._lineaDesdeParadaFeature || null);
};

function mostrarLineasEnContenedorParadas(feature, opts = {}) {
  if (leafletMap && feature?.geometry?.coordinates) {
    const coords = feature.geometry.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      const lat = Number(coords[1]);
      const lng = Number(coords[0]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        // Math.max: si ya estabas más cerca que el zoom de calle se respeta ese
        // acercamiento; si estabas más lejos (por ejemplo viendo una línea completa),
        // se acerca hasta la parada en vez de dejar el mapa alejado.
        const zoomActual = (leafletMap && typeof leafletMap.getZoom === 'function') ? leafletMap.getZoom() : ZOOM_CALLE;
        const z = Math.max(zoomActual, ZOOM_PUNTO_ENFOCADO);
        establecerVistaMapaPunto(lat, lng, z);
        if (!opts?.gpsWalk) {
          centrarMapaEnPunto(lat, lng, z);
        }
      }
    }
  }

  const lineas = obtenerLineasDetalleDesdeRelations(feature);
  if (!lineas.length) {
    abrirBottomSheet('Parada', '<p>No hay líneas disponibles para esta parada.</p>');
    return;
  }

  // Obtener nombre de la parada desde el feature
  const paradaNombre = typeof obtenerNombreParadaCompleto === 'function'
    ? obtenerNombreParadaCompleto(feature)
    : (feature?.properties?.name || 'Parada');
  window._currentFeature = feature;

  // Destacar en el mapa la parada seleccionada con halo y pulso
  if (feature?.geometry?.coordinates) {
    const coords = feature.geometry.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      destacarParadaEnMapa(Number(coords[1]), Number(coords[0]), paradaNombre);
    }
  }

  const paradaId = obtenerIdParada(feature);
  const paradasFavs = obtenerParadasFavs();
  const esParadaFav = Array.isArray(paradasFavs) && paradasFavs.some((f) => f?.id === paradaId);

  const saveParadaHtml = `
    <div class="save-location-sheet" id="save-parada-container" style="${esParadaFav ? 'display: none;' : ''}">
      <p class="save-location-title">¿Guardar esta parada?</p>
      <p class="save-location-description">
        Podrás acceder rápidamente a las líneas que pasan por aquí desde tu sección de <strong>Guardados</strong>.
      </p>
      <div class="save-location-field">
        <label for="input-nombre-parada" class="save-location-label">
          Nombre de la parada
        </label>
        <input
          id="input-nombre-parada"
          type="text"
          class="save-location-input"
          value="${escapeHtml(paradaNombre)}"
          placeholder="Ej: Mi parada, Parada Facultad..."
          maxlength="60"
          onkeydown="if(event.key==='Enter'){event.preventDefault();document.querySelector('button[data-save-parada=\\'1\\']')?.click();}"
        />
      </div>
      <div class="save-location-buttonarea">
        <button
          type="button"
          class="btn-save-location-primary"
          data-save-parada="1"
          data-parada-id="${escapeHtml(String(paradaId))}"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"></path>
          </svg>
          <span>Guardar en mis paradas</span>
        </button>
      </div>
    </div>
  `;

  const itemsHtml = lineas
    .map((l) => renderBotonLineaHtml({ ref: l.ref, name: l.name }))
    .join('');

  const listaParadasHtml = recorridoActivo ? renderListaParadasRecorrido() : '';

  const gpsWalk = opts?.gpsWalk;

  const html = `
    <div style="display: flex; flex-direction: column; gap: 12px; padding: 4px 0 16px 0;">
      <ul class="bs-nav-rows">
        <li>
          <button type="button" class="btn-nav-row" onclick="iniciarPlaneoRutaHastaParadaSeleccionada(window._currentFeature || null)">
            🎯 Planificar viaje hacia esta parada
          </button>
        </li>
      </ul>

      <div style="margin-top: 4px;">
        <p style="margin: 0 0 10px 0; font-size: 14px; font-weight: 700; color: #93c5fd;">Líneas que pasan por esta parada:</p>
        <ul class="lineas-list">${itemsHtml}</ul>
      </div>

      ${saveParadaHtml}

      <div class="tsj-ad-slot" ${TSJ_ADS_PLACEHOLDER_ATTR}="${TSJ_ADS_TOKEN}"></div>
      ${listaParadasHtml}
    </div>
  `;
  abrirBottomSheet(escapeHtml(paradaNombre), html, 'parada', gpsWalk ? `A pie: ${gpsWalk.distTexto} (~${gpsWalk.minPie} min)` : (esParadaFav ? 'Parada guardada' : ''));
}



function asegurarParadasLayer() {
  if (!leafletMap || typeof L === 'undefined') return null;
  if (!paradasLayer) {
    paradasLayer = L.layerGroup().addTo(leafletMap);
  }
  return paradasLayer;
}

// Enganche opcional para seguir la descarga del GeoJSON de paradas: recibe una
// fracción de 0 a 1. Lo usa la pantalla de carga durante el arranque; el resto del
// tiempo queda en null y cargarParadasGeojson() no reporta nada.
let _onProgresoDescargaParadas = null;

// Dónde se recuerda cuánto pesó el GeoJSON ya descomprimido en la visita anterior.
// Hace falta porque el Content-Length viene en bytes COMPRIMIDOS mientras que el
// stream entrega bytes descomprimidos: usar el header como denominador haría que el
// avance se dispare al principio y después se quede clavado en el tope. La primera
// visita usa el header igual (queda optimista, pero nunca retrocede) y a partir de la
// segunda el tamaño real ya se conoce.
const STORAGE_TAMANO_PARADAS_KEY = 'zondamov_tamano_paradas_bytes';

// Lee el cuerpo de una respuesta JSON informando el avance de la descarga. Si el
// navegador no expone streams o no hay ningún tamaño de referencia, cae al camino
// simple (resp.json()) y no reporta nada.
async function leerJsonConProgreso(resp, onProgreso) {
  const totalHeader = Number(resp.headers.get('content-length')) || 0;
  let totalPrevio = 0;
  try {
    totalPrevio = Number(localStorage.getItem(STORAGE_TAMANO_PARADAS_KEY)) || 0;
  } catch {
    // almacenamiento bloqueado
  }
  const total = totalPrevio || totalHeader;

  if (typeof onProgreso !== 'function' || !total || !resp.body || typeof resp.body.getReader !== 'function') {
    return resp.json();
  }

  const reader = resp.body.getReader();
  const trozos = [];
  let recibido = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    trozos.push(value);
    recibido += value.length;
    onProgreso(Math.min(1, recibido / total));
  }

  try {
    localStorage.setItem(STORAGE_TAMANO_PARADAS_KEY, String(recibido));
  } catch {
    // almacenamiento bloqueado
  }

  const buffer = new Uint8Array(recibido);
  let offset = 0;
  for (const trozo of trozos) {
    buffer.set(trozo, offset);
    offset += trozo.length;
  }
  onProgreso(1);
  return JSON.parse(new TextDecoder('utf-8').decode(buffer));
}

async function cargarParadasGeojson() {
  if (paradasGeojson) return paradasGeojson;

  try {
    const resp = await fetch(PARADAS_GEOJSON_URL, { cache: 'force-cache' });
    if (!resp.ok) {
      throw new Error(`No se pudo cargar ${PARADAS_GEOJSON_URL} (HTTP ${resp.status}).`);
    }
    const data = await leerJsonConProgreso(resp, _onProgresoDescargaParadas);
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
    void actualizarHudParadaMasCercana();
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

let _nearestStopHudParada = null;
let indicacionGpsLayer = null;

function asegurarIndicacionGpsLayer() {
  if (!leafletMap || typeof L === 'undefined') return null;
  if (!indicacionGpsLayer) {
    indicacionGpsLayer = L.layerGroup().addTo(leafletMap);
  }
  return indicacionGpsLayer;
}

function limpiarIndicacionGps() {
  if (indicacionGpsLayer) {
    indicacionGpsLayer.clearLayers();
  }
}

function limpiarRutaGpsActiva() {
  limpiarIndicacionGps();
  const bar = document.getElementById('map-active-gps-route-bar');
  if (bar) {
    bar.classList.remove('visible');
  }
}

function mostrarBarraRutaGpsActiva(distTexto, minPie, nombreParada) {
  const bar = document.getElementById('map-active-gps-route-bar');
  if (!bar) return;

  const dtEl = document.getElementById('active-gps-dist-time');
  const targetEl = document.getElementById('active-gps-target');

  if (dtEl) dtEl.textContent = `${distTexto} • ~${minPie} min a pie`;
  if (targetEl) targetEl.textContent = `Hacia ${nombreParada}`;

  // Ocultar HUD normal de parada mientras la ruta activa esté en pantalla
  const hud = document.getElementById('map-nearest-stop-hud');
  if (hud) hud.classList.remove('visible');

  bar.classList.add('visible');
}

function isHudParadaCercanaHabilitado() {
  const val = localStorage.getItem('zondamov_hud_parada_cercana_enabled');
  return val === null ? true : val === 'true';
}

function setHudParadaCercanaHabilitado(enabled) {
  localStorage.setItem('zondamov_hud_parada_cercana_enabled', enabled ? 'true' : 'false');
  const hud = document.getElementById('map-nearest-stop-hud');
  if (!enabled) {
    if (hud) hud.classList.remove('visible');
    limpiarRutaGpsActiva();
  } else {
    void actualizarHudParadaMasCercana();
  }
}

function setupPreferenciaHudParada() {
  const toggle = document.getElementById('toggle-nearest-stop-hud');
  if (!toggle) return;

  toggle.checked = isHudParadaCercanaHabilitado();
  toggle.onchange = () => {
    setHudParadaCercanaHabilitado(toggle.checked);
  };
}

async function actualizarHudParadaMasCercana() {
  const hud = document.getElementById('map-nearest-stop-hud');
  if (!hud) return;

  // Si la barra de ruta GPS activa está visible, no mostrar el HUD de parada
  const activeGpsBar = document.getElementById('map-active-gps-route-bar');
  if (activeGpsBar?.classList.contains('visible')) {
    hud.classList.remove('visible');
    return;
  }

  if (!isHudParadaCercanaHabilitado()) {
    hud.classList.remove('visible');
    return;
  }

  const bs = document.getElementById('bottom-sheet');
  const isBsActive = bs?.classList.contains('active');
  const viewMap = document.getElementById('view-map');
  const isMapActive = viewMap?.classList.contains('active');

  // Solo mostrar en la vista del mapa cuando no hay panel de detalle abierto ni ruta activa
  if (!isMapActive || isBsActive || (recorridoActivo && recorridoActivo.planned)) {
    hud.classList.remove('visible');
    return;
  }

  // Coordenadas de referencia: primero ubicación GPS, luego centro del mapa
  let refLat = null;
  let refLng = null;

  if (ubicacion && Number.isFinite(ubicacion.lat) && Number.isFinite(ubicacion.lng)) {
    refLat = Number(ubicacion.lat);
    refLng = Number(ubicacion.lng);
  } else if (leafletMap && typeof leafletMap.getCenter === 'function') {
    const c = leafletMap.getCenter();
    if (c && Number.isFinite(c.lat) && Number.isFinite(c.lng)) {
      refLat = Number(c.lat);
      refLng = Number(c.lng);
    }
  }

  // A partir de acá la isla ya se puede mostrar: aunque no haya una parada cerca,
  // los paneles de planificar viaje y favoritos siguen siendo útiles. Antes, cualquiera
  // de estos cortes escondía todo el contenedor.
  hud.style.display = '';
  hud.classList.add('visible');

  if (!Number.isFinite(refLat) || !Number.isFinite(refLng)) {
    marcarIslaSinParada('Activá la ubicación o movete por el mapa para ver la parada más cercana.');
    return;
  }

  const puntos = await cargarParadasPuntos();
  if (!Array.isArray(puntos) || puntos.length === 0) {
    marcarIslaSinParada('Todavía se están cargando las paradas. Probá de nuevo en unos segundos.');
    return;
  }

  let mejor = null;
  let minDist = Infinity;

  for (const p of puntos) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const d = calcularDistancia(refLat, refLng, p.lat, p.lng);
    if (d < minDist) {
      minDist = d;
      mejor = p;
    }
  }

  // Si no hay paradas o la más cercana está a más de 3000 metros, el panel de parada
  // pasa a su estado vacío (la isla sigue visible por los otros dos paneles).
  if (!mejor || !mejor.feature || minDist > 3000) {
    marcarIslaSinParada('No hay paradas a menos de 3 km de acá. Movete por el mapa para buscar una.');
    return;
  }

  _nearestStopHudParada = mejor;

  const nombreParada = mejor.feature.properties?.name || mejor.feature.properties?.['name:es'] || 'Parada cercana';
  const minPie = Math.max(1, Math.round(minDist / 75));
  const distTexto = minDist < 1000 ? `${Math.round(minDist)} m` : `${(minDist / 1000).toFixed(1)} km`;

  const nameEl = document.getElementById('hud-stop-name');
  const distEl = document.getElementById('hud-stop-dist');
  const instrEl = document.getElementById('hud-stop-instruction');
  const linesRow = document.getElementById('hud-lines-row');

  if (nameEl) nameEl.textContent = nombreParada;
  if (distEl) distEl.textContent = `${distTexto} • ~${minPie} min a pie`;
  if (instrEl) {
    instrEl.textContent = `Caminá hacia ${nombreParada} (~${minPie} min). Tocá acá para trazar la ruta GPS a pie en el mapa.`;
  }

  if (linesRow) {
    const lineas = obtenerLineasDetalleDesdeRelations(mejor.feature);
    if (lineas.length === 0) {
      linesRow.innerHTML = '<span style="font-size: 11px; color: #94a3b8; font-weight: 500;">Parada sin líneas registradas</span>';
    } else {
      const maxShow = 6;
      const shown = lineas.slice(0, maxShow);
      const remaining = lineas.length - maxShow;

      const pillsHtml = shown
        .map((l) => {
          const rawRef = String(l.ref || l.name || '').trim();
          const cleanRef = formatBadgeLinea(rawRef);
          const c = getColorForLinea(rawRef);
          const tc = getTextColorForBg(c);
          return `<span class="hud-line-pill" style="background-color: ${c}; color: ${tc};">${escapeHtml(cleanRef)}</span>`;
        })
        .join('');

      const moreHtml = remaining > 0 ? `<span class="hud-line-more">+${remaining}</span>` : '';
      linesRow.innerHTML = pillsHtml + moreHtml;
    }
  }

  hud.style.display = '';
  hud.classList.add('visible');
  ajustarAlturaIsla();
}

let _dashNearestStopParada = null;

// Tarjeta "Tu parada más cercana" en el Dashboard: ahorra tener que entrar al mapa
// para saber a qué parada ir y qué líneas pasan por ahí.
async function actualizarTarjetaParadaCercanaDashboard() {
  // La tarjeta (contenedor) siempre queda visible porque también aloja el toggle de
  // preferencia; solo se oculta/muestra el bloque de datos de la parada en sí.
  const body = document.getElementById('dashboard-nearest-stop-body');
  if (!body) return;

  let refLat = null;
  let refLng = null;

  if (ubicacion && Number.isFinite(ubicacion.lat) && Number.isFinite(ubicacion.lng)) {
    refLat = Number(ubicacion.lat);
    refLng = Number(ubicacion.lng);
  } else {
    try {
      const position = await obtenerPosicionActual();
      refLat = position.coords.latitude;
      refLng = position.coords.longitude;
      ubicacion = { lat: refLat, lng: refLng };
    } catch {
      body.style.display = 'none';
      return;
    }
  }

  const puntos = await cargarParadasPuntos();
  if (!Array.isArray(puntos) || puntos.length === 0) {
    body.style.display = 'none';
    return;
  }

  let mejor = null;
  let minDist = Infinity;
  for (const p of puntos) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const d = calcularDistancia(refLat, refLng, p.lat, p.lng);
    if (d < minDist) {
      minDist = d;
      mejor = p;
    }
  }

  if (!mejor || !mejor.feature || minDist > 3000) {
    body.style.display = 'none';
    return;
  }

  _dashNearestStopParada = mejor;

  const nombreParada = typeof obtenerNombreParadaCompleto === 'function'
    ? obtenerNombreParadaCompleto(mejor.feature)
    : (mejor.feature.properties?.name || 'Parada cercana');
  const distTexto = minDist < 1000 ? `${Math.round(minDist)} m` : `${(minDist / 1000).toFixed(1)} km`;

  const nameEl = document.getElementById('dash-nearest-stop-name');
  const distEl = document.getElementById('dash-nearest-stop-dist');
  const linesEl = document.getElementById('dash-nearest-stop-lines');

  if (nameEl) nameEl.textContent = nombreParada;
  if (distEl) distEl.textContent = `A ${distTexto} de tu ubicación`;

  if (linesEl) {
    const lineas = obtenerLineasDetalleDesdeRelations(mejor.feature);
    if (lineas.length === 0) {
      linesEl.innerHTML = '<span style="font-size: 12px; color: #71717a; font-weight: 500;">Sin líneas registradas</span>';
    } else {
      const maxShow = 6;
      const shown = lineas.slice(0, maxShow);
      const remaining = lineas.length - maxShow;

      const pillsHtml = shown
        .map((l) => {
          const rawRef = String(l.ref || l.name || '').trim();
          const cleanRef = formatBadgeLinea(rawRef);
          const c = getColorForLinea(rawRef);
          const tc = getTextColorForBg(c);
          return `<span class="hud-line-pill" style="background-color: ${c}; color: ${tc};">${escapeHtml(cleanRef)}</span>`;
        })
        .join('');

      const moreHtml = remaining > 0 ? `<span class="hud-line-more">+${remaining}</span>` : '';
      linesEl.innerHTML = pillsHtml + moreHtml;
    }
  }

  body.style.display = '';
}

function setupTarjetaParadaCercanaDashboard() {
  const btn = document.getElementById('dash-nearest-stop-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (!_dashNearestStopParada || !_dashNearestStopParada.feature) return;
    cambiarVista('view-map');
    mostrarLineasEnContenedorParadas(_dashNearestStopParada.feature);
  });
}

// Accesos rápidos a favoritos (lugares/líneas/paradas guardados) debajo del buscador.
function renderAccesosRapidosDashboard() {
  const section = document.getElementById('quick-favs-section');
  const row = document.getElementById('quick-favs-row');
  if (!section || !row) return;

  const lugares = obtenerLugaresFavs();
  const lineas = obtenerLineasFavs();
  const paradas = obtenerParadasFavs();

  const items = [
    ...lugares.map((l) => ({ tipo: 'lugar', data: l })),
    ...lineas.map((l) => ({ tipo: 'linea', data: l })),
    ...paradas.map((p) => ({ tipo: 'parada', data: p })),
  ].slice(0, 3);

  if (items.length === 0) {
    section.style.display = 'none';
    row.innerHTML = '';
    return;
  }

  row.innerHTML = '';
  for (const item of items) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'quick-fav-chip';

    if (item.tipo === 'linea') {
      const ref = String(item.data.ref || item.data.linea || '').trim();
      const name = String(item.data.name || item.data.nombre || `Línea ${ref}`).trim();
      const c = getColorForLinea(ref);
      const tc = getTextColorForBg(c);
      chip.innerHTML = `
        <span class="quick-fav-chip-icon" style="background-color: ${c}; color: ${tc};">${escapeHtml(formatBadgeLinea(ref))}</span>
        <span class="quick-fav-chip-label">${escapeHtml(name)}</span>
      `;
      chip.addEventListener('click', () => {
        cambiarVista('view-map');
        void mostrarRecorridoDeLinea(ref, name);
      });
    } else if (item.tipo === 'parada') {
      const nombre = String(item.data.nombre || item.data.label || 'Parada').trim();
      chip.innerHTML = `
        <span class="quick-fav-chip-icon">🚏</span>
        <span class="quick-fav-chip-label">${escapeHtml(nombre)}</span>
      `;
      chip.addEventListener('click', () => {
        void centrarEnParadaGuardada(item.data);
      });
    } else {
      const nombre = String(item.data.nombre || 'Lugar').trim();
      const lat = Number(item.data.lat);
      const lng = Number(item.data.lng);
      chip.innerHTML = `
        <span class="quick-fav-chip-icon">📌</span>
        <span class="quick-fav-chip-label">${escapeHtml(nombre)}</span>
      `;
      chip.addEventListener('click', () => {
        centrarEnLugar(lat, lng, nombre);
      });
    }

    row.appendChild(chip);
  }

  section.style.display = '';
}

async function trazarRutaGpsAParadaCercana(paradaItem) {
  if (!paradaItem || !paradaItem.feature) return;
  const latD = Number(paradaItem.lat);
  const lngD = Number(paradaItem.lng);
  if (!Number.isFinite(latD) || !Number.isFinite(lngD)) return;

  const loadingOverlay = document.getElementById('hud-loading-overlay');
  const hud = document.getElementById('map-nearest-stop-hud');
  if (loadingOverlay) loadingOverlay.style.display = 'flex';
  if (hud) hud.style.pointerEvents = 'none';

  try {
    // Determinar origen
    let latO = null;
    let lngO = null;
    if (ubicacion && Number.isFinite(ubicacion.lat) && Number.isFinite(ubicacion.lng)) {
      latO = Number(ubicacion.lat);
      lngO = Number(ubicacion.lng);
    } else if (leafletMap && typeof leafletMap.getCenter === 'function') {
      const c = leafletMap.getCenter();
      if (c && Number.isFinite(c.lat) && Number.isFinite(c.lng)) {
        latO = Number(c.lat);
        lngO = Number(c.lng);
      }
    }

    if (!Number.isFinite(latO) || !Number.isFinite(lngO)) {
      latO = latD;
      lngO = lngD;
    }

    const layer = asegurarIndicacionGpsLayer();
    if (layer) layer.clearLayers();

    const distM = calcularDistancia(latO, lngO, latD, lngD);
    const minPie = Math.max(1, Math.round(distM / 75));
    const distTexto = distM < 1000 ? `${Math.round(distM)} m` : `${(distM / 1000).toFixed(1)} km`;

    let coordsRuta = [[latO, lngO], [latD, lngD]];

    // Pequeño delay mínimo para que la animación de carga se aprecie visualmente de forma fluida
    const minDelayPromise = new Promise((resolve) => setTimeout(resolve, 380));

    // Intentar consultar ruta peatonal OSRM para seguir el trazado real de las calles
    try {
      const controller = new AbortController();
      const toId = setTimeout(() => controller.abort(), 2500);
      const osrmUrl = `https://router.project-osrm.org/route/v1/walking/${lngO},${latO};${lngD},${latD}?overview=full&geometries=geojson`;
      const resp = await fetch(osrmUrl, { signal: controller.signal });
      clearTimeout(toId);
      if (resp.ok) {
        const data = await resp.json();
        const geom = data?.routes?.[0]?.geometry?.coordinates;
        if (Array.isArray(geom) && geom.length >= 2) {
          coordsRuta = geom.map((pt) => [pt[1], pt[0]]);
        }
      }
    } catch {
      // Fallback a línea directa
    }

    await minDelayPromise;

    if (layer && typeof L !== 'undefined') {
      // 1. Halo / resplandor GPS exterior
      L.polyline(coordsRuta, {
        color: '#e6351d',
        weight: 9,
        opacity: 0.45,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(layer);

      // 2. Línea punteada GPS interior
      L.polyline(coordsRuta, {
        color: '#ff735c',
        weight: 4.5,
        opacity: 0.95,
        dashArray: '8, 8',
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(layer);

      // 3. Marcador pin destacado en la parada
      const stopIcon = L.divIcon({
        className: 'gps-stop-pin-icon',
        html: `
          <div style="position: relative; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center;">
            <div style="position: absolute; width: 34px; height: 34px; border-radius: 50%; background: rgba(255, 71, 46, 0.35); animation: hudDotPulse 1.5s infinite ease-in-out;"></div>
            <div style="width: 24px; height: 24px; border-radius: 50%; background: #ff472e; border: 2px solid #ffffff; box-shadow: 0 4px 12px rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; color: #ffffff;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
            </div>
          </div>
        `,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      });

      L.marker([latD, lngD], { icon: stopIcon }).addTo(layer);
    }

    // Centrar y encuadrar mapa
    if (leafletMap) {
      if (distM > 35) {
        const gpsBounds = [[latO, lngO], [latD, lngD]];
        const gpsFitOpts = {
          paddingTopLeft: [40, 40],
          paddingBottomRight: [40, 220],
          maxZoom: 18,
        };
        leafletMap.fitBounds(gpsBounds, { ...gpsFitOpts, animate: true });
        establecerVistaMapaBounds(gpsBounds, gpsFitOpts);
      } else {
        centrarMapaEnPunto(latD, lngD, 18);
      }
    }

    // Mostrar barra flotante achicada de ruta activa arriba del mapa
    const nombreParada = typeof obtenerNombreParadaCompleto === 'function'
      ? obtenerNombreParadaCompleto(paradaItem.feature)
      : (paradaItem.feature?.properties?.name || 'Parada cercana');
    mostrarBarraRutaGpsActiva(distTexto, minPie, nombreParada);

    // Desplegar panel con indicación GPS peatonal y las líneas
    mostrarLineasEnContenedorParadas(paradaItem.feature, { gpsWalk: { distTexto, minPie } });
  } finally {
    if (loadingOverlay) loadingOverlay.style.display = 'none';
    if (hud) hud.style.pointerEvents = '';
  }
}

// Dibuja la caminata desde el origen hasta la primera parada de una ruta ya planeada
// (directa o con trasbordo) y muestra la distancia/tiempo en la barra superior.
// No abre ningún panel: el bottom sheet de la ruta planeada ya está a cargo de eso.
async function trazarCaminataHaciaPrimeraParadaPlaneada(origenLat, origenLng, paradaItem) {
  if (!paradaItem || !paradaItem.feature) return;
  const latO = Number(origenLat);
  const lngO = Number(origenLng);
  const latD = Number(paradaItem.lat);
  const lngD = Number(paradaItem.lng);
  if (!Number.isFinite(latO) || !Number.isFinite(lngO) || !Number.isFinite(latD) || !Number.isFinite(lngD)) return;

  const layer = asegurarIndicacionGpsLayer();
  if (layer) layer.clearLayers();

  const distM = calcularDistancia(latO, lngO, latD, lngD);
  const minPie = Math.max(1, Math.round(distM / 75));
  const distTexto = distM < 1000 ? `${Math.round(distM)} m` : `${(distM / 1000).toFixed(1)} km`;

  let coordsRuta = [[latO, lngO], [latD, lngD]];

  try {
    const controller = new AbortController();
    const toId = setTimeout(() => controller.abort(), 2500);
    const osrmUrl = `https://router.project-osrm.org/route/v1/walking/${lngO},${latO};${lngD},${latD}?overview=full&geometries=geojson`;
    const resp = await fetch(osrmUrl, { signal: controller.signal });
    clearTimeout(toId);
    if (resp.ok) {
      const data = await resp.json();
      const geom = data?.routes?.[0]?.geometry?.coordinates;
      if (Array.isArray(geom) && geom.length >= 2) {
        coordsRuta = geom.map((pt) => [pt[1], pt[0]]);
      }
    }
  } catch {
    // Fallback a línea directa
  }

  // Si mientras se consultaba OSRM se cerró la ruta planeada, no dibujar nada.
  if (!recorridoActivo || !recorridoActivo.planned) return;

  if (layer && typeof L !== 'undefined') {
    L.polyline(coordsRuta, {
      color: '#e6351d',
      weight: 8,
      opacity: 0.4,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(layer);

    L.polyline(coordsRuta, {
      color: '#ff735c',
      weight: 4,
      opacity: 0.95,
      dashArray: '8, 8',
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(layer);

    const stopIcon = L.divIcon({
      className: 'gps-stop-pin-icon',
      html: `
        <div style="position: relative; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;">
          <div style="position: absolute; width: 28px; height: 28px; border-radius: 50%; background: rgba(255, 71, 46, 0.35); animation: hudDotPulse 1.5s infinite ease-in-out;"></div>
          <div style="width: 20px; height: 20px; border-radius: 50%; background: #ff472e; border: 2px solid #ffffff; box-shadow: 0 4px 12px rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; color: #ffffff;">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
              <circle cx="12" cy="10" r="3"/>
            </svg>
          </div>
        </div>
      `,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
    L.marker([latD, lngD], { icon: stopIcon }).addTo(layer);
  }

  const nombreParada = typeof obtenerNombreParadaCompleto === 'function'
    ? obtenerNombreParadaCompleto(paradaItem.feature)
    : (paradaItem.feature?.properties?.name || obtenerNombreParadaBase(paradaItem.feature) || 'la primera parada');

  mostrarBarraRutaGpsActiva(distTexto, minPie, nombreParada);
}

// ─── Isla dinámica del mapa ────────────────────────────────────────────────
// Un solo contenedor flotante con tres paneles superpuestos: parada más cercana en
// vivo, acceso directo a planificar viaje y favoritos. Se alternan deslizando en
// vertical (touch o rueda del mouse), tocando los puntos indicadores o con las
// flechas del teclado. Solo el panel activo recibe clicks; la altura del contenedor
// se anima hasta la del panel activo, que es lo que da la sensación de "isla" que se
// re-forma en lugar de tres tarjetas distintas.
const DI_PANELES = ['parada', 'planear', 'favoritos'];
// La lista de favoritos tiene scroll propio, así que puede mostrar bastantes más de
// los que entran a la vista sin estirar la isla.
const DI_MAX_FAVORITOS = 12;
const DI_HINT_STORAGE_KEY = 'zondamov_isla_hint_visto';
const DI_UMBRAL_SWIPE_PX = 26;

let _diIndice = 0;
let _diSetupHecho = false;
let _diGestoMovido = false;
let _diUltimoWheel = 0;

function diRefs() {
  return {
    hud: document.getElementById('map-nearest-stop-hud'),
    viewport: document.getElementById('di-viewport'),
    panes: Array.from(document.querySelectorAll('#di-viewport .di-pane')),
    dots: Array.from(document.querySelectorAll('#di-dots .di-dot')),
  };
}

// La altura no puede salir del flujo normal: los paneles están posicionados en
// absoluto (superpuestos), así que el viewport mediría 0. Se fija a mano con la
// altura real del panel activo y la transición CSS hace el resto.
function ajustarAlturaIsla() {
  const { viewport, panes } = diRefs();
  if (!viewport) return;
  const activo = panes[_diIndice];
  if (!activo) return;
  viewport.style.height = `${activo.offsetHeight}px`;
}

function marcarHintIslaVisto() {
  const { hud } = diRefs();
  if (hud) hud.classList.add('di-hint-off');
  try {
    localStorage.setItem(DI_HINT_STORAGE_KEY, 'true');
  } catch {
    // noop: modo privado / almacenamiento bloqueado
  }
}

function irAPanelIsla(indice, { silencioso = false } = {}) {
  const { hud, panes, dots } = diRefs();
  if (!hud || panes.length === 0) return;

  const total = panes.length;
  const destino = ((Number(indice) % total) + total) % total;
  const anterior = _diIndice;

  // El panel que se va sale en la dirección del gesto: si avanzamos, se va por arriba.
  const avanzando = destino > anterior || (anterior === total - 1 && destino === 0);

  panes.forEach((pane, i) => {
    const esActivo = i === destino;
    pane.classList.toggle('is-active', esActivo);
    pane.classList.toggle('is-exit-up', !esActivo && avanzando);
    pane.setAttribute('aria-hidden', esActivo ? 'false' : 'true');
  });

  dots.forEach((dot, i) => {
    const esActivo = i === destino;
    dot.classList.toggle('is-active', esActivo);
    dot.setAttribute('aria-selected', esActivo ? 'true' : 'false');
  });

  _diIndice = destino;

  // Los favoritos se re-leen al entrar al panel: pueden haber cambiado desde la
  // última vez (se guardó una parada, se borró un lugar) sin pasar por acá.
  if (DI_PANELES[destino] === 'favoritos') renderFavoritosIsla();

  ajustarAlturaIsla();

  if (!silencioso && destino !== anterior) {
    marcarHintIslaVisto();
    hud.classList.add('di-morphing');
    window.setTimeout(() => hud.classList.remove('di-morphing'), 220);
  }
}

// Favoritos (lugares, líneas y paradas guardadas) resumidos dentro de la isla.
function renderFavoritosIsla() {
  const cont = document.getElementById('di-favs-list');
  if (!cont) return;

  const lugares = typeof obtenerLugaresFavs === 'function' ? obtenerLugaresFavs() : [];
  const lineas = typeof obtenerLineasFavs === 'function' ? obtenerLineasFavs() : [];
  const paradas = typeof obtenerParadasFavs === 'function' ? obtenerParadasFavs() : [];

  const items = [
    ...(Array.isArray(lugares) ? lugares : []).map((l) => ({ tipo: 'lugar', data: l })),
    ...(Array.isArray(lineas) ? lineas : []).map((l) => ({ tipo: 'linea', data: l })),
    ...(Array.isArray(paradas) ? paradas : []).map((x) => ({ tipo: 'parada', data: x })),
  ].slice(0, DI_MAX_FAVORITOS);

  cont.innerHTML = '';

  if (items.length === 0) {
    const vacio = document.createElement('p');
    vacio.className = 'di-favs-empty';
    vacio.textContent = 'Todavía no guardaste nada. Tocá el corazón en una línea, parada o lugar y va a aparecer acá.';
    cont.appendChild(vacio);
    return;
  }

  for (const item of items) {
    const fila = document.createElement('button');
    fila.type = 'button';
    fila.className = 'di-fav-row';
    // Arrastrar la lista termina en un "click" sobre la fila donde estaba el dedo:
    // si hubo movimiento, el gesto era para scrollear, no para abrir el favorito.
    fila.addEventListener('click', (ev) => {
      if (!_diGestoMovido) return;
      ev.stopImmediatePropagation();
      ev.preventDefault();
    });

    if (item.tipo === 'linea') {
      const ref = String(item.data.ref || item.data.linea || '').trim();
      const nombre = String(item.data.name || item.data.nombre || `Línea ${ref}`).trim();
      const bg = getColorForLinea(ref);
      const fg = getTextColorForBg(bg);
      fila.innerHTML = `
        <span class="di-fav-icon" style="background-color: ${bg}; color: ${fg};">${escapeHtml(formatBadgeLinea(ref))}</span>
        <span class="di-fav-text">
          <span class="di-fav-name">${escapeHtml(nombre)}</span>
          <span class="di-fav-kind">Línea guardada</span>
        </span>
      `;
      fila.addEventListener('click', (ev) => {
        ev.stopPropagation();
        void mostrarRecorridoDeLinea(ref, nombre);
      });
    } else if (item.tipo === 'parada') {
      const nombre = String(item.data.nombre || item.data.label || 'Parada').trim();
      fila.innerHTML = `
        <span class="di-fav-icon">🚏</span>
        <span class="di-fav-text">
          <span class="di-fav-name">${escapeHtml(nombre)}</span>
          <span class="di-fav-kind">Parada guardada</span>
        </span>
      `;
      fila.addEventListener('click', (ev) => {
        ev.stopPropagation();
        void centrarEnParadaGuardada(item.data);
      });
    } else {
      const nombre = String(item.data.nombre || 'Lugar').trim();
      const lat = Number(item.data.lat);
      const lng = Number(item.data.lng);
      fila.innerHTML = `
        <span class="di-fav-icon">📌</span>
        <span class="di-fav-text">
          <span class="di-fav-name">${escapeHtml(nombre)}</span>
          <span class="di-fav-kind">Lugar guardado</span>
        </span>
      `;
      fila.addEventListener('click', (ev) => {
        ev.stopPropagation();
        centrarEnLugar(lat, lng, nombre);
      });
    }

    cont.appendChild(fila);
  }

  actualizarSombrasScrollFavoritosIsla();
}

// Muestra los degradados de recorte solo del lado donde realmente queda contenido
// fuera de la vista, para que se note que la lista sigue.
function actualizarSombrasScrollFavoritosIsla() {
  const lista = document.getElementById('di-favs-list');
  const scroller = document.getElementById('di-favs-scroller');
  if (!lista || !scroller) return;
  const hayScroll = lista.scrollHeight - lista.clientHeight > 1;
  scroller.classList.toggle('has-more-above', hayScroll && lista.scrollTop > 1);
  scroller.classList.toggle(
    'has-more-below',
    hayScroll && lista.scrollTop < lista.scrollHeight - lista.clientHeight - 1,
  );
}

// La lista de favoritos scrolleable que contiene al elemento tocado, o null si el
// gesto no empezó dentro de una.
function listaFavoritosScrolleableDesde(target) {
  if (!(target instanceof Element)) return null;
  const lista = target.closest('#di-favs-list');
  if (!lista) return null;
  return lista.scrollHeight - lista.clientHeight > 1 ? lista : null;
}

// True si a la lista todavía le queda recorrido en la dirección del gesto. Se usa con
// la rueda del mouse: mientras quede, la rueda scrollea; al llegar al tope, cambia de
// panel.
function listaFavoritosPuedeScrollear(lista, delta) {
  if (!lista) return false;
  const maxScroll = lista.scrollHeight - lista.clientHeight;
  if (delta > 0) return lista.scrollTop > 0;
  if (delta < 0) return lista.scrollTop < maxScroll - 1;
  return false;
}

function setupNearestStopHud() {
  const { hud } = diRefs();
  if (!hud || _diSetupHecho) return;
  _diSetupHecho = true;

  // La isla flota sobre el mapa: sin esto, arrastrar o girar la rueda encima de ella
  // termina moviendo/zoomeando el mapa de abajo en vez de cambiar de panel.
  if (typeof L !== 'undefined' && L.DomEvent) {
    try {
      L.DomEvent.disableClickPropagation(hud);
      L.DomEvent.disableScrollPropagation(hud);
    } catch {
      // noop
    }
  }

  // ── Panel 1: tocar la tarjeta traza la ruta a pie hasta la parada ──
  const trigger = document.getElementById('hud-parada-trigger');
  if (trigger) {
    const trazar = (ev) => {
      ev.stopPropagation();
      // Un deslizamiento termina en "click": si el dedo se movió, no era un toque.
      if (_diGestoMovido) return;
      if (!_nearestStopHudParada || !_nearestStopHudParada.feature) return;
      void trazarRutaGpsAParadaCercana(_nearestStopHudParada);
    };
    trigger.addEventListener('click', trazar);
    trigger.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      trazar(ev);
    });
  }

  // ── Panel 2: accesos al planificador ──
  document.getElementById('di-plan-btn')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    mostrarPlanificadorViaje();
  });

  document.getElementById('di-plan-from-stop-btn')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    mostrarPlanificadorViaje();
    if (typeof mostrarSelectorUbicacionRuta === 'function') mostrarSelectorUbicacionRuta('destino');
  });

  // ── Panel 3: ver todos los guardados ──
  document.getElementById('di-favs-all-btn')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    cambiarVista('view-guardados');
  });

  // ── Puntos indicadores ──
  for (const dot of diRefs().dots) {
    dot.addEventListener('click', (ev) => {
      ev.stopPropagation();
      irAPanelIsla(Number(dot.dataset.diGoto || 0));
    });
  }

  // ── Gesto vertical (dedo o mouse) ──
  let inicioY = 0;
  let inicioX = 0;
  let arrastrando = false;
  // Lista de favoritos bajo el dedo (si el gesto arrancó ahí) y su scroll inicial,
  // para poder calcular cuánto del arrastre absorbió ella y cuánto sobró.
  let listaArrastre = null;
  let listaScrollInicial = 0;

  hud.addEventListener('pointerdown', (ev) => {
    // Los botones internos manejan su propio click; no arrancamos gesto sobre ellos.
    // Las filas de favoritos SÍ son botones, pero también tienen que poder arrastrarse,
    // así que se las exceptúa (el click se descarta después si hubo movimiento).
    const sobreBoton = ev.target instanceof Element && ev.target.closest('button');
    const sobreFila = ev.target instanceof Element && ev.target.closest('.di-fav-row');
    if (sobreBoton && !sobreFila) return;

    arrastrando = true;
    _diGestoMovido = false;
    inicioY = ev.clientY;
    inicioX = ev.clientX;
    listaArrastre = listaFavoritosScrolleableDesde(ev.target);
    listaScrollInicial = listaArrastre ? listaArrastre.scrollTop : 0;

    // Con captura, el gesto sigue llegando aunque el dedo se salga de la isla.
    try { hud.setPointerCapture(ev.pointerId); } catch { /* noop */ }
  });

  hud.addEventListener('pointermove', (ev) => {
    if (!arrastrando) return;
    const dy = ev.clientY - inicioY;
    if (Math.abs(dy) > 8) _diGestoMovido = true;

    // Arrastre dentro de la lista: la movemos nosotros. El navegador no lo hace
    // porque la lista tiene touch-action: none.
    if (listaArrastre) {
      listaArrastre.scrollTop = listaScrollInicial - dy;
      actualizarSombrasScrollFavoritosIsla();
    }
  });

  const terminarGesto = (ev) => {
    if (!arrastrando) return;
    arrastrando = false;
    try { hud.releasePointerCapture(ev.pointerId); } catch { /* noop */ }

    const dy = ev.clientY - inicioY;
    const dx = ev.clientX - inicioX;
    // Solo cuenta como cambio de panel si el movimiento fue claramente vertical.
    if (Math.abs(dy) <= Math.abs(dx)) return;

    // Dentro de la lista, lo que decide es el SOBRANTE: el tramo del arrastre que la
    // lista no pudo absorber porque ya estaba en el tope. Así, deslizar en el medio de
    // los favoritos los recorre, y seguir deslizando cuando ya no queda más cambia de
    // panel — sin tener que sacar el dedo de la lista primero.
    const absorbido = listaArrastre ? Math.abs(listaArrastre.scrollTop - listaScrollInicial) : 0;
    listaArrastre = null;

    const sobrante = Math.abs(dy) - absorbido;
    if (sobrante < DI_UMBRAL_SWIPE_PX) return;

    // Deslizar hacia arriba muestra el panel siguiente (como pasar de página).
    irAPanelIsla(_diIndice + (dy < 0 ? 1 : -1));
  };

  hud.addEventListener('pointerup', terminarGesto);
  hud.addEventListener('pointercancel', () => {
    arrastrando = false;
    listaArrastre = null;
  });

  // Rueda del mouse: un panel por gesto, con una pausa para que un scroll largo
  // no atraviese los tres paneles de golpe.
  hud.addEventListener('wheel', (ev) => {
    if (Math.abs(ev.deltaY) < Math.abs(ev.deltaX)) return;
    // Dentro de la lista de favoritos la rueda la scrollea a ella (mientras le quede
    // recorrido); recién al llegar al tope vuelve a cambiar de panel.
    const listaRueda = listaFavoritosScrolleableDesde(ev.target);
    if (listaFavoritosPuedeScrollear(listaRueda, -ev.deltaY)) {
      ev.stopPropagation();
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    const ahora = Date.now();
    if (ahora - _diUltimoWheel < 380) return;
    _diUltimoWheel = ahora;
    irAPanelIsla(_diIndice + (ev.deltaY > 0 ? 1 : -1));
  }, { passive: false });

  hud.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      irAPanelIsla(_diIndice + 1);
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      irAPanelIsla(_diIndice - 1);
    }
  });

  // La pista "deslizá para cambiar" solo se muestra hasta que el usuario lo hace una vez.
  try {
    if (localStorage.getItem(DI_HINT_STORAGE_KEY) === 'true') hud.classList.add('di-hint-off');
  } catch {
    // noop
  }

  // Si cambia el tamaño de la ventana, el panel activo puede pasar a ocupar más o
  // menos líneas de texto; hay que volver a medirlo.
  window.addEventListener('resize', ajustarAlturaIsla);

  document.getElementById('di-favs-list')
    ?.addEventListener('scroll', actualizarSombrasScrollFavoritosIsla, { passive: true });

  renderFavoritosIsla();
  irAPanelIsla(0, { silencioso: true });
}

// Estado del panel 1 cuando no hay ninguna parada cerca (o todavía no hay GPS): la
// isla sigue a la vista porque los otros dos paneles siguen siendo útiles.
function marcarIslaSinParada(motivo) {
  _nearestStopHudParada = null;

  const nameEl = document.getElementById('hud-stop-name');
  const distEl = document.getElementById('hud-stop-dist');
  const instrEl = document.getElementById('hud-stop-instruction');
  const linesRow = document.getElementById('hud-lines-row');

  if (nameEl) nameEl.textContent = 'Sin parada cerca';
  if (distEl) distEl.textContent = '--';
  if (instrEl) instrEl.textContent = motivo;
  if (linesRow) linesRow.innerHTML = '';

  ajustarAlturaIsla();
}


function cargarLF(coords, zoomObjetivo = null) {
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

    // Basemap estándar de OpenStreetMap: gratuito, sin API key y sin restricciones
    // de referrer/uso que otros proveedores (CARTO, Stadia, Thunderforest) sí exigen.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(leafletMap);

    leafletMap.on('moveend', agendarActualizacionParadas);
    leafletMap.on('zoomend', agendarActualizacionParadas);
    leafletMap.on('click', (e) => {
      if (!_pickingOrigenEnMapa) return;
      const { lat, lng } = e.latlng || {};
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const modo = _pickingModoEnMapa;
      cancelarSeleccionOrigenEnMapa();
      if (modo === 'destino') {
        establecerDestinoPlaneo(lat, lng, 'Punto elegido en el mapa');
      } else {
        establecerOrigenPlaneo(lat, lng, 'Punto elegido en el mapa');
      }
    });

    setupLongPressGuardarUbicacionEnMapa();
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

    cambiarVista('view-map');

    const safeLat = Number(latlng.lat);
    const safeLng = Number(latlng.lng);
    const currentZoom = (leafletMap && typeof leafletMap.getZoom === 'function') ? leafletMap.getZoom() : ZOOM_CALLE;

    try {
      const layerSel = asegurarSeleccionParadaLayer();
      if (layerSel && typeof L !== 'undefined') {
        layerSel.clearLayers();
        L.circleMarker([safeLat, safeLng], { radius: 7, weight: 2.5, color: '#e6351d', fillColor: '#ff472e', fillOpacity: 0.9 }).addTo(layerSel);
      }
    } catch {
      // noop
    }

    centrarMapaEnPunto(safeLat, safeLng, currentZoom);

    const nombre = makeNombre();
    abrirBottomSheetGuardarUbicacion(nombre, safeLat, safeLng, 'longpress');
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
    return generarNombreUbicacionGuardada('punto');
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
function MostrarFavs() {
  abrirBottomSheetFavoritos();
}
function cargarFavos() {
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
  if (typeof renderSeccionGuardados === 'function') renderSeccionGuardados();
  if (typeof renderAccesosRapidosDashboard === 'function') renderAccesosRapidosDashboard();
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

      const c = getColorForLinea(ref);
      const tc = getTextColorForBg(c);
      btn.style.setProperty('--line-color', c);
      btn.style.setProperty('--line-text', tc);
      btn.classList.add('has-line-color');

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

  const input = document.getElementById('search-input');
  if (input) {
    input.value = '';
    input.blur();
  }

  const sResults = document.getElementById('search-results');
  if (sResults) {
    sResults.innerHTML = '<p class="search-results-hint">Escribe para buscar</p>';
  }

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
const SEARCH_PARADAS_MAX_RESULTS = 8;
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

const _nominatimCache = new Map(); // clave: "bounded:query" -> resultados crudos
const NOMINATIM_CACHE_MAX_ENTRIES = 60;

async function fetchNominatimSanJuan(query, signal, bounded = true) {
  const cacheKey = `${bounded ? '1' : '0'}:${query}`;
  const cached = _nominatimCache.get(cacheKey);
  if (cached) return cached;

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
  const resultados = Array.isArray(raw) ? raw : [];

  // Cachear para que retipear o borrar/reescribir la misma búsqueda no vuelva a pegarle a la red.
  if (_nominatimCache.size >= NOMINATIM_CACHE_MAX_ENTRIES) {
    const oldestKey = _nominatimCache.keys().next().value;
    _nominatimCache.delete(oldestKey);
  }
  _nominatimCache.set(cacheKey, resultados);

  return resultados;
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

let _paradasBusquedaCache = null;

async function obtenerParadasParaBusqueda() {
  if (_paradasBusquedaCache) return _paradasBusquedaCache;

  const puntos = await cargarParadasPuntos();
  if (!Array.isArray(puntos)) {
    _paradasBusquedaCache = [];
    return _paradasBusquedaCache;
  }

  const arr = [];
  for (const p of puntos) {
    if (!p || !p.feature) continue;
    const props = p.feature.properties || {};
    const name = typeof props.name === 'string' ? props.name.trim() : '';
    const street = typeof props['addr:street'] === 'string' ? props['addr:street'].trim() : '';
    const nombre = name || street;
    if (!nombre) continue; // Evita listar paradas sin nombre real (ruido en la búsqueda)
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    arr.push({ nombre, lat: p.lat, lng: p.lng, paradaId: obtenerIdParada(p.feature), feature: p.feature });
  }

  _paradasBusquedaCache = arr;
  return _paradasBusquedaCache;
}

async function buscarParadasLocales(query) {
  const queryNorm = normalizarTextoBusqueda(query);
  if (!queryNorm) return [];
  const tokens = tokenizarBusqueda(queryNorm);

  const paradas = await obtenerParadasParaBusqueda();
  if (!Array.isArray(paradas) || paradas.length === 0) return [];

  const candidatos = [];
  for (const p of paradas) {
    const score = scoreTextoContraQuery(p.nombre, queryNorm, tokens);
    if (score > 0) candidatos.push({ ...p, score });
  }

  candidatos.sort((a, b) => b.score - a.score);
  return candidatos.slice(0, SEARCH_PARADAS_MAX_RESULTS);
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
  // Solo se paga el segundo round-trip de red si la búsqueda acotada no trajo nada.
  const baseUnbounded = baseBounded.length === 0
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

      const c = getColorForLinea(item.ref);
      const tc = getTextColorForBg(c);
      btn.style.setProperty('--line-color', c);
      btn.style.setProperty('--line-text', tc);
      btn.classList.add('has-line-color');

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

// Abrir modal con historial al tocar la barra (sin texto) o al tocar el botón/contenedor
const searchInputEl = document.getElementById('search-input');
const searchToggleBtnEl = document.getElementById('search-toggle-btn');
const searchContainerEl = document.querySelector('.search-bar-container');

if (searchInputEl) {
  const openIfNeeded = () => {
    const q = String(searchInputEl.value || '').trim();
    const modal = document.getElementById('search-modal');
    if (!modal) return;
    if (!modal.classList.contains('active')) modal.classList.add('active');

    const container = document.querySelector('.search-bar-container');
    if (container) {
      container.classList.add('is-open');
    }

    posicionarModalBusqueda();
    if (!q) {
      renderHistorialBusqueda();
    } else if (q.length >= SEARCH_MIN_CHARS) {
      void buscarLugares(q);
    }

    // Enfocar el input para habilitar la escritura inmediata
    if (document.activeElement !== searchInputEl) {
      searchInputEl.focus();
    }
  };

  // En móvil, abrir en touchstart puede hacer que el mismo tap termine cerrando el modal.
  // Abrimos en focus/click, y en click lo diferimos un tick para evitar carreras con el tap.
  searchInputEl.addEventListener('focus', openIfNeeded);
  searchInputEl.addEventListener('click', (e) => {
    e.stopPropagation();
    setTimeout(openIfNeeded, 0);
  });

  // Al hacer click en el botón del buscador (lupa) cuando está cerrado
  if (searchToggleBtnEl) {
    searchToggleBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      openIfNeeded();
    });
  }

  // Al hacer click en cualquier parte del contenedor cerrado
  if (searchContainerEl) {
    searchContainerEl.addEventListener('click', (e) => {
      if (!searchContainerEl.classList.contains('is-open')) {
        e.stopPropagation();
        openIfNeeded();
      }
    });
  }
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

async function centrarEnLugar(lat, lng, nombreLugar) {
  const safeLat = Number(lat);
  const safeLng = Number(lng);
  if (!Number.isFinite(safeLat) || !Number.isFinite(safeLng)) return;

  cambiarVista('view-map');

  if (!leafletMap) {
    cargarLF({ lat: safeLat, lng: safeLng }, ZOOM_CALLE);
  }
  if (!leafletMap) return;

  cerrarModalBusqueda();
  establecerVistaMapaPunto(safeLat, safeLng, ZOOM_CALLE);

  limpiarRecorrido();

  destacarParadaEnMapa(safeLat, safeLng, nombreLugar);
  centrarMapaEnPunto(safeLat, safeLng, ZOOM_CALLE);

  // Abrir bottom-sheet con 'Cómo llegar', opción de guardar y anuncios
  abrirBottomSheetGuardarUbicacion(nombreLugar, safeLat, safeLng, 'search', null);

  // Buscar si hay una parada cercana para mostrar también sus líneas
  try {
    const puntos = await cargarParadasPuntos();
    if (Array.isArray(puntos) && puntos.length > 0) {
      let paradaCercana = null;
      let distMin = Infinity;
      for (const punto of puntos) {
        const dist = calcularDistancia(safeLat, safeLng, punto.lat, punto.lng);
        if (dist < distMin) {
          distMin = dist;
          paradaCercana = punto;
        }
      }
      if (paradaCercana?.feature && distMin <= 1200) {
        abrirBottomSheetGuardarUbicacion(nombreLugar, safeLat, safeLng, 'search', paradaCercana);
      }
    }
  } catch (err) {
    console.error('Error al buscar paradas cercanas para el lugar:', err);
  }
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

  centrarMapaEnPunto(safeLat, safeLng, zoom);
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

function ordenarYUnirMultiLineString(lines) {
  if (!lines || lines.length === 0) return [];
  if (lines.length === 1) return lines[0];

  const pool = [...lines];
  let out = pool.shift(); // Tomar el primer segmento tal como viene

  // Verificar si el primer segmento está invertido respecto al resto de la ruta
  if (pool.length > 0) {
    const outStart = out[0];
    const outEnd = out[out.length - 1];
    let startC = false;
    let endC = false;
    const match = (p1, p2) => calcularDistancia(p1[0], p1[1], p2[0], p2[1]) < 10;

    for (const line of pool) {
      if (match(outStart, line[0]) || match(outStart, line[line.length - 1])) startC = true;
      if (match(outEnd, line[0]) || match(outEnd, line[line.length - 1])) endC = true;
    }
    // Si el inicio conecta pero el final no, es probable que esté dibujado al revés en OSM
    if (startC && !endC) {
      out.reverse();
    }
  }

  while (pool.length > 0) {
    let outEnd = out[out.length - 1];
    let found = false;

    for (let i = 0; i < pool.length; i++) {
      const line = pool[i];
      const lineStart = line[0];
      const lineEnd = line[line.length - 1];

      // Tolerate tiny rounding differences
      const match = (p1, p2) => calcularDistancia(p1[0], p1[1], p2[0], p2[1]) < 10;

      if (match(outEnd, lineStart)) {
        out = out.concat(line.slice(1));
        pool.splice(i, 1);
        found = true;
        break;
      } else if (match(outEnd, lineEnd)) {
        out = out.concat(line.slice().reverse().slice(1));
        pool.splice(i, 1);
        found = true;
        break;
      }
    }

    if (!found) {
      // Si hay saltos, tomar el siguiente y verificar su orientación
      let next = pool.shift();
      if (pool.length > 0) {
        const nextStart = next[0];
        const nextEnd = next[next.length - 1];
        let startC = false;
        let endC = false;
        const match = (p1, p2) => calcularDistancia(p1[0], p1[1], p2[0], p2[1]) < 10;
        for (const line of pool) {
          if (match(nextStart, line[0]) || match(nextStart, line[line.length - 1])) startC = true;
          if (match(nextEnd, line[0]) || match(nextEnd, line[line.length - 1])) endC = true;
        }
        if (startC && !endC) next.reverse();
      }
      out = out.concat(next);
    }
  }
  return out;
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
    const lines = [];
    for (const line of coords) {
      if (!Array.isArray(line)) continue;
      const currLine = [];
      for (const c of line) {
        if (!Array.isArray(c) || c.length < 2) continue;
        const lng = Number(c[0]);
        const lat = Number(c[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        currLine.push([lat, lng]);
      }
      if (currLine.length > 0) lines.push(currLine);
    }
    const joined = ordenarYUnirMultiLineString(lines);
    for (const p of joined) out.push(p);
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

  if (s > e) return Infinity; // No se puede viajar hacia atrás en una línea de colectivo

  let total = 0;
  for (let i = s; i < e; i++) {
    const a = latLngs[i];
    const b = latLngs[i + 1];
    if (!a || !b) continue;
    total += calcularDistancia(a[0], a[1], b[0], b[1]);
  }
  return total;
}

function estimarTiempoTotalSegundos({ dO, dD, rideDist, waitSecs }) {
  const dOn = Number(dO);
  const dDn = Number(dD);
  const walkOSecs = dOn / WALKING_SPEED_M_S;
  const walkDSecs = dDn / WALKING_SPEED_M_S;
  // Penaliza rutas que obligan a caminar demasiado hasta el punto de abordaje,
  // favoreciendo líneas que pasan más cerca del origen aunque el viaje sea similar.
  const walkOSecsPenalizado = dOn > CAMINATA_EXCESIVA_UMBRAL_M
    ? walkOSecs * CAMINATA_EXCESIVA_PENALIZACION
    : walkOSecs;
  const rideSecs = Number(rideDist) / BUS_SPEED_M_S;
  const wait = Number(waitSecs);
  const total = walkOSecsPenalizado + walkDSecs + rideSecs + (Number.isFinite(wait) ? wait : 0);
  return Number.isFinite(total) ? total : Infinity;
}

async function obtenerParadasEnTramoPlaneado(relIds, latLngs, iO, iD) {
  if (!relIds || relIds.size === 0) return [];
  if (!Array.isArray(latLngs) || latLngs.length < 2) return [];

  const start = Math.min(Number(iO), Number(iD));
  const end = Math.max(Number(iO), Number(iD));
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < 0) return [];

  const puntos = await cargarParadasPuntos();
  if (!Array.isArray(puntos)) return [];

  const seleccion = [];
  for (const p of puntos) {
    if (!p || !p.feature) continue;
    if (!featurePerteneceAAlgunaRelacion(p.feature, relIds)) continue;
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const idx = indiceMasCercanoEnCaminoPreciso(p.lat, p.lng, latLngs);
    if (idx < start || idx > end) continue;
    const paradaId = obtenerIdParada(p.feature);
    seleccion.push({ feature: p.feature, lat: p.lat, lng: p.lng, paradaId, idx });
  }

  // Ordenar por posición a lo largo del tramo (no por cercanía al origen).
  seleccion.sort((a, b) => a.idx - b.idx);
  if (seleccion.length > MAX_PARADAS_MOSTRAR) seleccion.length = MAX_PARADAS_MOSTRAR;
  return seleccion.map(({ idx, ...rest }) => rest);
}

// Resuelve el punto de partida activo para planear una ruta: el punto elegido por el
// usuario (buscado, guardado o tocado en el mapa) si hay uno, o su ubicación GPS actual.
async function resolverOrigenPlaneo() {
  if (_routePlanOrigin && Number.isFinite(_routePlanOrigin.lat) && Number.isFinite(_routePlanOrigin.lng)) {
    return { lat: _routePlanOrigin.lat, lng: _routePlanOrigin.lng, nombre: _routePlanOrigin.nombre || 'Punto de partida' };
  }
  if (!ubicacion || !Number.isFinite(ubicacion.lat) || !Number.isFinite(ubicacion.lng)) {
    const position = await obtenerPosicionActual();
    ubicacion = { lat: position.coords.latitude, lng: position.coords.longitude };
  }
  return { lat: ubicacion.lat, lng: ubicacion.lng, nombre: 'Mi ubicación actual' };
}

// Tras elegir un nuevo origen: si ya hay destino elegido (flujo "Opciones de ruta"),
// recalcula las opciones; si todavía no hay destino (flujo "Planificar viaje" desde
// el dashboard), vuelve a mostrar el planificador con el origen actualizado.
function refrescarPlaneoTrasElegirOrigen() {
  if (_routePlanTarget && Number.isFinite(_routePlanTarget.lat) && Number.isFinite(_routePlanTarget.lng)) {
    void mostrarOpcionesRutaParaTarget(_routePlanLastAllowTransfer);
  } else {
    renderPlanificadorViajeSheet();
  }
}

function establecerOrigenPlaneo(lat, lng, nombre) {
  const latN = Number(lat);
  const lngN = Number(lng);
  if (!Number.isFinite(latN) || !Number.isFinite(lngN)) return;
  _routePlanOrigin = { lat: latN, lng: lngN, nombre: String(nombre || 'Punto de partida').trim() || 'Punto de partida' };
  mostrarMarcadorOrigen(latN, lngN, _routePlanOrigin.nombre);
  enfocarSeleccionDePlaneo();
  refrescarPlaneoTrasElegirOrigen();
}

function usarMiUbicacionComoOrigenPlaneo() {
  _routePlanOrigin = null;
  // El GPS ya se muestra con su propio marcador ("tu ubicación"); si había un pin de
  // origen elegido a mano, se saca para no dejarlo confundiendo sobre el mapa.
  limpiarMarcadorOrigen();
  enfocarSeleccionDePlaneo();
  refrescarPlaneoTrasElegirOrigen();
}

function establecerDestinoPlaneo(lat, lng, nombre, feature = null) {
  const latN = Number(lat);
  const lngN = Number(lng);
  if (!Number.isFinite(latN) || !Number.isFinite(lngN)) return;
  _routePlanTarget = {
    feature: feature || null,
    nombre: String(nombre || 'Destino').trim() || 'Destino',
    lat: latN,
    lng: lngN,
    stopId: feature ? obtenerIdParada(feature) : null,
  };
  mostrarMarcadorDestino(latN, lngN, _routePlanTarget.nombre);
  // Encuadre inmediato: mostrarOpcionesRutaParaTarget() vuelve a encuadrar al final,
  // pero antes tiene que resolver el GPS y cargar los datasets, y mientras tanto el
  // pin recién puesto se quedaría fuera de pantalla varios segundos.
  enfocarSeleccionDePlaneo();
  void mostrarOpcionesRutaParaTarget(true);
}

let _pickingModoEnMapa = 'origen'; // 'origen' | 'destino'

function activarSeleccionEnMapa(modo) {
  if (!leafletMap) return;
  // Importante: cerrar el sheet y fijar la vista ANTES de prender el flag de picking.
  // cerrarBottomSheet() termina llamando a asegurarVistaMenuEnEscritorio(), que en
  // escritorio (>=1024px) puede disparar cambiarVista('view-dashboard') si en ese
  // instante no hay ningún menú activo — y cambiarVista() cancela cualquier picking en
  // curso (_pickingOrigenEnMapa) como parte de una navegación real. Si el flag ya
  // estuviera en true acá, se cancelaba solo apenas se activaba y tocar el mapa no
  // hacía nada en escritorio.
  if (typeof cerrarBottomSheet === 'function') cerrarBottomSheet(true);
  cambiarVista('view-map');

  _pickingOrigenEnMapa = true;
  _pickingModoEnMapa = modo === 'destino' ? 'destino' : 'origen';
  mostrarBannerSeleccionEnMapa(_pickingModoEnMapa);
  document.body.classList.add('is-picking-map-point');
}

function mostrarBannerSeleccionEnMapa(modo) {
  const banner = document.getElementById('map-picking-banner');
  const texto = document.getElementById('map-picking-banner-text');
  if (texto) {
    texto.textContent = modo === 'destino'
      ? 'Tocá un punto del mapa para usarlo como destino'
      : 'Tocá un punto del mapa para usarlo como punto de partida';
  }
  if (banner) banner.hidden = false;
}

function cancelarSeleccionOrigenEnMapa() {
  _pickingOrigenEnMapa = false;
  const banner = document.getElementById('map-picking-banner');
  if (banner) banner.hidden = true;
  document.body.classList.remove('is-picking-map-point');
}

function setupMapPickingBanner() {
  const cancelBtn = document.getElementById('map-picking-banner-cancel');
  if (cancelBtn) {
    cancelBtn.onclick = (ev) => {
      ev.stopPropagation();
      cancelarSeleccionOrigenEnMapa();
    };
  }
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

  // Si el usuario eligió un punto de partida personalizado (buscado/guardado/en el mapa)
  // para esta sesión de planeo, tiene prioridad sobre la ubicación GPS.
  if ((!Number.isFinite(latO) || !Number.isFinite(lngO)) && _routePlanOrigin
    && Number.isFinite(_routePlanOrigin.lat) && Number.isFinite(_routePlanOrigin.lng)) {
    latO = Number(_routePlanOrigin.lat);
    lngO = Number(_routePlanOrigin.lng);
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

    if (scoreSecs === Infinity) continue; // Ignorar rutas donde el usuario iría hacia atrás

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

  const colorLinea = getColorForLinea(mejor.ref);

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
    if (iO <= iDMin) {
      // Recorte “bien cortado”: termina en el punto más cercano al destino.
      // Si además se alcanza el umbral de cercanía, intentamos cortar en el primer punto que entra al umbral
      // y luego no sigue acercándose (evita que el trazado pase de largo).
      let end = iDMin;
      let bestSeen = Infinity;
      let cutCandidate = null;

      for (let i = iO; i <= iDMin; i++) {
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

      startIndex = iO;
      endIndex = end;

      const tramo = latLngs.slice(iO, end + 1);
      if (tramo.length >= 2) {
        dibujarTrazoRecorridoConFlechas(layerRec, tramo, colorLinea);
      }
    }
  }

  if (recorridoActivo) {
    recorridoActivo.startIndex = startIndex;
    recorridoActivo.endIndex = endIndex;
  }

  // Asignar los IDs de relación y cargar las paradas reales del tramo (a lo largo de la geometría
  // recortada), sin dibujarlas en el mapa.
  try {
    const relIds = obtenerRelIdsDeRutas([mejorFeature]);
    if (recorridoActivo) recorridoActivo.relIds = relIds;
    if (relIds && relIds.size > 0) {
      const seleccion = (startIndex != null && endIndex != null)
        ? await obtenerParadasEnTramoPlaneado(relIds, latLngs, startIndex, endIndex)
        : await dibujarParadasDeLineaCercanasAlOrigen(relIds, latO, lngO, mejor.ref, mejor.name, { draw: false });
      if (recorridoActivo && Array.isArray(seleccion)) recorridoActivo.nearbyStops = seleccion;
    }
  } catch {
    // noop
  }

  // Marcadores origen/destino y conexión directa (opcional) en una capa separada.
  const layerSel = asegurarSeleccionParadaLayer();
  if (layerSel) {
    layerSel.clearLayers();
    L.circleMarker(origen, { radius: 6, weight: 2, color: colorLinea, fillColor: colorLinea, fillOpacity: 0.9 }).addTo(layerSel);
    L.circleMarker(destino, { radius: 6, weight: 2, color: colorLinea, fillColor: colorLinea, fillOpacity: 0.9 }).addTo(layerSel);
  }

  try {
    const bounds = L.latLngBounds([origen, destino]);
    const recBounds = layerRec?.getBounds?.();
    if (recBounds && recBounds.isValid && recBounds.isValid()) bounds.extend(recBounds);
    leafletMap.fitBounds(bounds, { padding: [20, 20] });
    establecerVistaMapaBounds(bounds, { padding: [20, 20] });
    recordarEncuadreRecorridoPlaneado(bounds, { padding: [20, 20] });
  } catch {
    // noop
  }

  if (nombreDestino) {
    // Mantener el nombre en memoria si luego se quiere reusar
    window._ultimoDestinoBusqueda = { nombre: String(nombreDestino), lat: latD, lng: lngD };
  }

  // Trazar la caminata desde el origen hasta la primera parada del tramo y mostrarla arriba del mapa.
  const primeraParada = recorridoActivo?.nearbyStops?.[0] || null;
  if (primeraParada) {
    void trazarCaminataHaciaPrimeraParadaPlaneada(latO, lngO, primeraParada);
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

function renderListaParadasPlaneoTimeline({ legs = [], transferLabel = '' } = {}) {
  const validLegs = (Array.isArray(legs) ? legs : []).filter((l) => Array.isArray(l?.stops) && l.stops.length > 0);
  if (validLegs.length === 0) return '';

  const getStopName = (p) => {
    if (!p) return 'Parada';
    if (typeof p.etiqueta === 'string' && p.etiqueta.trim()) return p.etiqueta.trim();
    const nombre = obtenerNombreParadaBase(p.feature);
    if (nombre) return nombre;
    const et = obtenerEtiquetaParada(p.feature);
    return et || 'Parada';
  };
  const getStopId = (p) => p.paradaId || obtenerIdParada(p.feature) || '';

  const stopIconSvg = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>';
  const stopIconSvgSmall = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>';
  const destinoIconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>';

  let rowsHtml = '<div class="transit-faint-dot"></div>';

  validLegs.forEach((leg, legIdx) => {
    const stops = leg.stops;
    const ref = String(leg.ref || '').trim();
    const name = String(leg.name || '').trim();
    const lineColor = getColorForLinea(ref) || '#ef4444';
    const textColor = getTextColorForBg(lineColor);
    const badgeText = formatBadgeLinea(ref) || '1';
    const isFirstLeg = legIdx === 0;
    const isLastLeg = legIdx === validLegs.length - 1;
    const singleStop = stops.length === 1;

    if (validLegs.length > 1) {
      rowsHtml += `
        <div class="planeo-timeline-header">
          <span class="planeo-timeline-badge" style="background-color: ${lineColor}; color: ${textColor};">${escapeHtml(badgeText)}</span>
          <span class="planeo-timeline-title">${escapeHtml(isFirstLeg ? 'Tramo 1' : 'Tramo 2')}${name ? ` — ${escapeHtml(name)}` : ` — Línea ${escapeHtml(ref)}`}</span>
        </div>
      `;
    }

    const first = stops[0];
    const last = stops[stops.length - 1];
    const intermediate = stops.slice(1, stops.length - 1);

    const firstId = getStopId(first);
    const firstName = getStopName(first);
    let firstMeta = isFirstLeg ? 'Tu posición' : 'Parada de cambio';
    if (singleStop && isLastLeg) firstMeta += ' · Destino final';
    const firstDataAttrs = `data-plane-stop-id="${escapeHtml(firstId)}" data-plane-line-ref="${escapeHtml(ref)}" data-plane-line-name="${escapeHtml(name)}"`;

    rowsHtml += `
      <div class="transit-row transit-row-origin${isFirstLeg ? ' transit-row-current' : ''}">
        <div class="transit-badge-col">
          <span class="transit-line-pill-badge" style="background-color: ${lineColor}; color: ${textColor};">${escapeHtml(badgeText)}</span>
        </div>
        <div class="transit-rail-col">
          <div class="transit-tube-seg" style="top: 14px; border-radius: 9999px 9999px 0 0; background: ${lineColor};">
            <span class="transit-dot"></span>
          </div>
        </div>
        <button type="button" class="transit-stop-btn" ${firstDataAttrs}>
          <span class="transit-stop-icon-badge">${stopIconSvg}</span>
          <div class="transit-stop-info">
            <span class="transit-stop-name transit-stop-name-primary">${escapeHtml(firstName)}</span>
            <span class="transit-stop-meta">${escapeHtml(firstMeta)}</span>
          </div>
        </button>
      </div>
    `;

    if (intermediate.length > 0) {
      const rows = intermediate.map((p) => {
        const pId = getStopId(p);
        const pName = getStopName(p);
        const dataAttrs = `data-plane-stop-id="${escapeHtml(pId)}" data-plane-line-ref="${escapeHtml(ref)}" data-plane-line-name="${escapeHtml(name)}"`;
        return `
          <div class="transit-row transit-row-intermediate">
            <div class="transit-badge-col"></div>
            <div class="transit-rail-col">
              <div class="transit-tube-seg" style="background: ${lineColor};">
                <span class="transit-dot"></span>
              </div>
            </div>
            <button type="button" class="transit-stop-btn" ${dataAttrs}>
              <span class="transit-stop-icon-badge">${stopIconSvgSmall}</span>
              <div class="transit-stop-info">
                <span class="transit-stop-name">${escapeHtml(pName)}</span>
              </div>
            </button>
          </div>
        `;
      }).join('');

      rowsHtml += `
        <div class="transit-row transit-accordion-row">
          <div class="transit-badge-col"></div>
          <div class="transit-rail-col">
            <div class="transit-tube-seg" style="background: ${lineColor};">
              <span class="transit-dot"></span>
            </div>
          </div>
          <button type="button" class="transit-accordion-btn" onclick="toggleTransitTimeline(this)" aria-expanded="false">
            <div class="transit-accordion-left">
              <span class="transit-accordion-icon" style="transform: rotate(180deg);">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m8 14 4-4 4 4"/></svg>
              </span>
              <span class="transit-accordion-label">${intermediate.length} paradas en el trayecto</span>
            </div>
          </button>
        </div>
        <div class="transit-intermediate-stops collapsed">
          ${rows}
        </div>
      `;
    }

    if (!singleStop) {
      const lastId = getStopId(last);
      const lastName = getStopName(last);
      const lastMetaText = isLastLeg
        ? 'Destino final'
        : `Trasbordo en: ${String(transferLabel || '').trim() || 'punto de cambio'}`;
      const lastDataAttrs = `data-plane-stop-id="${escapeHtml(lastId)}" data-plane-line-ref="${escapeHtml(ref)}" data-plane-line-name="${escapeHtml(name)}"`;

      rowsHtml += `
        <div class="transit-row transit-row-dest">
          <div class="transit-badge-col"></div>
          <div class="transit-rail-col">
            <div class="transit-tube-seg" style="${isLastLeg ? 'bottom: 14px; border-radius: 0 0 9999px 9999px;' : ''} background: ${lineColor};">
              <span class="transit-dot"></span>
            </div>
          </div>
          <button type="button" class="transit-stop-btn" ${lastDataAttrs}>
            <span class="transit-stop-icon-badge">${stopIconSvg}</span>
            <div class="transit-stop-info">
              <span class="transit-stop-name transit-stop-name-primary">${escapeHtml(lastName)}</span>
              <span class="transit-stop-meta">${isLastLeg ? destinoIconSvg : ''}${escapeHtml(lastMetaText)}</span>
            </div>
          </button>
        </div>
      `;
    }
  });

  rowsHtml += '<div class="transit-faint-dot"></div><div class="transit-faint-dot"></div>';

  return `
    <div class="transit-timeline-container">
      <div class="transit-timeline-track">
        ${rowsHtml}
      </div>
    </div>
  `;
}

function mostrarParadasPlaneoActualEnBottomSheet({ ref, name } = {}) {
  const lineaRef = String(ref || recorridoActivo?.ref || '').trim();
  const lineaName = String(name || recorridoActivo?.name || '').trim();
  const seleccion = recorridoActivo?.planned ? (recorridoActivo?.nearbyStops || []) : [];

  const stops = normalizarParadasSeleccionParaLista(seleccion, lineaRef, lineaName);
  setPlaneoParadasIndex(stops);

  reencuadrarRecorridoPlaneadoCompleto();

  const subtitulo = lineaRef ? `Línea ${lineaRef}${lineaName ? ` — ${lineaName}` : ''}` : '';
  const html = stops.length
    ? `${renderListaParadasPlaneoTimeline({ legs: [{ ref: lineaRef, name: lineaName, stops }] })}
       <p style="margin: 10px 0 0 0; font-size: 12px; color: var(--text-muted, #888); text-align: center;">Tocá una parada para ver arribos.</p>`
    : `<p style="margin: 0; font-size: 14px; color: var(--text-secondary, #666); text-align: center;">No se encontraron paradas cercanas para esta línea.</p>`;

  abrirBottomSheet('Ruta', html, '', subtitulo);
}

function mostrarParadasPlaneadasEnBottomSheet() {
  if (!recorridoActivo || !recorridoActivo.planned) return;

  reencuadrarRecorridoPlaneadoCompleto();

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
    const html = (stops1.length && stops2.length)
      ? `<p style="margin: 0 0 12px 0; font-size: 12px; color: var(--text-muted, #888); text-align: center;">Tocá una parada para ver arribos.</p>
         ${renderListaParadasPlaneoTimeline({
           legs: [
             { ref: aRef, name: leg1.name, stops: stops1 },
             { ref: bRef, name: leg2.name, stops: stops2 },
           ],
           transferLabel: tName,
         })}`
      : '<p style="margin:0; font-size:14px; color: var(--text-secondary,#666); text-align:center;">No se encontraron paradas suficientes para mostrar el trayecto completo.</p>';
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

    if (scoreSecs === Infinity) continue;

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
  if (iO < 0 || iDMin < 0 || iO > iDMin) return null;

  let end = iDMin;
  let bestSeen = Infinity;
  let cutCandidate = null;

  for (let i = iO; i <= iDMin; i++) {
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

  const tramo = latLngs.slice(iO, end + 1);
  if (tramo.length < 2) return null;
  return { tramo, latLngs, startIndex: iO, endIndex: end };
}

async function planearRutaConTrasbordo({ lineaA, lineaB, transfer, destino }) {
  if (!leafletMap || typeof L === 'undefined') return;

  // Resolver el punto de partida activo: el elegido por el usuario o su GPS actual.
  let origen;
  try {
    origen = await resolverOrigenPlaneo();
  } catch {
    alert('No se pudo obtener tu ubicación actual.');
    return;
  }

  const latO = origen.lat;
  const lngO = origen.lng;
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

  const colorA = getColorForLinea(aRef);
  const colorB = getColorForLinea(bRef);

  limpiarRecorrido();
  recorridoActivo = { planned: true, mode: 'transfer', legs: [], transferName: String(transfer?.name || '').trim() };

  const layerRec = asegurarRecorridoLayer();
  layerRec?.clearLayers();
  const layerParadas = asegurarParadasLayer();
  layerParadas?.clearLayers();

  const tramoInfo1 = calcularTramoRecortado(latO, lngO, tLat, tLng, tramo1.feature, tramo1.mejor);
  const tramoInfo2 = calcularTramoRecortado(tLat, tLng, dLat, dLng, tramo2.feature, tramo2.mejor);
  if (tramoInfo1) dibujarTrazoRecorridoConFlechas(layerRec, tramoInfo1.tramo, colorA);
  if (tramoInfo2) dibujarTrazoRecorridoConFlechas(layerRec, tramoInfo2.tramo, colorB);

  const relIds1 = obtenerRelIdsDeRutas([tramo1.feature]);
  const relIds2 = obtenerRelIdsDeRutas([tramo2.feature]);

  const sel1 = (relIds1 && relIds1.size > 0 && tramoInfo1)
    ? await obtenerParadasEnTramoPlaneado(relIds1, tramoInfo1.latLngs, tramoInfo1.startIndex, tramoInfo1.endIndex)
    : [];
  const sel2 = (relIds2 && relIds2.size > 0 && tramoInfo2)
    ? await obtenerParadasEnTramoPlaneado(relIds2, tramoInfo2.latLngs, tramoInfo2.startIndex, tramoInfo2.endIndex)
    : [];

  recorridoActivo.legs = [
    { ref: aRef, name: tramo1.mejor?.name || '', relIds: relIds1, origen: { lat: latO, lng: lngO }, destino: { lat: tLat, lng: tLng }, nearbyStops: sel1 || [], startIndex: tramoInfo1?.startIndex ?? null, endIndex: tramoInfo1?.endIndex ?? null },
    { ref: bRef, name: tramo2.mejor?.name || '', relIds: relIds2, origen: { lat: tLat, lng: tLng }, destino: { lat: dLat, lng: dLng }, nearbyStops: sel2 || [], startIndex: tramoInfo2?.startIndex ?? null, endIndex: tramoInfo2?.endIndex ?? null },
  ];

  const layerSel = asegurarSeleccionParadaLayer();
  if (layerSel) {
    layerSel.clearLayers();
    L.circleMarker([latO, lngO], { radius: 6, weight: 2, color: colorA, fillColor: colorA, fillOpacity: 0.9 }).addTo(layerSel);
    L.circleMarker([tLat, tLng], { radius: 6, weight: 2, color: '#ff472e', fillColor: '#ff472e', fillOpacity: 0.9 }).addTo(layerSel);
    L.circleMarker([dLat, dLng], { radius: 6, weight: 2, color: colorB, fillColor: colorB, fillOpacity: 0.9 }).addTo(layerSel);
  }

  try {
    const bounds = L.latLngBounds([[latO, lngO], [dLat, dLng]]);
    bounds.extend([tLat, tLng]);
    const recBounds = layerRec?.getBounds?.();
    if (recBounds && recBounds.isValid && recBounds.isValid()) bounds.extend(recBounds);
    leafletMap.fitBounds(bounds, { padding: [20, 20] });
    establecerVistaMapaBounds(bounds, { padding: [20, 20] });
    recordarEncuadreRecorridoPlaneado(bounds, { padding: [20, 20] });
  } catch {
    // noop
  }

  const stops1 = normalizarParadasSeleccionParaLista(sel1 || [], aRef, tramo1.mejor?.name || '');
  const stops2 = normalizarParadasSeleccionParaLista(sel2 || [], bRef, tramo2.mejor?.name || '');
  setPlaneoParadasIndex([...stops1, ...stops2]);

  const tName = String(transfer?.name || '').trim();
  const subtitulo = tName ? `Trasbordo en: ${tName}` : '';
  const html = (stops1.length && stops2.length)
    ? `<p style="margin: 0 0 12px 0; font-size: 12px; color: var(--text-muted, #888); text-align: center;">Tocá una parada para ver arribos.</p>
       ${renderListaParadasPlaneoTimeline({
         legs: [
           { ref: aRef, name: tramo1.mejor?.name || '', stops: stops1 },
           { ref: bRef, name: tramo2.mejor?.name || '', stops: stops2 },
         ],
         transferLabel: tName,
       })}`
    : '<p style="margin:0; font-size:14px; color: var(--text-secondary,#666); text-align:center;">No se encontraron paradas suficientes para mostrar el trayecto completo.</p>';
  abrirBottomSheet('Ruta', html, '', subtitulo);

  // Trazar la caminata desde el origen hasta la primera parada del primer tramo.
  const primeraParada = sel1?.[0] || null;
  if (primeraParada) {
    void trazarCaminataHaciaPrimeraParadaPlaneada(latO, lngO, primeraParada);
  }
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

// Ajusta el mapa para que origen y destino entren juntos en pantalla. Si los dos
// puntos están prácticamente encima (mismo lugar), fitBounds daría un encuadre
// degenerado con zoom máximo, así que en ese caso se centra en el punto.
// Guarda el encuadre del recorrido planificado para poder recuperarlo después de
// haber enfocado una parada suelta.
function recordarEncuadreRecorridoPlaneado(bounds, fitOpts) {
  if (!recorridoActivo || !bounds) return;
  recorridoActivo.viewBounds = bounds;
  recorridoActivo.viewFitOpts = fitOpts || { padding: [20, 20] };
}

// Vuelve a mostrar el recorrido planificado entero. Se usa al regresar a la lista de
// paradas: ahí el usuario quiere ver el viaje completo otra vez, no la última parada
// que estuvo mirando de cerca.
function reencuadrarRecorridoPlaneadoCompleto() {
  if (!leafletMap || !recorridoActivo?.planned) return;
  const bounds = recorridoActivo.viewBounds;
  if (!bounds || typeof bounds.isValid !== 'function' || !bounds.isValid()) return;
  const fitOpts = recorridoActivo.viewFitOpts || { padding: [20, 20] };
  try {
    leafletMap.fitBounds(bounds, fitOpts);
    establecerVistaMapaBounds(bounds, fitOpts);
  } catch {
    // noop
  }
}

// Acomoda el mapa a lo que el usuario lleva elegido del viaje:
//  · origen y destino puestos  → encuadra los dos juntos;
//  · uno solo                  → centra en ese, para que su marcador se vea.
//
// Se llama apenas se elige cada extremo. Antes no se llamaba nada hasta que estaban
// los dos y se habían calculado las opciones de ruta: elegir un punto de partida
// distinto del actual no movía el mapa, así que el pin nuevo quedaba fuera de pantalla
// y parecía que no se había puesto nada.
function enfocarSeleccionDePlaneo() {
  if (!leafletMap) return;

  const destinoOk = _routePlanTarget
    && Number.isFinite(_routePlanTarget.lat)
    && Number.isFinite(_routePlanTarget.lng);

  // Origen efectivo: el elegido a mano o, si no hay, el GPS (que es el que se usa
  // como punto de partida por defecto).
  const origenElegido = _routePlanOrigin
    && Number.isFinite(_routePlanOrigin.lat)
    && Number.isFinite(_routePlanOrigin.lng)
    ? _routePlanOrigin
    : null;
  const origenGps = ubicacion && Number.isFinite(ubicacion.lat) && Number.isFinite(ubicacion.lng)
    ? ubicacion
    : null;
  const origen = origenElegido || origenGps;

  if (destinoOk && origen) {
    encuadrarOrigenYDestinoPlaneo(origen.lat, origen.lng, _routePlanTarget.lat, _routePlanTarget.lng);
    return;
  }
  if (destinoOk) {
    centrarMapaEnPunto(_routePlanTarget.lat, _routePlanTarget.lng, ZOOM_PLANEO_CONTEXTO);
    return;
  }
  if (origenElegido) {
    centrarMapaEnPunto(origenElegido.lat, origenElegido.lng, ZOOM_PLANEO_CONTEXTO);
    return;
  }
  if (origenGps) {
    centrarMapaEnPunto(origenGps.lat, origenGps.lng, ZOOM_PLANEO_CONTEXTO);
  }
}

function encuadrarOrigenYDestinoPlaneo(latOrigen, lngOrigen, latDestino, lngDestino) {
  if (!leafletMap || typeof L === 'undefined') return;
  if (![latOrigen, lngOrigen, latDestino, lngDestino].every((n) => Number.isFinite(Number(n)))) return;

  try {
    const separados = Math.abs(latOrigen - latDestino) > 0.0002 || Math.abs(lngOrigen - lngDestino) > 0.0002;
    if (!separados) {
      centrarMapaEnPunto(Number(latDestino), Number(lngDestino), ZOOM_CALLE);
      return;
    }

    const bounds = L.latLngBounds([
      [Number(latOrigen), Number(lngOrigen)],
      [Number(latDestino), Number(lngDestino)],
    ]);
    if (!bounds.isValid()) return;

    // El panel de opciones tapa la mitad inferior (mobile) o la columna izquierda
    // (escritorio), así que hace falta bastante aire alrededor de los dos pines.
    const fitOpts = { padding: [56, 56], maxZoom: ZOOM_CALLE };
    leafletMap.fitBounds(bounds, fitOpts);
    establecerVistaMapaBounds(bounds, fitOpts);
  } catch {
    // noop
  }
}

async function mostrarOpcionesRutaParaTarget(permitirTrasbordo) {
  limpiarRecorrido();
  const layerParadas = asegurarParadasLayer();
  if (layerParadas) layerParadas.clearLayers();

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

  let origen;
  try {
    origen = await resolverOrigenPlaneo();
  } catch {
    alert('No se pudo obtener tu ubicación actual.');
    return;
  }
  const latO = origen.lat;
  const lngO = origen.lng;

  // Encuadre inicial del viaje: con origen y destino ya resueltos, se ajusta la vista
  // para que entren los dos puntos. Antes el mapa se quedaba donde estuviera (a menudo
  // sobre uno solo de los extremos) y había que alejar a mano para ver el viaje entero.
  encuadrarOrigenYDestinoPlaneo(latO, lngO, _routePlanTarget.lat, _routePlanTarget.lng);

  await obtenerIndiceParadasPuntosPorId();
  await obtenerStopsIndexPorLinea();

  const origenStops = await obtenerParadasCercanasA(latO, lngO, ROUTE_NEARBY_STOPS_RADIUS_M, ROUTE_NEARBY_STOPS_MAX);
  const origenRefs = new Set();
  for (const s of origenStops) {
    const lineas = obtenerLineasDetalleDesdeRelations(s.feature);
    if (!Array.isArray(lineas)) continue;
    for (const l of lineas) {
      const ref = typeof l?.ref === 'string' ? l.ref.trim() : '';
      if (ref) origenRefs.add(ref);
    }
  }

  // Líneas candidatas para el destino: la parada exacta (si el destino es una parada
  // de colectivo) y, sobre todo, cualquier parada cercana por proximidad. Esto es lo
  // que permite planear rutas hacia una dirección buscada, un lugar guardado o un
  // punto cualquiera del mapa, que no tienen una parada/relación de OSM asociada.
  const destinoStops = await obtenerParadasCercanasA(_routePlanTarget.lat, _routePlanTarget.lng, ROUTE_NEARBY_STOPS_RADIUS_M, ROUTE_NEARBY_STOPS_MAX);
  const refToName = new Map();
  const destinoRefsSet = new Set();

  const registrarLinea = (l) => {
    const ref = l && l.ref != null ? String(l.ref).trim() : '';
    if (!ref) return;
    destinoRefsSet.add(ref);
    const name = String(l.name || '').trim();
    if (name && !refToName.get(ref)) refToName.set(ref, name);
  };

  for (const l of obtenerLineasDetalleDesdeRelations(_routePlanTarget.feature)) registrarLinea(l);
  for (const s of destinoStops) {
    const lineas = obtenerLineasDetalleDesdeRelations(s.feature);
    if (!Array.isArray(lineas)) continue;
    for (const l of lineas) registrarLinea(l);
  }

  // "Sin trasbordo" = cualquier línea que pase cerca del destino.
  let destinoRefs = Array.from(destinoRefsSet);

  const directValid = [];
  for (const ref of destinoRefs) {
    if (directValid.length >= ROUTE_MAX_OPCIONES_DIRECTAS) break;
    const result = await elegirMejorRutaFeatureEntre(latO, lngO, _routePlanTarget.lat, _routePlanTarget.lng, [ref]);
    if (result) {
      directValid.push(ref);
    }
  }
  const directLimited = directValid;

  const combos = [];
  if (permitirTrasbordo && destinoRefs.length && origenRefs.size) {
    const destinoSet = new Set(destinoRefs);
    let count = 0;
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

        // Verificar validez geométrica y dirección de ambos tramos
        const tramo1 = await elegirMejorRutaFeatureEntre(latO, lngO, best.lat, best.lng, [a]);
        if (!tramo1) continue;
        const tramo2 = await elegirMejorRutaFeatureEntre(best.lat, best.lng, latD, lngD, [b]);
        if (!tramo2) continue;

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
      return renderBotonLineaHtml({
        ref,
        name,
        extraAttrs: `data-route-line-ref="${refAttr}" data-route-line-name="${nameAttr}"`,
      });
    })
    .join('');

  const directHtml = directItems
    ? `<ul class="lineas-list">${directItems}</ul>`
    : `<p style="margin: 0; font-size: 14px; color: var(--text-secondary, #666); text-align: center;">No se encontraron líneas para esta parada.</p>`;

  const combosItems = combos
    .map((c) => {
      const labelRef = `${c.a} + ${c.b}`;
      const transferName = String(c.transfer.name || c.transfer.id || '').trim();
      const nameDisplay = transferName ? `<span class="linea-button-name">Trasbordo en ${escapeHtml(transferName)}</span>` : '';
      const colorA = getColorForLinea(c.a);
      const tc = getTextColorForBg(colorA);
      return `<li><button type="button" class="btn-linea" style="--line-color: ${colorA}; --line-text: ${tc};" data-route-combo="1" data-linea-a="${escapeHtml(c.a)}" data-linea-b="${escapeHtml(c.b)}" data-transfer-lat="${String(c.transfer.lat)}" data-transfer-lng="${String(c.transfer.lng)}" data-transfer-name="${escapeHtml(transferName)}"><span class="linea-button-badge linea-badge-combo" style="background-color: ${colorA}; color: ${tc};">${escapeHtml(labelRef)}</span><div class="linea-rail-col"><div class="linea-tube-seg"><span class="linea-dot"></span></div></div><div class="linea-button-info"><span class="linea-button-ref">Línea ${escapeHtml(c.a)} → ${escapeHtml(c.b)}</span>${nameDisplay}</div><svg class="linea-button-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></button></li>`;
    })
    .join('');

  const combosHtml = permitirTrasbordo
    ? (combosItems
      ? `<ul class="lineas-list">${combosItems}</ul>`
      : `<p style="margin: 0; font-size: 14px; color: var(--text-secondary, #666); text-align: center;">No se encontraron combinaciones con 1 trasbordo.</p>`)
    : '';

  const origenNombre = String(origen.nombre || 'Mi ubicación actual').trim();
  const origenRowHtml = `
    <div class="route-origin-row">
      <div class="route-origin-row-info">
        <span class="route-origin-row-icon" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M3 12h4m10 0h4M12 3v4m0 10v4"></path></svg>
        </span>
        <div class="route-origin-row-text">
          <span class="route-origin-row-label">Desde</span>
          <span class="route-origin-row-name">${escapeHtml(origenNombre)}</span>
        </div>
      </div>
      <button type="button" class="route-origin-row-change" data-route-change-origin="1">Cambiar</button>
    </div>
  `;

  const html = `
    ${origenRowHtml}
    <p style="margin: 0 0 10px 0; font-size: 17px; font-weight: 900; color: var(--text-primary, #222); text-align: center;">Sin trasbordo</p>
    ${directHtml}
    <p style="margin: 14px 0 10px 0; font-size: 17px; font-weight: 900; color: var(--text-primary, #222); text-align: center;">Con trasbordo</p>
    ${combosHtml}
    <p style="margin: 14px 0 0 0; font-size: 12px; color: var(--text-muted, #888); text-align: center;">Tocá una opción para dibujar la ruta.</p>
  `;
  abrirBottomSheet('Opciones de ruta', html, '', subtitulo);
}

function renderResultadosOrigenPicker(items, container) {
  if (!Array.isArray(items) || items.length === 0) {
    container.innerHTML = '<p class="search-results-hint">Sin resultados</p>';
    return;
  }

  container.innerHTML = '';
  for (const item of items) {
    const nombre = String(item.nombre || 'Lugar').trim();
    const lat = Number(item.lat);
    const lng = Number(item.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const esParada = item.tipoResultado === 'parada';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'search-unified-item';
    btn.dataset.originLat = String(lat);
    btn.dataset.originLng = String(lng);
    btn.dataset.originNombre = nombre;
    btn.innerHTML = `
      <div class="search-unified-item-main">
        <span class="search-unified-item-title">${escapeHtml(nombre)}</span>
        <span class="search-unified-item-sub">${esParada ? 'Parada de colectivos' : 'Calle / Ubicación'}</span>
      </div>
      <span style="font-size: 14px;">${esParada ? '🚏' : '📍'}</span>
    `;
    container.appendChild(btn);
  }
}

let _origenPickerSeq = 0;
let _origenPickerTimeout = null;

async function ejecutarBusquedaOrigenPicker(query) {
  const container = document.getElementById('origin-picker-results');
  if (!container) return;
  const mySeq = ++_origenPickerSeq;

  let paradas = [];
  try {
    paradas = await buscarParadasLocales(query);
  } catch {
    // noop
  }
  if (mySeq !== _origenPickerSeq) return;
  renderResultadosOrigenPicker(paradas.map((p) => ({ ...p, tipoResultado: 'parada' })), container);

  try {
    const calles = await buscarCallesEnSanJuan(query);
    if (mySeq !== _origenPickerSeq) return;
    renderResultadosOrigenPicker(
      [...paradas.map((p) => ({ ...p, tipoResultado: 'parada' })), ...calles],
      container,
    );
  } catch {
    // Se quedan los resultados locales (paradas) ya mostrados.
  }
}

// Selector de punto de partida: permite planear rutas desde cualquier lugar
// (ubicación GPS, un punto tocado en el mapa, una búsqueda o un guardado/favorito),
// no solo desde la posición actual del usuario.
let _ubicacionPickerModo = 'origen'; // 'origen' | 'destino': a cuál de los dos le pega el picker abierto

// Selector de ubicación reutilizable para elegir tanto el origen como el destino de una
// ruta: por GPS (solo tiene sentido para el origen), tocando un punto del mapa, buscando
// una calle/parada, o desde los lugares/paradas guardados como favoritos.
function mostrarSelectorUbicacionRuta(modo) {
  _ubicacionPickerModo = modo === 'destino' ? 'destino' : 'origen';
  const esDestino = _ubicacionPickerModo === 'destino';

  const favLugares = obtenerLugaresFavs();
  const favParadas = obtenerParadasFavs();
  const guardadosItems = [
    ...favLugares.map((l) => ({ ...l, tipoResultado: 'calle' })),
    ...favParadas.map((p) => ({ ...p, tipoResultado: 'parada' })),
  ].slice(0, 10);

  const guardadosHtml = guardadosItems.length
    ? guardadosItems
      .map((item) => {
        const nombre = String(item.nombre || item.label || 'Guardado').trim();
        const lat = Number(item.lat);
        const lng = Number(item.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
        const esParada = item.tipoResultado === 'parada';
        return `<button type="button" class="search-unified-item" data-origin-lat="${lat}" data-origin-lng="${lng}" data-origin-nombre="${escapeHtml(nombre)}">
          <div class="search-unified-item-main">
            <span class="search-unified-item-title">${escapeHtml(nombre)}</span>
            <span class="search-unified-item-sub">Guardado</span>
          </div>
          <span style="font-size: 14px;">${esParada ? '🚏' : '📌'}</span>
        </button>`;
      })
      .join('')
    : '';

  const quickActionsHtml = esDestino
    ? `<div class="origin-picker-quick-actions origin-picker-quick-actions--single">
        <button type="button" class="btn-nav-row" data-origin-pick="mapa">🗺️ Elegir en el mapa</button>
      </div>`
    : `<div class="origin-picker-quick-actions">
        <button type="button" class="btn-nav-row" data-origin-pick="gps">📍 Mi ubicación actual</button>
        <button type="button" class="btn-nav-row" data-origin-pick="mapa">🗺️ Elegir en el mapa</button>
      </div>`;

  const html = `
    ${quickActionsHtml}
    <div class="search-unified-box" style="margin: 16px 0 0 0;">
      <span class="search-unified-icon" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>
      </span>
      <input type="text" id="origin-picker-input" class="search-unified-input" placeholder="${esDestino ? '¿A dónde vas?' : 'Buscar una calle o parada...'}" autocomplete="off" />
    </div>
    <div id="origin-picker-results" class="search-unified-dropdown search-unified-dropdown-inline" style="display: none;"></div>
    ${guardadosItems.length ? `
      <p class="origin-picker-section-title">Guardados</p>
      <div class="search-unified-dropdown search-unified-dropdown-inline">${guardadosHtml}</div>
    ` : ''}
  `;

  abrirBottomSheet(esDestino ? 'Elegir destino' : 'Punto de partida', html, '', '');

  const input = document.getElementById('origin-picker-input');
  const results = document.getElementById('origin-picker-results');
  if (input && results) {
    input.addEventListener('input', () => {
      const val = input.value.trim();
      if (_origenPickerTimeout) clearTimeout(_origenPickerTimeout);
      if (val.length < 2) {
        results.style.display = 'none';
        results.innerHTML = '';
        return;
      }
      results.style.display = 'flex';
      results.innerHTML = '<p class="search-results-loading">Buscando...</p>';
      _origenPickerTimeout = setTimeout(() => ejecutarBusquedaOrigenPicker(val), 150);
    });
  }
}

// Accesos directos desde el Dashboard: abre el mapa con el planificador de viaje,
// permitiendo elegir tanto el origen como el destino (con buscador) antes de calcular rutas.
function mostrarPlanificadorViaje() {
  _routePlanTarget = null;
  _routePlanOrigin = null;

  // Abrir el planificador arranca un viaje nuevo, así que el mapa tiene que arrancar
  // limpio también: sin el recorrido de la línea que se estuviera mirando y sin los
  // pines de origen/destino de un planeo anterior.
  limpiarRecorrido();
  limpiarMarcadoresSeleccion();

  // Y sobre todo hay que soltar la vista guardada: cambiarVista('view-map') reaplica
  // window._activeMapView, así que si venías de centrar una parada, un lugar guardado
  // o una línea entera, el planificador se abría mostrando eso en vez del lugar desde
  // el que vas a salir.
  window._activeMapView = null;

  cambiarVista('view-map');
  enfocarSeleccionDePlaneo();
  renderPlanificadorViajeSheet();
}

function renderPlanificadorViajeSheet() {
  const origenNombre = _routePlanOrigin?.nombre || 'Mi ubicación actual';
  const destinoNombre = String(_routePlanTarget?.nombre || '').trim();

  const html = `
    <div class="trip-planner-rows">
      <div class="trip-planner-row">
        <span class="trip-planner-row-icon trip-planner-row-icon-origin" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"></circle></svg>
        </span>
        <div class="trip-planner-row-text">
          <span class="trip-planner-row-label">Desde</span>
          <span class="trip-planner-row-value">${escapeHtml(origenNombre)}</span>
        </div>
        <button type="button" class="trip-planner-row-btn" data-trip-pick="origen">Elegir</button>
      </div>
      <div class="trip-planner-row">
        <span class="trip-planner-row-icon trip-planner-row-icon-dest" aria-hidden="true">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
        </span>
        <div class="trip-planner-row-text">
          <span class="trip-planner-row-label">Hasta</span>
          <span class="trip-planner-row-value${destinoNombre ? '' : ' trip-planner-row-placeholder'}">${destinoNombre ? escapeHtml(destinoNombre) : '¿A dónde vas?'}</span>
        </div>
        <button type="button" class="trip-planner-row-btn" data-trip-pick="destino">${destinoNombre ? 'Cambiar' : 'Buscar'}</button>
      </div>
    </div>
    <p style="margin: 14px 0 0 0; font-size: 12px; color: var(--text-muted, #888); text-align: center;">Elegí el destino para ver las opciones de ruta.</p>
  `;

  abrirBottomSheet('Planificar viaje', html, '', '');
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

// ─── Pantalla de carga inicial ─────────────────────────────────────────────
// El overlay ya viene pintado en el HTML (así se ve desde el primer frame, sin esperar
// a que corra este script). Acá solo se va contando en qué paso está el arranque y se
// lo saca cuando el mapa ya tiene tiles dibujadas.
let _pantallaCargaOculta = false;

function actualizarPasoPantallaCarga(texto) {
  const el = document.getElementById('app-loading-step');
  if (el) el.textContent = texto;
}

// Cuánto del ícono está lleno, de 0 a 100. Nunca retrocede: los pasos del arranque
// no siempre terminan en orden (las tiles pueden llegar antes que el GPS) y ver el
// ícono vaciarse se leería como un error.
let _progresoPantallaCarga = 0;

function actualizarProgresoPantallaCarga(porcentaje) {
  const overlay = document.getElementById('app-loading-screen');
  if (!overlay) return;
  const pct = Math.max(0, Math.min(100, Number(porcentaje) || 0));
  if (pct <= _progresoPantallaCarga) return;
  _progresoPantallaCarga = pct;
  overlay.style.setProperty('--app-loading-restante', `${100 - pct}%`);
}

function ocultarPantallaCargaApp() {
  if (_pantallaCargaOculta) return;
  _pantallaCargaOculta = true;
  const overlay = document.getElementById('app-loading-screen');
  if (!overlay) return;
  overlay.classList.add('is-hidden');
  // Se saca del DOM recién al terminar el fundido para que no quede capturando
  // clicks sobre el mapa mientras se desvanece.
  window.setTimeout(() => overlay.remove(), 420);
}

// Llena el ícono en proporción a las tiles del mapa que ya llegaron, y resuelve
// cuando la capa termina su primera tanda.
//
// Se engancha apenas la capa existe en vez de esperar a que Centrar() termine: el
// mapa se crea a mitad de Centrar(), que además descarga el GeoJSON de paradas. Si
// se esperaba a que todo eso terminara para recién empezar a medir, el ícono se
// quedaba clavado varios segundos y después saltaba de golpe — justo lo contrario de
// mostrar cómo va cargando.
//
// Si el mapa nunca llega a crearse (sin permiso de ubicación, sin red), resuelve
// igual por tiempo: la pantalla de carga nunca debe dejar al usuario encerrado.
function seguirCargaDelMapa(desde = 15, hasta = 88) {
  return new Promise((resolve) => {
    let listo = false;
    let enganchado = false;
    let pedidas = 0;
    let llegadas = 0;

    const terminar = () => {
      if (listo) return;
      listo = true;
      actualizarProgresoPantallaCarga(hasta);
      resolve();
    };

    const contarTile = () => {
      llegadas += 1;
      if (pedidas > 0) {
        actualizarProgresoPantallaCarga(desde + ((hasta - desde) * Math.min(1, llegadas / pedidas)));
      }
    };

    const intentarEnganchar = () => {
      if (listo || enganchado || !leafletMap) return;
      leafletMap.eachLayer((capa) => {
        if (!capa || typeof capa.on !== 'function' || !capa._url) return;
        enganchado = true;
        capa.on('tileloadstart', () => { pedidas += 1; });
        // 'tileerror' también cuenta: una tile que falló no va a llegar nunca y sin
        // contarla el llenado se quedaría esperándola para siempre.
        capa.on('tileload', contarTile);
        capa.on('tileerror', contarTile);
        capa.once('load', terminar);
      });
      // Que el mapa ya exista es en sí un avance: la ubicación se resolvió.
      if (enganchado) actualizarProgresoPantallaCarga(desde);
    };

    const esperarAlMapa = () => {
      if (listo || enganchado) return;
      intentarEnganchar();
      if (!enganchado) window.setTimeout(esperarAlMapa, 100);
    };

    esperarAlMapa();
    window.setTimeout(terminar, 7000);
  });
}

window.onload = async () => {
  try {
    actualizarPasoPantallaCarga('Buscando tu ubicación...');
    actualizarProgresoPantallaCarga(8);

    // Los dos arrancan juntos a propósito: el seguimiento de tiles queda esperando a
    // que Centrar() cree el mapa y desde ese momento el ícono se llena solo, mientras
    // Centrar() sigue ocupado bajando las paradas.
    // Dos fuentes reales de avance corriendo a la vez; como el progreso nunca
    // retrocede, manda en cada momento la que va más adelante:
    //  · las tiles del mapa cubren el arranque (12 → 38);
    //  · la descarga del GeoJSON de paradas —decenas de MB, lo que de verdad se está
    //    esperando— cubre el grueso (38 → 95).
    const cargaDelMapa = seguirCargaDelMapa(12, 38);

    // El tramo del GeoJSON arranca justo donde terminan las tiles (38) en vez de
    // solaparse desde abajo: si empezara en 15, su primer tercio quedaba por debajo
    // de lo que ya marcaban las tiles y el ícono se veía detenido un buen rato.
    _onProgresoDescargaParadas = (fraccion) => {
      actualizarPasoPantallaCarga('Descargando paradas y recorridos...');
      actualizarProgresoPantallaCarga(38 + (57 * fraccion));
    };

    const centrado = Centrar();

    // Tener el mapa dibujado es lo que sí hay que esperar antes de mostrar la app.
    await cargaDelMapa;

    // A las paradas se les da una ventana acotada para que se vea su avance real. Si
    // la conexión es lenta y tardan más, la app se abre igual y el dataset termina de
    // bajar de fondo: la pantalla de carga no puede quedarse rehén de 50 MB.
    await Promise.race([
      centrado,
      new Promise((r) => window.setTimeout(r, 9000)),
    ]);

    actualizarPasoPantallaCarga('Preparando tus guardados...');
    cargarFavos();
    actualizarProgresoPantallaCarga(100);
  } catch (error) {
    console.error('Error al obtener la ubicación inicial:', error.message ?? error);
    actualizarProgresoPantallaCarga(100);
  } finally {
    // Fuera del arranque, cargarParadasGeojson() no tiene que reportar nada.
    _onProgresoDescargaParadas = null;
    // Un respiro para que se vea el ícono completarse antes del fundido; si no, el
    // último tramo del llenado queda tapado por la salida.
    window.setTimeout(ocultarPantallaCargaApp, 340);
  }
};

// Red de seguridad: si algo del arranque queda colgado (geolocalización que nunca
// responde, tiles que no cargan), la pantalla se va igual a los 9 segundos.
window.setTimeout(() => {
  actualizarProgresoPantallaCarga(100);
  window.setTimeout(ocultarPantallaCargaApp, 200);
}, 16000);