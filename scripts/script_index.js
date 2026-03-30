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
const STORAGE_LINEAS_FAVS_KEY = 'transitsj_lineas_favs_v1';
const STORAGE_PARADAS_FAVS_KEY = 'transitsj_paradas_favs_v1';
const MAX_PARADAS_FAVS = 5;

const GEO_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 0,
};

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
  for (const f of favs) {
    const ref = typeof f?.ref === 'string' ? f.ref.trim() : '';
    const name = typeof f?.name === 'string' ? f.name.trim() : '';
    const item = document.createElement('button');
    item.type = 'button';
    item.dataset.lineaKey = ref || name;
    item.dataset.lineaRef = ref;
    item.dataset.lineaName = name;
    item.textContent = ref ? `Línea ${ref}${name ? ` — ${name}` : ''}` : name;
    contLineasFavs.appendChild(item);
  }
}

if (contLineasFavs) {
  contLineasFavs.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    const btn = target.closest('button[data-linea-key]');
    if (!(btn instanceof HTMLButtonElement)) return;

    const ref = btn.dataset.lineaRef || '';
    const name = btn.dataset.lineaName || '';
    if (!ref) {
      if (contenedorParadas) {
        contenedorParadas.style.display = 'block';
        contenedorParadas.innerHTML = '<p>Esta línea favorita no tiene referencia (ref) para buscar su recorrido.</p>';
      }
      return;
    }

    void mostrarRecorridoDeLinea(ref, name);
  });
}

function renderParadasFavs() {
  const contParadasFavs = document.getElementById('paradas_favs');
  if (!contParadasFavs) return;
  const favs = obtenerParadasFavs();
  contParadasFavs.innerHTML = '';
  for (const f of favs) {
    const id = typeof f?.id === 'string' ? f.id : '';
    const label = typeof f?.label === 'string' ? f.label : 'Parada';
    const lat = typeof f?.lat === 'number' ? f.lat : null;
    const lng = typeof f?.lng === 'number' ? f.lng : null;
    const item = document.createElement('button');
    item.type = 'button';
    item.dataset.paradaId = id;
    if (lat !== null) item.dataset.lat = String(lat);
    if (lng !== null) item.dataset.lng = String(lng);
    item.textContent = label;
    contParadasFavs.appendChild(item);
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
    const marker = L.marker([latNum, lngNum]).bindPopup(escapeHtml(label || 'Parada favorita')).addTo(layerSel);
    const z = typeof leafletMap.getMaxZoom === 'function' ? leafletMap.getMaxZoom() : ZOOM_CALLE;
    leafletMap.setView([latNum, lngNum], Number.isFinite(z) ? z : ZOOM_CALLE);
    marker.openPopup();
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

const contParadasFavsEl = document.getElementById('paradas_favs');
if (contParadasFavsEl) {
  contParadasFavsEl.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    const btn = target.closest('button[data-parada-id]');
    if (!(btn instanceof HTMLButtonElement)) return;

    const id = btn.dataset.paradaId || '';
    const label = btn.textContent || 'Parada';
    const lat = btn.dataset.lat ? Number(btn.dataset.lat) : null;
    const lng = btn.dataset.lng ? Number(btn.dataset.lng) : null;
    void centrarEnParadaFavorita({ id, label, lat, lng });
  });
}

function obtenerIdParada(feature) {
  const id = feature?.properties?.['@id'];
  if (typeof id === 'string' && id.trim()) return id.trim();
  const coords = feature?.geometry?.coordinates;
  if (Array.isArray(coords) && coords.length >= 2) return `coords:${coords[1]},${coords[0]}`;
  return 'parada_sin_id';
}

function obtenerEtiquetaParada(feature) {
  const name = feature?.properties?.name;
  if (typeof name === 'string' && name.trim()) return name.trim();
  const id = feature?.properties?.['@id'];
  if (typeof id === 'string' && id.trim()) return id.trim();
  return 'Parada';
}

function renderListaParadasRecorrido() {
  if (!Array.isArray(paradasRecorrido) || paradasRecorrido.length === 0) return '';

  const items = paradasRecorrido
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
  if (contenedorParadas) {
    contenedorParadas.innerHTML = '';
    contenedorParadas.style.display = 'none';
  }
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
    const etiqueta = obtenerEtiquetaParada(item.feature);
    const marker = L.marker([item.lat, item.lng]).bindPopup(escapeHtml(etiqueta)).addTo(layerParadas);
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
  if (favs.some((f) => (f?.ref || f?.name) === key)) return;
  favs.push({ ref, name });
  guardarLineasFavs(favs);
  renderLineasFavs();
}

function agregarParadaAFavoritos(feature) {
  const id = obtenerIdParada(feature);
  const label = obtenerEtiquetaParada(feature);
  if (!id) return;

  const coords = feature?.geometry?.coordinates;
  const lng = Array.isArray(coords) && coords.length >= 2 ? Number(coords[0]) : null;
  const lat = Array.isArray(coords) && coords.length >= 2 ? Number(coords[1]) : null;

  const favs = obtenerParadasFavs();
  if (favs.some((f) => f?.id === id)) return;

  favs.push({
    id,
    label,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  });
  while (favs.length > MAX_PARADAS_FAVS) {
    favs.shift();
  }
  guardarParadasFavs(favs);
  renderParadasFavs();
}

