const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const chromiumSparticuz = require('@sparticuz/chromium');

chromium.use(stealth);

const LATITUD = parseFloat(process.env.LATITUD || "-31.5375");
const LONGITUD = parseFloat(process.env.LONGITUD || "-68.5364");
const TIMEOUT_DEFAULT_MS = parseInt(process.env.TIMEOUT_DEFAULT_MS || "1500");

// Instancia global caliente para reutilizar Chromium en arranques calientes (Warm Starts)
let cachedBrowser = null;

async function doLookup(page, url, id_p) {
  // Acelerar la carga bloqueando imágenes, fuentes, media y trackers pesados de terceros
  await page.route('**/*', (route) => {
    const resourceType = route.request().resourceType();
    const requestUrl = route.request().url();
    
    if (['image', 'font', 'media'].includes(resourceType)) {
      return route.abort();
    }
    
    // Bloquear scripts y trackers pesados que demoran la ejecución del JS de Moovit
    const blockPatterns = [
      'google-analytics', 'googleads', 'doubleclick', 'facebook',
      'taboola', 'outbrain', 'criteo', 'amazon-adsystem', 'adnxs',
      'hotjar', 'sentry.io', 'amplitude', 'scorecardresearch'
    ];
    if (blockPatterns.some(pattern => requestUrl.includes(pattern))) {
      return route.abort();
    }
    
    return route.continue();
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_DEFAULT_MS * 8 });

  // Optimización: Esperar dinámicamente a que aparezca al menos una parada en vez de esperar un timeout fijo de 2 segundos.
  try {
    await page.waitForSelector('[id^="stop-"]', { state: 'attached', timeout: TIMEOUT_DEFAULT_MS * 6 });
  } catch (e) {
    // Si falla, permitimos continuar por si el selector final ya está listo o para lanzar el error detallado abajo.
    console.log("[arrivals] Aviso: Timeout esperando cargador de paradas genérico.");
  }

  let selectorObjetivo = `[id="${id_p}"]`;
  const match = id_p.match(/^(stop-\d+)-\d+$/);
  const fallbackSelector = match ? `[id^="${match[1]}-"]` : null;
  let finalSelector = selectorObjetivo;
  
  try {
    await page.waitForSelector(selectorObjetivo, { state: 'attached', timeout: TIMEOUT_DEFAULT_MS * 4 });
  } catch (error) {
    if (fallbackSelector) {
      console.log(`[arrivals] No se encontró el ID exacto '${id_p}'. Probando fallback selector: '${fallbackSelector}'`);
      try {
        await page.waitForSelector(fallbackSelector, { state: 'attached', timeout: TIMEOUT_DEFAULT_MS * 4 });
        finalSelector = fallbackSelector;
      } catch (fallbackError) {
        const availableIds = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('[id^="stop-"]')).map(el => el.id);
        });
        console.warn(`[arrivals] Fallback fallido. IDs de paradas disponibles en el DOM:`, availableIds);
        throw {
          statusCode: 404,
          message: `No se encontró la parada con ID base '${match[1]}' en la página de Moovit. IDs disponibles: ${availableIds.slice(0, 10).join(', ')}...`
        };
      }
    } else {
      const availableIds = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('[id^="stop-"]')).map(el => el.id);
      });
      console.warn(`[arrivals] ID exacto fallido sin posibilidad de fallback. IDs de paradas disponibles:`, availableIds);
      throw {
        statusCode: 404,
        message: `No se encontró un elemento con id '${id_p}' en el DOM (timeout esperando selector).`
      };
    }
  }

  // Esperar la respuesta de la API interna al hacer click
  const responsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/lines/linearrival') && response.status() === 200,
    { timeout: TIMEOUT_DEFAULT_MS * 8 }
  );

  await page.locator(finalSelector).first().click({ timeout: TIMEOUT_DEFAULT_MS * 4 });

  const response = await responsePromise;
  const datos = await response.json();

  let arrivals = [];
  if (Array.isArray(datos) && datos.length > 0) {
    arrivals = datos[0].arrivals || [];
  }

  if (arrivals.length === 0) {
    let horario_estimado = null;
    const elem = page.locator("div.current.ng-star-inserted span.ng-star-inserted").first();
    if (await elem.count() > 0) {
      horario_estimado = (await elem.innerText()).trim();
    }

    return {
      id_p,
      arrivals: [],
      horario_estimado,
      raw: datos,
    };
  }

  return {
    id_p,
    arrivals,
    raw: datos,
  };
}

exports.handler = async (event, context) => {
  // Configuración de CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ detail: 'Método no permitido. Usa POST.' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ detail: 'JSON inválido en el cuerpo de la petición' }) };
  }

  const { url, id_p } = body;
  if (!url || !id_p) {
    return { statusCode: 400, headers, body: JSON.stringify({ detail: 'Faltan parámetros obligatorios: url y id_p' }) };
  }

  let browserContext = null;
  try {
    // Intentar reutilizar contexto en el browser caliente existente
    try {
      if (cachedBrowser && cachedBrowser.isConnected()) {
        browserContext = await cachedBrowser.newContext({
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          geolocation: { latitude: LATITUD, longitude: LONGITUD },
          permissions: ['geolocation'],
        });
        console.log("[arrivals] Reutilizando instancia existente de Chromium caliente.");
      }
    } catch (contextError) {
      console.warn("[arrivals] Error intentando reutilizar browser caliente, reiniciando Chromium...", contextError);
      try { await cachedBrowser.close(); } catch (e) {}
      cachedBrowser = null;
    }

    // Si no había browser o se corrompió, abrir uno nuevo
    if (!cachedBrowser || !cachedBrowser.isConnected()) {
      console.log("[arrivals] Lanzando nueva instancia de Chromium...");
      cachedBrowser = await chromium.launch({
        args: chromiumSparticuz.args,
        executablePath: await chromiumSparticuz.executablePath(),
        headless: true,
      });

      browserContext = await cachedBrowser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        geolocation: { latitude: LATITUD, longitude: LONGITUD },
        permissions: ['geolocation'],
      });
    }

    const page = await browserContext.newPage();
    page.setDefaultTimeout(TIMEOUT_DEFAULT_MS * 8);

    const result = await doLookup(page, url, id_p);

    // Cerrar el contexto de navegación (libera memoria y borra cookies/pestanas) pero mantener vivo el navegador maestro
    await browserContext.close();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result)
    };

  } catch (error) {
    if (browserContext) {
      try { await browserContext.close(); } catch (e) {}
    }
    
    const statusCode = error.statusCode || 500;
    const errorMessage = error.message || error.toString();
    return {
      statusCode,
      headers,
      body: JSON.stringify({ detail: errorMessage })
    };
  }
};
