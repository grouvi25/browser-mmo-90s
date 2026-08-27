# -*- coding: utf-8 -*-
"""Соты новой арены: заливка светлых внутренностей внутри границ поля."""
import io, sys, os
from collections import deque
from PIL import Image, ImageFilter
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
HERE = os.path.dirname(os.path.abspath(__file__))

im = Image.open(os.path.join(HERE, 'karta.png')).convert('L')
# арена: песчаная площадка без вагонов
BOX = (430, 420, 1340, 730)
crop = im.crop(BOX)
cw, ch = crop.size
# линии решётки утолщаем, иначе заливка течёт через разрывы штриха
work = crop.filter(ImageFilter.MinFilter(3))
px = work.load()
DARK = 175
wall = [[px[x, y] < DARK for x in range(cw)] for y in range(ch)]
print('арена %dx%d, тёмных %.1f%%' % (cw, ch, 100*sum(sum(r) for r in wall)/(cw*ch)))

seen = [[False]*cw for _ in range(ch)]
cells = []
for sy in range(0, ch, 3):
    for sx in range(0, cw, 3):
        if wall[sy][sx] or seen[sy][sx]:
            continue
        q = deque([(sx, sy)]); seen[sy][sx] = True; pts = []
        leaked = False
        while q:
            x, y = q.popleft(); pts.append((x, y))
            if len(pts) > 20000: leaked = True; break
            for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
                nx, ny = x+dx, y+dy
                if 0 <= nx < cw and 0 <= ny < ch and not seen[ny][nx] and not wall[ny][nx]:
                    seen[ny][nx] = True; q.append((nx, ny))
        if leaked or len(pts) < 900: continue
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        cells.append({'n': len(pts), 'w': max(xs)-min(xs)+1, 'h': max(ys)-min(ys)+1,
                      'cx': BOX[0]+sum(xs)/len(xs), 'cy': BOX[1]+sum(ys)/len(ys)})

cells.sort(key=lambda c: (round(c['cy']/40), c['cx']))
print('\nнайдено сот: %d' % len(cells))
rows = {}
for c in cells:
    rows.setdefault(round(c['cy']/40), []).append(c)
for key in sorted(rows):
    row = rows[key]
    print('ряд y≈%4d: %d сот, центры x: %s'
          % (row[0]['cy'], len(row), ' '.join('%d' % c['cx'] for c in row)))
    print('            размеры: %s' % ' '.join('%dx%d' % (c['w'], c['h']) for c in row))
