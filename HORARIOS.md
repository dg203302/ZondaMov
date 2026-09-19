# Cómo la app calcula los horarios de llegada

Documento técnico del sistema de arribos de ZondaMov: qué datos usa, cómo los cruza y
dónde están los límites. Para actualizar los datos, ver
[`Datos/redtulum/ACTUALIZAR.md`](Datos/redtulum/ACTUALIZAR.md).

---

## 1. El problema

ZondaMov es un sitio estático: no hay backend. Cuando el usuario toca una parada en el
mapa y quiere saber cuándo pasa el 100, hay que resolver tres cosas en el navegador:

1. **Qué línea es.** El mapa usa OpenStreetMap, donde las líneas son relaciones con una
   etiqueta `ref` (`"100"`, `"440-A"`, `"TEO 1"`).
2. **Qué parada es.** Acá está la parte difícil: las paradas del mapa vienen de OSM y los
   horarios de un GTFS derivado de Moovit. **Son dos universos distintos**, con nombres
   distintos, y el GTFS **no trae coordenadas**. El único puente posible es el nombre.
3. **Cuándo pasa.** Con la línea y la parada resueltas, buscar las próximas salidas.

Antes esto se hacía contra una API HTTP (`/api/arrivals`) y después con un JSON de
"ventana horaria + frecuencia promedio". Hoy se hace con un índice compacto que corre
entero en el dispositivo.

---

## 2. Vista general

```
  Feature de parada del GeoJSON (OSM)   +   ref de línea de OSM
                    │                             │
                    │                             ▼
                    │                   resolverLineaEnIndice()
                    │                   "TEO 1" → TEO1 · 82 paradas
                    │                             │
                    └──────────────┬──────────────┘
                                   ▼
                        buscarParadaEnLinea()
                        nombre OSM → ST0402
                                   │
                                   ▼
                       proximasLlegadasDeLinea()
                       rt.llegadas({ linea, parada, n })
                                   │
                                   ▼
              [{ minutosDesdeAhora, dayOffset, horaTexto }, …]
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
              bottom sheet    recorrido     lista de la parada
```

