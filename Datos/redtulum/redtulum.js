/**
 * API local de horarios PROGRAMADOS de RedTulum (San Juan, Argentina).
 *
 * Cada función devuelve el mismo JSON que devolvía el endpoint HTTP equivalente. Ante un error
 * devuelve { error, codigo } (codigo = 400 / 404 / 409, con el mismo significado que en HTTP);
 * no lanza excepciones por entradas inválidas.
 *
 *   import { loadRedTulum } from './redtulum/redtulum.js';
 *   const rt = await loadRedTulum({ indexUrl: '/redtulum/index.json' });
 *   rt.llegadas({ linea: '100', parada: 'ST0001' });
 */
import { createEngine } from './engine.js';

const AVISO =
  'Horarios PROGRAMADOS y aproximados (no es tiempo real). Estimados a partir de frecuencias ' +
  'publicadas; no contemplan feriados ni desvíos.';

const clampInt = (v, def, min, max) => Math.min(Math.max(parseInt(v, 10) || def, min), max);
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const fail = (codigo, error, extra) => ({ error, codigo, ...extra });

export function createRedTulum(index, options = {}) {
  const E = createEngine(index, options);

  /** Resuelve la parada: id exacto (ST0001) o texto. Devuelve { idx } o { fallo }. */
  function resolveStop(param, route) {
    const byId = E.findStop(param);
    if (byId !== undefined) return { idx: byId };
    const matches = E.searchStops(param, route, 10);
    if (matches.length === 0) {
      const donde = route ? ` de la línea ${route.linea}` : '';
      return { fallo: fail(404, `No hay paradas${donde} que coincidan con "${param}"`) };
    }
    if (matches.length > 1) {
      return { fallo: fail(409, 'Parada ambigua, indicá el id', { candidatas: matches }) };
    }
    return { idx: E.findStop(matches[0].id) };
  }

  /** `ahora` (solo pruebas): "YYYY-MM-DDTHH:MM" en hora local. En uso normal se omite. */
  function base(ahora) {
    return E.nowLocal(ahora || undefined);
  }

  return {
    /** Estado del índice cargado. */
    health() {
      return { ok: true, ...E.counts, feed: E.meta.feed, indice_generado: E.meta.generado };
    },

    /** Todas las líneas. Dato estático. */
    lineas() {
      return E.routes.map((r) => ({ linea: r.linea, nombre: r.nombre, agencia: r.agencia }));
    },

    /** Paradas de una línea, en orden. */
    paradasDeLinea({ linea } = {}) {
      const route = E.findRoute(str(linea));
      if (!route) return fail(404, 'Línea no encontrada');
      const { paradas, variantes } = E.routeStops(route);
      return { linea: route.linea, nombre: route.nombre, paradas, ...(variantes && { variantes }) };
    },

    /** Busca paradas por texto (sin distinguir mayúsculas ni tildes), opcionalmente dentro de una línea. */
    buscarParadas({ q, linea } = {}) {
      const text = str(q);
      if (!text) return fail(400, 'Falta el parámetro q');
      if (text.length > 100) return fail(400, 'q demasiado largo (máx. 100)');
      let route;
      if (str(linea)) {
        route = E.findRoute(str(linea));
        if (!route) return fail(404, 'Línea no encontrada');
      }
      return E.searchStops(text, route, 25);
    },

    /** Una parada y las líneas que pasan por ella. */
    parada({ id } = {}) {
      const idx = E.findStop(str(id));
      if (idx === undefined) return fail(404, 'Parada no encontrada');
      return { ...E.stopInfo(idx), lineas: (E.stopRoutes.get(idx) || []).map((r) => ({ linea: r.linea, nombre: r.nombre })) };
    },

    /** Próximas pasadas de TODAS las líneas por una parada (n = horarios por línea). */
    paradasLlegadas({ id, n, ahora } = {}) {
      const idx = E.findStop(str(id));
      if (idx === undefined) return fail(404, 'Parada no encontrada');
      const b = base(ahora);
      if (!b) return fail(400, 'Formato de "ahora" inválido, usá YYYY-MM-DDTHH:MM');
      const per = clampInt(n, 2, 1, 10);

      const lineas = (E.stopRoutes.get(idx) || [])
        .map((r) => ({ linea: r.linea, nombre_linea: r.nombre, proximos: E.nextArrivals(r, idx, b, per) }))
        .filter((l) => l.proximos.length > 0)
        .sort((a, c) => a.proximos[0].en_min - c.proximos[0].en_min);

      return { parada: E.stopInfo(idx), consulta_local: E.fmtBase(b), lineas, aproximado: true, aviso: AVISO };
    },

    /** Próximas pasadas de UNA línea por una parada. `parada` = id (ST0001) o texto del nombre. */
    llegadas({ linea, parada, n, ahora } = {}) {
      const lineaS = str(linea);
      const paradaS = str(parada);
      if (!lineaS || !paradaS) return fail(400, 'Faltan parámetros: linea y parada');
      if (lineaS.length > 20 || paradaS.length > 100) return fail(400, 'Parámetro demasiado largo');

      const route = E.findRoute(lineaS);
      if (!route) return fail(404, `Línea "${lineaS}" no encontrada`);

      const r = resolveStop(paradaS, route);
      if (r.fallo) return r.fallo;

      if (!route.stopSet.has(r.idx)) {
        const s = E.stopInfo(r.idx);
        return fail(404, `La línea ${route.linea} no pasa por la parada ${s.id} (${s.nombre})`);
      }

      const b = base(ahora);
      if (!b) return fail(400, 'Formato de "ahora" inválido, usá YYYY-MM-DDTHH:MM');

      return {
        linea: route.linea,
        nombre_linea: route.nombre,
        parada: E.stopInfo(r.idx),
        consulta_local: E.fmtBase(b),
        proximos: E.nextArrivals(route, r.idx, b, clampInt(n, 5, 1, 20)),
        aproximado: true,
        aviso: AVISO,
      };
    },
  };
}

/**
 * Descarga el índice y arma la API. Llamala una sola vez y reutilizá el resultado.
 * @param {object} [o]
 * @param {string|URL} [o.indexUrl]  URL del index.json (por defecto, junto a este módulo)
 * @param {typeof fetch} [o.fetchImpl]
 * @param {string} [o.tz]            zona horaria (por defecto la del feed)
 */
export async function loadRedTulum({ indexUrl, fetchImpl, tz } = {}) {
  const url = indexUrl ?? new URL('./index.json', import.meta.url);
  const doFetch = fetchImpl ?? globalThis.fetch;
  const res = await doFetch(url);
  if (!res.ok) throw new Error(`No se pudo cargar el índice de RedTulum (HTTP ${res.status})`);
  return createRedTulum(await res.json(), { tz });
}
