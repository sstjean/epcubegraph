"""Dump the Grid swatch as a colored ASCII grid to verify orientation."""
import sys
from PIL import Image

img = Image.open(sys.argv[1]).convert('RGB')
orange = (255, 87, 34)
green = (76, 175, 80)

def near(p, t, tol=30):
    return all(abs(p[i] - t[i]) <= tol for i in range(3))

W, H = img.size
# Find swatch
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
        row2 = [img.getpixel((x, y2)) for x in range(max(0, x0 - 1), min(W, x1 + 2))]
        if any(near(p, orange) or near(p, green) for p in row2):
            ymax = y2
        else:
            break
    print(f'Swatch bbox: x={x0}..{x1} y={y}..{ymax}')
    print()
    print('Layout (R=red, G=green, .=other):')
    for yy in range(y, ymax + 1):
        line = ''
        for xx in range(x0, x1 + 1):
            p = img.getpixel((xx, yy))
            if near(p, orange):
                line += 'R'
            elif near(p, green):
                line += 'G'
            else:
                line += '.'
        print(f'  y={yy}: {line}')
    sys.exit(0)

print(f'No orange/green swatch found in {sys.argv[1]}', file=sys.stderr)
sys.exit(1)
