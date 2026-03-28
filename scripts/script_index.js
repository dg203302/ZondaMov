const mapa = document.getElementById('map');

let ubicacion = null;
let leafletMap = null;
let userMarker = null;

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

async function actualizarCada5s() {
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
    cargarLF(ubicacion);
  } catch (error) {
    console.error('Error:', error.message ?? error);
  }
}

// Primera lectura + refresco cada 5 segundos
actualizarCada5s();
setInterval(actualizarCada5s, 5000);

function cargarLF(coords){
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
    }).setView([coords.lat, coords.lng], 16);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(leafletMap);

    userMarker = L.marker([coords.lat, coords.lng]).addTo(leafletMap);
    return;
  }

  if (userMarker) {
    userMarker.setLatLng([coords.lat, coords.lng]);
  }

  leafletMap.setView([coords.lat, coords.lng], leafletMap.getZoom());
}