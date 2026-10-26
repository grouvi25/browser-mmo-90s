import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../shared/security/auth-middleware'
import { BalanceConfig } from '../../config/balance.config'
import { CharactersService } from './characters.service'
import { CreateCharacterSchema } from './characters.schemas'
import { WeaponSkillsRepository } from '../weapon-skills/weapon-skills.repository'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { prisma } from '../../shared/db/prisma'
import { EconomyService } from '../economy/economy.service'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { calcCharacterRating } from '../stats/stats.formulas'
import { dogSummary } from '../city/city.config'
import { PROFESSION_NAMES, type ProfessionCode } from '../professions/professions'
import { syncHpWithGear } from '../items/gear-bonuses'

const BattleLoadoutSchema = z.object({
  itemInstanceIds: z.array(z.string().uuid()).max(4),
})

const DistributeStatSchema = z.object({
  stat: z.enum(['str', 'agi', 'rea', 'acc', 'end', 'luck', 'agr', 'auth']),
  amount: z.number().int().min(1).max(5),
})

const STAT_KEYS = ['str', 'agi', 'rea', 'acc', 'end', 'luck', 'agr', 'auth'] as const
type StatKey = typeof STAT_KEYS[number]

const ApplyStatsSchema = z.object({
  // zod v4: record с enum-ключами требует ВСЕ ключи — а черновик статов
  // приходит частичным, поэтому partialRecord.
  deltas: z.partialRecord(z.enum(STAT_KEYS), z.number().int().min(0).max(100)),
})

/** С чего начинал персонаж: база плюс бонус архетипа. Ниже свиток не опускает. */
function startingStats(archetype: string): Record<StatKey, number> {
  const B = BalanceConfig.character
  const base = { ...B.baseStats } as Record<StatKey, number>
  for (const [stat, bonus] of Object.entries(B.archetypeBonuses[archetype] ?? {})) base[stat as StatKey] += bonus ?? 0
  return base
}

/** Выносливость меняет запас HP — пересчитываем сразу, а не после боя
    (с прибавками от надетых вещей). */
async function syncHpMax(tx: Prisma.TransactionClient, characterId: string) {
  const stats = await tx.characterStats.findUniqueOrThrow({ where: { characterId } })
  await syncHpWithGear(tx, characterId)
  return stats
}

