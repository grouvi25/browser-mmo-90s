// Детализация сцены «Дома бригад»: вставляется перед рамкой.
const L = require('./lib.cjs')
const { rr, rnd, box, ink, wash, line, hatch, blot, f } = L

/** Фоновая «панелька» в дымке: окна и балконы тушью, а не сетка квадратов. */
function farBlock(x, top, w, bottom) {
  let s = wash(box(x, top, w, bottom - top), '#b0a8b1', { op: 0.5, amp: 2 })
  s += ink(box(x, top, w, bottom - top), { closed: true, w: 1.2, op: 0.4, double: false })
  for (let yy = top + 16; yy < bottom - 18; yy += 27) {
    s += `<path d="M${x} ${yy - 4} H${x + w}" stroke="#6d6470" stroke-width=".8" opacity=".25"/>`
    for (let xx = x + 12; xx < x + w - 16; xx += 29) {
      s += `<rect x="${xx}" y="${yy}" width="13" height="14" fill="${rnd() < 0.15 ? '#c8bb9a' : '#6f6875'}" opacity="${f(rr(0.22, 0.4))}"/>`
      if (rnd() < 0.18) s += `<path d="M${xx - 3} ${yy + 15} h20 v-6 h-20 z" fill="none" stroke="#5e5662" stroke-width=".9" opacity=".35"/>`
    }
  }
  return s
}

/** Потёки ржавчины/воды сверху вниз по стене. */
function streaks(x, y, w, h, n, color = '#7a4a32', op = 0.22) {
  let s = ''
  for (let i = 0; i < n; i++) {
    const sx = x + rr(0, w), len = rr(h * 0.25, h * 0.85), wd = rr(3, 10)
    s += `<path d="M${f(sx)} ${y} q${f(rr(-3, 3))} ${f(len / 2)} ${f(rr(-2, 2))} ${f(len)}" stroke="${color}" stroke-width="${f(wd)}" stroke-linecap="round" opacity="${f(rr(op * 0.5, op))}" filter="url(#wc)"/>`
  }
  return s
}

/** Трещина-ветка в асфальте или штукатурке. */
function crack(x, y, len, { w = 1.3, op = 0.6, branches = 2 } = {}) {
  let s = '', pts = [[x, y]], ang = rr(-0.5, 0.5)
  for (let k = 0; k < 6; k++) { ang += rr(-0.6, 0.6); const p = pts[pts.length - 1]; pts.push([p[0] + Math.cos(ang) * len / 6, p[1] + Math.sin(ang) * len / 12]) }
  s += ink(pts, { w, op, double: false, amp: 1.5 })
  for (let b = 0; b < branches; b++) { const p = pts[1 + Math.floor(rnd() * 4)]; s += ink([p, [p[0] + rr(-30, 30), p[1] + rr(6, 22)]], { w: w * 0.7, op: op * 0.8, double: false }) }
  return s
}

