import { dogSummary } from '../city/city.config'
import { CharactersRepository } from './characters.repository'
import { calcCharacterRating, calcHpMax, getExpForNextLevel } from '../stats/stats.formulas'
import { gearOf } from '../items/gear-bonuses'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { BalanceConfig } from '../../config/balance.config'
import { audit } from '../../shared/logger/audit-logger'
import { Nickname, type CreateCharacterInput } from './characters.schemas'
import { AuthRepository } from '../auth/auth.repository'
import { NoticesService } from '../chat/notices.service'
import { prisma } from '../../shared/db/prisma'
import { PROFESSION_NAMES, type ProfessionCode } from '../professions/professions'
import { applyUpgradeModifiers, type UpgradeKind } from '../upgrades/upgrades.formulas'

/** Карман без исчезнувших вещей: съеденных в бою, проданных, чужих. */
async function liveLoadout(characterId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const items = await prisma.itemInstance.findMany({
    where: { id: { in: ids }, ownerId: characterId, status: { notIn: ['CONSUMED', 'DELETED'] }, template: { type: 'CONSUMABLE' } },
    select: { id: true },
  })
  const alive = new Set(items.map(item => item.id))
  return ids.filter(id => alive.has(id))
}

export const CharactersService = {
  async create(userId: string, input: CreateCharacterInput) {
    // Check user doesn't already have a character
    const existing = await CharactersRepository.findByUserId(userId)
    if (existing) {
      throw new AppError(ErrorCode.CHARACTER_ALREADY_EXISTS, 'You already have a character', 409)
    }

    // Ник по умолчанию — тот, что выбран при регистрации (он же имя для
    // входа, правка 29.10). Занятость — без учёта регистра и с чужими
    // логинами: по нику входят, и у одного имени должен быть один хозяин.
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { login: true } })
    const parsedNick = Nickname.safeParse(input.nickname ?? user.login)
    if (!parsedNick.success) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Введите ник персонажа', 422)
    const nickname = parsedNick.data
    if (await AuthRepository.nicknameTaken(nickname, userId)) {
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
      nickname,
      archetype: arch,
      gender: input.gender ?? 'MALE',
      hpCurrent: hpMax,
      hpMax,
      money: B.startMoney,
    })

    // Create stats
    await CharactersRepository.createStats(char.id, { ...base, pointsAvailable })

    // Письмо Бывалого новичку (Дмитрий 09.11): строка в ленте «Системы», сам текст — на /novichok.
    await NoticesService.push(char.id, `Бывалый оставил тебе письмо, ${char.nickname}: «Кодекс выживания приезжего». Читай в Библиотеке → «С чего начать» или по адресу kooperativ.space/novichok`)
      .catch(() => undefined)

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
      gear: gearOf(equipped.map(item => ({
        ...item,
        effective: applyUpgradeModifiers(
          item.template,
          (item.upgradeModifiersJson as Partial<Record<UpgradeKind, number>> | null) ?? {},
          item.statAllocation,
          item.socketsJson,
        ),
      }))),
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
    return { itemInstanceIds: await liveLoadout(char.id, ((char.battleLoadoutJson as string[] | null) ?? []).slice(0, 4)) }
  },

  async setBattleLoadout(userId: string, itemInstanceIds: string[]) {
    const char = await this.getProfile(userId)
    if (char.status === 'IN_BATTLE') {
      throw new AppError(ErrorCode.CHARACTER_IN_BATTLE, 'Cannot edit loadout in battle', 400)
    }
    // Обращение №51: использованный в бою расходник оставался в списке, и любая
    // правка карманов отклонялась целиком. Исчезнувшие вещи (съедены, проданы,
    // не свои) молча выпадают; отказ — только на попытку положить не расходник.
    const requested = [...new Set(itemInstanceIds)]
    const items = await prisma.itemInstance.findMany({
      where: { id: { in: requested }, ownerId: char.id, status: { notIn: ['CONSUMED', 'DELETED'] } },
      include: { template: true },
    })
    if (items.some(item => item.template.type !== 'CONSUMABLE')) {
      throw new AppError(ErrorCode.CONFLICT, 'Можно взять только расходники из своего инвентаря', 422)
    }
    const alive = new Set(items.map(item => item.id))
    const unique = requested.filter(id => alive.has(id))
    if (unique.length > 4) throw new AppError(ErrorCode.CONFLICT, 'Не больше 4 вещей', 422)

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
