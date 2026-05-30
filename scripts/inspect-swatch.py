"""One-off: locate and zoom the Grid legend swatch in a verify-*.png."""
import sys
from PIL import Image

src = sys.argv[1]
out = sys.argv[2]
img = Image.open(src).convert('RGB')
orange = (255, 87, 34)
green = (76, 175, 80)

def near(p, t, tol=30):
    return all(abs(p[i] - t[i]) <= tol for i in range(3))

W, H = img.size
for y in range(H):
    row = [img.getpixel((x, y)) for x in range(W)]
    o = [i for i, p in enumerate(row) if near(p, orange)]
    g = [i for i, p in enumerate(row) if near(p, green)]
    if not (o and g):
        continue
    s = set(o) | set(g)
    if max(s) - min(s) >= 25:
        continue
    x0, x1 = min(s), max(s)
    ymax = y
    for y2 in range(y, min(y + 30, H)):
        row2 = [img.getpixel((x, y2)) for x in range(max(0, x0 - 2), min(W, x1 + 3))]
        if any(near(p, orange) or near(p, green) for p in row2):
            ymax = y2
        else:
            break
    crop = img.crop((x0 - 3, y - 3, x1 + 4, ymax + 4))
    crop = crop.resize((crop.width * 20, crop.height * 20), Image.NEAREST)
    crop.save(out)
    print(f'swatch y={y}..{ymax} x={x0}..{x1} -> {out} {crop.size}')
    sys.exit(0)
print('no swatch found')
sys.exit(1)
