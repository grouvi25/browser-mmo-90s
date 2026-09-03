// =============================================================
// PREMIUM — шаг F5 Этапа 4
//
// Принцип этапа: премиум продаёт ВРЕМЯ, а не силу. Формулировка не
// декоративная, она проверяется машинно — инвариант 12 модели данных:
// ни один товар витрины не выдаёт предмет с ненулевым бюджетом статов.
//
// Чего подписка не даёт: характеристик, урона, брони, шанса улучшения,
// скидок на рынке, доступа к рецептам, влияния на бой любым способом.
//
// ТЗ: docs/specs/stage-4/MASTER_TZ_STAGE_4_STRATEGY_PREMIUM_WAR.md, часть VI.
// =============================================================
import { prisma } from '../../shared/db/prisma'
import { withTransaction } from '../../shared/db/transaction'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { BalanceConfig } from '../../config/balance.config'

const P = BalanceConfig.strategy.premium

/** Закрытый список эффектов витрины. Ни один не выдаёт предмет. */
export const PREMIUM_GRANTS = [
  'SUBSCRIPTION_DAYS', 'CYCLE_INSTANT', 'FARM_WATER_ALL', 'BUFF_COOLDOWN_RESET',
  'INVENTORY_SLOTS', 'LOADOUT_SLOT', 'PORTRAIT', 'NICK_COLOR',
] as const
export type PremiumGrant = (typeof PREMIUM_GRANTS)[number]

/**
 * Из восьми эффектов реализован один.
 *
 * Остальным семи нужны поля и механики, которых в игре нет: портрет и цвет
 * ника — колонки персонажа, места в инвентаре — лимит, которого не
 * существует, мгновенный цикл, полив и сброс отката — разовые действия с
 * целью. Это долг Этапа 4, закрывается шагом G0 Этапа 5.
 *
 * До тех пор товар нельзя ни продать, ни выдать: покупка, которая ничего не
 * делает и при этом записывается в историю, хуже отсутствующего товара.
 */
export const IMPLEMENTED_GRANTS: readonly PremiumGrant[] = ['SUBSCRIPTION_DAYS']

export function isPremiumGrant(code: string): code is PremiumGrant {
  return (PREMIUM_GRANTS as readonly string[]).includes(code)
}

export function isGrantImplemented(code: string): boolean {
  return (IMPLEMENTED_GRANTS as readonly string[]).includes(code)
}

/** Льготы подписки. Числа живут в BalanceConfig, не в клиенте. */
export const PREMIUM_BENEFITS = {
  skillMultiplier: P.skillMultiplier,
  helperSlots: P.helperSlots,
  dailyShiftCap: P.dailyShiftCap,
  loadoutSlots: P.loadoutSlots,
} as const

/**
 * Активна ли подписка ПРЯМО СЕЙЧАС.
 *
 * Флаг и срок проверяются вместе: флаг без срока — вечная подписка,
 * срок без флага — выданная и отозванная. Ни то ни другое не должно
 * молча работать.
 */
export function isPremiumActive(
  character: { isPremium: boolean; premiumExpiresAt: Date | null },
  now = new Date(),
): boolean {
  if (!character.isPremium) return false
  if (!character.premiumExpiresAt) return false
  return character.premiumExpiresAt.getTime() > now.getTime()
}

