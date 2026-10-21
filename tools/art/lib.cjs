// Библиотека «акварель + тушь» для SVG-сцен в стиле игры.
let seed = 1
function setSeed(s) { seed = s >>> 0 || 1 }
function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
const rr = (a, b) => a + (b - a) * rnd()
const f = n => Math.round(n * 10) / 10

/** Разбивает ломаную на мелкие шаги с дрожанием поперёк — рука, а не линейка. */
function jitter(pts, amp = 1.4, step = 16, closed = false) {
  const src = closed ? [...pts, pts[0]] : pts
  const out = []
  for (let i = 0; i < src.length - 1; i++) {
    const [x1, y1] = src[i], [x2, y2] = src[i + 1]
    const len = Math.hypot(x2 - x1, y2 - y1)
    const n = Math.max(1, Math.round(len / step))
    const nx = -(y2 - y1) / (len || 1), ny = (x2 - x1) / (len || 1)
    for (let k = 0; k < n; k++) {
      const t = k / n
      const j = k === 0 ? 0 : rr(-amp, amp)
      out.push([x1 + (x2 - x1) * t + nx * j, y1 + (y2 - y1) * t + ny * j])
    }
  }
  out.push(closed ? out[0] : src[src.length - 1])
  return out
}
function smooth(pts, closed = false) {
  if (pts.length < 3) return 'M' + pts.map(p => f(p[0]) + ' ' + f(p[1])).join(' L')
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2
    d += ` Q${f(pts[i][0])} ${f(pts[i][1])} ${f(mx)} ${f(my)}`
  }
  const last = pts[pts.length - 1]
  d += ` L${f(last[0])} ${f(last[1])}`
  return closed ? d + ' Z' : d
}
const path = (pts, { amp = 1.4, step = 16, closed = false } = {}) => smooth(jitter(pts, amp, step, closed), closed)
const box = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]

const INK = '#2a2320'
/** Линия тушью: основной штрих + тонкий второй проход со сдвигом. */
function ink(pts, { w = 2.2, op = 0.9, closed = false, amp = 1.2, color = INK, double = true } = {}) {
  const a = `<path d="${path(pts, { amp, closed })}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" opacity="${op}" filter="url(#inkf)"/>`
  if (!double) return a
  const shifted = pts.map(([x, y]) => [x + rr(-1.2, 1.2), y + rr(-1.2, 1.2)])
  return a + `<path d="${path(shifted, { amp: amp * 0.8, closed })}" fill="none" stroke="${color}" stroke-width="${f(w * 0.45)}" stroke-linecap="round" opacity="${op * 0.55}"/>`
}
/** Акварельная заливка: рваный край, растёк, тёмная кайма пигмента. */
function wash(pts, color, { op = 0.8, amp = 3, filter = 'wc', closed = true } = {}) {
  const d = path(pts, { amp, step: 22, closed })
  return `<g filter="url(#${filter})" opacity="${op}"><path d="${d}" fill="${color}"/><path d="${d}" fill="none" stroke="${color}" stroke-width="3.5" opacity=".55" style="mix-blend-mode:multiply"/></g>`
}
function shape(pts, fill, opts = {}) { return wash(pts, fill, opts) + ink(pts, { closed: true, ...opts.ink }) }
function line(x1, y1, x2, y2, o = {}) { return ink([[x1, y1], [x2, y2]], o) }
/** Штриховка тушью внутри прямоугольника: тени и фактура. */
function hatch(x, y, w, h, { gap = 9, angle = 1, op = 0.35, wid = 1 } = {}) {
  let s = ''
  for (let t = -h; t < w; t += gap) {
    const x1 = x + t, y1 = y + h, x2 = x + t + h * angle, y2 = y
    const cx1 = Math.max(x, Math.min(x + w, x1)), cx2 = Math.max(x, Math.min(x + w, x2))
    if (cx2 - cx1 < 3) continue
    const ky1 = y1 - (cx1 - x1) / angle, ky2 = y2 + (x2 - cx2) / angle
    s += `<path d="M${f(cx1)} ${f(ky1)} L${f(cx2)} ${f(ky2)}" stroke="${INK}" stroke-width="${wid}" opacity="${op * rr(0.6, 1)}" stroke-linecap="round"/>`
  }
  return s
}
/** Пятно-лужа/грязь/тень. */
function blot(cx, cy, rx, ry, color, op = 0.35) {
  const pts = []
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 9) pts.push([cx + Math.cos(a) * rx * rr(0.75, 1.15), cy + Math.sin(a) * ry * rr(0.75, 1.15)])
  return wash(pts, color, { op, amp: 4 })
}

