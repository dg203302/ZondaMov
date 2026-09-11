# Mejora del Sistema de Planeación de Ruta y su Interfaz

## Contexto

Actualmente, cuando se planea una ruta (directa o con trasbordo), el bottom sheet muestra las paradas cercanas en un formato de lista plana con botones genéricos (`renderListaParadasPlaneo`). El usuario quiere que, **durante una ruta planeada activa**, las paradas se presenten en una interfaz estilo transit/metro similar a la captura de referencia (Barcelona Metro L4), pero adaptada al diseño visual de ZondaMov.

Además, se pide mejorar el algoritmo de decisión y planeación de rutas.

## Referencia Visual (Captura del usuario)

La captura muestra:
- **Badge circular de línea** a la izquierda (L4, fondo amarillo)
- **Tubo vertical coloreado** que conecta las paradas (riel tipo metro)
- **Parada con posición actual** destacada con el nombre en color y subtítulo "Current position"
- **Paradas siguientes** con nombre y metadata ("3 mins left")
- **Parada destino** con hora de llegada ("13:19") y nota ("take right side")
- **Sin tiempos** — el usuario pidió explícitamente NO copiar los tiempos, solo la interfaz

## Propuesta de Cambios

### 1. Interfaz — Nuevo `renderListaParadasPlaneoTimeline`

Se reemplazará `renderListaParadasPlaneo` (lista plana actual) por una nueva función `renderListaParadasPlaneoTimeline` que usa el **mismo sistema visual de transit-timeline** que ya existe en `renderListaParadasRecorrido`.

**Estructura visual para ruta directa:**
```
○ (tenue)
[Badge Línea] ● Tu posición (parada más cercana al origen)
              │ (tubo coloreado)
              ● Parada intermedia 1
              │
              ● Parada intermedia 2
              │
              ● Destino (nombre del destino)
○ (tenue)
```

**Para rutas con trasbordo:**
```
○ (tenue)
[Badge A]  ● Tu posición → Parada cercana línea A
           │
           ● Trasbordo en: [nombre]
[Badge B]  ● Parada de cambio → línea B
           │
           ● Destino
○ (tenue)
```

**Diferencias clave con la lista actual:**
- Usa el tubo vertical coloreado (`.transit-tube-seg`) en vez de botones planos
- Parada más cercana al usuario se destaca en amarillo/verde con subtítulo "Tu posición"
- Cada parada tiene el ícono de parada (`.transit-stop-icon-badge`) ya implementado
- Las paradas son clickeables (centran en el mapa y muestran líneas)
- El botón de acordeón colapsa las paradas intermedias si hay muchas (>3)

### 2. Algoritmo — Mejoras en la selección de ruta

#### 2.1 Filtrado de paradas del tramo (no solo cercanas al origen)
Actualmente `dibujarParadasDeLineaCercanasAlOrigen` obtiene paradas dentro de `RADIO_PARADAS_METROS` del **origen**. Para una ruta planeada, se necesitan las paradas **a lo largo del tramo recortado** (entre iO y iD en la geometría).

Se agregará una función `obtenerParadasEnTramoPlaneado(relIds, latLngs, iO, iD)` que:
1. Filtra paradas que pertenecen a las relaciones de la ruta
2. Para cada parada, calcula su índice más cercano en la geometría
3. Incluye solo las paradas cuyo índice cae entre iO e iD
4. Las ordena por posición a lo largo del tramo

#### 2.2 Mejor puntuación con penalización por caminata excesiva
Actualmente `estimarTiempoTotalSegundos` trata la caminata linealmente. Se añadirá una **penalización multiplicativa** cuando `dO > 500m` (el usuario tendría que caminar demasiado hasta la ruta), lo que favorece líneas que pasan más cerca del origen.

#### 2.3 Guardar metadatos del tramo planeado
Almacenar `startIndex` y `endIndex` en `recorridoActivo` para poder recortar las paradas del tramo sin recalcular.

### 3. Archivos a Modificar

---

### [MODIFY] [script_index.js](file:///c:/Users/Lolma/OneDrive/Escritorio/Repositorios%20Github/ZondaMov/scripts/script_index.js)

1. **Nueva función `obtenerParadasEnTramoPlaneado`** (~línea 6500): Obtiene paradas ordenadas a lo largo del tramo recortado, no solo cercanas al origen.

2. **Nuevo renderizador `renderListaParadasPlaneoTimeline`** (~línea 6534): Reemplaza `renderListaParadasPlaneo`. Genera HTML con el mismo sistema visual `transit-timeline` que la captura de referencia.

3. **Actualizar `verLineaMasCercanaDesdeActualHastaDestino`** (~línea 6327): 
   - Guardar `startIndex`/`endIndex` en `recorridoActivo`
   - Usar `obtenerParadasEnTramoPlaneado` en vez de `dibujarParadasDeLineaCercanasAlOrigen`
   - Llamar al nuevo renderizador de timeline en el bottom sheet

4. **Actualizar `mostrarParadasPlaneoActualEnBottomSheet`** (~línea 6562): Usar el nuevo renderizador timeline

5. **Actualizar `planearRutaConTrasbordo`** (~línea 6683): Usar el nuevo sistema de paradas del tramo para cada leg

6. **Mejora de `estimarTiempoTotalSegundos`** (~línea 6319): Agregar penalización por caminata excesiva

---

### [MODIFY] [index.html](file:///c:/Users/Lolma/OneDrive/Escritorio/Repositorios%20Github/ZondaMov/index.html)

1. **Agregar CSS para `transit-row-current`** (~línea 2590): Estilo destacado para la parada que corresponde a la posición actual del usuario (texto color amarillo/cian, subtítulo "Tu posición")
2. **Agregar CSS para `.planeo-timeline-header`**: Encabezado compacto del timeline de planeación

## Verificación

### Automated Tests
- `node -c .\scripts\script_index.js` — Verificar sintaxis JS

### Manual Verification  
- Abrir la app, buscar una ubicación, tocar "Cómo llegar"
- Verificar que el bottom sheet muestra la timeline tipo metro con paradas ordenadas
- Verificar que las paradas son clickeables y centran en el mapa
- Verificar rutas con trasbordo muestran dos segmentos con sus badges respectivos

## Open Questions

> [!IMPORTANT]
> **¿Querés que las paradas intermedias arranquen colapsadas (con el acordeón tipo "N paradas en el trayecto") o que se muestren todas expandidas por defecto?**
> En la captura de referencia se muestran todas expandidas. El sistema actual en recorridos completos las muestra colapsables.

> [!NOTE]
> La mejora del algoritmo incluye filtrar paradas **a lo largo del tramo** en lugar de solo las cercanas al origen. Esto significa que ahora se mostrarán las paradas reales por las que pasa el colectivo entre el punto de abordaje y el destino, dando al usuario una visión completa del viaje.
