import { prisma } from '../../shared/db/prisma'
import type { WeaponSkill, WeaponType, WeaponType as PrismaWeaponType } from '@prisma/client'
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

/**
 * Начислить опыт оружия с переливом в антимастерство на потолке 20.
 *
 * Переехало из battles.service: командному бою нужно то же самое, а импорт
 * сервиса в бой дал бы цикл. Заодно ушло расхождение — командный бой писал
 * навык упрощённой веткой, без перелива, то есть антимастерство в войне за
 * район не копилось вовсе.
 */
export async function saveWeaponSkillExp(
  tx: typeof prisma,
  characterId: string,
  weaponType: string,
  weaponExpGain: number
): Promise<void> {
  if (weaponExpGain <= 0) return
  const existing = await tx.weaponSkill.findUnique({
    where: { characterId_weaponType: { characterId, weaponType: weaponType as PrismaWeaponType } },
  })
  const base = existing ?? { skillLevel: 1, skillExp: 0, antiSkillLevel: 0, antiSkillExp: 0 }

  const MAX_WSK = 20
  if (base.skillLevel < MAX_WSK) {
    // Normal WSK progression
    const newWskExp = base.skillExp + weaponExpGain
    const newWskLevel = getWeaponSkillLevelFromExp(newWskExp)
    if (existing) {
      await tx.weaponSkill.update({
        where: { characterId_weaponType: { characterId, weaponType: weaponType as PrismaWeaponType } },
        data: { skillExp: newWskExp, skillLevel: newWskLevel },
      })
    } else {
      await tx.weaponSkill.create({
        data: { characterId, weaponType: weaponType as PrismaWeaponType, skillExp: newWskExp, skillLevel: newWskLevel },
      })
    }
  } else {
    // WSK=20 reached → overflow exp goes to antiSkillLevel (WRES)
    // antiSkill thresholds: each level requires the same table but offset
    // 20/1=1 antiSkill point, 20/2=2, etc. (simplified: 100 exp per anti-skill level)
    const ANTI_EXP_PER_LEVEL = 500
    const MAX_ANTI_LEVEL = 10
    const newAntiExp = (base.antiSkillExp ?? 0) + weaponExpGain * 0.5 // 50% overflow to anti-skill
    const newAntiLevel = Math.min(MAX_ANTI_LEVEL, Math.floor(newAntiExp / ANTI_EXP_PER_LEVEL))
    if (existing) {
      await tx.weaponSkill.update({
        where: { characterId_weaponType: { characterId, weaponType: weaponType as PrismaWeaponType } },
        data: { antiSkillExp: newAntiExp, antiSkillLevel: newAntiLevel },
      })
    } else {
      await tx.weaponSkill.create({
        data: { characterId, weaponType: weaponType as PrismaWeaponType, skillExp: base.skillExp, skillLevel: MAX_WSK, antiSkillExp: newAntiExp, antiSkillLevel: newAntiLevel },
      })
    }
  }
}
