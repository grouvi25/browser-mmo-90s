import type { PrismaClient } from '@prisma/client'
import { CityConfig } from '../src/modules/city/city.config'
export async function seedCity(prisma: PrismaClient) {
  for (const entry of CityConfig.namedItems) {
    const data = { name: entry.name, description: 'Именная вещь ЦУМа. Все очки характеристик распределяет владелец на Складе.',
      type: entry.type, weaponType: entry.weaponType, armorSlot: entry.armorSlot,
      priceBase: entry.price, qualityBase: 'NAMED' as const, allocationMode: 'PLAYER' as const,
      statBudget: entry.budget, statAllocation: {}, sourceType: 'DONATE' as const, itemTier: 4,
      minDamage: entry.type === 'WEAPON' ? 5 : null, maxDamage: entry.type === 'WEAPON' ? 10 : null,
      // База брони как у стёганой куртки: очки «Броня» умножают базу, и с
      // нулём вложенные в куртку очки не давали ничего (правка заказчика 28.10).
      armor: entry.type === 'ARMOR' ? 10 : null,
      durabilityMax: 100, isEquippable: true, isActive: true }
    await prisma.itemTemplate.upsert({ where: { code: entry.code }, update: { armor: data.armor }, create: { code: entry.code, ...data } })
  }
  const a = CityConfig.artifact
  await prisma.itemTemplate.upsert({ where: { code: a.code }, update: {}, create: {
    code: a.code, name: a.name, description: 'Артефакт Берёзки: +10% боевого опыта, +3% уклонения. Бонус действует только когда предмет надет и исправен.',
    type: 'ACCESSORY', armorSlot: 'ACCESSORY', qualityBase: 'UNIQUE', sourceType: 'DONATE',
    priceBase: a.price, battleExpBonus: a.bonus, dodgeBonus: 0.03, durabilityMax: 100,
  } })
}
