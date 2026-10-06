#!/usr/bin/env node
/**
 * Convierte la red publicada por colectivossj.com.ar (topology / stops / schedules .json)
 * en un índice de horarios de RedTulum, formato 3.
 *
 *   node scripts/redtulum/build-colectivossj.mjs [--descargar] [--src carpeta] [--out index.json]
 *                                                [--gtfs-previo carpeta] [--dias-vigencia 60]
 *                                                [--corte-madrugada 240]
 *
 * Diferencia con build-index.mjs (formato 2): el GTFS trae viajes completos y el índice los
 * comprime en patrones (salida + desfases). Acá NO hay viajes: schedules.json trae, por parada y
 * por servicio, la lista de horas de paso. Se guardan tal cual en `route.times`:
 *
 *   times[paradaIdx][calendario] = [primera, +delta, +delta, ...]
 *
 * en minutos desde las 00:00 del día de servicio, ascendentes y codificados como deltas (el
 * motor los decodifica al primer uso; así el gzip baja de ~870 KB a ~330 KB). calendario es
 * LV / SA / DO (ver `services`). Los servicios de una misma línea que pasan por la misma
 * parada (ida/vuelta, ramales) se unen en una sola lista.
 *
 * Las horas de schedules.json vienen en módulo 1440: un viaje de las 00:32 de un día de servicio
 * aparece como 32 y queda ordenado al principio. Los valores menores a --corte-madrugada
 * (04:00 por defecto; en los datos no hay ninguna salida entre 02:00 y 04:59) se llevan a
 * 24:xx para que el motor los trate como parte del día de servicio anterior.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCSV } from './csv.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(HERE, '..', '..');
const CDN = 'https://cdn.colectivossj.com.ar/network';
const ARCHIVOS = ['topology', 'stops', 'schedules'];

/* ------------------------------------------------------------- argumentos */

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, def) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const SRC = path.resolve(opt('src', path.join(RAIZ, 'Datos', 'colectivossj_src')));
const OUT = path.resolve(opt('out', path.join(RAIZ, 'Datos', 'redtulum', 'index.colectivossj.json')));
const GTFS_PREVIO = path.resolve(opt('gtfs-previo', path.join(RAIZ, 'Datos', 'redtulum_gtfs_aproximado_v2')));
const DIAS_VIGENCIA = Number(opt('dias-vigencia', 60));
const CORTE_MADRUGADA = Number(opt('corte-madrugada', 240));

const normLine = (s) => String(s).replace(/[-\s]/g, '').toUpperCase();
const natural = (a, b) => a.localeCompare(b, 'es', { numeric: true });
const ymd = (d) => d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();

/* ------------------------------------------------------------ descarga */

