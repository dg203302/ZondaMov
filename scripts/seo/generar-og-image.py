"""
Genera Icons/og-image.png (1200x630), la imagen que se ve al compartir el sitio en redes.
Usa el logo de Icons/manifest-icon-512.maskable.png (fondo #3d1f00) y la fuente Segoe UI de Windows;
si no está, cae a otra fuente del sistema.

    python scripts/seo/generar-og-image.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

RAIZ = Path(__file__).resolve().parents[2]
BG = (61, 31, 0)
CLARO = (252, 236, 224)
ACENTO = (242, 180, 140)

def fuente(nombres, size):
    for n in nombres:
        for base in ("C:/Windows/Fonts", "/usr/share/fonts/truetype/dejavu", "/Library/Fonts"):
            p = Path(base) / n
            if p.exists():
                return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()

negrita = ["segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"]
normal = ["segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"]

img = Image.new("RGB", (1200, 630), BG)

logo = Image.open(RAIZ / "Icons" / "manifest-icon-512.maskable.png").convert("RGB")
w, h = logo.size
c = int(w * 0.5)
logo = logo.crop((c - int(w * 0.22), int(h * 0.26), c + int(w * 0.22), int(h * 0.72))).resize((380, 395), Image.LANCZOS)
img.paste(logo, (90, 118))

d = ImageDraw.Draw(img)
x = 530
d.text((x, 150), "ZondaMov", font=fuente(negrita, 104), fill=CLARO)
d.text((x, 285), "Colectivos y horarios", font=fuente(normal, 48), fill=ACENTO)
d.text((x, 345), "de San Juan en el mapa", font=fuente(normal, 48), fill=ACENTO)
d.rounded_rectangle((x, 460, x + 372, 520), radius=30, fill=(229, 100, 38))
d.text((x + 28, 468), "zondamov.com.ar", font=fuente(negrita, 34), fill=(255, 255, 255))

out = RAIZ / "Icons" / "og-image.png"
img.save(out, optimize=True)
print(f"[og] {out} {out.stat().st_size // 1024} KB")
