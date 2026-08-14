# -*- coding: utf-8 -*-
"""Раскладываем найденные соты в ряды и колонки и смотрим структуру."""
import io, json, sys
from statistics import median

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

cells = json.load(open("cells-found.json"))
print("всего областей: %d" % len(cells))

# Ряды: у сот «остриём вверх» ряды идут по общей высоте центра
cells.sort(key=lambda c: c["cy"])
rows, cur = [], [cells[0]]
for c in cells[1:]:
    if c["cy"] - cur[-1]["cy"] > median(x["h"] for x in cells) * 0.45:
        rows.append(cur)
        cur = [c]
    else:
        cur.append(c)
rows.append(cur)

print("рядов: %d" % len(rows))
for i, row in enumerate(rows):
    row.sort(key=lambda c: c["cx"])
    hs = [c["h"] for c in row]
    ws = [c["w"] for c in row]
    steps = [round(row[j + 1]["cx"] - row[j]["cx"]) for j in range(len(row) - 1)]
    print("  ряд %d: сот %2d, cy≈%4.0f, h %3d…%3d, w %3d…%3d, шаг %s"
          % (i, len(row), sum(c["cy"] for c in row) / len(row),
             min(hs), max(hs), min(ws), max(ws), steps))

json.dump(rows, open("cells-rows.json", "w"), ensure_ascii=False)