function defs(w, h) {
  return `<defs>
  <filter id="wc" x="-5%" y="-5%" width="110%" height="110%">
    <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="3" seed="${Math.floor(rr(1, 99))}" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="9" xChannelSelector="R" yChannelSelector="G" result="d"/>
    <feGaussianBlur in="d" stdDeviation="0.7" result="b"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="7" result="g"/>
    <feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.1 1.15" result="ga"/>
    <feComposite in="b" in2="ga" operator="in" result="gr"/>
    <feBlend in="gr" in2="b" mode="multiply"/>
  </filter>
  <filter id="wcSoft" x="-20%" y="-20%" width="140%" height="140%">
    <feTurbulence type="fractalNoise" baseFrequency="0.008" numOctaves="3" seed="11" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="40" xChannelSelector="R" yChannelSelector="G" result="d"/>
    <feGaussianBlur in="d" stdDeviation="7"/>
  </filter>
  <filter id="inkf" x="-2%" y="-2%" width="104%" height="104%">
    <feTurbulence type="fractalNoise" baseFrequency="0.07" numOctaves="2" seed="5" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
  <filter id="paper" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed="3" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.24  0 0 0 0 0.2  0 0 0 0 0.22  0 0 0 0.11 0"/>
  </filter>
  <filter id="fibers" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.004 0.06" numOctaves="2" seed="9" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.3  0 0 0 0 0.36  0 0 0 0.16 -0.02"/>
  </filter>
</defs>`
}

/** Небо: размытые лилово-серые размывы, как на сценах Гаражей и Центра. */
function sky(w, top, bottom) {
  let s = `<rect x="0" y="0" width="${w}" height="${bottom}" fill="#e6e1e6"/>`
  const tones = ['#b9adbb', '#c9c0c9', '#a99eae', '#d7d0d6', '#9d93a3']
  for (let i = 0; i < 26; i++) {
    const cx = rr(-100, w + 100), cy = rr(top, bottom * 0.85), rx = rr(160, 420), ry = rr(30, 90)
    s += `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" fill="${tones[i % tones.length]}" opacity="${f(rr(0.18, 0.42))}" filter="url(#wcSoft)"/>`
  }
  return s
}
/** Рваная рамка тушью по краю, как у всех сцен игры. */
function frame(w, h, m = 14) {
  const edge = (pts) => ink(pts, { w: rr(3.5, 6), amp: 2.5, op: 0.95 })
  return [
    edge([[m, m + rr(-4, 4)], [w - m, m + rr(-4, 4)]]),
    edge([[w - m + rr(-4, 4), m], [w - m + rr(-4, 4), h - m]]),
    edge([[w - m, h - m + rr(-4, 4)], [m, h - m + rr(-4, 4)]]),
    edge([[m + rr(-4, 4), h - m], [m + rr(-4, 4), m]]),
    ink([[m + 6, m + 10], [w * 0.4, m + 8]], { w: 1.4, op: 0.6 }),
    ink([[w - m - 9, h * 0.5], [w - m - 8, h - m - 30]], { w: 1.4, op: 0.6 }),
  ].join('')
}
function overlay(w, h) {
  return `<rect width="${w}" height="${h}" filter="url(#paper)" style="mix-blend-mode:multiply"/><rect width="${w}" height="${h}" filter="url(#fibers)" style="mix-blend-mode:multiply"/>`
}

/** Окно: рама тушью, стекло размывом, иногда занавеска/свет. */
function windowAt(x, y, w, h, { lit = false, glass = '#8e9aa6', frameColor = '#e9e4dc', cross = true } = {}) {
  let s = wash(box(x, y, w, h), lit ? '#e8c879' : glass, { op: lit ? 0.75 : 0.55, amp: 1.2 })
  if (!lit && rnd() < 0.35) s += wash([[x + 2, y + 2], [x + w * 0.45, y + 2], [x + w * 0.3, y + h - 2], [x + 2, y + h - 2]], '#c9b7a6', { op: 0.5, amp: 1 })
  s += ink(box(x, y, w, h), { closed: true, w: 1.6, amp: 0.6 })
  if (cross) { s += line(x + w / 2, y, x + w / 2, y + h, { w: 1.1, amp: 0.4, double: false }); s += line(x, y + h * 0.35, x + w, y + h * 0.35, { w: 1, amp: 0.4, double: false }) }
  return s
}


