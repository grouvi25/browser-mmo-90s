// «Жилой сектор»: двор панельной девятиэтажки 90-х — подъезды, балконы
// с бельём, антенны, второй дом вглубь, берёза, выбивалка с ковром,
// «Жигули», доска объявлений. Тушь + акварель, как сцены игры.
const fs = require('fs')
const L = require('./lib.cjs')
const D = require('./details-houses.cjs')
const { rr, rnd, box, ink, wash, line, hatch, blot, windowAt, pshape, f } = L
L.setSeed(4417)
const W = 2001, H = 992
const out = []
const add = s => out.push(s)
const shape = (pts, fill, o = {}) => pshape(pts, fill, { shadeSide: 'top', shade: 0.3, ...o })

add(L.sky(W, 20, 660))
for (const [x, w, top] of [[1240, 220, 230], [1470, 180, 270]]) add(D.farBlock(x, top, w, 470))
// Птицы.
for (let i = 0; i < 7; i++) { const x = rr(300, 1500), y = rr(50, 160), s = rr(6, 11); add(ink([[x - s, y - s * 0.4], [x, y], [x + s, y - s * 0.5]], { w: 1.4, double: false, op: 0.7 })) }

// ===== Девятиэтажка =====
const BX = 70, BY = 118, BW = 1190, FLOOR = 54, FLOORS = 9, BB = BY + FLOOR * FLOORS + 70
add(shape(box(BX, BY, BW, BB - BY), '#c8c1b6', { shadeSide: 'right', shade: 0.25, blooms: 7, light: 3 }))
// Крыша: парапет, будка лифта, антенны.
add(shape(box(BX - 6, BY - 14, BW + 12, 16), '#9e968c'))
add(shape(box(560, BY - 64, 150, 52), '#b2aaa0'))
for (const x of [200, 360, 800, 980, 1120]) {
  const h = rr(50, 90)
  add(ink([[x, BY - 14], [x, BY - 14 - h]], { w: 1.8 }))
  for (let k = 0; k < 3; k++) add(line(x - 24 + k * 6, BY - 14 - h + 10 + k * 12, x + 24 - k * 6, BY - 14 - h + 10 + k * 12, { w: 1.2, double: false }))
}
// Стыки панелей.
for (let i = 1; i <= FLOORS; i++) add(`<path d="M${BX} ${BY + i * FLOOR} H${BX + BW}" stroke="#7a7268" stroke-width="1.1" opacity=".45"/>`)
for (let x = BX + 132; x < BX + BW; x += 132) add(`<path d="M${x} ${BY} V${BB - 70}" stroke="#7a7268" stroke-width="1" opacity=".35"/>`)
// Окна и балконы.
const cols = [], colW = 50, gap = 99
for (let x = BX + 40; x < BX + BW - 60; x += gap) cols.push(x)
const balconyCols = new Set([2, 3, 7, 8])
const laundry = ['#c94f4f', '#e2d6a6', '#6f8fb0', '#f0ece6', '#7d9c6c']
for (let r = 0; r < FLOORS; r++) {
  const y = BY + r * FLOOR + 12
  cols.forEach((x, ci) => {
    const lit = rnd() < 0.06
    if (balconyCols.has(ci)) {
      const glazed = rnd() < 0.45
      add(windowAt(x, y, colW, 34, { lit }))
      // Плита балкона и ограждение.
      add(shape(box(x - 14, y + 34, colW + 28, 8), '#a59d92', { shade: 0 }))
      if (glazed) {
        add(shape(box(x - 14, y + 8, colW + 28, 26), ['#9b7b5e', '#b9b3a8', '#8a8f8a'][ci % 3], { shade: 0.15 }))
        for (let k = 1; k < 4; k++) add(line(x - 14 + k * (colW + 28) / 4, y + 8, x - 14 + k * (colW + 28) / 4, y + 34, { w: 1, double: false }))
      } else {
        add(ink(box(x - 14, y + 18, colW + 28, 16), { closed: true, w: 1.3 }))
        for (let k = 0; k < 9; k++) add(`<path d="M${x - 12 + k * 9} ${y + 19} v14" stroke="${L.INK}" stroke-width=".9" opacity=".55"/>`)
        if (rnd() < 0.55) {
          add(`<path d="M${x - 10} ${y + 6} Q${x + colW / 2} ${y + 12} ${x + colW + 10} ${y + 6}" fill="none" stroke="${L.INK}" stroke-width=".8" opacity=".6"/>`)
          for (let k = 0; k < 3; k++) { const wd = k === 1 ? 24 : 15, lx = x - 6 + k * 22, c = laundry[(r + k + ci) % laundry.length]; add(wash([[lx, y + 8], [lx + wd, y + 9], [lx + wd - 1, y + 8 + (k === 1 ? 24 : 16)], [lx + 1, y + 8 + (k === 1 ? 26 : 17)]], c, { op: 0.9, amp: 0.8 })); add(ink([[lx, y + 8], [lx + wd, y + 9], [lx + wd - 1, y + 8 + (k === 1 ? 24 : 16)], [lx + 1, y + 8 + (k === 1 ? 26 : 17)]], { closed: true, w: 0.8, double: false, op: 0.6 })) }
        }
      }
    } else {
      add(windowAt(x, y, colW, 34, { lit }))
    }
    if (rnd() < 0.05) add(`<ellipse cx="${x + colW + 8}" cy="${y + 10}" rx="9" ry="11" fill="#d9d9d4" stroke="${L.INK}" stroke-width="1.2"/>`)
  })
}
// Первый этаж: подъезды с козырьками, двери, номера, лавки.
const groundY = BB - 70
add(shape(box(BX, groundY, BW, 70), '#b0a89d', { shadeSide: 'bottom' }))
for (const [i, dx] of [[1, 230], [2, 620], [3, 1010]]) {
  add(shape(box(dx - 70, groundY - 10, 140, 12), '#958c80', { shade: 0 }))
  add(line(dx - 62, groundY + 2, dx - 62, groundY + 64, { w: 2 }) + line(dx + 62, groundY + 2, dx + 62, groundY + 64, { w: 2 }))
  add(shape(box(dx - 34, groundY + 8, 68, 62), i === 2 ? '#5b6e5a' : '#6e5245', { shadeSide: 'bottom' }))
  add(`<rect x="${dx + 18}" y="${groundY + 28}" width="10" height="16" fill="#3a3a3a" opacity=".8"/>`)
  add(wash(box(dx - 16, groundY - 34, 32, 20), '#3f5d86', { op: 0.9, amp: 0.5 }) + `<text x="${dx - 5}" y="${groundY - 19}" font-family="Arial" font-size="15" fill="#f1f1ee">${i}</text>`)
  // Лавка у подъезда.
  add(shape(box(dx + 80, groundY + 46, 110, 9), '#8a6a4e', { shade: 0 }))
  add(line(dx + 88, groundY + 55, dx + 88, groundY + 72, { w: 2 }) + line(dx + 182, groundY + 55, dx + 182, groundY + 72, { w: 2 }))
}
// Граффити и объявления.
add(`<text x="300" y="${groundY + 52}" font-family="Arial Black, Impact, sans-serif" font-size="26" fill="#a34343" opacity=".6" transform="rotate(-3 300 ${groundY + 52})">КИНО</text>`)
add(shape(box(760, groundY + 10, 96, 52), '#8e7a5c', { shade: 0.1 }))
for (const [x, y, w, h, r] of [[766, groundY + 14, 26, 20, -4], [798, groundY + 12, 22, 26, 3], [826, groundY + 18, 24, 18, -2], [770, groundY + 38, 30, 18, 5]]) add(`<g transform="rotate(${r} ${x} ${y})">${wash(box(x, y, w, h), '#f3efe6', { op: 0.95, amp: 0.4 })}${ink(box(x, y, w, h), { closed: true, w: 0.9, double: false })}<path d="M${x + 4} ${y + 6} h${w - 8} M${x + 4} ${y + 11} h${w - 10}" stroke="#555" stroke-width=".8"/></g>`)
add(`<text x="770" y="${groundY + 8}" font-family="Arial" font-size="11" fill="#2a2320">ОБЪЯВЛЕНИЯ</text>`)
// Табличка с адресом.
add(wash(box(BX + BW - 150, BY + 60, 120, 36), '#3f5d86', { op: 0.92, amp: 0.6 }) + ink(box(BX + BW - 150, BY + 60, 120, 36), { closed: true, w: 1.4 }))
add(`<text x="${BX + BW - 142}" y="${BY + 76}" font-family="Arial" font-size="12" fill="#f3f2ee">ул. Строителей</text><text x="${BX + BW - 108}" y="${BY + 92}" font-family="Arial" font-size="14" font-weight="bold" fill="#f3f2ee">25</text>`)
add(D.streaks(BX, BY, BW, BB - BY - 70, 26, '#6f6457', 0.16))
for (let i = 0; i < 8; i++) add(D.crack(rr(BX + 40, BX + BW - 60), rr(BY + 40, BB - 90), rr(30, 70), { w: 0.9, op: 0.4, branches: 1 }))

