// «Дома бригад»: улица резиденций бригад 90-х — кирпичный коттедж с башенкой,
// особняк за глухим забором с воротами и будкой охраны, дача за профнастилом,
// «шестисотый» у ворот. Тушь + акварель, как сцены Центра и Гаражей.
const fs = require('fs')
const L = require('./lib.cjs')
const D = require('./details-houses.cjs')
const { rr, rnd, box, ink, wash, line, hatch, blot, windowAt, pshape } = L
const shape = (pts, fill, o = {}) => pshape(pts, fill, { shadeSide: 'top', shade: 0.32, ...o })
L.setSeed(9021)
const W = 2001, H = 992
const out = []
const add = s => out.push(s)

add(L.sky(W, 30, 640))

// Дальний план: панельные дома в дымке.
for (const [x, w, top] of [[60, 260, 210], [300, 200, 250], [470, 300, 190], [1180, 260, 230], [1420, 240, 205], [1650, 320, 240]]) add(D.farBlock(x, top, w, 470))

// Столбы и провода.
for (const px of [120, 1890]) {
  add(ink([[px, 640], [px + rr(-3, 3), 120]], { w: 5, op: 0.85 }))
  add(line(px - 34, 150, px + 34, 146, { w: 3 }))
  add(line(px - 26, 176, px + 26, 174, { w: 2.4 }))
}
for (const [y1, y2, sag] of [[150, 146, 70], [176, 174, 90], [160, 160, 55]]) {
  add(`<path d="M120 ${y1} Q1005 ${y1 + sag * 2} 1890 ${y2}" fill="none" stroke="${L.INK}" stroke-width="1.6" opacity=".75" filter="url(#inkf)"/>`)
}

// ===== Левый дом: кирпичный коттедж с башенкой =====
const brick = '#a77467', roofGreen = '#5f6a63'
add(shape(box(195, 300, 400, 268), brick, { op: 0.82 }))
for (let yy = 312; yy < 560; yy += 14) for (let xx = 205 + ((yy / 14) % 2) * 12; xx < 585; xx += 26) if (rnd() < 0.55) add(`<path d="M${xx} ${yy} h${(10 + rnd() * 8).toFixed(1)}" stroke="#5b3027" stroke-width="1" opacity=".35"/>`)
add(shape([[175, 302], [395, 196], [615, 302]], roofGreen, { op: 0.85 }))
add(hatch(200, 210, 380, 90, { gap: 11, op: 0.22 }))
// Башенка.
add(shape(box(108, 248, 118, 320), '#ad7a6c', { op: 0.85 }))
add(shape([[96, 252], [167, 104], [238, 252]], roofGreen, { op: 0.9 }))
add(line(167, 104, 167, 62, { w: 2 }))
add(wash([[168, 64], [205, 72], [168, 82]], '#a8323a', { op: 0.85, amp: 1 }) + ink([[168, 64], [205, 72], [168, 82]], { closed: true, w: 1.3 }))
for (const yy of [290, 400]) {
  add(windowAt(140, yy, 52, 74))
  add(ink([[138, yy], [166, yy - 22], [194, yy]], { w: 1.6 }))
}
// Окна дома: арочные, два этажа.
for (const yy of [330, 440]) for (const xx of [250, 365, 480]) {
  add(windowAt(xx, yy, 62, 82))
  add(ink([[xx - 4, yy], [xx + 31, yy - 26], [xx + 66, yy]], { w: 1.8 }))
}
// Тарелка-антенна и кондиционер — признак достатка в 90-е.
add(wash([[548, 330], [588, 318], [592, 350], [552, 360]], '#cfd0cc', { op: 0.85, amp: 1 }))
add(ink([[548, 330], [588, 318], [592, 350], [552, 360]], { closed: true, w: 1.5 }))
add(line(570, 340, 600, 330, { w: 1.4 }))
// Низкий кирпичный забор и калитка.
add(shape(box(90, 548, 560, 64), '#9c5f50', { op: 0.85 }))
for (const xx of [90, 230, 370, 510, 640]) add(shape(box(xx - 8, 530, 26, 84), '#8d5245', { op: 0.9 }))

