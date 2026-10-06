/**
 * Verifica que un índice formato 3 (build-colectivossj.mjs) responda lo mismo que los JSON de
 * colectivossj de los que salió: compara el motor contra una implementación "fuerza bruta"
 * que lee schedules.json/topology.json directamente (sin deltas ni índices por parada).
 * Se espera 0 diferencias.
 *
 *   node scripts/redtulum/verificar-colectivossj.mjs [carpeta-src] [index.json]
 *   N=10000 node scripts/redtulum/verificar-colectivossj.mjs     (consultas al azar)
 *
 * Mismos parámetros por defecto y mismo --corte-madrugada que el build (240 min).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine } from '../../Datos/redtulum/engine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(HERE, '..', '..');
const SRC = path.resolve(process.argv[2] || path.join(RAIZ, 'Datos', 'colectivossj_src'));
const INDEX = path.resolve(process.argv[3] || path.join(RAIZ, 'Datos', 'redtulum', 'index.colectivossj.json'));
const N = Number(process.env.N) || 3000;
const CORTE = Number(process.env.CORTE_MADRUGADA) || 240;

const leer = (f) => JSON.parse(fs.readFileSync(path.join(SRC, `${f}.json`), 'utf8'));
const topology = leer('topology');
const schedules = leer('schedules');
const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
const E = createEngine(index);

const normLine = (s) => String(s).replace(/[-\s]/g, '').toUpperCase();
const hhmm = (t) => {
  const s = ((t % 86400) + 86400) % 86400;
  return String(Math.floor(s / 3600)).padStart(2, '0') + ':' + String(Math.floor((s % 3600) / 60)).padStart(2, '0');
};

/* ------------------------------------------------------------ referencia */

const servicesDeLinea = new Map(); // normLine -> Set(id de servicio)
for (const sv of Object.values(topology.services)) {
  const k = normLine(sv.code);
  if (!servicesDeLinea.has(k)) servicesDeLinea.set(k, new Set());
  servicesDeLinea.get(k).add(String(sv.id));
}
const BUCKET = ['sunday', 'weekday', 'weekday', 'weekday', 'weekday', 'weekday', 'saturday']; // por getUTCDay()
const cal = index.services.LV; // inicio/fin, iguales para LV, SA y DO

function refNext(linea, stopId, base, n) {
  const svcs = servicesDeLinea.get(normLine(linea));
  const out = [];
  for (const off of [-1, 0, 1]) {
    const dt = new Date(Date.UTC(base.y, base.mo - 1, base.d + off));
    const num = dt.getUTCFullYear() * 10000 + (dt.getUTCMonth() + 1) * 100 + dt.getUTCDate();
    if (num < cal[7] || num > cal[8]) continue;
    const porSvc = schedules[BUCKET[dt.getUTCDay()]]?.[stopId] || {};
    const nowIn = base.secs - off * 86400;
    const mins = new Set();
    for (const [sid, lista] of Object.entries(porSvc)) {
      if (!svcs.has(sid)) continue;
      for (const m of lista) mins.add(m < CORTE ? m + 1440 : m);
    }
    for (const m of mins) {
      const t = m * 60;
      if (t >= nowIn) out.push({ wait: t - nowIn, t, off });
    }
  }
  out.sort((a, b) => a.wait - b.wait);
  return out.slice(0, n).map((f) => ({
    hora: hhmm(f.t), en_min: Math.round(f.wait / 60), dia: f.t + f.off * 86400 < 86400 ? 'hoy' : 'mañana',
  }));
}

/* ------------------------------------------------------------- pruebas */

const rnd = (k) => Math.floor(Math.random() * k);
function randomBase() {
  const desde = new Date(Date.UTC(+String(cal[7]).slice(0, 4), +String(cal[7]).slice(4, 6) - 1, +String(cal[7]).slice(6)));
  const dt = new Date(desde.getTime() + rnd(61) * 86400000);
  const roll = Math.random();
  const secs = roll < 0.5 ? rnd(86400) : roll < 0.75 ? 23 * 3600 + rnd(3600) : rnd(2 * 3600);
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate(), secs };
}

let checked = 0;
let bad = 0;
let conHorario = 0;
const conSeq = index.routes.filter((r) => r.seqs.length);
for (let i = 0; i < N; i++) {
  const r = conSeq[rnd(conSeq.length)];
  const seq = r.seqs[rnd(r.seqs.length)];
  const s = seq[rnd(seq.length)];
  const base = randomBase();
  const n = 1 + rnd(8);
  const got = E.nextArrivals(E.findRoute(r.linea), s, base, n);
  const want = refNext(r.linea, index.stopIds[s], base, n);
  checked++;
  if (want.length) conHorario++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    if (bad++ < 3) console.error('DIFERENCIA', r.linea, index.stopIds[s], base, n, '\n  got ', got, '\n  want', want);
  }
}

console.log(`[test] ${checked} consultas (${conHorario} con resultados), diferencias: ${bad}`);
process.exit(bad ? 1 : 0);
