/**
 * Motor de consulta sobre el índice compacto (formato 2) generado por tools/build-index.mjs.
 *
 * Módulo ES sin dependencias ni APIs de Node: corre igual en el navegador, en Deno y en Node.
 * El arranque es liviano a propósito: lo costoso (formateador de zona horaria, normalización
 * de nombres) se difiere hasta el primer uso.
 */

/* ----------------------------------------------------------- utilidades */

// Normalización para búsqueda por nombre: sin mayúsculas ni tildes.
const ACCENTS = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', ñ: 'n' };
export const norm = (s) =>
  String(s).toLowerCase().replace(/[áéíóúüñ]/g, (c) => ACCENTS[c]).replace(/\s+/g, ' ').trim();

/** "440-A", "440 a" y "440A" son la misma línea. */
export const normLine = (s) => String(s).replace(/[-\s]/g, '').toUpperCase();

export const fmtHHMM = (secs) => {
  const s = ((secs % 86400) + 86400) % 86400;
  return String(Math.floor(s / 3600)).padStart(2, '0') + ':' + String(Math.floor((s % 3600) / 60)).padStart(2, '0');
};

/** Primer índice i tal que arr[i] >= x (arr ordenado ascendente). */
export function lowerBound(arr, x) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < x) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** Orden natural barato (sin Intl): 2 < 10 < 100, y los números antes que las letras. */
export function naturalCompare(a, b) {
  const pa = String(a).match(/\d+|\D+/g) || [];
  const pb = String(b).match(/\d+|\D+/g) || [];
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const x = pa[i];
    const y = pb[i];
    const nx = /^\d/.test(x);
    const ny = /^\d/.test(y);
    if (nx && ny) {
      const d = Number(x) - Number(y);
      if (d) return d;
    } else if (nx !== ny) return nx ? -1 : 1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return pa.length - pb.length;
}

/* -------------------------------------------------------------- motor */