// ===== Центр: особняк за глухим забором =====
add(shape(box(770, 238, 480, 260), '#d4c7ad', { op: 0.8 }))
add(shape([[745, 242], [1010, 140], [1275, 242]], '#77594a', { op: 0.85 }))
add(hatch(780, 160, 470, 80, { gap: 10, op: 0.2 }))
add(shape(box(1150, 150, 34, 62), '#8a6151', { op: 0.85 }))
add(wash([[1155, 140], [1180, 120], [1210, 70], [1240, 40]], '#bdb5bd', { op: 0.3, amp: 6, closed: false }))
// Фронтон и колонны — купеческий китч.
add(shape([[900, 268], [1010, 214], [1120, 268]], '#e6dcc6', { op: 0.85 }))
for (const xx of [912, 962, 1038, 1088]) add(shape(box(xx, 270, 22, 190), '#efe8da', { op: 0.9 }))
for (const xx of [800, 1160]) for (const yy of [280, 380]) add(windowAt(xx, yy, 56, 72, { lit: yy === 380 && xx === 1160 }))
add(windowAt(980, 300, 60, 84))
// Глухой кирпичный забор с тумбами и колючкой.
add(shape(box(680, 430, 660, 186), '#97675a', { op: 0.86 }))
for (let yy = 444; yy < 610; yy += 15) for (let xx = 690 + ((yy / 15) % 2) * 14; xx < 1330; xx += 30) if (rnd() < 0.5) add(`<path d="M${xx} ${yy} h${(12 + rnd() * 8).toFixed(1)}" stroke="#4e2a22" stroke-width="1" opacity=".33"/>`)
for (const xx of [668, 790, 1220, 1330]) { add(shape(box(xx, 410, 34, 208), '#87503f', { op: 0.92 })); add(shape(box(xx - 6, 398, 46, 16), '#b9b3a8', { op: 0.9 })) }
let wire = ''
for (let xx = 690; xx < 1330; xx += 16) wire += `<ellipse cx="${xx}" cy="${418 + rr(-2, 2)}" rx="10" ry="7" fill="none" stroke="${L.INK}" stroke-width="1.1" opacity=".7"/>`
add(wire)
// Ворота: кованые, тёмные, с пиками и гербом бригады.
add(shape(box(830, 450, 360, 166), '#3d4245', { op: 0.92 }))
for (let xx = 846; xx < 1185; xx += 18) { add(line(xx, 452, xx, 612, { w: 1.6, op: 0.7, double: false })); add(ink([[xx - 5, 452], [xx, 438], [xx + 5, 452]], { w: 1.4, double: false })) }
add(line(1010, 450, 1010, 616, { w: 3 }))
add(`<circle cx="1010" cy="520" r="34" fill="#b8963e" opacity=".85" filter="url(#wc)"/>`)
add(ink([[976, 520], [986, 492], [1010, 484], [1034, 492], [1044, 520], [1034, 548], [1010, 556], [986, 548]], { closed: true, w: 2 }))
add(ink([[996, 506], [1024, 534]], { w: 2.4 }) + ink([[1024, 506], [996, 534]], { w: 2.4 }))
// Камера наблюдения на тумбе.
add(shape([[1226, 384], [1262, 376], [1266, 392], [1230, 398]], '#d6d6d0', { op: 0.9 }))
add(line(1240, 396, 1238, 410, { w: 2 }))
// Будка охраны и шлагбаум.
add(shape(box(1350, 470, 108, 146), '#c3cbd0', { op: 0.85 }))
add(shape([[1340, 474], [1404, 438], [1468, 474]], '#5b6670', { op: 0.9 }))
add(windowAt(1368, 500, 72, 50, { lit: true, cross: false }))
add(ink(box(1376, 560, 30, 56), { closed: true, w: 1.5 }))
let stripes = ''
for (let i = 0; i < 9; i++) {
  const x1 = 1458 + i * 34
  stripes += wash([[x1, 561], [x1 + 34, 559], [x1 + 34, 571], [x1, 573]], i % 2 ? '#f0ece4' : '#b8333a', { op: 0.9, amp: 0.6 })
}
add(stripes + ink([[1458, 561], [1764, 551], [1764, 563], [1458, 573]], { closed: true, w: 1.6 }))
add(shape(box(1450, 548, 16, 70), '#8c9196', { op: 0.9 }))