async function mostrarRecorridoDeLinea(ref, name = '') {
  if (!leafletMap || typeof L === 'undefined') return;

  if (seleccionParadaLayer) seleccionParadaLayer.clearLayers();

  const data = await cargarParadasGeojson();
  if (!data) return;

  const rutas = obtenerRutasDeLinea(data, ref);
  if (!rutas.length) {
    if (contenedorParadas) {
      contenedorParadas.style.display = 'block';
      contenedorParadas.innerHTML = `<p>No se encontró el recorrido para la línea ${escapeHtml(ref)}.</p>`;
    }
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

  if (contenedorParadas) {
    contenedorParadas.style.display = 'block';
    const titulo = ref ? `Línea ${escapeHtml(ref)}` : 'Línea';
    const detalle = name ? ` — ${escapeHtml(name)}` : '';
    const listaParadasHtml = renderListaParadasRecorrido();
    contenedorParadas.innerHTML = `
      <h3>Recorrido</h3>
      <p>${titulo}${detalle}</p>
      <button type="button" id="btn_regresar_vista">Regresar</button>
      <button type="button" id="btn_fav_linea">Agregar a favoritos</button>
      ${listaParadasHtml}
    `;
    const btn = document.getElementById('btn_fav_linea');
    btn?.addEventListener('click', () => agregarLineaAFavoritos({ ref: String(ref), name: String(name || '') }));

    const btnRegresar = document.getElementById('btn_regresar_vista');
    btnRegresar?.addEventListener('click', volverVistaGeneral);
  }
}

function mostrarLineasEnContenedorParadas(feature) {
  if (!contenedorParadas) return;

  contenedorParadas.style.display = 'block';
  const lineas = obtenerLineasDetalleDesdeRelations(feature);
  if (!lineas.length) {
    contenedorParadas.innerHTML = '<p>No hay líneas disponibles para esta parada.</p>';
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
  contenedorParadas.innerHTML = `<button type="button" id="btn_regresar_vista">Regresar</button><h3>Parada seleccionada</h3><button type="button" id="btn_fav_parada">Agregar parada a favoritos</button><ul>${itemsHtml}</ul>${listaParadasHtml}`;

  const btn = document.getElementById('btn_regresar_vista');
  btn?.addEventListener('click', volverVistaGeneral);

  const btnFavParada = document.getElementById('btn_fav_parada');
  btnFavParada?.addEventListener('click', () => agregarParadaAFavoritos(feature));
}

if (contenedorParadas) {
  contenedorParadas.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;

    const btnParada = target.closest('button[data-parada-id]');
    if (btnParada instanceof HTMLButtonElement) {
      const paradaId = btnParada.dataset.paradaId || '';
      if (!paradaId) return;
      if (Array.isArray(paradasRecorrido)) {
        const found = paradasRecorrido.find((p) => (p.paradaId || obtenerIdParada(p.feature)) === paradaId);
        if (found) {
          leafletMap?.setView([found.lat, found.lng], leafletMap.getZoom());
          mostrarLineasEnContenedorParadas(found.feature);

          const marker = paradasRecorridoMarkers?.get(paradaId);
          marker?.openPopup();
        }
      }
      return;
    }

    const btn = target.closest('button[data-linea-ref]');
    if (!(btn instanceof HTMLButtonElement)) return;
    const ref = btn.dataset.lineaRef || '';
    const name = btn.dataset.lineaName || '';
    if (!ref && !name) return;
    void mostrarRecorridoDeLinea(ref, name);
  });
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

function zoomEsMaximo() {
  if (!leafletMap) return false;
  const z = leafletMap.getZoom();
  const maxZ = leafletMap.getMaxZoom();
  return Number.isFinite(maxZ) ? z >= maxZ : false;
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

  if (zoomEsMaximo()) {
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
    const lineas = obtenerLineasDesdeRelations(item.feature);
    const lineasTxt = lineas.length ? `Líneas: ${lineas.join(', ')}` : 'Líneas: (sin datos)';
    const marker = L.marker([item.lat, item.lng]).bindPopup(lineasTxt).addTo(layer);
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
    const lineas = obtenerLineasDesdeRelations(item.feature);
    const lineasTxt = lineas.length ? `Líneas: ${lineas.join(', ')}` : 'Líneas: (sin datos)';
    const distTxt = `Distancia: ${Math.round(item.d)} m`;

    const marker = L.marker([item.lat, item.lng])
      .bindPopup(`${lineasTxt}<br>${distTxt}`)
      .addTo(layer);
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
      zoomControl: true,
      scrollWheelZoom: true,
      maxZoom: 19,
    }).setView([coords.lat, coords.lng], typeof zoomObjetivo === 'number' ? zoomObjetivo : ZOOM_CALLE);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(leafletMap);

    userMarker = L.marker([coords.lat, coords.lng]).addTo(leafletMap);

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
  const contenedorFavs = document.getElementById('favoritos');
  contenedorFavs.style.display = contenedorFavs.style.display === 'none' ? 'block' : 'none';
}
function cargarFavos(){
  renderParadasFavs();
  renderLineasFavs();
}
window.onload = async () => {
  try {
    await Centrar();
    cargarFavos();
  } catch (error) {
    console.error('Error al obtener la ubicación inicial:', error.message ?? error);
  }
};