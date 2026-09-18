// Genera Datos/noticias_redtulum.json con las últimas novedades oficiales de RedTulum.
//
// Se corre a mano (o desde un cron/acción programada) cada vez que se quiera refrescar
// la sección "Noticias de RedTulum" del inicio:
//
//     node scripts/actualizar_noticias.mjs
//
// El snapshot queda versionado en el repo porque la app es un sitio estático: ninguna
// de las dos fuentes oficiales manda cabeceras CORS, así que el navegador no puede
// leerlas directo. Bajarlas acá y servir un JSON propio también hace que la sección
// abra al instante y siga funcionando sin conexión (PWA).
//
// Fuentes (ambas oficiales):
//  · sisanjuan.gob.ar — Servicio Informativo del Gobierno de San Juan, feed RSS del
//    tag "RedTulum" (es el que se mantiene más al día).
//  · redtulum.gob.ar/novedades — las novedades publicadas por el propio RedTulum.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const RSS_SISANJUAN = 'https://sisanjuan.gob.ar/secciones/gobierno/itemlist/tag/RedTulum?format=feed&type=rss';
const SISANJUAN_TAG_URL = 'https://sisanjuan.gob.ar/secciones/gobierno/itemlist/tag/RedTulum';
const NOVEDADES_REDTULUM = 'https://www.redtulum.gob.ar/novedades';

const MAX_NOTICIAS = 12;
const MAX_RESUMEN = 260;
const TIMEOUT_MS = 30000;
// sisanjuan.gob.ar devuelve 500 cada tanto (su Joomla pierde la conexión a la base),
// así que conviene reintentar antes de dar la fuente por caída.
const REINTENTOS = 3;
const ESPERA_REINTENTO_MS = 4000;
// sisanjuan.gob.ar rechaza los user-agent de herramientas (403) y su WAF devuelve 500
// cuando se le pide la respuesta comprimida, así que se pide identidad y se firma como
// navegador.
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 ZondaMov/actualizar_noticias';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = path.join(RAIZ, 'Datos', 'noticias_redtulum.json');

const MESES_ES = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
  julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
};

async function bajarTexto(url) {
  let ultimoError;
  for (let intento = 1; intento <= REINTENTOS; intento += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: '*/*', 'Accept-Encoding': 'identity' },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.text();
    } catch (error) {
      ultimoError = error;
      if (intento < REINTENTOS) {
        await new Promise((r) => setTimeout(r, ESPERA_REINTENTO_MS * intento));
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw ultimoError;
}

// Los feeds vienen con entidades HTML mezcladas dentro del CDATA, así que hay que
// desarmarlas antes de guardar el texto plano.
function decodificarEntidades(texto) {
  return String(texto)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function aTextoPlano(html) {
  return decodificarEntidades(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}

function recortar(texto, max = MAX_RESUMEN) {
  const limpio = String(texto).trim();
  if (limpio.length <= max) return limpio;
  const corte = limpio.slice(0, max);
  const ultimoEspacio = corte.lastIndexOf(' ');
  return `${corte.slice(0, ultimoEspacio > max * 0.6 ? ultimoEspacio : max).trimEnd()}…`;
}

function tagInterno(xml, tag) {
  const conCdata = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, 'i').exec(xml);
  if (conCdata) return conCdata[1];
  const plano = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  return plano ? decodificarEntidades(plano[1]) : '';
}

// Clave de deduplicado: las dos fuentes suelen publicar la misma novedad con títulos
// casi idénticos (cambia alguna tilde o el prefijo "RedTulum:").
function claveTitulo(titulo) {
  return String(titulo)
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // marcas de acento ya separadas por NFD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 9)
    .join(' ');
}

async function leerSisanjuan() {
  const xml = await bajarTexto(RSS_SISANJUAN);
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);

  return items.map((item) => {
    const titulo = aTextoPlano(tagInterno(item, 'title'));
    const url = aTextoPlano(tagInterno(item, 'link'));
    const descripcion = tagInterno(item, 'description');
    const fechaRss = tagInterno(item, 'pubDate');

    // El K2 de Joomla arma la descripción en tres bloques: imagen, copete y nota
    // completa. El copete es exactamente el resumen que queremos mostrar.
    const copete = /<div class="K2FeedIntroText">([\s\S]*?)<\/div>/i.exec(descripcion);
    const imagenEnclosure = /<enclosure[^>]+url="([^"]+)"/i.exec(item);
    const imagenEnDescripcion = /<img[^>]+src="([^"]+)"/i.exec(descripcion);
    const fecha = new Date(fechaRss);
    const idNota = /\/(\d+)-/.exec(url);

    return {
      id: `sisanjuan-${idNota ? idNota[1] : claveTitulo(titulo).replaceAll(' ', '-')}`,
      titulo,
      resumen: recortar(aTextoPlano(copete ? copete[1] : descripcion)),
      url,
      imagen: imagenEnclosure?.[1] || imagenEnDescripcion?.[1] || '',
      fecha: Number.isNaN(fecha.getTime()) ? '' : fecha.toISOString(),
      fuente: 'Gobierno de San Juan',
      fuenteUrl: SISANJUAN_TAG_URL,
    };
  });
}