function details() {
  const out = []
  const add = s => out.push(s)
  // Черепица: ряды по скатам, мелкая штриховка в тени.
  for (let yy = 214; yy < 300; yy += 13) add(`<path d="M${f(395 - (yy - 196) * 2.1)} ${yy} L${f(395 + (yy - 196) * 2.1)} ${yy}" stroke="#2f3532" stroke-width="1" opacity=".3"/>`)
  for (let yy = 160; yy < 240; yy += 12) add(`<path d="M${f(1010 - (yy - 140) * 2.5)} ${yy} L${f(1010 + (yy - 140) * 2.5)} ${yy}" stroke="#3a2a22" stroke-width="1" opacity=".3"/>`)
  for (let yy = 250; yy < 328; yy += 12) add(`<path d="M${f(1735 - (yy - 236) * 1.42)} ${yy} L${f(1735 + (yy - 236) * 1.42)} ${yy}" stroke="#3a3c3e" stroke-width="1" opacity=".3"/>`)
  // Водостоки и выкрошенный кирпич.
  for (const [x, y1, y2] of [[592, 300, 560], [770, 245, 430], [1246, 245, 430]]) add(ink([[x, y1], [x, y2]], { w: 3.2, op: 0.75 }))
  for (let i = 0; i < 9; i++) add(wash(box(rr(210, 560), rr(320, 540), rr(14, 30), rr(8, 14)), '#c9a596', { op: 0.6, amp: 1.5 }))
  // Ржавые потёки: ворота, профнастил, бочка, забор.
  add(streaks(832, 452, 356, 150, 18, '#6e4630', 0.3))
  add(streaks(1562, 446, 396, 160, 22, '#6b4a2f', 0.28))
  add(streaks(684, 432, 650, 170, 14, '#5b2f25', 0.18))
  add(streaks(1588, 650, 86, 110, 6, '#5a2d1a', 0.35))
  // Трещины на штукатурке особняка и на тумбах.
  for (let i = 0; i < 6; i++) add(crack(rr(790, 1220), rr(260, 480), rr(40, 90), { w: 1, op: 0.45, branches: 1 }))

  // Асфальт: заплаты, разметка, люк, следы шин, трещины-ветки.
  for (const [cx, cy, rx, ry] of [[1010, 735, 130, 34], [1500, 850, 150, 30], [220, 785, 100, 26], [1830, 925, 110, 24]]) {
    const pts = []
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 7) pts.push([cx + Math.cos(a) * rx * rr(0.7, 1.1), cy + Math.sin(a) * ry * rr(0.6, 1.1)])
    add(wash(pts, '#7c756f', { op: 0.32, amp: 4 }))
    add(ink(pts, { closed: true, w: 1, op: 0.3, double: false, amp: 2 }))
  }
  // Тень от заборов на тротуар и затемнение краёв кадра.
  add(`<rect x="40" y="612" width="1920" height="22" fill="#3b3035" opacity=".18" filter="url(#wcSoft)"/>`)
  for (const [x, y, rx, ry] of [[0, 992, 520, 260], [2001, 992, 520, 260], [0, 0, 380, 220], [2001, 0, 380, 220]]) add(`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#4a3d48" opacity=".22" filter="url(#wcSoft)"/>`)
  for (let x = 60; x < 1960; x += 170) add(wash(box(x + rr(-8, 8), 818 + rr(-3, 3), rr(70, 100), 10), '#efece6', { op: rr(0.25, 0.5), amp: 2 }))
  add(`<ellipse cx="1110" cy="900" rx="70" ry="20" fill="#5d5853" opacity=".7" filter="url(#wc)"/>`)
  add(ink([[1040, 900], [1060, 886], [1110, 880], [1160, 886], [1180, 900], [1160, 914], [1110, 920], [1060, 914]], { closed: true, w: 1.8 }))
  for (let k = -40; k <= 40; k += 16) add(`<path d="M${1110 + k} 884 v32" stroke="#2a2320" stroke-width="1" opacity=".4"/>`)
  for (const yy of [880, 906]) add(`<path d="M120 ${yy} C 600 ${yy - 30}, 1300 ${yy + 25}, 1960 ${yy - 10}" fill="none" stroke="#5d5752" stroke-width="7" opacity=".14" filter="url(#wc)"/>`)
  for (let i = 0; i < 22; i++) add(crack(rr(60, 1900), rr(680, 960), rr(60, 160), { w: rr(0.9, 1.6), op: 0.55 }))
  // Бордюр: камни с зазорами, сколы.
  for (let x = 40; x < 1960; x += 64) add(`<path d="M${x} 650 v-12" stroke="${L.INK}" stroke-width="1.2" opacity=".5"/>`)
  return out.join('\n')
}

/** Детальный «шестисотый»: хром, двери, отражения неба, зеркало, решётка. */
function carDetails(ox, oy, s) {
  let c = ''
  const X = x => ox + x * s, Y = y => oy + y * s
  c += `<path d="M${X(180)} ${Y(20)} L${X(392)} ${Y(16)}" stroke="#9aa6b0" stroke-width="${3 * s}" opacity=".6"/>`
  c += `<path d="M${X(30)} ${Y(86)} C ${X(150)} ${Y(70)}, ${X(420)} ${Y(70)}, ${X(560)} ${Y(86)}" fill="none" stroke="#c9d2da" stroke-width="${5 * s}" opacity=".28" filter="url(#wc)"/>`
  for (const [a, b] of [[150, 290], [292, 450]]) c += ink([[X(a), Y(66)], [X(a + 4), Y(136)]], { w: 1.4, op: 0.8, double: false })
  for (const x of [266, 420]) c += `<rect x="${X(x)}" y="${Y(80)}" width="${18 * s}" height="${4 * s}" fill="#c8ccd0" opacity=".9"/>`
  c += `<path d="M${X(140)} ${Y(56)} l${-18 * s} ${-4 * s} l${-2 * s} ${10 * s} z" fill="#2c2f33" stroke="${L.INK}" stroke-width="1.2"/>`
  for (let k = 0; k < 4; k++) c += `<path d="M${X(552)} ${Y(100 + k * 3)} h${18 * s}" stroke="#d6d9db" stroke-width="1.4" opacity=".85"/>`
  c += `<path d="M${X(12)} ${Y(118)} H${X(568)}" stroke="#141517" stroke-width="${6 * s}" opacity=".35"/>`
  for (const wx of [110, 460]) for (let a = 0; a < 6; a++) {
    const ang = a * Math.PI / 3
    c += `<path d="M${X(wx)} ${Y(140)} l${f(Math.cos(ang) * 17 * s)} ${f(Math.sin(ang) * 17 * s)}" stroke="#7d8388" stroke-width="2" opacity=".8"/>`
  }
  c += `<path d="M${X(200)} ${Y(30)} l${30 * s} ${26 * s} M${X(320)} ${Y(26)} l${36 * s} ${30 * s}" stroke="#eef3f6" stroke-width="2.4" opacity=".5"/>`
  return c
}

module.exports = { details, carDetails, farBlock, streaks, crack }
