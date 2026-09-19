/**
 * Lector CSV mínimo para archivos GTFS (soporta comillas, BOM y CRLF).
 * Devuelve { idx, rows }: idx mapea nombre de columna -> posición, rows es un array de arrays.
 */
import fs from 'node:fs';
import path from 'node:path';

export function readCSV(dir, name) {
  let text = fs.readFileSync(path.join(dir, name + '.txt'), 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  const header = rows.shift();
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  return { idx, rows };
}
