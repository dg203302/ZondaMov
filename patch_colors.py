import sys

with open('scripts/script_index.js', 'r') as f:
    content = f.read()

import re

old_func = re.search(r'function getColorForLinea\(ref\) \{.*?return \'#007BFF\';\n\}', content, re.DOTALL)
if not old_func:
    print("Could not find function")
    sys.exit(1)

new_func = """function getColorForLinea(ref) {
  if (!ref) return '#7c7c7cff';
  const refStr = String(ref).toUpperCase().trim();
  
  if (refStr.startsWith('TEO')) return '#8bc34a'; // Verde (Troncal Este-Oeste)
  if (refStr.startsWith('TNS') || refStr === 'T' || refStr.startsWith('T-') || refStr.startsWith('T ')) return '#e53935'; // Rojo (Troncal Norte-Sur)
  if (refStr === 'A' || refStr.startsWith('A-') || refStr.startsWith('A ')) return '#8e24aa'; // Violeta (Corredor Interhospitalario)

  const match = refStr.match(/\d+/);
  if (match) {
    const num = parseInt(match[0], 10);
    if (num === 10 || num === 20) return '#fbc02d'; // Amarillo (Perimetrales Suroeste/Sureste)
    if (num === 30) return '#03a9f4'; // Celeste (Perimetral Este)
    if (num === 40) return '#8bc34a'; // Verde manzana (Perimetral Norte)
    
    if (num >= 100 && num <= 130) return '#e91e63';
    if (num >= 140 && num <= 162) return '#8e24aa';
    if (num >= 200 && num <= 266) return '#fbc02d';
    if (num >= 300 && num <= 364) return '#03a9f4';
    if (num >= 400 && num <= 462) return '#8bc34a';
    if (num >= 500 && num <= 850) return '#ff9800';
  }
  
  return '#007BFF'; // Default fallback
}"""

content = content.replace(old_func.group(0), new_func)

with open('scripts/script_index.js', 'w') as f:
    f.write(content)
print("Done")