export const PremiumService = {
  /** Состояние подписки. Числа льгот приходят с сервера, а не зашиты в клиент. */
  async state(characterId: string) {
    const character = await prisma.character.findUniqueOrThrow({
      where: { id: characterId },
      select: { isPremium: true, premiumExpiresAt: true },
    })
    const active = isPremiumActive(character)
    return {
      isPremium: active,
      expiresAt: character.premiumExpiresAt,
      benefits: active
        ? PREMIUM_BENEFITS
        : {
            skillMultiplier: 1,
            helperSlots: 0,
            dailyShiftCap: BalanceConfig.economy.work.dailyShiftLimit,
            loadoutSlots: 2,
          },
    }
  },

  /** Витрина. */
  async shop() {
    const items = await prisma.premiumProduct.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { code: true, name: true, description: true, kind: true, priceRub: true, grantCode: true },
    })
    return { items }
  },

  /**
   * Выдать товар. В первой версии оплата вне игры, оформляет администратор.
   *
   * PREM_002 — рантайм-форма инварианта 12: даже если в витрину попадёт
   * товар со статами, выдать его не удастся ни игроку, ни админу.
   */
  async grant(params: {
    characterId: string
    productCode: string
    adminId?: string
    days?: number
  }) {
    return withTransaction(async tx => {
      const product = await tx.premiumProduct.findUnique({ where: { code: params.productCode } })
      if (!product) {
        throw new AppError(ErrorCode.PREM_PRODUCT_NOT_FOUND, 'Товар не найден', 404)
      }
      if (!isPremiumGrant(product.grantCode)) {
        throw new AppError(
          ErrorCode.PREM_GRANTS_STATS,
          `Товар выдаёт неизвестный эффект «${product.grantCode}» — запрещено`,
          400,
        )
      }
      // Порядок проверок важен: нереализованный товар выключен в витрине, и
      // без этой проверки раньше сработала бы «товар не найден» — админ
      // получил бы неверную причину отказа.
      if (!isGrantImplemented(product.grantCode)) {
        throw new AppError(
          ErrorCode.PREM_GRANT_NOT_READY,
          `Эффект «${product.grantCode}» ещё не реализован — выдавать нечего`,
          409,
        )
      }
      if (!product.isActive) {
        throw new AppError(ErrorCode.PREM_PRODUCT_NOT_FOUND, 'Товар снят с витрины', 404)
      }

      const character = await tx.character.findUniqueOrThrow({
        where: { id: params.characterId },
        select: { id: true, isPremium: true, premiumExpiresAt: true },
      })

      let expiresAt = character.premiumExpiresAt
      if (product.grantCode === 'SUBSCRIPTION_DAYS') {
        const days = params.days ?? product.grantValue
        // Продление считается от текущего срока, если он ещё не истёк:
        // иначе покупка второй подписки сжигала бы остаток первой.
        const from = expiresAt && expiresAt.getTime() > Date.now() ? expiresAt : new Date()
        expiresAt = new Date(from.getTime() + days * 24 * 3_600_000)
        await tx.character.update({
          where: { id: character.id },
          data: { isPremium: true, premiumExpiresAt: expiresAt },
        })
      }

      await tx.premiumPurchase.create({
        data: {
          characterId: character.id,
          productId: product.id,
          priceRub: product.priceRub,
          grantedByAdminId: params.adminId ?? null,
        },
      })

      return {
        productCode: product.code,
        isPremium: product.grantCode === 'SUBSCRIPTION_DAYS' ? true : character.isPremium,
        expiresAt,
      }
    })
  },

  /** Отозвать подписку. Помощники остаются, но перестают работать. */
  async revoke(characterId: string) {
    return withTransaction(async tx => {
      await tx.character.update({
        where: { id: characterId },
        data: { isPremium: false, premiumExpiresAt: null },
      })
      // Помощник без подписки остаётся в профиле — как просил заказчик, —
      // но выйти на смену больше не может.
      await tx.helper.updateMany({ where: { characterId }, data: { status: 'DORMANT' } })
      return { isPremium: false }
    })
  },

  /** История покупок персонажа. */
  async purchases(characterId: string, limit = 50) {
    const rows = await prisma.premiumPurchase.findMany({
      where: { characterId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { product: { select: { code: true, name: true, kind: true } } },
    })
    return {
      items: rows.map(row => ({
        at: row.createdAt,
        code: row.product.code,
        name: row.product.name,
        kind: row.product.kind,
        // Цена копией на момент сделки: в каталоге она меняется.
        priceRub: row.priceRub,
      })),
    }
  },

  /** Суточный потолок смен с учётом подписки. */
  async dailyShiftCap(characterId: string): Promise<number> {
    const state = await this.state(characterId)
    return state.benefits.dailyShiftCap
  },

  /**
   * Множитель набора навыка оружия — ТОЛЬКО в боях с ботами.
   *
   * В PvP он не применяется намеренно. Навык оружия — это боевая сила, и
   * ускорять её набор в соревновательной части значило бы продавать силу,
   * а не время (принцип П4). В PvE подписка экономит гринд и ничего не
   * решает за игрока. Описание товара в витрине говорит об этом прямо.
   */
  async skillMultiplier(characterId: string): Promise<number> {
    const state = await this.state(characterId)
    return state.benefits.skillMultiplier
  },
}
