#!/usr/bin/env node
/**
 * Genera las páginas estáticas de SEO a partir de Datos/redtulum/index.json:
 *
 *   linea/<slug>/index.html   una por línea (recorrido, paradas, primer/último servicio, frecuencia)
 *   lineas/index.html         listado de todas las líneas (enlaza a cada una)
 *   sitemap.xml               home + listado + líneas
 *
 *   node scripts/seo/generar-paginas-lineas.mjs [index.json]
 *
 * La app es una SPA de una sola URL: sin esto, Google solo ve "ZondaMov" y no hay nada que
 * rankee para búsquedas como "horarios línea 100 San Juan". Cada página lleva contenido real
 * (nombre, paradas en orden, horarios) y un enlace para abrir la app. Correr después de
 * regenerar index.json (ver Datos/redtulum/ACTUALIZAR.md) y commitear el resultado.
 *
 * Los datos son los del índice en uso, o sea horarios PROGRAMADOS y aproximados; las páginas
 * lo dicen explícitamente.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(HERE, '..', '..');
const INDEX = path.resolve(process.argv[2] || path.join(RAIZ, 'Datos', 'redtulum', 'index.json'));
const SITIO = 'https://zondamov.com.ar';
const ICONO = `${SITIO}/Icons/og-image.png`; // 1200x630, ver scripts/seo/generar-og-image.py
const GEOJSON = path.join(RAIZ, 'Datos', 'DATOS SAN JUAN.geojson');

const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
const generado = (index.meta.generado || new Date().toISOString()).slice(0, 10); // fecha de los datos
const hoy = new Date().toISOString().slice(0, 10); // fecha de las páginas (lastmod del sitemap)

// Refs de líneas que existen como recorrido en el mapa (OSM). Solo a esas se les ofrece
// "ver en el mapa" (/?linea=...): para el resto el botón abriría la app sin mostrar nada.
const claveLinea = (s) => String(s).replace(/[-\s]/g, '').toUpperCase();
const refsMapa = new Map(); // clave normalizada -> ref tal como está en el mapa
for (const f of JSON.parse(fs.readFileSync(GEOJSON, 'utf8')).features) {
  const p = f.properties || {};
  if (p.type === 'route' && p.route === 'bus' && typeof p.ref === 'string') refsMapa.set(claveLinea(p.ref), p.ref.trim());
}

/* ----------------------------------------------------------------- utilidades */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugDe = (linea) => String(linea).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const natural = (a, b) => String(a).localeCompare(String(b), 'es', { numeric: true });
const hhmm = (secs) => {
  const s = ((secs % 86400) + 86400) % 86400;
  return String(Math.floor(s / 3600)).padStart(2, '0') + ':' + String(Math.floor((s % 3600) / 60)).padStart(2, '0');
};
const mediana = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const titulo = (s) => String(s).trim();

// Grupo de calendario de cada service_id: lunes-viernes / sábado / domingo.
const GRUPOS = [['LV', 'Lunes a viernes'], ['SA', 'Sábados'], ['DO', 'Domingos']];
const gruposDelServicio = (svc) => {
  const [dom, lun, mar, mie, jue, vie, sab] = index.services[svc] || [];
  const g = [];
  if (lun || mar || mie || jue || vie) g.push('LV');
  if (sab) g.push('SA');
  if (dom) g.push('DO');
  return g;
};

/** Resumen de un sentido (secuencia): salidas desde la cabecera por grupo de días. */
function resumenSentido(route, seqI) {
  const porGrupo = { LV: new Set(), SA: new Set(), DO: new Set() };
  for (const pat of route.patterns) {
    if (pat.seq !== seqI) continue;
    for (const [svc, starts] of Object.entries(pat.starts)) {
      for (const g of gruposDelServicio(svc)) for (const t of starts) porGrupo[g].add(t);
    }
  }
  return GRUPOS.map(([g, nombre]) => {
    const l = [...porGrupo[g]].sort((a, b) => a - b);
    if (!l.length) return { nombre, n: 0 };
    const dif = l.slice(1).map((v, i) => Math.round((v - l[i]) / 60)).filter((m) => m > 0);
    return { nombre, n: l.length, primero: hhmm(l[0]), ultimo: hhmm(l.at(-1)), cada: dif.length ? mediana(dif) : null };
  });
}

/* ------------------------------------------------------------------ plantilla */

