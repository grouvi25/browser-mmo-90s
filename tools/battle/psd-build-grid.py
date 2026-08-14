# -*- coding: utf-8 -*-
"""Генерируем таблицу клеток и карту соседства прямо из PSD-решётки.

Размеры берём не из найденных областей (они меньше на толщину линии),
а из шага сетки: ширина клетки равна шагу ряда, высота — вертикальному
шагу, делённому на 0.75 (соты «остриём вверх» находят друг на друга
на четверть высоты). Соседство выводим геометрически: кто реально
касается, тот и сосед — тогда логика не может разойтись с картинкой.
"""
import io, json, math, sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

CANVAS_W, CANVAS_H = 3280, 1798
rows = json.load(open("cells-rows.json"))
ROWS = len(rows)
COLS = len(rows[0])

steps, centres_y = [], []
for row in rows:
    row.sort(key=lambda c: c["cx"])
    steps.append((row[-1]["cx"] - row[0]["cx"]) / (COLS - 1))
    centres_y.append(sum(c["cy"] for c in row) / len(row))

# вертикальный шаг; для последнего ряда продолжаем рост
deltas = [centres_y[i + 1] - centres_y[i] for i in range(ROWS - 1)]
deltas.append(deltas[-1] + (deltas[-1] - deltas[-2]))

cells = {}
for y, row in enumerate(rows):
    w = steps[y]
    h = deltas[y] / 0.75
    x0 = row[0]["cx"]
    for x in range(COLS):
        cx = x0 + w * x
        cy = centres_y[y]
        cells[(x, y)] = {
            "cx": cx, "cy": cy, "w": w, "h": h,
            "left": cx - w / 2, "top": cy - h / 2,
        }

print("сетка %dx%d, всего клеток %d" % (COLS, ROWS, len(cells)))
print("ширина клетки: %.0f…%.0f px, высота: %.0f…%.0f px"
      % (steps[0], steps[-1], deltas[0] / 0.75, deltas[-1] / 0.75))

# ── соседство по геометрии ───────────────────────────────────
adj = {}
for key, c in cells.items():
    near = []
    for other, o in cells.items():
        if other == key:
            continue
        d = math.hypot(c["cx"] - o["cx"], c["cy"] - o["cy"])
        # соседями могут быть только клетки того же или смежного ряда,
        # иначе на краю поля в шестёрку пролезает клетка через ряд
        dy = abs(key[1] - other[1])
        dx = abs(key[0] - other[0])
        if dy > 1 or (dy == 0 and dx != 1) or (dy == 1 and dx > 1):
            continue
        if d < c["w"] * 1.18:
            near.append((d, other))
    near.sort()
    adj[key] = [k for _, k in near[:6]]

# симметрия: оставляем только взаимные связи
sym = {k: sorted({n for n in v if k in adj[n]}, key=lambda t: (t[1], t[0])) for k, v in adj.items()}
asym = sum(1 for k, v in adj.items() for n in v if k not in adj[n])
degrees = {}
for k, v in sym.items():
    degrees.setdefault(len(v), 0)
    degrees[len(v)] += 1
print("односторонних связей отброшено: %d" % asym)
print("распределение соседей:", dict(sorted(degrees.items())))

interior_bad = [k for k, v in sym.items()
                if 0 < k[0] < COLS - 1 and 0 < k[1] < ROWS - 1 and len(v) != 6]
print("внутренних клеток не с шестью соседями: %d %s" % (len(interior_bad), interior_bad[:8]))

# связность
start = (0, 0)
seen, stack = {start}, [start]
while stack:
    cur = stack.pop()
    for nb in sym[cur]:
        if nb not in seen:
            seen.add(nb)
            stack.append(nb)
print("достижимо клеток: %d из %d" % (len(seen), len(cells)))

pct = lambda v, total: round(v / total * 100, 4)
out = {
    "cols": COLS, "rows": ROWS,
    "cells": [{
        "x": x, "y": y,
        "left": pct(cells[(x, y)]["left"], CANVAS_W),
        "top": pct(cells[(x, y)]["top"], CANVAS_H),
        "width": pct(cells[(x, y)]["w"], CANVAS_W),
        "height": pct(cells[(x, y)]["h"], CANVAS_H),
        "centerX": pct(cells[(x, y)]["cx"], CANVAS_W),
        "centerY": pct(cells[(x, y)]["cy"], CANVAS_H),
    } for y in range(ROWS) for x in range(COLS)],
    "adjacency": {"%d:%d" % k: ["%d:%d" % n for n in v] for k, v in sym.items()},
}
json.dump(out, open("grid-from-psd.json", "w"), ensure_ascii=False)
print("сохранено в grid-from-psd.json")