// ===== Второй дом вглубь (перспектива) =====
const P2 = [[1290, 210], [1960, 300], [1960, 652], [1290, 652]]
add(shape(P2, '#bdb5ab', { shadeSide: 'right', shade: 0.3 }))
for (let r = 0; r < 7; r++) {
  for (let c = 0; c < 9; c++) {
    const t = c / 9, x = 1312 + t * 620, topY = 210 + t * 90, h = (652 - topY - 70) / 7
    const y = topY + 16 + r * h, ww = 42 - t * 12, hh = h * 0.55
    add(wash([[x, y], [x + ww, y + ww * 0.13], [x + ww, y + ww * 0.13 + hh], [x, y + hh]], rnd() < 0.05 ? '#e8c879' : '#8f9aa5', { op: 0.55, amp: 0.6 }))
    add(ink([[x, y], [x + ww, y + ww * 0.13], [x + ww, y + ww * 0.13 + hh], [x, y + hh]], { closed: true, w: 1, op: 0.7, double: false }))
  }
}

// ===== Двор =====
add(wash([[30, 652], [W - 30, 652], [W - 30, H - 30], [30, H - 30]], '#968e86', { op: 0.6, amp: 3 }))
add(ink([[30, 652], [W - 30, 652]], { w: 2.2 }))
for (const [cx, cy, rx, ry] of [[380, 800, 260, 60], [1560, 760, 260, 50], [980, 930, 300, 40]]) add(blot(cx, cy, rx, ry, '#7e8a5c', 0.42))
for (let i = 0; i < 60; i++) { const x = rr(60, 1950), y = rr(700, 960); if (rnd() < 0.5) add(ink([[x, y], [x + rr(-6, 6), y - rr(6, 18)]], { w: 1, op: 0.6, double: false, color: '#46553a' })) }
for (let i = 0; i < 18; i++) add(D.crack(rr(60, 1900), rr(690, 960), rr(50, 140), { w: rr(0.9, 1.4), op: 0.5 }))
for (const [cx, cy, rx, ry] of [[720, 860, 150, 28], [1250, 760, 120, 22]]) { add(blot(cx, cy, rx, ry, '#7f8b9a', 0.42)); add(`<path d="M${cx - rx * 0.5} ${cy} h${rx * 0.4} M${cx - rx * 0.1} ${cy + 7} h${rx * 0.5}" stroke="#f1eef0" stroke-width="2" opacity=".55"/>`) }