// ===== Справа: дача за профнастилом =====
add(shape([[1600, 330], [1735, 236], [1870, 330]], '#6d7377', { op: 0.85 }))
add(shape(box(1620, 328, 230, 120), '#8f6f56', { op: 0.82 }))
for (let yy = 340; yy < 446; yy += 12) add(`<path d="M1622 ${yy} H1848" stroke="#4d3423" stroke-width="1" opacity=".35"/>`)
add(windowAt(1702, 276, 66, 46, { cross: true }))
add(windowAt(1650, 360, 60, 62))
add(windowAt(1760, 360, 60, 62))
add(shape(box(1560, 444, 400, 174), '#64735f', { op: 0.86 }))
for (let xx = 1572; xx < 1955; xx += 15) add(`<path d="M${xx} 446 V616" stroke="#2f3d33" stroke-width="${xx % 30 ? 1.2 : 2.2}" opacity=".45"/>`)
let wire2 = ''
for (let xx = 1568; xx < 1955; xx += 16) wire2 += `<ellipse cx="${xx}" cy="${436 + rr(-2, 2)}" rx="10" ry="7" fill="none" stroke="${L.INK}" stroke-width="1.1" opacity=".7"/>`
add(wire2)
add(`<text x="1610" y="540" font-family="Arial Black, Impact, sans-serif" font-size="46" fill="#e8e3da" opacity=".78" transform="rotate(-4 1610 540)" filter="url(#inkf)">ЦОЙ ЖИВ</text>`)
add(`<text x="1820" y="590" font-family="Arial, sans-serif" font-size="30" fill="#c8b04a" opacity=".7" transform="rotate(6 1820 590)">ШТАБ</text>`)
add(ink([[1615, 548], [1840, 530]], { w: 1.3, op: 0.5 }))

// ===== Земля: тротуар, асфальт, трещины, лужи =====
add(wash(box(30, 612, W - 60, 40), '#b9b0a8', { op: 0.75, amp: 2 }))
add(ink([[30, 652], [W - 30, 648]], { w: 2.4 }))
add(wash([[30, 652], [W - 30, 648], [W - 30, H - 30], [30, H - 30]], '#9a928c', { op: 0.6, amp: 3 }))
for (let i = 0; i < 26; i++) {
  const x = rr(60, W - 120), y = rr(670, H - 60), pts = [[x, y]]
  for (let k = 0; k < 5; k++) pts.push([pts[k][0] + rr(-40, 60), pts[k][1] + rr(-14, 18)])
  add(ink(pts, { w: rr(0.9, 1.6), op: 0.55, double: false, amp: 2 }))
}
for (const [cx, cy, rx, ry] of [[300, 860, 170, 38], [1290, 900, 230, 44], [1720, 790, 140, 30], [760, 940, 120, 22]]) {
  add(blot(cx, cy, rx, ry, '#7f8b9a', 0.42))
  add(`<path d="M${cx - rx * 0.6} ${cy} h${rx * 0.5} M${cx - rx * 0.2} ${cy + 8} h${rx * 0.6}" stroke="#f1eef0" stroke-width="2" opacity=".55"/>`)
}
// Мусор: бочка, окурки, карты, листья.
add(shape(box(1585, 640, 92, 128), '#7b5848', { op: 0.85 }))
add(`<ellipse cx="1631" cy="640" rx="46" ry="12" fill="#5a3e33" opacity=".8"/>`)
for (const yy of [670, 735]) add(line(1586, yy, 1676, yy, { w: 1.4 }))
add(blot(1600, 700, 22, 34, '#a24f2c', 0.4))
for (let i = 0; i < 14; i++) { const x = rr(200, 1900), y = rr(700, H - 50); add(`<path d="M${x.toFixed(0)} ${y.toFixed(0)} l${rr(8, 14).toFixed(1)} ${rr(-3, 3).toFixed(1)}" stroke="#efe6d6" stroke-width="3.5" stroke-linecap="round"/><path d="M${x.toFixed(0)} ${y.toFixed(0)} l3 0" stroke="#c86b3a" stroke-width="3.5"/>`) }
for (let i = 0; i < 18; i++) add(blot(rr(80, 1950), rr(680, H - 40), rr(5, 11), rr(3, 6), ['#b98f3c', '#a8763a', '#c4a24f'][i % 3], 0.6))
for (const [x, y, r] of [[1160, 870, -12], [1205, 884, 10]]) add(`<g transform="rotate(${r} ${x} ${y})">${wash(box(x, y, 26, 36), '#f2efe9', { op: 0.95, amp: 0.6 })}${ink(box(x, y, 26, 36), { closed: true, w: 1.2, double: false })}<text x="${x + 6}" y="${y + 24}" font-size="16" fill="#b0262e">♦</text></g>`)

