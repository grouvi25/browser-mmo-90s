// Картинки шаблонов вещей, загружаемые из админки (Дима 09.11). Игра берёт список
// «код → версия» одним запросом и дальше грузит картинку по адресу с версией:
// замена картинки меняет адрес, долгий кэш браузера не мешает.
import { prisma } from '../../shared/db/prisma'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'

export const TEMPLATE_IMAGE_MAX_BYTES = 150_000

export const TemplateImages = {
  async list(): Promise<Record<string, number>> {
    const rows = await prisma.itemTemplateImage.findMany({ select: { code: true, version: true } })
    return Object.fromEntries(rows.map(row => [row.code, row.version]))
  },

  async get(code: string) {
    const row = await prisma.itemTemplateImage.findUnique({ where: { code } })
    return row ? { mime: row.mime, bytes: Buffer.from(row.data, 'base64') } : null
  },

  async set(code: string, dataUrl: string) {
    const parsed = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
    if (!parsed) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Картинка: PNG, JPEG или WebP', 422)
    if (Buffer.byteLength(parsed[2], 'base64') > TEMPLATE_IMAGE_MAX_BYTES) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Картинка слишком большая: не больше 150 КБ', 422)
    }
    if (!await prisma.itemTemplate.findUnique({ where: { code }, select: { id: true } })) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Вещь не найдена', 404)
    }
    const row = await prisma.itemTemplateImage.upsert({
      where: { code },
      create: { code, mime: parsed[1], data: parsed[2] },
      update: { mime: parsed[1], data: parsed[2], version: { increment: 1 } },
      select: { code: true, version: true },
    })
    return row
  },

  async remove(code: string) {
    await prisma.itemTemplateImage.deleteMany({ where: { code } })
    return { code, removed: true }
  },
}
