# -*- coding: utf-8 -*-
"""Точные центры нарисованных сот: утолщаем линии, чтобы заливка не текла
через разрывы, метим области, отбираем соты по размеру."""
import io, json, sys
from collections import deque
from PIL import Image, ImageFilter

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

LAYER_X, LAYER_Y = 111, 313
CANVAS_W, CANVAS_H = 3280, 1798
SCALE = 2

img = Image.open("cells-layer.png").convert("RGBA")
alpha = img.getchannel("A")
W, H = alpha.size
small = alpha.resize((W // SCALE, H // SCALE), Image.BILINEAR)
small = small.filter(ImageFilter.MaxFilter(5))      # утолщаем линии
sw, sh = small.size
px = small.load()
line = bytearray(sw * sh)
for y in range(sh):
    row = y * sw
    for x in range(sw):
        line[row + x] = 1 if px[x, y] > 40 else 0

seen = bytearray(sw * sh)
cells = []
for sy in range(sh):
    for sx in range(sw):
        i = sy * sw + sx
        if line[i] or seen[i]:
            continue
        q = deque([(sx, sy)])
        seen[i] = 1
        xs = ys = 0
        n = 0
        minx = maxx = sx
        miny = maxy = sy
        while q:
            cx, cy = q.popleft()
            xs += cx; ys += cy; n += 1
            if cx < minx: minx = cx
            if cx > maxx: maxx = cx
            if cy < miny: miny = cy
            if cy > maxy: maxy = cy
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = cx + dx, cy + dy
                if 0 <= nx < sw and 0 <= ny < sh:
                    j = ny * sw + nx
                    if not seen[j] and not line[j]:
                        seen[j] = 1
                        q.append((nx, ny))
        w = (maxx - minx + 1) * SCALE
        h = (maxy - miny + 1) * SCALE
        if n * SCALE * SCALE < 8000 or w > 420 or h > 360:
            continue
        cells.append({
            "w": w, "h": h,
            "cx": xs / n * SCALE + LAYER_X, "cy": ys / n * SCALE + LAYER_Y,
            "area": n * SCALE * SCALE,
        })

print("нашлось сот: %d" % len(cells))
if cells:
    ws = sorted(c["w"] for c in cells)
    hs = sorted(c["h"] for c in cells)
    print("ширина %d…%d, высота %d…%d, отношение h/w в среднем %.3f"
          % (ws[0], ws[-1], hs[0], hs[-1], sum(c["h"] / c["w"] for c in cells) / len(cells)))

json.dump([{k: round(v, 2) for k, v in c.items()} for c in cells],
          open("cells-found.json", "w"), ensure_ascii=False)
print("сохранено в cells-found.json")
