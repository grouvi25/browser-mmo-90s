# -*- coding: utf-8 -*-
"""Пишем в проект таблицу клеток и карту соседства, снятые с PSD."""
import io, json, sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

REPO = "C:/Users/misha/ZCodeProject/browser-mmo-90s/"
g = json.load(open("grid-from-psd.json"))
cells = g["cells"]
adj = g["adjacency"]
COLS, ROWS = g["cols"], g["rows"]

# соты «остриём вверх»
POLY = "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)"

HEAD = ("// Сетка снята с решётки слоя «Клетки» файла «ПБ основа.psd»:\n"
        "// центры и шаг посчитаны по самому рисунку, а не подобраны на глаз.\n"
        "// Поле перспективное — клетки растут к переднему краю, поэтому\n"
        "// размеры у каждого ряда свои. Файл сгенерирован, править руками не нужно.\n")


def order(key):
    x, y = key.split(":")
    return int(y), int(x)


# ── фронт: таблица клеток ────────────────────────────────────
lines = [HEAD,
         "export interface DesignerCell {\n"
         "  x: number; y: number\n"
         "  left: number; top: number; width: number; height: number\n"
         "  polygon: string\n"
         "  centerX: number; centerY: number\n"
         "}\n\n",
         "export const DESIGNER_BATTLE_COLUMNS = %d\n" % COLS,
         "export const DESIGNER_BATTLE_ROWS = %d\n\n" % ROWS,
         "export const DESIGNER_BATTLE_CELLS: readonly DesignerCell[] = [\n"]
for c in cells:
    lines.append("  { x: %d, y: %d, left: %.4f, top: %.4f, width: %.4f, height: %.4f,"
                 " polygon: '%s', centerX: %.4f, centerY: %.4f },\n"
                 % (c["x"], c["y"], c["left"], c["top"], c["width"], c["height"],
                    POLY, c["centerX"], c["centerY"]))
lines.append("] as const\n")
open(REPO + "frontend/src/shared/lib/designer-battle-grid.ts", "w",
     encoding="utf-8", newline="").write("".join(lines))

# ── соседство: общий текст для клиента и сервера ─────────────
body = []
for key in sorted(adj, key=order):
    body.append("  '%s': [%s],\n" % (key, ", ".join("'%s'" % n for n in adj[key])))
body = "".join(body)

front = (HEAD +
         "// Зеркало backend/src/modules/battles/designer-grid-adjacency.ts.\n"
         "export type BattleCellKey = `${number}:${number}`\n\n"
         "export const DESIGNER_CELL_NEIGHBOURS: "
         "Readonly<Record<BattleCellKey, readonly BattleCellKey[]>> = {\n"
         + body + "} as const\n")
open(REPO + "frontend/src/shared/lib/designer-battle-adjacency.ts", "w",
     encoding="utf-8", newline="").write(front)

centers = "".join("  '%s': [%.4f, %.4f],\n"
                  % ("%d:%d" % (c["x"], c["y"]), c["centerX"], c["centerY"])
                  for c in cells)
back = (HEAD +
        "// Клиентское зеркало — frontend/src/shared/lib/designer-battle-adjacency.ts.\n"
        "export const DESIGNER_CELL_NEIGHBOURS: "
        "Readonly<Record<string, readonly string[]>> = {\n" + body + "} as const\n\n"
        "// Центры клеток в процентах поля: нужны для выбора клетки под бойца.\n"
        "export const DESIGNER_CELL_CENTERS: Readonly<Record<string, readonly [number, number]>> = {\n"
        + centers + "} as const\n")
open(REPO + "backend/src/modules/battles/designer-grid-adjacency.ts", "w",
     encoding="utf-8", newline="").write(back)

print("записано: клеток %d, ключей соседства %d, поле %dx%d" % (len(cells), len(adj), COLS, ROWS))
print("  frontend/src/shared/lib/designer-battle-grid.ts")
print("  frontend/src/shared/lib/designer-battle-adjacency.ts")
print("  backend/src/modules/battles/designer-grid-adjacency.ts")