// Выбивалка с ковром.
add(ink([[470, 840], [470, 690]], { w: 4 }) + ink([[700, 840], [700, 690]], { w: 4 }) + ink([[462, 694], [708, 694]], { w: 4 }))
add(shape([[500, 696], [670, 696], [662, 800], [508, 806]], '#9a3b38', { shade: 0.2 }))
for (let k = 0; k < 4; k++) add(ink([[520, 712 + k * 24], [650, 712 + k * 24]], { w: 1.2, color: '#e3c88a', op: 0.7, double: false }))
add(ink([[585, 704], [610, 750], [585, 796], [560, 750]], { closed: true, w: 1.6, color: '#e3c88a', op: 0.85, double: false }))
// Песочница.
add(shape([[880, 760], [1100, 760], [1120, 820], [860, 820]], '#c9a36a', { shadeSide: 'bottom' }))
add(ink([[870, 760], [1110, 760], [1130, 822], [850, 822]], { closed: true, w: 2.4 }))

// Берёза справа на переднем плане: изогнутый сужающийся ствол, свисающие
// ветки, осенняя крона мелкими мазками.
const trunk = [[1760, 962], [1772, 780], [1768, 640], [1782, 500], [1790, 360], [1798, 250]]
const trunkR = [[1828, 962], [1814, 780], [1806, 640], [1808, 500], [1806, 360], [1804, 250]]
const TP = [...trunk, ...trunkR.slice().reverse()]
add(pshape(TP, '#ece8e1', { shadeSide: 'right', shade: 0.3, light: 0 }))
for (let y = 300; y < 950; y += rr(22, 46)) { const t = (y - 250) / 712, xl = 1798 - t * 34, wd = 12 + t * 50; add(`<path d="M${f(xl + rr(0, wd * 0.4))} ${f(y)} h${f(rr(wd * 0.25, wd * 0.6))}" stroke="${L.INK}" stroke-width="${f(rr(2, 4.5))}" stroke-linecap="round" opacity=".85"/>`) }
const branches = [[1790, 420, 1660, 300], [1796, 360, 1910, 240], [1784, 520, 1640, 470], [1800, 470, 1960, 410], [1798, 300, 1740, 180], [1802, 290, 1870, 160]]
for (const [x1, y1, x2, y2] of branches) {
  add(ink([[x1, y1], [(x1 + x2) / 2 + rr(-14, 14), (y1 + y2) / 2 + rr(-10, 10)], [x2, y2]], { w: 2.6 }))
  for (let k = 0; k < 6; k++) { const t = rr(0.3, 1), px = x1 + (x2 - x1) * t, py = y1 + (y2 - y1) * t; add(`<path d="M${f(px)} ${f(py)} q${f(rr(-8, 8))} ${f(rr(30, 60))} ${f(rr(-12, 12))} ${f(rr(70, 120))}" fill="none" stroke="${L.INK}" stroke-width="1" opacity=".55"/>`) }
}
const leaf = ['#c9a547', '#b38a3c', '#d6bd6a', '#9a9a52', '#c07a3c']
for (let i = 0; i < 260; i++) {
  const [x1, y1, x2, y2] = branches[i % branches.length], t = rr(0.2, 1.05)
  const cx = x1 + (x2 - x1) * t + rr(-50, 50), cy = y1 + (y2 - y1) * t + rr(-30, 90)
  add(`<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rr(4, 11))}" ry="${f(rr(3, 7))}" transform="rotate(${f(rr(-60, 60))} ${f(cx)} ${f(cy)})" fill="${leaf[i % leaf.length]}" opacity="${f(rr(0.45, 0.85))}"/>`)
}
for (let i = 0; i < 26; i++) add(blot(rr(1500, 1980), rr(820, 970), rr(4, 9), rr(3, 5), ['#c9a547', '#b07a35'][i % 2], 0.65))

