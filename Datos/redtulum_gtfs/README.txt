RED TULUM (San Juan, Argentina) - Feed GTFS de referencia
============================================================
Generado: 11 de septiembre de 2026
Fuente de datos: paginas publicas de Moovit para San Juan
(indice: https://moovitapp.com/index/es-419/transporte_publico-linesIndex-San_Juan-1-6206)
y confirmado contra el listado oficial de lineas de RedTulum
(https://www.redtulum.gob.ar/lineas).

Este NO es un feed GTFS oficial de RedTulum ni de la Provincia de San Juan.
Es un documento con estructura GTFS armado manualmente a partir de la
informacion que Moovit publica de cada linea (parada de inicio, parada de
fin, cantidad de paradas y duracion aproximada del viaje), ya que RedTulum
no publica un feed GTFS descargable y su app oficial dejo de funcionar
en 2026 (recomiendan Moovit / Google Maps para consultar horarios y
recorridos).

COBERTURA
---------
- 9 operadores / agrupamientos de lineas: UTE - La Marina - La Positiva,
  Albardon, El Triunfo, Mayo, Alto de Sierra, Nuevo Sur, Libertador,
  Valle Del Sol y Vallecito. Estos 9 grupos cubren toda la Red Tulum
  (red primaria: troncales TEO/TNS, corredores A-E, perimetrales 10-20-30-40,
  interurbanas 2-3-4; y red secundaria: todas las series numeradas 100 a 850)
  en los 19 departamentos de la provincia.
- 137 lineas / ramales relevados (routes.txt), incluyendo ramales con
  sufijo propio como 440-A/B/C/D, 441-A/B/C/D/E/F, o troncales divididos
  en TEO1/TEO2/TEO3.
- 186 paradas unicas de inicio/fin (stops.txt).
- 137 "trips" (uno por linea/ramal) con 2 stop_times cada uno: la parada
  de inicio (stop_sequence 1) y la parada de fin (stop_sequence 2).

LIMITACIONES IMPORTANTES (leer antes de usar)
----------------------------------------------
1. SOLO INICIO Y FIN: stop_times.txt contiene UNICAMENTE la parada de
   inicio y la parada de fin de cada linea/ramal, no las paradas
   intermedias. Moovit muestra el listado completo de paradas intermedias
   en cada pagina de linea (por ejemplo, la linea 127 tiene 69 paradas
   en total) pero relevar las ~186 paradas intermedias promedio de las
   137 lineas (miles de paradas) quedo fuera del alcance de este relevamiento.
   La columna "cantidad_paradas" en el resumen indica cuantas paradas
   tiene realmente cada linea segun Moovit.
2. SIN COORDENADAS: stops.txt no incluye stop_lat/stop_lon porque Moovit
   no expone coordenadas en el HTML publico de cada linea (se cargan via
   mapa interactivo). Un lector de GTFS estricto puede rechazar este
   archivo por eso; se dejaron las columnas presentes pero vacias.
3. SIN CALENDARIO: no se incluye calendar.txt/calendar_dates.txt. Cada
   pagina de Moovit indica dias de operacion (p.ej. "dias habiles") pero
   no se releva de forma sistematica en esta primera version.
4. UN SOLO SENTIDO POR LINEA: se releva el sentido "principal" que Moovit
   muestra por defecto para cada linea/ramal (direction_id=0). La mayoria
   de las lineas tambien tienen un sentido de vuelta en Moovit
   ("Ver todos los sentidos"), pero el identificador de ese sentido no
   sigue un patron predecible para las 137 lineas, asi que no se incluyo
   en esta version para evitar datos incorrectos.
5. Los datos pueden cambiar: Moovit actualiza recorridos y paradas con
   el tiempo. Este documento es una foto del 11/09/2026.

ARCHIVOS
--------
- agency.txt       9 agencias/operadores
- routes.txt       137 lineas/ramales (route_id = ID interno de Moovit)
- stops.txt        186 paradas de inicio/fin unicas
- trips.txt        137 viajes (uno por linea/ramal), con trip_headsign
- stop_times.txt   274 filas (inicio + fin de cada viaje)
- feed_info.txt    metadata del feed
- resumen_lineas_redtulum.xlsx   informe legible con la misma informacion
                    en una sola tabla, organizado por operador/corredor.

Cada fila de routes.txt tiene un route_url que apunta a la pagina de
Moovit correspondiente, por si se necesita verificar o ampliar el detalle
(paradas intermedias, horarios, mapa) de una linea puntual.