// Фонарь.
add(ink([[700, 640], [702, 330], [740, 300], [800, 300]], { w: 5 }))
add(shape([[786, 296], [826, 296], [818, 316], [794, 316]], '#4a4e52', { op: 0.9 }))
add(blot(806, 330, 34, 20, '#f2dd9a', 0.35))


// ===== «Шестисотый» у ворот =====
const car = (ox, oy, s = 1) => {
  const P = pts => pts.map(([x, y]) => [ox + x * s, oy + y * s])
  let c = blot(ox + 280 * s, oy + 168 * s, 300 * s, 22 * s, '#3c3a3e', 0.45)
  c += shape(P([[0, 110], [18, 72], [120, 62], [175, 14], [395, 10], [470, 62], [560, 76], [574, 112], [566, 140], [10, 140]]), '#2f3236', { op: 0.92 })
  c += wash(P([[186, 22], [282, 18], [282, 62], [150, 64]]), '#7d8b96', { op: 0.85, amp: 1 }) + ink(P([[186, 22], [282, 18], [282, 62], [150, 64]]), { closed: true, w: 1.5 })
  c += wash(P([[294, 18], [388, 18], [446, 62], [294, 62]]), '#6f7d88', { op: 0.85, amp: 1 }) + ink(P([[294, 18], [388, 18], [446, 62], [294, 62]]), { closed: true, w: 1.5 })
  c += `<path d="M${ox + 200 * s} ${oy + 30 * s} l40 ${-6 * s}" stroke="#eef2f4" stroke-width="3" opacity=".6"/>`
  c += line(ox + 6 * s, oy + 104 * s, ox + 570 * s, oy + 104 * s, { w: 2.6, color: '#c9cdd0', op: 0.9 })
  c += line(ox + 288 * s, oy + 64 * s, ox + 288 * s, oy + 138 * s, { w: 1.4 })
  c += wash(P([[548, 80], [572, 84], [572, 98], [546, 96]]), '#f3e7b0', { op: 0.95, amp: 0.5 })
  c += wash(P([[4, 82], [22, 80], [20, 96], [4, 98]]), '#c43b3b', { op: 0.9, amp: 0.5 })
  for (const wx of [110, 460]) {
    c += `<circle cx="${ox + wx * s}" cy="${oy + 140 * s}" r="${38 * s}" fill="#1f2022" filter="url(#wc)"/>`
    c += `<circle cx="${ox + wx * s}" cy="${oy + 140 * s}" r="${20 * s}" fill="#b9bec2" opacity=".9"/>`
    c += ink([[ox + (wx - 38) * s, oy + 140 * s], [ox + (wx - 30) * s, oy + 116 * s], [ox + wx * s, oy + 102 * s], [ox + (wx + 30) * s, oy + 116 * s], [ox + (wx + 38) * s, oy + 140 * s]], { w: 2 })
  }
  c += `<text x="${ox + 498 * s}" y="${oy + 128 * s}" font-family="Arial" font-size="${15 * s}" fill="#1e1e1e" opacity=".8">777</text>`
  return c
}
add(car(300, 690, 1.12))
add(D.carDetails(300, 690, 1.12))

add(D.details())
// Передний план: бетонные блоки, бурьян, бочка ближе — глубина кадра.
add(shape([[30, 900], [250, 880], [262, 962], [30, 970]], '#b3aba3', { shadeSide: 'bottom' }))
add(shape([[250, 914], [420, 904], [428, 966], [262, 970]], '#a9a199', { shadeSide: 'bottom' }))
add(hatch(40, 930, 380, 34, { gap: 7, op: 0.25 }))
for (let i = 0; i < 40; i++) { const x = rr(40, 470), y = rr(880, 905); add(ink([[x, y + 18], [x + rr(-12, 12), y - rr(10, 40)]], { w: 1.2, op: 0.7, double: false, color: '#3c4a2e' })) }
for (const [x0, x1] of [[640, 700], [1480, 1560], [80, 120]]) for (let i = 0; i < 14; i++) { const x = rr(x0, x1); add(ink([[x, 616], [x + rr(-8, 8), 616 - rr(8, 26)]], { w: 1, op: 0.7, double: false, color: '#46553a' })) }
add(L.stains(W, H, 18))
add(L.frame(W, H))
add(L.overlay(W, H))

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${L.defs(W, H)}${out.join('\n')}</svg>`
fs.writeFileSync(__dirname + '/scene-houses.svg', svg)
console.log('svg', (svg.length / 1024).toFixed(0) + ' KB')
