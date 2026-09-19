#!/usr/bin/env node
/**
 * Compila un GTFS estático en un índice compacto (redtulum/index.json).
 *
 *   node tools/build-index.mjs [carpeta-gtfs=data-src] [salida=redtulum/index.json]
 *
 * Idea: en vez de guardar cada parada de cada viaje (425 mil filas), se guarda por línea:
 *   - seqs:      secuencias de paradas (normalmente 1 por línea; más si el feed trae variantes/sentidos)
 *   - patterns:  grupos de viajes que comparten secuencia Y desfases idénticos respecto de la
 *                salida. Cada patrón lleva los desfases (seg) y las horas de salida por servicio.
 * La compresión es sin pérdida: hora de paso = salida + desfase[posición de la parada].
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCSV } from './csv.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const SRC = path.resolve(process.argv[2] || path.join(HERE, '..', 'data-src'));
const OUT = path.resolve(process.argv[3] || path.join(HERE, '..', 'redtulum', 'index.json'));

const toSecs = (s) => {
  const [h, m, x] = s.split(':').map(Number);
  return h * 3600 + m * 60 + (x || 0);
};

function main() {
  const t0 = Date.now();
  const warnings = [];

  // --- agencias ---------------------------------------------------------
  const agencies = new Map();
  let tz = null;
  {
    const { idx, rows } = readCSV(SRC, 'agency');
    for (const r of rows) {
      const id = idx.agency_id !== undefined ? r[idx.agency_id] : '';
      agencies.set(id, r[idx.agency_name]);
      if (!tz && idx.agency_timezone !== undefined) tz = r[idx.agency_timezone];
    }
  }

  // --- paradas ----------------------------------------------------------
  const stopIds = [];
  const stopNames = [];
  const stopIdx = new Map();
  {
    const { idx, rows } = readCSV(SRC, 'stops');
    for (const r of rows) {
      stopIdx.set(r[idx.stop_id], stopIds.length);
      stopIds.push(r[idx.stop_id]);
      stopNames.push(r[idx.stop_name]);
    }
  }

  // --- calendario: [dom, lun, mar, mié, jue, vie, sáb, inicio, fin] ------
  const services = {};
  {
    const { idx, rows } = readCSV(SRC, 'calendar');
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    for (const r of rows) {
      services[r[idx.service_id]] = [
        ...days.map((d) => (r[idx[d]] === '1' ? 1 : 0)),
        Number(r[idx.start_date]),
        Number(r[idx.end_date]),
      ];
    }
  }

  // --- líneas -----------------------------------------------------------
  const routes = [];
  const routeById = new Map();
  {
    const { idx, rows } = readCSV(SRC, 'routes');
    for (const r of rows) {
      const aid = idx.agency_id !== undefined ? r[idx.agency_id] : '';
      const route = {
        id: r[idx.route_id],
        linea: r[idx.route_short_name] || r[idx.route_long_name],
        nombre: r[idx.route_long_name],
        agencia: agencies.get(aid) || null,
        _seqs: new Map(),   // seqKey -> índice en seqs
        _pats: new Map(),   // patKey -> patrón
        seqs: [],
        patterns: [],
      };
      routes.push(route);
      routeById.set(route.id, route);
    }
  }

  // --- viajes -----------------------------------------------------------
  const tripInfo = new Map();
  {
    const { idx, rows } = readCSV(SRC, 'trips');
    for (const r of rows) tripInfo.set(r[idx.trip_id], { routeId: r[idx.route_id], serviceId: r[idx.service_id] });
  }

  // --- stop_times agrupados por viaje -----------------------------------
  const perTrip = new Map();
  let blankTimes = 0;
  {
    const { idx, rows } = readCSV(SRC, 'stop_times');
    for (const r of rows) {
      const tid = r[idx.trip_id];
      const raw = r[idx.arrival_time] || r[idx.departure_time];
      const si = stopIdx.get(r[idx.stop_id]);
      if (si === undefined) throw new Error(`stop_times referencia una parada inexistente: ${r[idx.stop_id]}`);
      let list = perTrip.get(tid);
      if (!list) perTrip.set(tid, (list = []));
      list.push([Number(r[idx.stop_sequence]), si, raw ? toSecs(raw) : null]);
      if (!raw) blankTimes++;
    }
  }

  // --- armado de patrones -----------------------------------------------
  let skippedTrips = 0;
  let usedTrips = 0;
  for (const [tid, list] of perTrip) {
    const info = tripInfo.get(tid);
    const route = info && routeById.get(info.routeId);
    if (!route) { skippedTrips++; continue; }
    if (list.some((x) => x[2] === null)) { skippedTrips++; continue; } // horarios sin completar

    list.sort((a, b) => a[0] - b[0]);
    const start = list[0][2];
    const stops = list.map((x) => x[1]);
    const off = list.map((x) => x[2] - start);

    const seqKey = stops.join(',');
    let seqI = route._seqs.get(seqKey);
    if (seqI === undefined) {
      seqI = route.seqs.length;
      route.seqs.push(stops);
      route._seqs.set(seqKey, seqI);
    }

    const patKey = seqI + '|' + off.join(',');
    let pat = route._pats.get(patKey);
    if (!pat) {
      pat = { seq: seqI, off, starts: {} };
      route._pats.set(patKey, pat);
      route.patterns.push(pat);
    }
    (pat.starts[info.serviceId] ||= []).push(start);
    usedTrips++;
  }
  if (skippedTrips) warnings.push(`${skippedTrips} viajes omitidos (sin línea conocida o con horarios vacíos)`);

  for (const route of routes) {
    for (const pat of route.patterns) for (const k of Object.keys(pat.starts)) pat.starts[k].sort((a, b) => a - b);
    delete route._seqs;
    delete route._pats;
  }

  // --- feed_info (opcional) ---------------------------------------------
  let feed = null;
  try {
    const { idx, rows } = readCSV(SRC, 'feed_info');
    if (rows[0]) feed = { publicador: rows[0][idx.feed_publisher_name], version: rows[0][idx.feed_version] };
  } catch { /* archivo opcional */ }

  const patternCount = routes.reduce((n, r) => n + r.patterns.length, 0);
  const index = {
    meta: {
      formato: 2,
      generado: new Date().toISOString(),
      tz: tz || 'America/Argentina/San_Juan',
      feed,
      conteo: { lineas: routes.length, paradas: stopIds.length, viajes: usedTrips, patrones: patternCount },
    },
    stopIds,
    stops: stopNames,
    services,
    routes: routes.map((r) => ({ id: r.id, linea: r.linea, nombre: r.nombre, agencia: r.agencia, seqs: r.seqs, patterns: r.patterns })),
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const json = JSON.stringify(index);
  fs.writeFileSync(OUT, json);

  console.log(`[build] ${routes.length} líneas, ${stopIds.length} paradas, ${usedTrips} viajes -> ${patternCount} patrones`);
  console.log(`[build] ${OUT}  ${(Buffer.byteLength(json) / 1024).toFixed(0)} KB  (${Date.now() - t0} ms)`);
  if (blankTimes) warnings.push(`${blankTimes} filas de stop_times sin hora`);
  for (const w of warnings) console.warn('[build] AVISO:', w);
}

main();