// Лавка и урна во дворе.
add(pshape(box(260, 900, 200, 14), '#8a6a4e', { shade: 0 }) + ink([[270, 914], [270, 948]], { w: 2.4 }) + ink([[450, 914], [450, 948]], { w: 2.4 }) + pshape(box(258, 872, 204, 12), '#7d5f45', { shade: 0 }))
add(pshape(box(500, 900, 46, 52), '#66706a', { shadeSide: 'right' }))
// «Жигули»-шестёрка, бежевая.
const zhig = (ox, oy, s) => {
  let c = blot(ox + 230 * s, oy + 132 * s, 250 * s, 18 * s, '#3c3a3e', 0.4)
  const P = pts => pts.map(([x, y]) => [ox + x * s, oy + y * s])
  c += pshape(P([[0, 80], [10, 56], [110, 50], [150, 8], [330, 6], [380, 50], [460, 58], [470, 84], [466, 112], [6, 112]]), '#cdbb93', { shadeSide: 'bottom', shade: 0.35 })
  c += wash(P([[160, 16], [236, 14], [236, 50], [128, 52]]), '#7d8b96', { op: 0.85, amp: 1 }) + ink(P([[160, 16], [236, 14], [236, 50], [128, 52]]), { closed: true, w: 1.4 })
  c += wash(P([[246, 14], [322, 14], [366, 50], [246, 50]]), '#6f7d88', { op: 0.85, amp: 1 }) + ink(P([[246, 14], [322, 14], [366, 50], [246, 50]]), { closed: true, w: 1.4 })
  c += line(ox + 4 * s, oy + 86 * s, ox + 466 * s, oy + 86 * s, { w: 2.2, color: '#d8dbdd' })
  c += line(ox + 240 * s, oy + 52 * s, ox + 240 * s, oy + 110 * s, { w: 1.3 })
  for (const wx of [92, 376]) { c += `<circle cx="${ox + wx * s}" cy="${oy + 112 * s}" r="${30 * s}" fill="#222" filter="url(#wc)"/><circle cx="${ox + wx * s}" cy="${oy + 112 * s}" r="${14 * s}" fill="#b7bcc0"/>` }
  c += wash(P([[448, 64], [468, 66], [468, 78], [448, 76]]), '#f3e7b0', { op: 0.95, amp: 0.4 })
  return c
}
add(zhig(1140, 820, 1.05))

// Фонарь.
add(ink([[1300, 820], [1302, 600], [1340, 572], [1392, 572]], { w: 4.5 }))
add(pshape([[1380, 568], [1414, 568], [1408, 586], [1386, 586]], '#4a4e52', { shade: 0 }))

for (const [x, y, rx, ry] of [[0, 992, 520, 260], [2001, 992, 520, 260], [0, 0, 380, 220], [2001, 0, 380, 220]]) add(`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#4a3d48" opacity=".22" filter="url(#wcSoft)"/>`)
add(L.stains(W, H, 18))
add(L.frame(W, H))
add(L.overlay(W, H))

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${L.defs(W, H)}${out.join('\n')}</svg>`
fs.writeFileSync(__dirname + '/scene-housing.svg', svg)
console.log('svg', (svg.length / 1024).toFixed(0) + ' KB')
