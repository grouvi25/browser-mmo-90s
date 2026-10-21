// SVG → PNG (для просмотра) и WEBP (в игру) через Chromium Playwright.
// node render.cjs scene.svg out-basename [W H]
const fs = require('fs')
const path = require('path')
const { chromium } = require(require.resolve('@playwright/test', { paths: [path.join(__dirname, '../../frontend')] }))
;(async () => {
  const [svgFile, outBase, W = '2001', H = '992'] = process.argv.slice(2)
  const w = +W, h = +H
  const svg = fs.readFileSync(svgFile, 'utf8')
  const b = await chromium.launch()
  const p = await b.newPage({ viewport: { width: w, height: h } })
  await p.setContent(`<html><body style="margin:0;background:#fff">${svg}</body></html>`)
  await p.waitForTimeout(400)
  const png = await p.screenshot({ type: 'png', clip: { x: 0, y: 0, width: w, height: h } })
  fs.writeFileSync(outBase + '.png', png)
  // webp — через canvas самого Chromium, без внешних кодеков.
  const webp = await p.evaluate(async ({ data, w, h }) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode()
    const c = document.createElement('canvas'); c.width = w; c.height = h
    c.getContext('2d').drawImage(img, 0, 0)
    return c.toDataURL('image/webp', 0.84).split(',')[1]
  }, { data: png.toString('base64'), w, h })
  fs.writeFileSync(outBase + '.webp', Buffer.from(webp, 'base64'))
  // Превью поменьше для просмотра.
  await p.setViewportSize({ width: 1200, height: Math.round(1200 * h / w) })
  await p.setContent(`<html><body style="margin:0"><img src="data:image/png;base64,${png.toString('base64')}" style="width:1200px;display:block"></body></html>`)
  await p.waitForTimeout(200)
  fs.writeFileSync(outBase + '-preview.png', await p.screenshot({ type: 'png' }))
  await b.close()
  console.log('ok', path.basename(outBase), (fs.statSync(outBase + '.webp').size / 1024).toFixed(0) + ' KB')
})().catch(e => { console.error(e); process.exit(1) })