export function createEngine(index, { tz: tzOverride } = {}) {
  if (!index || index.meta?.formato !== 2) throw new Error('Índice inválido o de un formato no soportado (se espera formato 2)');

  const tz = tzOverride || index.meta.tz || 'America/Argentina/San_Juan';
  const services = index.services;

  const stopIdToIdx = new Map(index.stopIds.map((id, i) => [id, i]));

  // Por línea: posiciones de cada parada dentro de cada secuencia (una parada puede repetirse).
  const routes = index.routes.map((r) => {
    const posBySeq = r.seqs.map((seq) => {
      const m = new Map();
      seq.forEach((stop, pos) => {
        const list = m.get(stop);
        if (list) list.push(pos); else m.set(stop, [pos]);
      });
      return m;
    });
    const stopSet = new Set();
    for (const m of posBySeq) for (const s of m.keys()) stopSet.add(s);
    let primary = 0;
    r.seqs.forEach((seq, i) => { if (seq.length > r.seqs[primary].length) primary = i; });
    return { ...r, posBySeq, stopSet, primary };
  });

  const routeByLine = new Map(routes.map((r) => [normLine(r.linea), r]));

  // Mapa inverso parada -> líneas. Se recorre en orden natural, así cada lista sale ya ordenada.
  const stopRoutes = new Map();
  for (const r of [...routes].sort((a, b) => naturalCompare(a.linea, b.linea))) {
    for (const s of r.stopSet) {
      const list = stopRoutes.get(s);
      if (list) list.push(r); else stopRoutes.set(s, [r]);
    }
  }

  /* --------------------------------------------- diferidos (primer uso) */

  let tzFormatter = null;
  let stopsNorm = null;

  /** Hora local del servicio. `override` = "YYYY-MM-DDTHH:MM[:SS]" (hora local) para pruebas. */
  function nowLocal(override) {
    if (override) {
      const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(override);
      if (!m) return null;
      return { y: +m[1], mo: +m[2], d: +m[3], secs: +m[4] * 3600 + +m[5] * 60 + (+m[6] || 0) };
    }
    tzFormatter ||= new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    const p = Object.fromEntries(tzFormatter.formatToParts(new Date()).map((x) => [x.type, x.value]));
    return { y: +p.year, mo: +p.month, d: +p.day, secs: +p.hour * 3600 + +p.minute * 60 + +p.second };
  }

  /* ------------------------------------------------------------ tiempo */

  /** Fecha calendario (yyyymmdd) y día de semana (0 = domingo) de base + offset días. */
  function dayInfo(base, offset) {
    const dt = new Date(Date.UTC(base.y, base.mo - 1, base.d + offset));
    return {
      num: dt.getUTCFullYear() * 10000 + (dt.getUTCMonth() + 1) * 100 + dt.getUTCDate(),
      dow: dt.getUTCDay(),
    };
  }

  function serviceActive(svcId, day) {
    const s = services[svcId];
    return !!s && s[day.dow] === 1 && day.num >= s[7] && day.num <= s[8];
  }

  const fmtBase = (base) =>
    `${base.y}-${String(base.mo).padStart(2, '0')}-${String(base.d).padStart(2, '0')} ${fmtHHMM(base.secs)}`;

  /* ---------------------------------------------------------- consultas */

  /**
   * Próximas `n` pasadas de `route` por la parada `stopIdx` desde `base`.
   * Se mira el día de servicio de ayer (viajes que cruzan la medianoche, ej. 25:10),
   * el de hoy y el de mañana (por si hoy ya no quedan salidas).
   */
  function nextArrivals(route, stopIdx, base, n) {
    const found = [];
    for (const off of [-1, 0, 1]) {
      const day = dayInfo(base, off);
      const nowInServiceDay = base.secs - off * 86400;
      for (const pat of route.patterns) {
        const positions = route.posBySeq[pat.seq].get(stopIdx);
        if (!positions) continue;
        for (const svc in pat.starts) {
          if (!serviceActive(svc, day)) continue;
          const starts = pat.starts[svc];
          for (const pos of positions) {
            const o = pat.off[pos];
            const first = lowerBound(starts, nowInServiceDay - o);
            const last = Math.min(starts.length, first + n);
            for (let k = first; k < last; k++) {
              const t = starts[k] + o;
              found.push({ wait: t - nowInServiceDay, t, off });
            }
          }
        }
      }
    }
    found.sort((a, b) => a.wait - b.wait);
    return found.slice(0, n).map((f) => ({
      hora: fmtHHMM(f.t),
      en_min: Math.round(f.wait / 60),
      dia: f.t + f.off * 86400 < 86400 ? 'hoy' : 'mañana',
    }));
  }

  const findRoute = (linea) => (linea ? routeByLine.get(normLine(linea)) : undefined);
  const findStop = (id) => stopIdToIdx.get(String(id).toUpperCase());
  const stopInfo = (i) => ({ id: index.stopIds[i], nombre: index.stops[i] });
  const linesAt = (i) => (stopRoutes.get(i) || []).map((r) => r.linea);

  function searchStops(text, route, limit) {
    stopsNorm ||= index.stops.map(norm);
    const nq = norm(text);
    const out = [];
    for (let i = 0; i < stopsNorm.length; i++) {
      if (!stopsNorm[i].includes(nq)) continue;
      if (route && !route.stopSet.has(i)) continue;
      out.push({ ...stopInfo(i), lineas: linesAt(i) });
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Paradas de una línea, en orden. Si el feed trae variantes, se devuelven aparte. */
  function routeStops(route) {
    const build = (seq) => seq.map((s, p) => ({ orden: p + 1, ...stopInfo(s) }));
    const variantes = route.seqs.length > 1
      ? route.seqs.map((seq, i) => ({ principal: i === route.primary, paradas: build(seq) }))
      : undefined;
    return { paradas: build(route.seqs[route.primary] || []), variantes };
  }

  return {
    meta: index.meta,
    counts: { lineas: routes.length, paradas: index.stops.length },
    routes,
    nowLocal, fmtBase, nextArrivals,
    findRoute, findStop, stopInfo, stopRoutes, linesAt, searchStops, routeStops,
  };
}