const CSS = `
:root{--bg:#f6f5f2;--fg:#1b1b1f;--mut:#5f6068;--card:#fff;--bd:#e3e1db;--ac:#d92b2b;--acfg:#fff}
@media(prefers-color-scheme:dark){:root{--bg:#141419;--fg:#ecebe8;--mut:#a3a3ab;--card:#1d1d24;--bd:#2c2c36;--ac:#ff5a5a;--acfg:#141419}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:inherit}.w{max-width:760px;margin:0 auto;padding:20px 16px 48px}
header.top{display:flex;align-items:center;gap:10px;margin-bottom:18px}header.top img{width:32px;height:32px;border-radius:8px}
header.top a{font-weight:700;text-decoration:none}
nav.bc{font-size:14px;color:var(--mut);margin-bottom:8px}nav.bc a{color:var(--mut)}
h1{font-size:1.6rem;line-height:1.25;margin:.2em 0 .4em}h2{font-size:1.15rem;margin:1.6em 0 .6em}
.lead{color:var(--mut);margin:0 0 16px}
.cta{display:inline-block;background:var(--ac);color:var(--acfg);padding:11px 18px;border-radius:10px;font-weight:700;text-decoration:none}
.card{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:6px 14px;margin:10px 0}
table{width:100%;border-collapse:collapse;font-size:15px}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--bd)}
tr:last-child td{border-bottom:0}th{color:var(--mut);font-weight:600}
ol.stops{padding-left:1.4em;margin:8px 0;columns:2;column-gap:28px}ol.stops li{break-inside:avoid;padding:1px 0}
@media(max-width:560px){ol.stops{columns:1}}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;list-style:none;padding:0;margin:12px 0}
.grid a{display:block;background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:10px 12px;text-decoration:none}
.grid b{display:block;font-size:1.1rem}.grid span{display:block;color:var(--mut);font-size:13px;line-height:1.3}
.note{font-size:13px;color:var(--mut);margin-top:28px}footer{margin-top:36px;font-size:14px;color:var(--mut)}`;

function pagina({ ruta, titulo: t, descripcion, cuerpo, jsonld }) {
  const url = `${SITIO}${ruta}`;
  return `<!DOCTYPE html>
<html lang="es-AR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t)}</title>
<meta name="description" content="${esc(descripcion)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta property="og:type" content="website">
<meta property="og:site_name" content="ZondaMov">
<meta property="og:locale" content="es_AR">
<meta property="og:title" content="${esc(t)}">
<meta property="og:description" content="${esc(descripcion)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${ICONO}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/png" href="/Icons/manifest-icon-192.maskable.png">
<link rel="apple-touch-icon" href="/Icons/apple-icon-180.png">
<link rel="manifest" href="/manifest.json">
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
<style>${CSS}</style>
</head>
<body>
<div class="w">
<header class="top"><img src="/Icons/manifest-icon-192.maskable.png" alt="" width="32" height="32"><a href="/">ZondaMov</a></header>
${cuerpo}
<footer>ZondaMov · Transporte público de San Juan · <a href="/">Abrir la app</a> · <a href="/lineas/">Todas las líneas</a></footer>
</div>
</body>
</html>
`;
}

/* ---------------------------------------------------------- páginas de línea */

const rutas = [...index.routes].sort((a, b) => natural(a.linea, b.linea));
const usados = new Map();
for (const r of rutas) {
  let slug = slugDe(r.linea) || r.id;
  if (usados.has(slug)) slug = `${slug}-${r.id}`;
  usados.set(slug, r);
  r.slug = slug;
}

fs.rmSync(path.join(RAIZ, 'linea'), { recursive: true, force: true });
let paginas = 0;

for (const r of rutas) {
  const sentidos = r.seqs
    .map((seq, i) => ({ seq, i, resumen: resumenSentido(r, i) }))
    .filter((s) => s.seq.length > 0)
    .sort((a, b) => b.seq.length - a.seq.length)
    .slice(0, 4);
  if (!sentidos.length) continue;

  const principal = sentidos[0];
  const origen = titulo(index.stops[principal.seq[0]]);
  const destino = titulo(index.stops[principal.seq.at(-1)]);
  const lv = principal.resumen[0];
  const hayServicio = principal.resumen.some((x) => x.n);

  const t = `Línea ${r.linea} San Juan: recorrido, paradas y horarios | ZondaMov`;
  let desc = `Línea ${r.linea} de colectivo en San Juan (${titulo(r.nombre)}): ${principal.seq.length} paradas`;
  if (lv.n) desc += `, de lunes a viernes sale de ${lv.primero} a ${lv.ultimo}`;
  desc += '. Horarios programados de RedTulum.';
  if (desc.length > 300) desc = desc.slice(0, 297) + '…';

  const bloques = sentidos.map((s, k) => {
    const o = titulo(index.stops[s.seq[0]]);
    const d = titulo(index.stops[s.seq.at(-1)]);
    const filas = s.resumen.map((x) => (x.n
      ? `<tr><td>${x.nombre}</td><td>${x.primero}</td><td>${x.ultimo}</td><td>${x.cada ? `cada ${x.cada} min (aprox.)` : 'salida única'}</td></tr>`
      : `<tr><td>${x.nombre}</td><td colspan="3">Sin servicio</td></tr>`)).join('');
    return `<h2>${sentidos.length > 1 ? `Recorrido ${k + 1}: ` : 'Recorrido: '}${esc(o)} → ${esc(d)}</h2>
<div class="card"><table>
<tr><th>Días</th><th>Primera salida</th><th>Última salida</th><th>Frecuencia</th></tr>
${filas}
</table></div>
<h2>Paradas (${s.seq.length})</h2>
<ol class="stops">${s.seq.map((p) => `<li>${esc(titulo(index.stops[p]))}</li>`).join('')}</ol>`;
  }).join('\n');

  const cuerpo = `<nav class="bc" aria-label="Migas de pan"><a href="/">ZondaMov</a> › <a href="/lineas/">Líneas</a> › Línea ${esc(r.linea)}</nav>
<h1>Línea ${esc(r.linea)} · ${esc(titulo(r.nombre))}</h1>
<p class="lead">${r.agencia ? `Operada por ${esc(r.agencia)}. ` : ''}${hayServicio
    ? `Recorre ${principal.seq.length} paradas entre ${esc(origen)} y ${esc(destino)}.`
    : 'Esta línea no tiene servicios programados en el índice actual.'}</p>
<p>${refsMapa.has(claveLinea(r.linea))
    ? `<a class="cta" href="/?linea=${encodeURIComponent(refsMapa.get(claveLinea(r.linea)))}">Ver la línea ${esc(r.linea)} en el mapa</a>`
    : '<a class="cta" href="/">Abrir ZondaMov</a>'}</p>
${bloques}
<p class="note">Horarios programados y aproximados (no es tiempo real): se calculan a partir de las ventanas y
frecuencias publicadas, y no contemplan feriados ni desvíos. Fuente: RedTulum. Datos actualizados al ${generado}.
Para ver la próxima llegada a una parada concreta, abrí la <a href="/">app</a>.</p>`;

  const ruta = `/linea/${r.slug}/`;
  const jsonld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage', '@id': `${SITIO}${ruta}#pagina`, url: `${SITIO}${ruta}`, name: t, description: desc,
        inLanguage: 'es-AR', isPartOf: { '@id': `${SITIO}/#sitio` }, dateModified: generado,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'ZondaMov', item: `${SITIO}/` },
          { '@type': 'ListItem', position: 2, name: 'Líneas', item: `${SITIO}/lineas/` },
          { '@type': 'ListItem', position: 3, name: `Línea ${r.linea}`, item: `${SITIO}${ruta}` },
        ],
      },
    ],
  };

  const dir = path.join(RAIZ, 'linea', r.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), pagina({ ruta, titulo: t, descripcion: desc, cuerpo, jsonld }));
  r.pagina = true;
  paginas++;
}

