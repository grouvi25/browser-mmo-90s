import type { Prisma } from '@prisma/client'
import { prisma } from '../../shared/db/prisma'
import { AppError } from '../../shared/errors/app-error'
import { DollarsService } from '../dollars/dollars.service'
import { EconomyService } from '../economy/economy.service'
import { normalizeAllocation } from '../items/item-stats.formulas'

const LEGACY_COMPLETED = 7
const LETTER_PENDING = 8
const COMPLETED = 9
const REWARD = { rubles: 5000, dollars: 100 }

const character = {
  id: true, nickname: true, tutorialStep: true, money: true, battleLevel: true,
  stats: { select: { str: true, pointsAvailable: true } },
} satisfies Prisma.CharacterSelect

type Character = Prisma.CharacterGetPayload<{ select: typeof character }>
type GuideDb = Pick<Prisma.TransactionClient, 'itemInstance' | 'governmentShopItem' | 'battleParticipant'>
type Action = 'complete' | 'dismiss-letter'

const weaponSelect = { id: true, name: true, weaponType: true } as const

function status(step: number | null) {
  return {
    active: step !== null && step < LEGACY_COMPLETED,
    completed: step !== null && step >= LEGACY_COMPLETED,
    letterPending: step === LETTER_PENDING,
    reward: REWARD,
  }
}

/** Оружие готово. Дальше свободные очки характеристик, если они есть, потом
 *  первый бой (Дима 26.11: «продолжить на бой, как с ботами, после первого
 *  боя заканчивалось»). Любой завершённый бой засчитывается, победа не нужна. */
async function afterWeapon(db: GuideDb, player: Character) {
  if ((player.stats?.pointsAvailable ?? 0) > 0) return 'stats' as const
  const fought = await db.battleParticipant.findFirst({
    where: { characterId: player.id, battle: { status: { in: ['FINISHED', 'TECHNICAL_WIN'] } } },
    select: { id: true },
  })
  return fought ? 'finish' as const : 'fight' as const
}

async function getLesson(db: GuideDb, player: Character) {
  const eligible = {
    type: 'WEAPON', allocationMode: 'PLAYER', statBudget: { gt: 0 }, isEquippable: true,
    levelReq: { lte: player.battleLevel }, strReq: { lte: player.stats?.str ?? 0 }, skillReq: 0,
  } satisfies Prisma.ItemTemplateWhereInput
  const weapons = await db.itemInstance.findMany({
    where: {
      ownerId: player.id, sourceType: 'GOVERNMENT', status: { in: ['NORMAL', 'EQUIPPED'] }, durabilityCurrent: { gt: 0 },
      template: eligible,
    },
    select: { id: true, statAllocation: true, isEquipped: true, template: { select: weaponSelect } },
    orderBy: [{ isEquipped: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
  })
  const done = weapons.find(item => {
    if (!item.isEquipped) return false
    const points = normalizeAllocation(item.statAllocation)
    return (points.MIN_DAMAGE ?? 0) + (points.MAX_DAMAGE ?? 0) + (points.DAMAGE ?? 0) > 0
  })
  const item = done ?? weapons[0]
  if (item) return {
    lesson: done ? await afterWeapon(db, player) : item.isEquipped ? 'allocate' as const : 'equip' as const,
    weapon: { ...item.template, itemId: item.id },
  }

  const stock = await db.governmentShopItem.findMany({
    where: { isAvailable: true, template: { ...eligible, isActive: true } },
    select: { overridePrice: true, template: { select: { ...weaponSelect, priceBase: true } } },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  })
  const choice = stock.find(entry => (entry.overridePrice ?? entry.template.priceBase) <= player.money) ?? stock[0]
  if (!choice) return { lesson: 'unavailable' as const }
  const price = choice.overridePrice ?? choice.template.priceBase
  return { lesson: 'buy' as const, weapon: { ...choice.template, price, canAfford: player.money >= price } }
}
export async function getTutorial(userId: string) {
  const player = await prisma.character.findUnique({ where: { userId }, select: character })
  if (!player) throw AppError.notFound('Character', userId)
  const flags = status(player.tutorialStep)
  return flags.active ? { ...flags, ...await getLesson(prisma, player) } : flags
}

export async function finishTutorialAction(userId: string, action: Action) {
  return prisma.$transaction(async tx => {
    const player = await tx.character.findUnique({ where: { userId }, select: character })
    if (!player) throw AppError.notFound('Character', userId)
    const flags = status(player.tutorialStep)

    if (action === 'dismiss-letter') {
      if (!flags.letterPending) return flags
      await tx.character.updateMany({ where: { id: player.id, tutorialStep: LETTER_PENDING }, data: { tutorialStep: COMPLETED } })
      return status(COMPLETED)
    }
    if (flags.completed) return flags
    if (!flags.active || (await getLesson(tx, player)).lesson !== 'finish') {
      throw AppError.validation('Сначала купите и наденьте оружие, сохраните очки в урон и проведите первый бой')
    }

    const changed = await tx.character.updateMany({
      where: { id: player.id, tutorialStep: player.tutorialStep }, data: { tutorialStep: LETTER_PENDING },
    })
    if (!changed.count) {
      const current = await tx.character.findUniqueOrThrow({ where: { id: player.id }, select: { tutorialStep: true } })
      return status(current.tutorialStep)
    }

    await EconomyService.credit(tx, { characterId: player.id, amount: REWARD.rubles, reasonCode: 'TUTORIAL' })
    await DollarsService.credit(tx, { characterId: player.id, amount: REWARD.dollars, reason: 'TUTORIAL' })
    await tx.gameNotice.create({
      data: { characterId: player.id, text: 'Бывалый оставил тебе письмо «Кодекс выживания приезжего». Его можно перечитать в Библиотеке → «С чего начать».' },
    })
    return status(LETTER_PENDING)
  })
}