let clipN = 0
function hex2rgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
function mix(a, b, t) { const A = hex2rgb(a), B = hex2rgb(b); return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("") }
function bbox(pts) { const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) } }
/** Живописная заливка: базовый размыв + неровный пигмент внутри формы
 *  (тёмные затёки, светлые просветы бумаги), тень снизу/сбоку, кайма. */
function paint(pts, color, { op = 0.85, shadeSide = "bottom", shade = 0.28, blooms = 4, light = 2 } = {}) {
  const id = "c" + (++clipN)
  const d = path(pts, { amp: 2.5, step: 22, closed: true })
  const b = bbox(pts)
  let s = `<clipPath id="${id}"><path d="${d}"/></clipPath><g opacity="${op}">`
  s += `<g filter="url(#wc)"><path d="${d}" fill="${color}"/></g><g clip-path="url(#${id})">`
  for (let i = 0; i < blooms; i++) {
    const cx = b.x + rr(0, b.w), cy = b.y + rr(0, b.h)
    s += `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rr(0.15, 0.45) * b.w + 10)}" ry="${f(rr(0.15, 0.45) * b.h + 10)}" fill="${mix(color, "#3a2c30", rr(0.18, 0.32))}" opacity="${f(rr(0.18, 0.38))}" filter="url(#wcSoft)"/>`
  }
  for (let i = 0; i < light; i++) {
    const cx = b.x + rr(0.1, 0.9) * b.w, cy = b.y + rr(0.05, 0.6) * b.h
    s += `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rr(0.08, 0.22) * b.w + 6)}" ry="${f(rr(0.06, 0.18) * b.h + 6)}" fill="${mix(color, "#fbf7f2", 0.45)}" opacity="${f(rr(0.25, 0.45))}" filter="url(#wcSoft)"/>`
  }
  if (shade > 0) {
    const sh = mix(color, "#241b20", 0.55)
    if (shadeSide === "bottom") s += `<rect x="${f(b.x - 10)}" y="${f(b.y + b.h * 0.72)}" width="${f(b.w + 20)}" height="${f(b.h * 0.4)}" fill="${sh}" opacity="${shade}" filter="url(#wcSoft)"/>`
    if (shadeSide === "right") s += `<rect x="${f(b.x + b.w * 0.78)}" y="${f(b.y - 10)}" width="${f(b.w * 0.3)}" height="${f(b.h + 20)}" fill="${sh}" opacity="${shade}" filter="url(#wcSoft)"/>`
    if (shadeSide === "top") s += `<rect x="${f(b.x - 10)}" y="${f(b.y - 6)}" width="${f(b.w + 20)}" height="${f(Math.min(40, b.h * 0.25))}" fill="${sh}" opacity="${shade}" filter="url(#wcSoft)"/>`
  }
  s += `</g><path d="${d}" fill="none" stroke="${mix(color, "#2a2024", 0.35)}" stroke-width="2.5" opacity=".45" filter="url(#wc)"/></g>`
  return s
}
function pshape(pts, fill, opts = {}) { return paint(pts, fill, opts) + ink(pts, { closed: true, ...(opts.ink || {}) }) }
/** Водяные разводы по всему листу — как у настоящей акварели. */
function stains(w, h, n = 14) {
  let s = ""
  for (let i = 0; i < n; i++) s += `<ellipse cx="${f(rr(0, w))}" cy="${f(rr(0, h))}" rx="${f(rr(60, 220))}" ry="${f(rr(30, 120))}" fill="${["#8e7e8c", "#a39188", "#f6f2ee"][i % 3]}" opacity="${f(rr(0.05, 0.12))}" filter="url(#wcSoft)" style="mix-blend-mode:multiply"/>`
  return s
}

module.exports = { paint, pshape, stains, mix, bbox, setSeed, rnd, rr, f, jitter, smooth, path, box, ink, wash, shape, line, hatch, blot, defs, sky, frame, overlay, windowAt, INK }
