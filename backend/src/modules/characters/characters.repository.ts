import { prisma } from '../../shared/db/prisma'
import type { Character, CharacterPet, CharacterStats } from '@prisma/client'

/** pets — для бонуса сытой собаки в бою; там, где персонаж собран
    вручную (тесты, симуляции), их может не быть. */
export type CharacterWithStats = Character & { stats: CharacterStats | null; pets?: CharacterPet[] }

export const CharactersRepository = {
  async findByUserId(userId: string): Promise<CharacterWithStats | null> {
    return prisma.character.findUnique({
      where: { userId },
      include: { stats: true, pets: true },
    })
  },

  async findById(id: string): Promise<CharacterWithStats | null> {
    return prisma.character.findUnique({
      where: { id },
      include: { stats: true, pets: true },
    })
  },

  async findByNickname(nickname: string): Promise<Character | null> {
    return prisma.character.findUnique({ where: { nickname } })
  },

  async create(data: {
    userId: string
    nickname: string
    archetype: string
    gender?: 'MALE' | 'FEMALE'
    hpCurrent: number
    hpMax: number
    money: number
  }): Promise<Character> {
    return prisma.character.create({ data: data as Parameters<typeof prisma.character.create>[0]['data'] })
  },

  async createStats(characterId: string, stats: {
    str: number; agi: number; rea: number; acc: number
    end: number; luck: number; agr: number; auth: number
    pointsAvailable: number
  }): Promise<CharacterStats> {
    return prisma.characterStats.create({ data: { characterId, ...stats } })
  },

  async updateHp(id: string, hpCurrent: number): Promise<void> {
    await prisma.character.update({ where: { id }, data: { hpCurrent } })
  },

  async updateStatus(id: string, status: string): Promise<void> {
    await prisma.character.update({
      where: { id },
      data: { status: status as Character['status'], lastActiveAt: new Date() },
    })
  },

  async updateBattleProgress(id: string, battleLevel: number, battleExp: number, hpMax: number): Promise<void> {
    await prisma.character.update({
      where: { id },
      data: { battleLevel, battleExp, hpMax },
    })
  },
}
