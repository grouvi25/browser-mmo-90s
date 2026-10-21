import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../shared/security/auth-middleware'
import { CharactersService } from './characters.service'
import { CreateCharacterSchema } from './characters.schemas'
import { WeaponSkillsRepository } from '../weapon-skills/weapon-skills.repository'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { prisma } from '../../shared/db/prisma'
import { z } from 'zod'
import { dogSummary } from '../city/city.config'
import { PROFESSION_NAMES, type ProfessionCode } from '../professions/professions'

const BattleLoadoutSchema = z.object({
  itemInstanceIds: z.array(z.string().uuid()).max(4),
})

const DistributeStatSchema = z.object({
  stat: z.enum(['str', 'agi', 'rea', 'acc', 'end', 'luck', 'agr', 'auth']),
  amount: z.number().int().min(1).max(5),
})

export async function charactersRoutes(fastify: FastifyInstance): Promise<void> {

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

  // GET /api/characters/by-nickname/:nickname — публичный профиль
  fastify.get<{ Params: { nickname: string } }>('/by-nickname/:nickname', { preHandler: authenticate },
    async (req, reply) => {
      const char = await prisma.character.findUnique({
        where: { nickname: req.params.nickname },
        include: { stats: true },
      })
      if (!char) throw AppError.notFound('Character', req.params.nickname)
      if (char.isInvisible) return reply.send({ hidden: true, nickname: req.params.nickname })
      const [clan, professions, skills, pets, weapons] = await Promise.all([
        char.clanId ? prisma.clan.findUnique({ where: { id: char.clanId }, select: { id: true, name: true, iconVersion: true } }) : null,
        prisma.characterProfession.findMany({ where: { characterId: char.id }, orderBy: { level: 'desc' } }),
        prisma.weaponSkill.findMany({ where: { characterId: char.id, skillLevel: { gt: 1 } }, orderBy: { skillLevel: 'desc' }, take: 3 }),
        prisma.characterPet.findMany({ where: { characterId: char.id } }),
        // Надетое оружие видно и в бою, тайны в нём нет; инвентарь и деньги — нет.
        prisma.itemInstance.findMany({
          where: { ownerId: char.id, isEquipped: true, status: { not: 'DELETED' }, template: { type: 'WEAPON' } },
          select: { armorSlot: true, template: { select: { name: true, code: true, weaponType: true } } },
        }),
      ])
      // Правка заказчика 21.10: чужой профиль выглядит как свой — те же графы.
      return reply.send({
        id: char.id,
        nickname: char.nickname,
        archetype: char.archetype,
        gender: char.gender,
        battleLevel: char.battleLevel,
        economicLevel: char.economicLevel,
        hpCurrent: char.hpCurrent,
        hpMax: char.hpMax,
        battlesTotal: char.battlesTotal,
        battlesWon: char.battlesWon,
        location: char.location,
        clan,
        professions: professions.map(p => ({ professionCode: p.professionCode, level: p.level, name: PROFESSION_NAMES[p.professionCode as ProfessionCode] ?? p.professionCode })),
        weaponSkills: skills.map(s => ({ weaponType: s.weaponType, skillLevel: s.skillLevel })),
        dog: dogSummary(pets),
        weapons: weapons.map(w => ({ armorSlot: w.armorSlot, ...w.template })),
        createdAt: char.createdAt,
      })
    })
}