async function descargar() {
  fs.mkdirSync(SRC, { recursive: true });
  const version = await (await fetch(`${CDN}/version.json`)).json();
  console.log(`[build] descargando red ${version.version} (${version.updated_at})`);
  for (const f of ARCHIVOS) {
    const url = version[`${f}_url`] || `${CDN}/${f}.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    fs.writeFileSync(path.join(SRC, `${f}.json`), Buffer.from(await res.arrayBuffer()));
  }
}

const leer = (f) => JSON.parse(fs.readFileSync(path.join(SRC, `${f}.json`), 'utf8'));

/* ----------------------------------------------------------------- main */

async function main() {
  if (flag('descargar')) await descargar();
  for (const f of ARCHIVOS) {
    if (!fs.existsSync(path.join(SRC, `${f}.json`))) {
      console.error(`[build] falta ${path.join(SRC, f + '.json')} (usá --descargar)`);
      process.exit(1);
    }
  }
  const t0 = Date.now();
  const warnings = [];

  const topology = leer('topology');
  const stops = leer('stops');
  const schedules = leer('schedules');

  // --- paradas -------------------------------------------------------------
  const stopIds = [];
  const stopNames = [];
  const coords = [];
  const stopIdx = new Map();
  for (const s of stops) {
    stopIdx.set(String(s.stop_id), stopIds.length);
    stopIds.push(String(s.stop_id));
    stopNames.push(String(s.stop_name).trim());
    coords.push([Math.round(s.stop_lat * 1e5) / 1e5, Math.round(s.stop_lon * 1e5) / 1e5]);
  }

  // --- nombre/agencia de las líneas: el topology no los trae, el GTFS anterior sí ----------
  const previo = new Map();
  if (fs.existsSync(path.join(GTFS_PREVIO, 'routes.txt'))) {
    const ag = readCSV(GTFS_PREVIO, 'agency');
    const agencias = new Map(ag.rows.map((r) => [r[ag.idx.agency_id], r[ag.idx.agency_name]]));
    const rt = readCSV(GTFS_PREVIO, 'routes');
    for (const r of rt.rows) {
      previo.set(normLine(r[rt.idx.route_short_name]), {
        nombre: r[rt.idx.route_long_name],
        agencia: agencias.get(r[rt.idx.agency_id]) || null,
      });
    }
  }

  // --- líneas: un registro por código, uniendo todos sus servicios de topology ---------------
  const routes = new Map(); // normLine -> route
  const routeOfService = new Map(); // id de servicio -> route
  for (const sv of Object.values(topology.services)) {
    const key = normLine(sv.code);
    let route = routes.get(key);
    if (!route) {
      const p = previo.get(key);
      route = {
        id: String(sv.code).trim(),
        linea: String(sv.code).trim(),
        nombre: p?.nombre || String(sv.name).trim(),
        agencia: p?.agencia ?? null,
        seqs: [],
        times: {},
        _seqKeys: new Set(),
      };
      routes.set(key, route);
    }
    routeOfService.set(String(sv.id), route);

    const seq = [];
    for (const s of sv.stops) {
      const i = stopIdx.get(String(s.id));
      if (i === undefined) { warnings.push(`topology referencia la parada ${s.id}, que no está en stops.json`); continue; }
      seq.push(i);
    }
    const k = seq.join(',');
    if (seq.length && !route._seqKeys.has(k)) { route._seqKeys.add(k); route.seqs.push(seq); }
  }

  // --- horarios ------------------------------------------------------------------------------
  const DIAS = { weekday: 'LV', saturday: 'SA', sunday: 'DO' };
  const acum = new Map(); // route -> Map(stopIdx -> { LV:Set, SA:Set, DO:Set })
  let madrugada = 0;
  const servSinLinea = new Set();
  const paradaFueraDeSecuencia = new Set();
  const paradasSinCoord = new Set();

  for (const [dia, cal] of Object.entries(DIAS)) {
    for (const [stopId, porServicio] of Object.entries(schedules[dia] || {})) {
      const si = stopIdx.get(stopId);
      if (si === undefined) { paradasSinCoord.add(stopId); continue; }
      for (const [svcId, minutos] of Object.entries(porServicio)) {
        const route = routeOfService.get(svcId);
        if (!route) { servSinLinea.add(svcId); continue; }
        if (!route.seqs.some((q) => q.includes(si))) paradaFueraDeSecuencia.add(`${route.linea}:${stopId}`);

        let porParada = acum.get(route);
        if (!porParada) acum.set(route, (porParada = new Map()));
        let porCal = porParada.get(si);
        if (!porCal) porParada.set(si, (porCal = {}));
        const set = (porCal[cal] ||= new Set());
        for (const m of minutos) {
          if (m < CORTE_MADRUGADA) { set.add(m + 1440); madrugada++; } else set.add(m);
        }
      }
    }
  }

  let salidas = 0;
  for (const [route, porParada] of acum) {
    for (const [si, porCal] of porParada) {
      const o = {};
      for (const cal of ['LV', 'SA', 'DO']) {
        if (!porCal[cal]) continue;
        const l = [...porCal[cal]].sort((a, b) => a - b);
        salidas += l.length;
        o[cal] = l.map((v, i) => (i ? v - l[i - 1] : v));
      }
      route.times[si] = o;
    }
  }

  if (paradasSinCoord.size) warnings.push(`${paradasSinCoord.size} paradas de schedules.json no están en stops.json (sin nombre ni coordenadas) y se descartaron`);
  if (servSinLinea.size) warnings.push(`${servSinLinea.size} servicios de schedules.json no están en topology.json y se descartaron (sin línea asignable)`);
  if (paradaFueraDeSecuencia.size) warnings.push(`${paradaFueraDeSecuencia.size} pares línea:parada con horario pero fuera de las secuencias de la línea (el motor no los consulta)`);

  const rutas = [...routes.values()].sort((a, b) => natural(a.linea, b.linea));
  const sinHorarios = rutas.filter((r) => Object.keys(r.times).length === 0).map((r) => r.linea);
  if (sinHorarios.length) warnings.push(`${sinHorarios.length} líneas sin ningún horario: ${sinHorarios.join(', ')}`);

  // --- calendario: [dom, lun, mar, mié, jue, vie, sáb, inicio, fin] -----------------------------
  const hoy = new Date(Date.now() - 3 * 3600 * 1000); // San Juan, UTC-3
  const desde = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate()));
  const hasta = new Date(desde.getTime() + DIAS_VIGENCIA * 86400000);
  const services = {
    LV: [0, 1, 1, 1, 1, 1, 0, ymd(desde), ymd(hasta)],
    SA: [0, 0, 0, 0, 0, 0, 1, ymd(desde), ymd(hasta)],
    DO: [1, 0, 0, 0, 0, 0, 0, ymd(desde), ymd(hasta)],
  };

  const index = {
    meta: {
      formato: 3,
      generado: new Date().toISOString(),
      tz: 'America/Argentina/San_Juan',
      feed: {
        publicador: `colectivossj.com.ar (${schedules.source || 'sin fuente'})`,
        version: `${schedules.version}${schedules.updated_at ? ' @' + schedules.updated_at : ''}`,
      },
      aviso:
        'Horarios PROGRAMADOS (no es tiempo real). Tomados de una copia de la red publicada por ' +
        'colectivossj.com.ar; no contemplan feriados ni desvíos.',
      conteo: { lineas: rutas.length, paradas: stopIds.length, salidas },
    },
    stopIds,
    stops: stopNames,
    coords,
    services,
    routes: rutas.map(({ id, linea, nombre, agencia, seqs, times }) => ({ id, linea, nombre, agencia, seqs, times })),
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const json = JSON.stringify(index);
  fs.writeFileSync(OUT, json);

  console.log(`[build] ${rutas.length} líneas, ${stopIds.length} paradas, ${salidas} salidas (LV+SA+DO)`);
  console.log(`[build] ${madrugada} horas de madrugada llevadas a 24:xx (corte ${CORTE_MADRUGADA / 60}h)`);
  console.log(`[build] vigencia ${ymd(desde)} -> ${ymd(hasta)}`);
  console.log(`[build] ${OUT}  ${(Buffer.byteLength(json) / 1024).toFixed(0)} KB  (${Date.now() - t0} ms)`);
  for (const w of warnings) console.warn('[build] AVISO:', w);
}

main().catch((e) => { console.error(e); process.exit(1); });