/* ------------------------------------------------------------- listado (hub) */

const conPagina = rutas.filter((r) => r.pagina);
{
  const t = 'Líneas de colectivo de San Juan (RedTulum): recorridos y horarios | ZondaMov';
  const desc = `Listado de las ${conPagina.length} líneas de colectivo de la red RedTulum en San Juan, Argentina, con su recorrido, paradas y horarios programados.`;
  const cuerpo = `<nav class="bc" aria-label="Migas de pan"><a href="/">ZondaMov</a> › Líneas</nav>
<h1>Líneas de colectivo de San Juan</h1>
<p class="lead">${conPagina.length} líneas de la red RedTulum. Elegí una para ver su recorrido, sus paradas y sus horarios programados.</p>
<p><a class="cta" href="/">Abrir el mapa</a></p>
<ul class="grid">
${conPagina.map((r) => `<li><a href="/linea/${r.slug}/"><b>${esc(r.linea)}</b><span>${esc(titulo(r.nombre))}</span></a></li>`).join('\n')}
</ul>
<p class="note">Horarios programados y aproximados (no es tiempo real). Fuente: RedTulum. Datos al ${generado}.</p>`;
  const jsonld = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'CollectionPage', '@id': `${SITIO}/lineas/#pagina`, url: `${SITIO}/lineas/`, name: t, description: desc, inLanguage: 'es-AR', isPartOf: { '@id': `${SITIO}/#sitio` } },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'ZondaMov', item: `${SITIO}/` },
        { '@type': 'ListItem', position: 2, name: 'Líneas', item: `${SITIO}/lineas/` },
      ] },
    ],
  };
  fs.mkdirSync(path.join(RAIZ, 'lineas'), { recursive: true });
  fs.writeFileSync(path.join(RAIZ, 'lineas', 'index.html'), pagina({ ruta: '/lineas/', titulo: t, descripcion: desc, cuerpo, jsonld }));
}

/* --------------------------------------------------------------- sitemap.xml */

const urls = [
  { loc: `${SITIO}/`, prio: '1.0' },
  { loc: `${SITIO}/lineas/`, prio: '0.8' },
  ...conPagina.map((r) => ({ loc: `${SITIO}/linea/${r.slug}/`, prio: '0.6' })),
];
fs.writeFileSync(path.join(RAIZ, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${hoy}</lastmod><priority>${u.prio}</priority></url>`).join('\n') +
  `\n</urlset>\n`);

console.log(`[seo] ${paginas} páginas de línea, 1 listado, sitemap con ${urls.length} URLs (datos al ${generado}, lastmod ${hoy})`);
const enMapa = conPagina.filter((r) => refsMapa.has(claveLinea(r.linea))).length;
console.log(`[seo] ${enMapa} de ${conPagina.length} páginas enlazan al mapa con /?linea=`);
const sin = rutas.filter((r) => !r.pagina).map((r) => r.linea);
if (sin.length) console.warn(`[seo] AVISO: ${sin.length} líneas sin página (sin paradas): ${sin.join(', ')}`);
