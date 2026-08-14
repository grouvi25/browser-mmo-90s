# -*- coding: utf-8 -*-
"""Обводим каждую нарисованную соту её собственным многоугольником.

Соты на арте нарисованы от руки и слегка кривые: правильный шестиугольник
садится на них с зазорами. Заливаем клетку от её центра, берём выпуклую
оболочку и вытаскиваем шесть вершин — по крайним точкам в шести
направлениях. Результат отдаётся в процентах от рамки клетки, то есть
прямо в формате CSS polygon().
"""
import io, json, math, sys
from collections import deque
from PIL import Image, ImageFilter

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

LAYER_X, LAYER_Y = 111, 313
SCALE = 2

img = Image.open("cells-layer.png").convert("RGBA")
alpha = img.getchannel("A")
W, H = alpha.size
small = alpha.resize((W // SCALE, H // SCALE), Image.BILINEAR).filter(ImageFilter.MaxFilter(3))
sw, sh = small.size
px = small.load()
wall = [[px[x, y] > 40 for x in range(sw)] for y in range(sh)]


def region(cx, cy):
    """Клетка как множество точек: заливка от центра до линий."""
    sx, sy = int((cx - LAYER_X) / SCALE), int((cy - LAYER_Y) / SCALE)
    if not (0 <= sx < sw and 0 <= sy < sh) or wall[sy][sx]:
        return None
    seen = {(sx, sy)}
    q = deque([(sx, sy)])
    pts = []
    while q:
        x, y = q.popleft()
        pts.append((x, y))
        if len(pts) > 40000:
            return None                      # заливка утекла
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < sw and 0 <= ny < sh and (nx, ny) not in seen and not wall[ny][nx]:
                seen.add((nx, ny))
                q.append((nx, ny))
    return pts


def hull(points):
    pts = sorted(set(points))
    if len(pts) < 3:
        return pts
    def half(seq):
        out = []
        for p in seq:
            while len(out) >= 2 and ((out[-1][0] - out[-2][0]) * (p[1] - out[-2][1])
                                     - (out[-1][1] - out[-2][1]) * (p[0] - out[-2][0])) <= 0:
                out.pop()
            out.append(p)
        return out
    return half(pts)[:-1] + half(reversed(pts))[:-1]


# вершины соты «остриём вверх»: верх, верх-право, низ-право, низ, низ-лево, верх-лево
DIRECTIONS = [(0, -1), (0.866, -0.5), (0.866, 0.5), (0, 1), (-0.866, 0.5), (-0.866, -0.5)]

rows = json.load(open("cells-rows.json"))
grid = json.load(open("grid-from-psd.json"))
boxes = {(c["x"], c["y"]): c for c in grid["cells"]}
CANVAS_W, CANVAS_H = 3280, 1798

out, fallback = {}, 0
for y, row in enumerate(rows):
    row = sorted(row, key=lambda c: c["cx"])
    for x, cell in enumerate(row):
        pts = region(cell["cx"], cell["cy"])
        box = boxes[(x, y)]
        if not pts or len(pts) < 200:
            fallback += 1
            continue
        hp = hull(pts)
        verts = []
        for dx, dy in DIRECTIONS:
            best = max(hp, key=lambda p: p[0] * dx + p[1] * dy)
            verts.append((best[0] * SCALE + LAYER_X, best[1] * SCALE + LAYER_Y))
        # в проценты от рамки клетки
        left = box["left"] / 100 * CANVAS_W
        top = box["top"] / 100 * CANVAS_H
        w = box["width"] / 100 * CANVAS_W
        h = box["height"] / 100 * CANVAS_H
        poly = [((vx - left) / w * 100, (vy - top) / h * 100) for vx, vy in verts]
        out["%d:%d" % (x, y)] = poly

print("обведено сот: %d, откат к правильному шестиугольнику: %d" % (len(out), fallback))
sample = out.get("4:4")
if sample:
    print("пример 4:4: " + ", ".join("%.1f%% %.1f%%" % p for p in sample))
json.dump(out, open("cell-polygons.json", "w"))