Todo el cálculo pasa por [`obtenerArribosDeLinea()`](scripts/script_index.js#L1331), que
es el único punto de entrada.

---

## 3. Los datos: `index.json`

Vive en `Datos/redtulum/index.json`. Pesa **435 KB** (95 KB comprimido) y contiene todo
el sistema: 137 líneas, 5371 paradas, 5081 viajes, 313 servicios de calendario.

El GTFS original tiene **424 998 filas** en `stop_times.txt` (una por cada paso de cada
viaje por cada parada). El índice guarda lo mismo en 435 KB **sin pérdida**: la prueba
`scripts/redtulum/verificar-index.mjs` compara las dos representaciones y da 0
diferencias.

### 3.1 Estructura

```jsonc
{
  "meta": {
    "formato": 2,                     // el motor rechaza cualquier otro formato
    "generado": "2026-09-19T03:54:01.906Z",
    "tz": "America/Argentina/San_Juan",
    "feed": { "publicador": "…", "version": "2026-09-11-v2-aprox" },
    "conteo": { "lineas": 137, "paradas": 5371, "viajes": 5081, "patrones": 270 }
  },

  // Paradas: dos arrays paralelos. El índice numérico dentro de estos arrays es
  // la "clave interna" que usan las secuencias de abajo.
  "stopIds": ["ST0001", "ST0002", …],   // 5371
  "stops":   ["B° Ate-Api S", "Molina Y Cipolletti", …],

  // Calendario: [dom, lun, mar, mié, jue, vie, sáb, fecha_inicio, fecha_fin]
  "services": {
    "100_svc1": [0, 1, 1, 1, 1, 1, 0, 20260101, 20261231],   // lunes a viernes
    "100_svc2": [0, 0, 0, 0, 0, 0, 1, 20260101, 20261231],   // sábados
    "100_svc3": [1, 0, 0, 0, 0, 0, 0, 20260101, 20261231]    // domingos
  },

  "routes": [
    {
      "id": "184765575",
      "linea": "100",                      // lo que ve el usuario
      "nombre": "Barrio ATE API - Av. Dr. Guillermo Rawson y Santa Fe",
      "agencia": "UTE - La Marina - La Positiva",

      // Secuencias de paradas (índices en stopIds). Normalmente una;
      // más si el feed trae variantes de recorrido.
      "seqs": [[0, 1, 2, 3, …]],           // 89 paradas

      // Patrones: viajes que comparten secuencia Y desfases idénticos.
      "patterns": [
        {
          "seq": 0,                        // qué secuencia usa
          "off": [0, 60, 60, 120, …],      // segundos desde la salida, por posición
          "starts": {                      // horas de salida (segundos desde medianoche)
            "100_svc1": [22680, 23640, 24600, …],   // 06:18, 06:34, 06:50…
            "100_svc3": [...]
          }
        },
        { "seq": 0, "off": [...], "starts": { "100_svc2": [...] } }
      ]
    }
  ]
}
```

### 3.2 La idea de compresión

La hora a la que un viaje pasa por una parada es:

```
hora_de_paso = starts[k] + off[posición_de_la_parada_en_la_secuencia]
```

Un patrón agrupa todos los viajes que recorren la misma secuencia con los mismos
desfases. Así, en vez de 425 mil filas quedan **270 patrones**. Cada línea tiene entre
1 y 4 patrones, y entre 6 y 163 paradas (72 en promedio).

Los desfases están en **segundos**, no en minutos fraccionarios como el formato anterior:
por eso los horarios pueden diferir en ±1 minuto respecto de lo que mostraba la versión
vieja.

---

## 4. El motor: cómo sale una llegada

`Datos/redtulum/engine.js` es el paquete `redtulum-local` sin modificar. Lo importante es
`nextArrivals(route, stopIdx, base, n)`:

```js
for (const off of [-1, 0, 1]) {                    // ayer, hoy, mañana
  const day = dayInfo(base, off);
  const nowInServiceDay = base.secs - off * 86400;
  for (const pat of route.patterns) {
    const positions = route.posBySeq[pat.seq].get(stopIdx);   // ← todas las posiciones
    if (!positions) continue;
    for (const svc in pat.starts) {
      if (!serviceActive(svc, day)) continue;      // día de semana Y rango de fechas
      const starts = pat.starts[svc];
      for (const pos of positions) {
        const o = pat.off[pos];
        const first = lowerBound(starts, nowInServiceDay - o);   // búsqueda binaria
        for (let k = first; k < Math.min(starts.length, first + n); k++) {
          found.push({ wait: starts[k] + o - nowInServiceDay, t: starts[k] + o, off });
        }
      }
    }
  }
}
found.sort((a, b) => a.wait - b.wait);
```

Tres detalles que importan:

**Mira tres días de servicio, no uno.** El día `-1` es para los viajes que cruzan la
medianoche: en GTFS una salida a las 25:10 pertenece al día anterior. El día `+1` es para
cuando hoy ya no quedan salidas.

**`positions` es un array, no un valor.** 33 de las 137 líneas pasan dos veces por la
misma parada (recorridos con lazo), y el motor suma las dos pasadas. Ejemplo real: la 104
por `ST0249` (posiciones 1 y 82 de su secuencia), un lunes a las 08:30:

```
08:41  08:48  09:02  09:09      ← pares: cabecera y vuelta del lazo
```

Es correcto y es normal ver dos horarios muy cercanos.

**`serviceActive` chequea también el rango de fechas.** `day.num >= s[7] && day.num <= s[8]`.
Fuera de la vigencia del feed el motor devuelve `[]` para todo — ver `ACTUALIZAR.md`.

La respuesta de `rt.llegadas()` es:

```json
{
  "linea": "TEO1",
  "nombre_linea": "Troncal Este - Oeste",
  "parada": { "id": "ST0402", "nombre": "Av. Ig. De La Roza Y Julio Cortázar S" },
  "consulta_local": "2026-09-21 08:30",
  "proximos": [
    { "hora": "08:45", "en_min": 15, "dia": "hoy" },
    { "hora": "09:05", "en_min": 35, "dia": "hoy" }
  ],
  "aproximado": true,
  "aviso": "Horarios PROGRAMADOS y aproximados (no es tiempo real)…"
}
```

---

## 5. La capa de la app, paso a paso

### 5.1 Cargar el motor — [`cargarApiHorarios()`](scripts/script_index.js#L1150)

```js
const { loadRedTulum } = await import(moduloUrl);
const api = await loadRedTulum({ indexUrl, fetchImpl: (u) => fetch(u, { cache: 'force-cache' }) });
```

- `import()` dinámico desde un script clásico: `script_index.js` no es un módulo, pero
  `import()` sí funciona adentro. Las URLs se resuelven contra `document.baseURI` para no
  depender de cómo el navegador calcule la base del script.
- `force-cache`: el índice se baja una vez y después sale de la caché del navegador. La
  app abre al instante y anda sin conexión.
- La única forma de invalidar esa caché es el `?v=` de `REDTULUM_INDEX_URL`.
- Se ejecuta **una sola vez por sesión** (guardas `_redTulumApi` / `_redTulumPromise`). Si
  falla devuelve `null` y limpia la promesa, así el próximo intento reintenta.

### 5.2 Resolver la línea — [`resolverLineaEnIndice()`](scripts/script_index.js#L1185)

La `ref` de OSM no siempre coincide con la del feed. `normalizarLineaParaLookup()` saca
espacios, guiones y todo lo que no sea alfanumérico:

| OSM | Clave | Índice |
|---|---|---|
| `"120"` | `120` | `120` |
| `"TEO 1"` | `TEO1` | `TEO1` |
| `"440-A"` | `440A` | `440-A` |
| `"262D"` | `262D` → `262` | `262` |

El segundo intento (recortar la letra de ramal `[A-F]` final) solo entra si la ref
completa **no** está en el índice. Los ramales que el feed sí modela (`440-A`…`441-F`)
matchean directo. Hoy lo usan `262D` y `262E`, que existen en OSM (462 paradas) pero no en
el feed: se les muestra el horario de la `262`. Las líneas que *son* una letra (`A`, `B`,
`C`, `D`, `E`) no se recortan porque no queda nada antes.

Resuelta la línea, se piden sus paradas (`rt.paradasDeLinea()`), se unen las de todas las
variantes y **se tokeniza cada nombre una sola vez**. El resultado se cachea en
`_paradasPorLineaIndice`: el HUD de arribos vuelve a pedir lo mismo en cada refresco y sin
caché se re-tokenizarían ~90 nombres × 8 líneas cada vez.

### 5.3 Resolver la parada — [`buscarParadaEnLinea()`](scripts/script_index.js#L1230)

La parte delicada. Entrada: todos los alias del feature de OSM que devuelve
`obtenerCandidatosNombreParada()` — `name`, `name:es`, `alt_name`, `official_name`,
`description`, `addr:street`, `ref`. Se busca **solo entre las paradas de esa línea**, no
entre las 5371: acota muchísimo el espacio y garantiza que la parada elegida esté
realmente en el recorrido.

**Primera pasada, match exacto.** Se comparan los nombres en minúsculas y sin tildes. Es
el 6% de los casos.

**Segunda pasada, Jaccard sobre tokens.** `tokenizarNombreParada()`:

1. Saca el sufijo de orientación final (`… N`, `… S -B`, `… -C`).
2. Saca tildes (NFD + quitar diacríticos) y puntuación.
3. Descarta palabras de 1 letra y una lista de *stop words* (`y`, `de`, `av`, `calle`,
   `barrio`, `dr`, `gral`, `almte`, `esquina`…).

```
"Avenida Ignacio de la Roza y Julio Cortázar"  →  {roza, julio, cortazar}
"Av. Ig. De La Roza Y Julio Cortázar N"        →  {roza, julio, cortazar}
                                        Jaccard = 1.000
```

Gana el score más alto, con umbral **0,3**. Si nada lo supera, se cae a la **cabecera de
la línea** (la parada de orden 1, offset 0), que es lo que hacía la implementación
anterior: es mejor mostrar la ventana de operación de la línea que no mostrar nada.

**Ejemplo real y completo.** Parada OSM `node/4079323689`, "Avenida Ignacio de la Roza y
Julio Cortázar", un lunes a las 08:30:

| Línea OSM | Clave | Línea del feed | Parada elegida | Próximos |
|---|---|---|---|---|
| `120` | `120` | 120 · Villa Observatorio – Valle Grande (123 paradas) | `ST0340` …Cortázar **N** | 09:08, 10:56, 12:44 |
| `TEO 1` | `TEO1` | TEO1 · Troncal Este – Oeste (82 paradas) | `ST0402` …Cortázar **S** | 08:45, 09:05, 09:25 |

Nótese que **la misma parada del mapa resuelve a `stop_id` distintos según la línea**. Eso
es correcto y es el motivo por el que la búsqueda se hace por línea.

### 5.4 Pedir los horarios — [`proximasLlegadasDeLinea()`](scripts/script_index.js#L1281)

Traduce la respuesta del motor al formato que consumen las vistas:

```js
{ minutosDesdeAhora: p.en_min, dayOffset: p.dia === 'mañana' ? 1 : 0, horaTexto: p.hora }
```

**El sondeo multi-día.** El motor solo mira ayer/hoy/mañana, pero **54 de las 137 líneas
no operan algún día de la semana** y algunas tienen una sola salida diaria. Si con eso no
se llega a `n` resultados, se sondea día por día (hasta 7 días) reusando el parámetro
`ahora` de la API:

```js
const sonda = rt.llegadas({ linea, parada: paradaId, n: faltan, ahora: `${ymd}T00:00` });
const dayOffset = dia + (p.dia === 'mañana' ? 1 : 0);
minutosDesdeAhora = dayOffset * 1440 + horaEnMinutos - minutosAhora;
```

Los minutos se recalculan contra la hora real (`consulta_local` de la primera respuesta),
no contra la base del sondeo. Se deduplica por `dayOffset|hora` para no repetir lo que ya
trajo la consulta directa. Ejemplo real, línea 122 en `ST0038`:

```
motor solo:  06:30 (mañana)
con sondeo:  06:30 (mañana) · 06:30 (en 2 días) · 06:30 (en 3 días)
```

### 5.5 El envoltorio — [`obtenerArribosDeLinea()`](scripts/script_index.js#L1331)

```js
{ items: [...], sinDatos: false, parada: { id, nombre, tokens } }
```

`sinDatos: true` significa **no se pudo consultar** (el índice no cargó, o la línea no
existe en el feed). Es distinto de `items: []`, que significa **no hay más servicios
programados**. Las vistas muestran mensajes distintos para cada caso.

---

## 6. Quién lo consume

| Vista | Función | Cuántos |
|---|---|---|
| Bottom sheet de una línea en una parada | [`mostrarArribosParaParadaYLinea()`](scripts/script_index.js#L1481) | 3 horarios |
| Tarjeta dentro del recorrido de la línea | `renderArribosPreviewHtml()` | 3 horarios |
| Lista de todas las líneas de una parada | [`llegadasPorLineaEnParada()`](scripts/script_index.js#L5996) | 1 por línea, hasta 8 líneas |

La tercera itera las líneas de la relación OSM y consulta cada una por separado (misma
resolución de parada por línea), después ordena por la que llega antes y manda al final
las que no tienen horario.

**Cómo se rotula** ([`textoEsperaLlegada()`](scripts/script_index.js#L6037)):

| Condición | Texto |
|---|---|
| sin `proxima` | `sin horario` |
| `dayOffset > 0` o más de 90 min | `mañana 06:30`, `lunes 21:16` |
| `min <= 0` | `llegando` |
| resto | `12 min` |

---

## 7. Hora y zona horaria

El motor usa **siempre la hora de San Juan (UTC−3)**, vía
`Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/San_Juan', … })`. No importa
en qué zona esté configurado el dispositivo: un usuario con el teléfono en UTC ve los
mismos horarios.

Lo que **sí** importa es que el reloj del dispositivo esté en hora: si está adelantado
media hora, los arribos también.

(`etiquetaDiaRelativoHorarios()`, que traduce `dayOffset` a "lunes"/"martes", sí usa el
`Date` local para el nombre del día. Para un dispositivo en San Juan es lo mismo.)

---

## 8. Caché y rendimiento

| Qué | Dónde | Vida |
|---|---|---|
| Módulo `redtulum.js` | module map del navegador | la sesión |
| `index.json` | caché HTTP (`force-cache`) | hasta que cambie el `?v=` |
| Motor armado | `_redTulumApi` | la sesión |
| Paradas de cada línea, ya tokenizadas | `_paradasPorLineaIndice` | la sesión |

Medido sobre 879 paradas reales del GeoJSON, 2261 pares parada × línea: **~0,13 ms por
consulta completa**, incluyendo la resolución de nombre. La consulta pura al motor es de
~0,02 ms; el resto es el matching.

---

## 9. Qué se ve cuando algo falla

| Situación | Resultado | Qué ve el usuario |
|---|---|---|
| El índice no cargó (404, offline en primera visita) | `sinDatos: true` | "Todavía no tenemos horario aproximado cargado para esta línea." |
| La ref de OSM no está en el feed | `sinDatos: true` | idem |
| La línea no opera en los próximos 7 días | `items: []` | "Sin más servicios programados por ahora." |
| El feed venció (hoy > `end_date`) | `items: []` **en todas las líneas** | idem — parece que no hay colectivos. Ver `ACTUALIZAR.md` |
| Ninguna parada supera el umbral 0,3 | horarios de la cabecera de la línea | horarios, sin aviso de que son de otra parada |

---

## 10. Límites conocidos

**Los datos son estimados.** El feed sale de un scrapeo no oficial de Moovit
(2026-09-11): las salidas se generaron a partir de la frecuencia publicada y la duración
del recorrido se repartió **lineal y proporcionalmente** entre las paradas. No hay
distancias reales, ni velocidades, ni tránsito, ni GPS. No es tiempo real y no contempla
feriados ni desvíos. La app lo aclara en cada vista.

**El cruce OSM ↔ feed es por nombre y no siempre acierta.** Medido sobre 2261 pares:

| | |
|---|---|
| Match exacto de nombre | 6,0 % |
| Jaccard con un ganador único | 51,1 % |
| **Jaccard empatado entre 2 o más paradas** | **28,1 %** |
| Sin match, cae a la cabecera de la línea | 14,8 % |

El empate casi siempre es entre los **dos lados de la misma esquina** (`… O` / `… E`,
`… N` / `… S`): 91 de las 137 líneas incluyen las dos, y hay 1102 pares así en el índice.
Como el tokenizador borra el sufijo de orientación, las dos puntúan idéntico y gana la
que aparece **primero en la secuencia de la línea** — que es la de ida, no la que está
más cerca del usuario. Es decir: **la app no distingue de qué lado de la calle estás
parado, y ante la duda muestra siempre el lado de ida.**

Y no es un error menor. Comparando el próximo arribo de las dos paradas de cada par, en
tres horas distintas de un lunes (3281 comparaciones):

| | |
|---|---|
| Mediana de la diferencia | **12 min** |
| p75 | 40 min |
| p90 | 80 min |
| Dentro de 5 min | 28 % |
| Dentro de 10 min | 45 % |

O sea: cuando el empate se resuelve para el lado equivocado, lo típico es errarle por
unos 12 minutos, y en el 10 % de los casos por más de una hora.

No se puede arreglar con los datos actuales — el GTFS no trae coordenadas. Con un feed
que las traiga, el match pasaría a ser por cercanía geográfica, que es exacto. Una
alternativa intermedia sería que la app le pregunte al usuario de qué lado espera cuando
detecta el empate.

**Un solo sentido por línea.** El feed modela `direction_id = 0`. Para el sentido de
vuelta puede no haber datos.

**El feed vence el 31/12/2026.** Ver [`Datos/redtulum/ACTUALIZAR.md`](Datos/redtulum/ACTUALIZAR.md).

**No hay detección automática de índice viejo.** El `?v=` de `REDTULUM_INDEX_URL` es la
única forma de que un índice nuevo llegue a los usuarios; hay que subirlo a mano y
redesplegar.

---

## 11. Mapa de archivos

```
Datos/redtulum/
  index.json          los datos (435 KB)
  engine.js           motor de consulta        ← paquete redtulum-local, sin modificar
  redtulum.js         API (llegadas, paradasDeLinea, buscarParadas…)
  ACTUALIZAR.md       cómo regenerar el índice

scripts/script_index.js
  cargarApiHorarios()          carga el motor, una vez por sesión
  resolverLineaEnIndice()      ref de OSM → línea del feed + paradas tokenizadas
  buscarParadaEnLinea()        nombre de OSM → stop_id
  proximasLlegadasDeLinea()    consulta + sondeo multi-día
  obtenerArribosDeLinea()      envoltorio: lo que usan las vistas
  llegadasPorLineaEnParada()   todas las líneas de una parada
  textoEsperaLlegada()         "12 min" / "llegando" / "lunes 21:16"

  tokenizarNombreParada()      tokens para el matching
  calcularSimilitudJaccard()   |A∩B| / |A∪B|
  obtenerClavesLineaLookup()   normalización de refs y fallback de ramal
  obtenerCandidatosNombreParada()  alias del feature de OSM

scripts/redtulum/
  build-index.mjs, csv.mjs     GTFS → index.json
  verificar-index.mjs          índice vs. GTFS crudo (0 diferencias)
```

---

## 12. Cómo probarlo sin navegador

```bash
# Consultar una línea y parada concretas
node --input-type=module -e "
import { createRedTulum } from './Datos/redtulum/redtulum.js';
import { readFileSync } from 'node:fs';
const rt = createRedTulum(JSON.parse(readFileSync('./Datos/redtulum/index.json','utf8')));
console.log(rt.buscarParadas({ q: 'cortazar', linea: 'TEO1' }));
console.log(rt.llegadas({ linea: 'TEO1', parada: 'ST0402', n: 3, ahora: '2026-09-21T08:30' }));
"

# Verificar que el índice sea fiel al GTFS
node scripts/redtulum/verificar-index.mjs
```

`ahora` (formato `YYYY-MM-DDTHH:MM`, hora local de San Juan) sirve para probar cualquier
día y hora. **La app nunca lo usa salvo en el sondeo multi-día**: en uso normal siempre es
la hora real.
