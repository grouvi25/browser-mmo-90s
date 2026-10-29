// =============================================================
// Настройки сайта, которые админка меняет без выкатки.
//
// Пока одна: окно при входе в игру (просьба Дмитрия 29.10: «игра на
// стадии тестирования… любые вопросы в поддержку или админу в ЛС»).
// Версия растёт при правке текста — игроки увидят новое окно ещё раз.
// =============================================================
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../shared/db/prisma'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'

export const WelcomeSchema = z.object({
  enabled: z.boolean(),
  title: z.string().trim().min(1).max(120),
  text: z.string().trim().min(1).max(2000),
})

export type Welcome = z.infer<typeof WelcomeSchema> & { version: number }

const Stored = WelcomeSchema.extend({ version: z.number().int().min(0) })

export const SiteService = {
  /** Окно при входе; нет записи или она битая — окна нет. */
  async welcome(): Promise<Welcome | null> {
    const row = await prisma.siteSetting.findUnique({ where: { key: 'welcome' } })
    const parsed = Stored.safeParse(row?.value)
    return parsed.success ? parsed.data : null
  },

  async saveWelcome(input: unknown, adminLabel: string): Promise<Welcome> {
    const parsed = WelcomeSchema.safeParse(input)
    if (!parsed.success) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Заголовок до 120 знаков, текст до 2000', 422)
    const prev = await this.welcome()
    const changed = !prev || prev.title !== parsed.data.title || prev.text !== parsed.data.text
    const next: Welcome = { ...parsed.data, version: (prev?.version ?? 0) + (changed ? 1 : 0) }
    const value = next as unknown as Prisma.InputJsonValue
    await prisma.siteSetting.upsert({
      where: { key: 'welcome' },
      create: { key: 'welcome', value, updatedBy: adminLabel },
      update: { value, updatedBy: adminLabel },
    })
    return next
  },
}
