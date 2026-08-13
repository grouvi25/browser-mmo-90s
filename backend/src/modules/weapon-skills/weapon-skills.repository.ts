import { prisma } from '../../shared/db/prisma'
import type { WeaponSkill, WeaponType } from '@prisma/client'
import { getWeaponSkillLevelFromExp } from '../stats/stats.formulas'

export const WeaponSkillsRepository = {
  async findOrCreate(characterId: string, weaponType: WeaponType): Promise<WeaponSkill> {
    return prisma.weaponSkill.upsert({
      where: { characterId_weaponType: { characterId, weaponType } },
      update: {},
      create: { characterId, weaponType, skillLevel: 1, skillExp: 0 },
    })
  },

  async addExp(
    characterId: string,
    weaponType: WeaponType,
    expGain: number
  ): Promise<{ level: number; exp: number; leveledUp: boolean }> {
    const skill = await this.findOrCreate(characterId, weaponType)
    const newExp = skill.skillExp + expGain
    const newLevel = getWeaponSkillLevelFromExp(newExp)
    const leveledUp = newLevel > skill.skillLevel

    await prisma.weaponSkill.update({
      where: { characterId_weaponType: { characterId, weaponType } },
      data: { skillExp: newExp, skillLevel: newLevel },
    })

    return { level: newLevel, exp: newExp, leveledUp }
  },

  async getAll(characterId: string): Promise<WeaponSkill[]> {
    return prisma.weaponSkill.findMany({ where: { characterId } })
  },

  async getByType(characterId: string, weaponType: WeaponType): Promise<WeaponSkill | null> {
    return prisma.weaponSkill.findUnique({
      where: { characterId_weaponType: { characterId, weaponType } },
    })
  },
}