export async function charactersRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/creation-config', { preHandler: authenticate }, async (_req, reply) => {
    reply.header('Cache-Control', 'no-store')
    return { startMoney: BalanceConfig.character.startMoney }
  })

  fastify.post('/', { preHandler: authenticate },
    async (req, reply) => {
      const parsed = CreateCharacterSchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(422).send({ code: 'GEN_001', message: 'Validation error', details: parsed.error.flatten().fieldErrors })
      }
      const char = await CharactersService.create(req.authUser.userId, parsed.data)
      return reply.code(201).send(char)
    })

  // PATCH /api/characters/me/gender — пол (правка заказчика: «пол женский»).
  // Уже созданные персонажи тоже должны мочь его выбрать, поэтому не только
  // при создании.
  fastify.patch('/me/gender', { preHandler: authenticate }, async (req, reply) => {
    const parsed = z.object({ gender: z.enum(['MALE', 'FEMALE']) }).safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Пол: MALE или FEMALE' })
    const char = await CharactersService.getProfile(req.authUser.userId)
    await prisma.character.update({ where: { id: char.id }, data: { gender: parsed.data.gender } })
    return reply.send({ gender: parsed.data.gender })
  })

  // Заметки в «Личном деле»: свои о любом игроке (и о себе), видит только автор.
  fastify.get<{ Params: { targetId: string } }>('/notes/:targetId', { preHandler: authenticate }, async (req, reply) => {
    if (!z.string().uuid().safeParse(req.params.targetId).success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    const me = await CharactersService.getProfile(req.authUser.userId)
    const note = await prisma.playerNote.findUnique({ where: { authorId_targetId: { authorId: me.id, targetId: req.params.targetId } } })
    return reply.send({ text: note?.text ?? '' })
  })
  fastify.put<{ Params: { targetId: string }; Body: { text: string } }>('/notes/:targetId', { preHandler: authenticate }, async (req, reply) => {
    const parsed = z.object({ text: z.string().max(4000) }).safeParse(req.body)
    if (!z.string().uuid().safeParse(req.params.targetId).success || !parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Заметка: не больше 4000 знаков' })
    const me = await CharactersService.getProfile(req.authUser.userId)
    const target = await prisma.character.findUnique({ where: { id: req.params.targetId }, select: { id: true } })
    if (!target) throw AppError.notFound('Character', req.params.targetId)
    await prisma.playerNote.upsert({
      where: { authorId_targetId: { authorId: me.id, targetId: target.id } },
      create: { authorId: me.id, targetId: target.id, text: parsed.data.text },
      update: { text: parsed.data.text },
    })
    return reply.send({ ok: true })
  })

  fastify.get('/me', { preHandler: authenticate },
    async (req, reply) => {
      const char = await CharactersService.getProfile(req.authUser.userId)
      // Include weapon skills inline for frontend convenience
      const skills = await WeaponSkillsRepository.getAll(char.id)
      return reply.send({ ...char, weaponSkills: skills })
    })

  // GET /api/characters/me/skills — weapon skills
  fastify.get('/me/battle-loadout', { preHandler: authenticate }, async (req, reply) => {
    return reply.send(await CharactersService.getBattleLoadout(req.authUser.userId))
  })

  fastify.put('/me/battle-loadout', { preHandler: authenticate }, async (req, reply) => {
    const parsed = BattleLoadoutSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(422).send({ code: 'GEN_001', message: 'Validation error', details: parsed.error.flatten().fieldErrors })
    }
    return reply.send(await CharactersService.setBattleLoadout(req.authUser.userId, parsed.data.itemInstanceIds))
  })

  fastify.get('/me/skills', { preHandler: authenticate },
    async (req, reply) => {
      const char = await CharactersService.getProfile(req.authUser.userId)
      const skills = await WeaponSkillsRepository.getAll(char.id)
      return reply.send(skills)
    })

  // POST /api/characters/stats/distribute — распределение очков характеристик
  // Используется: архетип STUDENT (+2 очка), повышение боевого уровня (+1 за уровень)
  fastify.post('/stats/distribute', { preHandler: authenticate },
    async (req, reply) => {
      const parsed = DistributeStatSchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      }
      const { stat, amount } = parsed.data

      const char = await CharactersService.getProfile(req.authUser.userId)
      if (!char.stats) throw AppError.internal('Stats missing')
      if (char.stats.pointsAvailable < amount) {
        throw new AppError(ErrorCode.CONFLICT, `Недостаточно очков (есть ${char.stats.pointsAvailable}, нужно ${amount})`, 400)
      }

      const MAX_STAT = 20
      const statsAsNumbers = char.stats as unknown as Record<string, number>
      const currentVal = statsAsNumbers[stat] ?? 0
      if (currentVal + amount > MAX_STAT) {
        throw new AppError(ErrorCode.CONFLICT, `Характеристика не может превышать ${MAX_STAT}`, 400)
      }
      // Conditional update preserves points and stat caps under concurrent requests.
      const updated = await prisma.characterStats.updateMany({
        where: {
          characterId: char.id,
          pointsAvailable: { gte: amount },
          [stat]: { lte: MAX_STAT - amount },
        },
        data: {
          [stat]: { increment: amount },
          pointsAvailable: { decrement: amount },
        },
      })
      if (updated.count !== 1) {
        throw new AppError(ErrorCode.CONFLICT, 'Не хватает очков или характеристика уже на пределе', 409)
      }
      const result = await prisma.characterStats.findUnique({ where: { characterId: char.id } })
      if (!result) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Stats not found', 404)

      return reply.send({ message: `+${amount} ${stat}`, stats: result })
    })

  fastify.get<{ Params: { id: string } }>('/:id', { preHandler: authenticate },
    async (req, reply) => {
      const char = await CharactersService.getById(req.params.id)
      return reply.send(char)
    })

  // POST /api/characters/stats/apply — черновик со страницы характеристик
  // одним разом (обещание игрокам 22.10): игрок крутит «+» и «−», смотрит,
  // что меняется, и только потом подтверждает.
  fastify.post('/stats/apply', { preHandler: authenticate },
    async (req, reply) => {
      const parsed = ApplyStatsSchema.safeParse(req.body)
      if (!parsed.success) throw AppError.validation('Неверный набор характеристик')
      const deltas = Object.entries(parsed.data.deltas).filter(([, v]) => (v ?? 0) > 0) as Array<[StatKey, number]>
      const total = deltas.reduce((sum, [, v]) => sum + v, 0)
      if (total === 0) throw AppError.validation('Ничего не выбрано')
      const char = await CharactersService.getProfile(req.authUser.userId)
      const max = BalanceConfig.character.maxStat
      const stats = await prisma.$transaction(async tx => {
        // Условия в самом UPDATE: два одновременных подтверждения не потратят очки дважды.
        const updated = await tx.characterStats.updateMany({
          where: {
            characterId: char.id,
            pointsAvailable: { gte: total },
            ...Object.fromEntries(deltas.map(([k, v]) => [k, { lte: max - v }])),
          },
          data: {
            pointsAvailable: { decrement: total },
            ...Object.fromEntries(deltas.map(([k, v]) => [k, { increment: v }])),
          },
        })
        if (updated.count !== 1) throw new AppError(ErrorCode.CONFLICT, `Не хватает очков или характеристика выше ${max}`, 409)
        return syncHpMax(tx, char.id)
      })
      return reply.send({ message: `Вложено очков: ${total}`, stats })
    })

  // POST /api/characters/stats/respec — свиток: все вложенные очки
  // возвращаются, характеристики — к стартовым.
  fastify.post('/stats/respec', { preHandler: authenticate },
    async (req, reply) => {
      const char = await CharactersService.getProfile(req.authUser.userId)
      if (!char.stats) throw AppError.internal('Stats missing')
      const start = startingStats(char.archetype)
      const current = char.stats as unknown as Record<StatKey, number>
      const spent = STAT_KEYS.reduce((sum, k) => sum + Math.max(0, current[k] - start[k]), 0)
      if (spent === 0) throw new AppError(ErrorCode.CONFLICT, 'Возвращать нечего: очки не вложены', 409)
      const stats = await prisma.$transaction(async tx => {
        const used = await tx.characterStats.updateMany({
          where: { characterId: char.id, respecScrolls: { gt: 0 }, ...Object.fromEntries(STAT_KEYS.map(k => [k, current[k]])) },
          data: { respecScrolls: { decrement: 1 }, pointsAvailable: { increment: spent }, ...start },
        })
        if (used.count !== 1) throw new AppError(ErrorCode.CONFLICT, 'Нет свитка перераспределения или характеристики уже изменились', 409)
        return syncHpMax(tx, char.id)
      })
      return reply.send({ message: `Очки возвращены: ${spent}`, stats })
    })

  // POST /api/characters/stats/respec/buy — свиток за рубли.
  fastify.post('/stats/respec/buy', { preHandler: authenticate },
    async (req, reply) => {
      const char = await CharactersService.getProfile(req.authUser.userId)
      const price = BalanceConfig.character.respecScrollPrice
      const stats = await prisma.$transaction(async tx => {
        await EconomyService.debit(tx, { characterId: char.id, amount: price, reasonCode: 'STAT_RESPEC_PURCHASE' })
        return tx.characterStats.update({ where: { characterId: char.id }, data: { respecScrolls: { increment: 1 } } })
      })
      return reply.send({ message: 'Куплен свиток перераспределения', stats })
    })

  // GET /api/characters/search?q= — поиск бойцов по началу ника
  fastify.get<{ Querystring: { q?: string } }>('/search', { preHandler: authenticate },
    async (req, reply) => {
      const q = (req.query.q ?? '').trim().slice(0, 30)
      if (q.length < 2) return reply.send({ items: [] })
      const rows = await prisma.character.findMany({
        where: { nickname: { contains: q, mode: 'insensitive' }, isInvisible: false },
        select: { nickname: true, battleLevel: true, battlesTotal: true, battlesWon: true, clanId: true },
        orderBy: { battleLevel: 'desc' },
        take: 20,
      })
      const clanIds = [...new Set(rows.flatMap(r => r.clanId ? [r.clanId] : []))]
      const clans = new Map((await prisma.clan.findMany({ where: { id: { in: clanIds } }, select: { id: true, name: true } })).map(c => [c.id, c.name]))
      return reply.send({ items: rows.map(r => ({ nickname: r.nickname, level: r.battleLevel, battles: r.battlesTotal, wins: r.battlesWon, clan: r.clanId ? clans.get(r.clanId) ?? null : null })) })
    })

  // GET /api/characters/by-nickname/:nickname — публичный профиль
  fastify.get<{ Params: { nickname: string } }>('/by-nickname/:nickname', { preHandler: authenticate },
    async (req, reply) => {
      const char = await prisma.character.findUnique({
        where: { nickname: req.params.nickname },
        include: { stats: true },
      })
      if (!char) throw AppError.notFound('Character', req.params.nickname)
      if (char.isInvisible) return reply.send({ hidden: true, nickname: req.params.nickname })
      const [clan, professions, skills, pets, equipped] = await Promise.all([
        char.clanId ? prisma.clan.findUnique({ where: { id: char.clanId }, select: { id: true, name: true, iconVersion: true } }) : null,
        prisma.characterProfession.findMany({ where: { characterId: char.id }, orderBy: { level: 'desc' } }),
        prisma.weaponSkill.findMany({ where: { characterId: char.id, skillLevel: { gt: 1 } }, orderBy: { skillLevel: 'desc' }, take: 3 }),
        prisma.characterPet.findMany({ where: { characterId: char.id } }),
        // Надетое видно и в бою, тайны в нём нет; рейтинг считается по
        // тому же правилу, что и в собственном досье.
        prisma.itemInstance.findMany({
          where: { ownerId: char.id, isEquipped: true, status: { not: 'DELETED' } },
          include: { template: true },
        }),
      ])
      const weapons = equipped.filter(i => i.template.type === 'WEAPON')
      // Правка заказчика 21.10: чужой профиль выглядит как свой — те же графы.
      return reply.send({
        id: char.id,
        nickname: char.nickname,
        archetype: char.archetype,
        gender: char.gender,
        battleLevel: char.battleLevel,
        economicLevel: char.economicLevel,
        rating: char.stats ? calcCharacterRating(char.stats, equipped) : 0,
        hpCurrent: char.hpCurrent,
        hpMax: char.hpMax,
        battlesTotal: char.battlesTotal,
        battlesWon: char.battlesWon,
        location: char.location,
        clan,
        professions: professions.map(p => ({ professionCode: p.professionCode, level: p.level, name: PROFESSION_NAMES[p.professionCode as ProfessionCode] ?? p.professionCode })),
        weaponSkills: skills.map(s => ({ weaponType: s.weaponType, skillLevel: s.skillLevel })),
        dog: dogSummary(pets),
        weapons: weapons.map(w => ({ armorSlot: w.armorSlot, name: w.template.name, code: w.template.code, weaponType: w.template.weaponType })),
        createdAt: char.createdAt,
      })
    })
}
