# Cómo actualizar los horarios de colectivos

Esta carpeta es el motor de horarios de la app. Todo lo que muestra ZondaMov sobre
"próximas llegadas" sale de acá.

| Archivo | Qué es |
|---|---|
| `index.json` | Los datos: 137 líneas, 5371 paradas, horarios y calendario. 435 KB (95 KB comprimido). |
| `engine.js` | El motor de consulta. |
| `redtulum.js` | La API que usa la app (`llegadas`, `paradasDeLinea`, `buscarParadas`…). |

`engine.js` y `redtulum.js` casi nunca se tocan: vienen del paquete `redtulum-local` y
funcionan con cualquier `index.json` en formato 2. **Lo que se actualiza es `index.json`.**

No hay servidor ni API externa: el navegador baja `index.json` una vez y resuelve todo
en el dispositivo.

---

## 1. Cuándo hay que actualizar

Hay dos motivos distintos:

**a) El índice venció.** Cada servicio del feed tiene un rango de fechas. Fuera de ese
rango el motor no devuelve **ningún** horario: la app muestra "Sin más servicios
programados por ahora" en todas las líneas, como si no hubiera colectivos.

El índice de hoy vale hasta el **31 de diciembre de 2026**. Para confirmarlo:

```bash
node -e "const s=require('./Datos/redtulum/index.json').services; const v=Object.values(s); console.log('vigente', Math.min(...v.map(x=>x[7])), '→', Math.max(...v.map(x=>x[8])));"
```

**b) Los horarios cambiaron.** RedTulum modificó recorridos, frecuencias o líneas. Acá
no hay síntoma automático: los horarios simplemente dejan de coincidir con la realidad.

---

## 2. Caso A — Tenés un GTFS nuevo

Es el camino normal. Sirve igual para un scrapeo nuevo de Moovit o para el feed oficial
de RedTulum, si algún día lo conseguís.

### Paso 1 — Dejar el GTFS en su lugar

El GTFS actual está en `Datos/redtulum_gtfs_aproximado_v2/`. Reemplazá esos `.txt` por
los nuevos, o poné los nuevos en otra carpeta y pasala como argumento en el paso 2.

Archivos que el build necesita:

| Archivo | Obligatorio | Para qué |
|---|---|---|
| `agency.txt` | sí | Nombre de la empresa y zona horaria. |
| `routes.txt` | sí | Líneas (`route_short_name` es lo que ve el usuario: `100`, `440-A`, `TEO1`). |
| `stops.txt` | sí | Paradas (`stop_id`, `stop_name`). |
| `trips.txt` | sí | Viajes y a qué línea y servicio pertenecen. |
| `stop_times.txt` | sí | Hora de paso por cada parada de cada viaje. Es el archivo pesado (~18 MB). |
| `calendar.txt` | sí | Qué días corre cada servicio y **entre qué fechas**. |
| `feed_info.txt` | no | De acá sale `feed_version`, que conviene tener para versionar. |

Si el feed nuevo trae `calendar_dates.txt` (feriados y servicios especiales), **el build
lo ignora**: habría que agregarle soporte a `build-index.mjs` y a `engine.js`.

### Paso 2 — Generar el índice

```bash
node scripts/redtulum/build-index.mjs Datos/redtulum_gtfs_aproximado_v2 Datos/redtulum/index.json
```

Tiene que imprimir algo así:

```
[build] 137 líneas, 5371 paradas, 5081 viajes -> 270 patrones
[build] .../Datos/redtulum/index.json  425 KB  (1398 ms)
```

Si el número de líneas o paradas cambió mucho respecto de lo que esperabas, frená y
mirá el GTFS antes de seguir.

### Paso 3 — Verificar

Este script compara el índice comprimido contra el GTFS crudo, fila por fila:

```bash
node scripts/redtulum/verificar-index.mjs
```

**Tiene que dar 0 diferencias.** Si no, el índice no es fiel al GTFS y no hay que
subirlo:

```
[test] 3940 consultas (47 paradas repetidas en línea incluidas), diferencias: 0
```

Para una pasada más exigente: `N=20000 node scripts/redtulum/verificar-index.mjs`

### Paso 4 — Probar a mano

```bash
node --input-type=module -e "
import { createRedTulum } from './Datos/redtulum/redtulum.js';
import { readFileSync } from 'node:fs';
const rt = createRedTulum(JSON.parse(readFileSync('./Datos/redtulum/index.json','utf8')));
console.log(rt.health());
console.log(rt.llegadas({ linea: '100', parada: 'ST0001', n: 3 }).proximos);
"
```

Mirá que `lineas` y `paradas` tengan sentido y que los horarios sean creíbles para la
hora en que lo corrés.

