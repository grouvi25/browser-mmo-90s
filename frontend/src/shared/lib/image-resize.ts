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