function parsearFechaRedtulum(texto) {
  // Formato del sitio: "25 Abril, 2025".
  const m = /(\d{1,2})\s+([a-záéíóúñ]+),?\s+(\d{4})/i.exec(String(texto).trim());
  if (!m) return '';
  const mes = MESES_ES[m[2].toLowerCase()];
  if (mes == null) return '';
  // Mediodía UTC para que el día no se corra al pasar a hora local argentina.
  return new Date(Date.UTC(Number(m[3]), mes, Number(m[1]), 12)).toISOString();
}

async function leerRedtulum() {
  const html = await bajarTexto(NOVEDADES_REDTULUM);
  const bloques = [...html.matchAll(/<div class="novedad[^"]*">([\s\S]*?)<a href="(novedad\?id=[^"]+)"><\/a>/g)];

  return bloques.map(([, bloque, href]) => {
    const titulo = aTextoPlano(/<h6[^>]*>([\s\S]*?)<\/h6>/i.exec(bloque)?.[1] ?? '');
    const resumen = aTextoPlano(/<p[^>]*>([\s\S]*?)<\/p>/i.exec(bloque)?.[1] ?? '');
    const fechaTexto = aTextoPlano(/<small class="date"[^>]*>([\s\S]*?)<\/small>/i.exec(bloque)?.[1] ?? '');
    const imagen = /background-image:\s*url\(([^)]+)\)/i.exec(bloque)?.[1]?.replace(/['"]/g, '') ?? '';
    const id = href.replace('novedad?id=', '');

    return {
      id: `redtulum-${id}`,
      titulo,
      resumen: recortar(resumen),
      url: `https://www.redtulum.gob.ar/${href}`,
      imagen,
      fecha: parsearFechaRedtulum(fechaTexto),
      fuente: 'RedTulum',
      fuenteUrl: NOVEDADES_REDTULUM,
    };
  });
}

async function leerFuente(nombre, fn) {
  try {
    const noticias = (await fn()).filter((n) => n.titulo && n.url);
    console.log(`✓ ${nombre}: ${noticias.length} novedades`);
    return noticias;
  } catch (error) {
    console.warn(`✗ ${nombre}: ${error.message ?? error}`);
    return [];
  }
}

async function leerSnapshotPrevio() {
  try {
    const previo = JSON.parse(await readFile(SALIDA, 'utf8'));
    return Array.isArray(previo.noticias) ? previo.noticias : [];
  } catch {
    return [];
  }
}

async function main() {
  const [sisanjuan, redtulum] = await Promise.all([
    leerFuente('sisanjuan.gob.ar', leerSisanjuan),
    leerFuente('redtulum.gob.ar', leerRedtulum),
  ]);

  if (sisanjuan.length === 0 && redtulum.length === 0) {
    throw new Error('Ninguna fuente respondió: no se sobrescribe el snapshot anterior.');
  }

  // Lo ya guardado va último: si hoy una de las dos fuentes está caída, sus noticias
  // siguen en el archivo en vez de desaparecer del inicio de la app.
  const previas = await leerSnapshotPrevio();

  const vistas = new Set();
  const noticias = [...sisanjuan, ...redtulum, ...previas]
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
    .filter((n) => {
      const clave = claveTitulo(n.titulo);
      if (!clave || vistas.has(clave)) return false;
      vistas.add(clave);
      return true;
    })
    .slice(0, MAX_NOTICIAS);

  const salida = {
    actualizado: new Date().toISOString(),
    fuentes: [
      { nombre: 'Gobierno de San Juan', url: SISANJUAN_TAG_URL },
      { nombre: 'RedTulum', url: NOVEDADES_REDTULUM },
    ],
    noticias,
  };

  await writeFile(SALIDA, `${JSON.stringify(salida, null, 2)}\n`, 'utf8');
  console.log(`\n${noticias.length} noticias guardadas en Datos/noticias_redtulum.json`);
  console.log(`Más reciente: ${noticias[0]?.fecha?.slice(0, 10) ?? '—'} · ${noticias[0]?.titulo ?? ''}`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
