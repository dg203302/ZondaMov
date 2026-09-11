RedTulum (San Juan) - GTFS APROXIMADO CON HORARIOS ESTIMADOS (v2 - "Plan B")
================================================================================
NO ES UN FEED OFICIAL. Generado a partir de datos públicos scrapeados de Moovit
(moovitapp.com) para las 137 líneas/ramales de las 9 agencias de RedTulum.

Este paquete es un PARCHE TEMPORAL para poder mostrar horarios de arribo
aproximados en una app mientras se gestiona el feed GTFS oficial con RedTulum.

QUÉ CONTIENE (a diferencia del primer entregable, que solo tenía inicio/fin):
- Secuencia COMPLETA y ordenada de paradas de cada línea/ramal (137 líneas).
- Horario semanal real publicado por Moovit por línea y por día (lun a dom):
  ventana de operación (hora inicio - hora fin) y frecuencia en minutos,
  o "Salida única" (un solo horario ese día), o sin servicio.
- stop_times.txt con una hora ESTIMADA de paso por CADA parada de CADA viaje
  generado sintéticamente a partir de esa frecuencia.

CÓMO SE CALCULAN LOS HORARIOS POR PARADA (método de interpolación):
1. Para cada línea y cada día de la semana, se toma la ventana horaria real
   (ej. 06:14-07:17) y la frecuencia real (ej. cada 23-39 min, se usa el
   promedio) publicadas por Moovit, y se generan salidas sintéticas de viaje
   a esa frecuencia dentro de esa ventana.
2. La duración total del recorrido (sacada del primer relevamiento, basado
   también en datos de Moovit) se reparte de forma PROPORCIONAL Y LINEAL
   entre las paradas según su posición en la secuencia (parada 1 = minuto 0,
   última parada = minuto "duración total"). NO se usan distancias reales,
   ni velocidades reales, ni tránsito, ni GPS de las unidades.

LIMITACIONES IMPORTANTES (léase antes de usar en producción):
1. Es una ESTIMACIÓN, no un horario real ni en tiempo real. Dos paradas
   consecutivas en el mundo real pueden estar a 200m o a 2km; acá se les
   asigna el mismo intervalo de tiempo si el algoritmo de reparto es lineal.
2. No incluye coordenadas geográficas (lat/lon) de las paradas.
3. Los "viajes" (trips) son sintéticos: no corresponden a un colectivo real
   circulando, sino a una salida teórica calculada a partir de la frecuencia
   publicada.
4. Los datos de origen (Moovit) pueden tener errores, estar desactualizados,
   o no reflejar cambios recientes de recorrido/horario.
5. No contempla feriados, servicios especiales, ni cortes de calle.
6. Direction_id = 0 para todos los viajes (no se modeló el sentido de
   regreso -1 por la inconsistencia de esa variante en Moovit, ver informe
   original).
7. Dato "snapshot" tomado el 2026-09-11; sin actualización automática.

RECOMENDACIÓN: usar esto solo como estimación de respaldo ("Próximo colectivo:
aprox. X min, basado en horario programado") y reemplazar en cuanto se
consiga el feed GTFS oficial (y, si es posible, GTFS-Realtime) de RedTulum.

ARCHIVOS:
- agency.txt, routes.txt, stops.txt, trips.txt, stop_times.txt, calendar.txt,
  feed_info.txt: paquete GTFS estándar, debería cargar en la mayoría de
  validadores/visualizadores GTFS (ej. https://gtfs-validator.mobilitydata.org/).
- Ver también redtulum_lineas_horarios_aproximados.json (fuera de este zip,
  entregado por separado) para un formato más directo de consumir desde una
  app (JSON con paradas ordenadas + offset estimado en minutos + horario
  semanal por línea).
