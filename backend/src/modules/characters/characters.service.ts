import { dogSummary } from '../city/city.config'
import { CharactersRepository } from './characters.repository'
import { calcCharacterRating, calcHpMax, getExpForNextLevel } from '../stats/stats.formulas'
import { gearOf } from '../items/gear-bonuses'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { BalanceConfig } from '../../config/balance.config'
import { audit } from '../../shared/logger/audit-logger'
import type { CreateCharacterInput } from './characters.schemas'
import { prisma } from '../../shared/db/prisma'
import { PROFESSION_NAMES, type ProfessionCode } from '../professions/professions'

export const CharactersService = {
  async create(userId: string, input: CreateCharacterInput) {
    // Check user doesn't already have a character
    const existing = await CharactersRepository.findByUserId(userId)
    if (existing) {
      throw new AppError(ErrorCode.CHARACTER_ALREADY_EXISTS, 'You already have a character', 409)
    }

    // Check nickname uniqueness
    const existingNick = await CharactersRepository.findByNickname(input.nickname)
    if (existingNick) {
      throw new AppError(ErrorCode.CONFLICT, 'Такой ник уже занят', 409)
    }

    const arch = input.archetype
    const B = BalanceConfig.character

    // Build base stats with archetype bonuses
    const base = { ...B.baseStats }
    const bonuses = B.archetypeBonuses[arch] ?? {}
    for (const [stat, bonus] of Object.entries(bonuses)) {
      (base as Record<string, number>)[stat] = ((base as Record<string, number>)[stat] ?? 0) + (bonus as number)
    }

    const pointsAvailable = B.startingPoints[arch] ?? 0

    // Calculate starting HP
    const hpMax = calcHpMax(base.end, 1)

    // Create character
    const char = await CharactersRepository.create({
      userId,
      nickname: input.nickname,
      archetype: arch,
      gender: input.gender ?? 'MALE',
      hpCurrent: hpMax,
      hpMax,
      money: B.startMoney,
    })

    // Create stats
    await CharactersRepository.createStats(char.id, { ...base, pointsAvailable })

    audit('character.created', {
      userId,
      characterId: char.id,
      nickname: char.nickname,
      archetype: arch,
    })

    return CharactersRepository.findByUserId(userId)
  },

  async getProfile(userId: string) {
    const char = await CharactersRepository.findByUserId(userId)
    if (!char) {
      throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Персонаж не найден', 404)
    }
    const [activeShift, professions, clan, equipped] = await Promise.all([
      prisma.workShift.findFirst({
        where: { characterId: char.id, status: { in: ['ACTIVE', 'READY_TO_CLAIM'] } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.characterProfession.findMany({ where: { characterId: char.id }, orderBy: { professionCode: 'asc' } }),
      // Досье показывало «не состоит» строкой в коде: бригады в профиле не было.
      char.clanId ? prisma.clan.findUnique({ where: { id: char.clanId }, select: { id: true, name: true, tag: true } }) : null,
      // Рейтинг зависит от надетого — считается на сервере, чтобы клиент
      // не собирал его по частям и не разошёлся с боем.
      prisma.itemInstance.findMany({
        where: { ownerId: char.id, isEquipped: true, status: { not: 'DELETED' } },
        include: { template: true },
      }),
    ])
    return {
      ...char,
      clan,
      dog: dogSummary(char.pets),
      rating: char.stats ? calcCharacterRating(char.stats, equipped) : 0,
      // Для карточки персонажа (правка 26.10, как в «Апехе»): прибавки и обереги
      // от надетого — тем же расчётом, что в бою, и порог следующего уровня.
      gear: gearOf(equipped),
      nextLevelExp: Number.isFinite(getExpForNextLevel(char.battleLevel)) ? getExpForNextLevel(char.battleLevel) : null,
      economy: {
        productionLevel: professions.reduce((max, item) => Math.max(max, item.level), 0),
        productionExp: professions.reduce((max, item) => Math.max(max, item.exp), 0),
        // Название рядом с кодом: досье показывало игроку «procurer».
        professions: professions.map(item => ({ ...item, name: PROFESSION_NAMES[item.professionCode as ProfessionCode] ?? item.professionCode })),
        economicLevel: char.economicLevel,
        economicExp: char.economicExp,
        activeShift,
      },
    }
  },

  async getBattleLoadout(userId: string) {
    const char = await this.getProfile(userId)
    return { itemInstanceIds: ((char.battleLoadoutJson as string[] | null) ?? []).slice(0, 4) }
  },

  async setBattleLoadout(userId: string, itemInstanceIds: string[]) {
    const char = await this.getProfile(userId)
    if (char.status === 'IN_BATTLE') {
      throw new AppError(ErrorCode.CHARACTER_IN_BATTLE, 'Cannot edit loadout in battle', 400)
    }
    const unique = [...new Set(itemInstanceIds)]
    if (unique.length > 4) throw new AppError(ErrorCode.CONFLICT, 'Не больше 4 вещей', 422)

    const items = await prisma.itemInstance.findMany({
      where: { id: { in: unique } },
      include: { template: true },
    })
    if (items.length !== unique.length || items.some(item => item.ownerId !== char.id)) {
      throw new AppError(ErrorCode.ITEM_NOT_OWNED, 'Loadout contains an item you do not own', 403)
    }
    if (items.some(item => item.template.type !== 'CONSUMABLE' || ['CONSUMED', 'DELETED'].includes(item.status))) {
      throw new AppError(ErrorCode.CONFLICT, 'Можно взять только расходники из своего инвентаря', 422)
    }

    await prisma.character.update({
      where: { id: char.id },
      data: { battleLoadoutJson: unique },
    })
    return { itemInstanceIds: unique }
  },

  async getById(characterId: string) {
    const char = await CharactersRepository.findById(characterId)
    if (!char) {
      throw AppError.notFound('Character', characterId)
    }
    return char
  },
}
