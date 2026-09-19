/**
 * Verifica que Datos/redtulum/index.json responda exactamente lo mismo que el GTFS del
 * que salió: compara el motor compacto contra una implementación "fuerza bruta" que lee
 * stop_times.txt fila por fila. Se espera 0 diferencias.
 *
 *   node scripts/redtulum/verificar-index.mjs [carpeta-gtfs] [index.json]
 *   N=10000 node scripts/redtulum/verificar-index.mjs     (cantidad de consultas al azar)
 *
 * Correr siempre después de regenerar el índice. Ver Datos/redtulum/ACTUALIZAR.md.
 *
 * Viene del paquete redtulum-local (test/regression.mjs); lo único que se cambió son
 * las rutas, para que apunten a la disposición de este repo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCSV } from './csv.mjs';
import { createEngine } from '../../Datos/redtulum/engine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(HERE, '..', '..');
const SRC = path.resolve(process.argv[2] || path.join(RAIZ, 'Datos', 'redtulum_gtfs_aproximado_v2'));
const INDEX = path.resolve(process.argv[3] || path.join(RAIZ, 'Datos', 'redtulum', 'index.json'));
const N = Number(process.env.N) || 3000;

for (const requerido of [path.join(SRC, 'stop_times.txt'), INDEX]) {
  if (!fs.existsSync(requerido)) {
    console.error(`[verificar] falta ${requerido}`);
    process.exit(1);
  }
}

/* ------------------------------------------------------- referencia (bruta) */

const toSecs = (s) => { const [h, m, x] = s.split(':').map(Number); return h * 3600 + m * 60 + (x || 0); };
const hhmm = (t) => {
  const s = ((t % 86400) + 86400) % 86400;
  return String(Math.floor(s / 3600)).padStart(2, '0') + ':' + String(Math.floor((s % 3600) / 60)).padStart(2, '0');
};

const routes = readCSV(SRC, 'routes');
const routeShort = new Map(routes.rows.map((r) => [r[routes.idx.route_id], r[routes.idx.route_short_name]]));
const trips = readCSV(SRC, 'trips');
const tripInfo = new Map(trips.rows.map((r) => [r[trips.idx.trip_id], { route: r[trips.idx.route_id], svc: r[trips.idx.service_id] }]));
const cal = readCSV(SRC, 'calendar');
const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const calendar = new Map(cal.rows.map((r) => [r[cal.idx.service_id], {
  dias: days.map((d) => r[cal.idx[d]] === '1'),
  start: +r[cal.idx.start_date], end: +r[cal.idx.end_date],
}]));

const ref = new Map(); // "stopId|routeId" -> [{t, svc}]
{
  const st = readCSV(SRC, 'stop_times');
  for (const r of st.rows) {
    const info = tripInfo.get(r[st.idx.trip_id]);
    const key = r[st.idx.stop_id] + '|' + info.route;
    let l = ref.get(key);
    if (!l) ref.set(key, (l = []));
    l.push({ t: toSecs(r[st.idx.arrival_time]), svc: info.svc });
  }
}

function refNext(routeId, stopId, base, n) {
  const list = ref.get(stopId + '|' + routeId) || [];
  const out = [];
  for (const off of [-1, 0, 1]) {
    const dt = new Date(Date.UTC(base.y, base.mo - 1, base.d + off));
    const num = dt.getUTCFullYear() * 10000 + (dt.getUTCMonth() + 1) * 100 + dt.getUTCDate();
    const dow = dt.getUTCDay();
    const nowIn = base.secs - off * 86400;
    for (const a of list) {
      const c = calendar.get(a.svc);
      if (!c || !c.dias[dow] || num < c.start || num > c.end) continue;
      if (a.t < nowIn) continue;
      out.push({ wait: a.t - nowIn, t: a.t, off });
    }
  }
  out.sort((a, b) => a.wait - b.wait);
  return out.slice(0, n).map((f) => ({
    hora: hhmm(f.t), en_min: Math.round(f.wait / 60), dia: f.t + f.off * 86400 < 86400 ? 'hoy' : 'mañana',
  }));
}

/* ------------------------------------------------------------ pruebas */

const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
const E = createEngine(index);
const routeIdByLine = new Map(index.routes.map((r) => [r.linea, r.id]));

const rnd = (n) => Math.floor(Math.random() * n);
function randomBase() {
  const dt = new Date(Date.UTC(2026, 0, 1 + rnd(365)));
  const roll = Math.random();
  const secs = roll < 0.5 ? rnd(86400) : roll < 0.75 ? 23 * 3600 + rnd(3600) : rnd(2 * 3600);
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate(), secs };
}

// Pares (línea, parada): todos los repetidos dentro de una secuencia + muestreo aleatorio.
const pairs = [];
const loops = [];
for (const r of index.routes) {
  for (const seq of r.seqs) {
    const seen = new Set();
    for (const s of seq) { if (seen.has(s)) loops.push([r, s]); seen.add(s); }
  }
}
for (let i = 0; i < N; i++) {
  const r = index.routes[rnd(index.routes.length)];
  if (!r.seqs.length) continue;
  const seq = r.seqs[rnd(r.seqs.length)];
  pairs.push([r, seq[rnd(seq.length)]]);
}

let checked = 0;
let bad = 0;
function check(r, stopIdx, base, n) {
  const route = E.findRoute(r.linea);
  const got = E.nextArrivals(route, stopIdx, base, n);
  const want = refNext(routeIdByLine.get(r.linea), index.stopIds[stopIdx], base, n);
  checked++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    if (bad++ < 3) console.error('DIFERENCIA', r.linea, index.stopIds[stopIdx], base, n, '\n  got ', got, '\n  want', want);
  }
}

for (const [r, s] of pairs) check(r, s, randomBase(), 1 + rnd(8));
for (const [r, s] of loops) for (let k = 0; k < 20; k++) check(r, s, randomBase(), 1 + rnd(8));

console.log(`[test] ${checked} consultas (${loops.length} paradas repetidas en línea incluidas), diferencias: ${bad}`);
process.exit(bad ? 1 : 0);
