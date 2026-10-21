// Ужать картинку до квадрата side×side (обрезка по центру) и вернуть PNG dataURL.
// Иконке бригады больше не нужно: на сервер уходит несколько килобайт.
export async function squareImage(file: File, side = 64): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('Нужна картинка PNG, JPEG, WebP или GIF')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Картинка не открылась'))
      el.src = url
    })
    const crop = Math.min(img.naturalWidth, img.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = side; canvas.height = side
    canvas.getContext('2d')!.drawImage(img, (img.naturalWidth - crop) / 2, (img.naturalHeight - crop) / 2, crop, crop, 0, 0, side, side)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Скриншот для поддержки: длинная сторона не больше maxSide, JPEG. Качество
 * снижается, пока картинка не влезет в maxBytes (весь запрос — до 1 МБ).
 */
export async function screenshotImage(file: File, maxSide = 1600, maxBytes = 650_000): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('Нужна картинка PNG, JPEG, WebP или GIF')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Картинка не открылась'))
      el.src = url
    })
    let scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
    for (let attempt = 0; attempt < 6; attempt++) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
      const ctx = canvas.getContext('2d')!
      // У PNG со прозрачностью JPEG дал бы чёрный фон.
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      const data = canvas.toDataURL('image/jpeg', attempt < 3 ? 0.85 - attempt * 0.1 : 0.6)
      if ((data.length - data.indexOf(',') - 1) * 3 / 4 <= maxBytes) return data
      if (attempt >= 2) scale *= 0.75
    }
    throw new Error('Скриншот слишком большой')
  } finally {
    URL.revokeObjectURL(url)
  }
}