⚠️ **Los `stop_id` importan.** La app cruza las paradas de OpenStreetMap con las del
feed **por nombre** (no hay coordenadas en este GTFS). Si el feed nuevo renombra
paradas, el match empeora en silencio. Después de actualizar, abrí la app y tocá unas
cuantas paradas de distintas zonas: si aparecen horarios que no corresponden a esa
esquina, el problema es el matching de nombres, no el índice.

### Paso 5 — Desplegar

Subí el `?v=` de la URL del índice: buscá `REDTULUM_INDEX_URL` en `scripts/script_index.js`
(cerca de la línea 42).

```js
const REDTULUM_INDEX_URL = encodeURI('Datos/redtulum/index.json?v=2026-09-11-v2-aprox');
```

Poné el `feed_version` nuevo (o la fecha del snapshot). **Si no lo subís, los usuarios
que ya abrieron la app siguen viendo el índice viejo**: se carga con `force-cache` y esa
URL es la única forma de invalidar la caché.

Conviene subir también el `?v=` de `script_index.js` en `index.html` (buscá
`script_index.js?v=`, cerca de la línea 8493).

Después: commit de `Datos/redtulum/index.json`, del GTFS nuevo y de los dos `?v=`, y
desplegá.

---

## 3. Caso B — El índice vence y no hay GTFS nuevo

Si llega el 31/12/2026 sin datos nuevos, la app se queda sin mostrar horarios. La salida
rápida es correr el vencimiento del calendario:

1. Abrí `Datos/redtulum_gtfs_aproximado_v2/calendar.txt`.
2. Cambiá la columna `end_date` (la última) de `20261231` al año siguiente en las 313
   filas. Por ejemplo:

   ```bash
   node -e "const f='Datos/redtulum_gtfs_aproximado_v2/calendar.txt',fs=require('fs');fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/20261231/g,'20271231'));"
   ```

3. Regenerá y verificá con los pasos 2 y 3 de arriba, y desplegá.

**Esto no actualiza nada: solo evita que la app se vea vacía.** Los horarios siguen
siendo los del snapshot del 2026-09-11, cada vez más desactualizados. Es un parche para
ganar tiempo, no un reemplazo de conseguir datos nuevos.

---

## 4. Lo que no se puede hacer

**Regenerar el índice desde el navegador.** Construirlo significa leer ~19 MB de GTFS
(solo `stop_times.txt` son 18 MB) y ninguna de las fuentes manda cabeceras CORS. Es lo
mismo que pasa con `scripts/actualizar_noticias.mjs`: se corre en Node y se versiona el
resultado en el repo.

Lo que **sí** se podría agregar algún día es que la app **detecte** que su índice quedó
viejo y baje el nuevo sola en segundo plano (revalidando con ETag y comparando
`meta.generado`), en vez de depender del `?v=`. No está implementado.

---

## 5. De dónde salen estos datos

El índice actual viene de un scrapeo **no oficial** de Moovit, del 2026-09-11. Los
horarios son **estimados**, no tiempo real:

- Para cada línea y día se tomó la ventana de operación y la frecuencia publicadas, y se
  generaron salidas sintéticas a esa frecuencia.
- La duración total del recorrido se repartió **lineal y proporcionalmente** entre las
  paradas según su posición. No hay distancias reales, ni velocidades, ni tránsito.
- Solo se modeló un sentido por línea (`direction_id = 0`); puede no haber datos de la
  vuelta.
- No contempla feriados, desvíos ni cortes de calle.

Por eso la app siempre aclara que son horarios aproximados. Si conseguís el GTFS oficial
de RedTulum, reemplazalo y estas limitaciones desaparecen casi todas.

---

## 6. Referencia rápida

```
Datos/redtulum/                       lo que usa la app en producción
  index.json                          ← esto es lo que se regenera
  engine.js, redtulum.js              motor y API (no se tocan)
  ACTUALIZAR.md                       este archivo

Datos/redtulum_gtfs_aproximado_v2/    el GTFS del que sale el índice
scripts/redtulum/
  build-index.mjs                     GTFS → index.json
  csv.mjs                             lector CSV que usa el build
  verificar-index.mjs                 compara el índice contra el GTFS (0 diferencias)
```

```bash
# regenerar
node scripts/redtulum/build-index.mjs Datos/redtulum_gtfs_aproximado_v2 Datos/redtulum/index.json

# verificar
node scripts/redtulum/verificar-index.mjs
```

Requiere Node 18 o superior. No hay dependencias que instalar.

El paquete original (`redtulum-local`, con su `README.md`, la guía `AGENTE.md` para
usarlo desde un LLM y el módulo `tools.js` de function calling) no está en el repo: acá
quedó solo lo necesario para producción y para regenerar el índice.
