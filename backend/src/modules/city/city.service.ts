import { prisma } from '../../shared/db/prisma'
import { withIdempotency } from '../../shared/db/idempotency'
import { withTransaction } from '../../shared/db/transaction'
import { AppError } from '../../shared/errors/app-error'
import { EconomyService } from '../economy/economy.service'
import { PROFESSION_CODES, PROFESSION_NAMES, isProfessionCode } from '../professions/professions'
import { CityConfig, artifactBonus, inPrison, validCityPath } from './city.config'

export const CityService = {
  async character(userId: string) {
    const char = await prisma.character.findUnique({ where: { userId } })
    if (!char) throw AppError.notFound('Персонаж')
    return char
  },
  async location(userId: string) {
    const char = await this.character(userId)
    return { path: inPrison(char.jailedUntil) ? '/prison' : validCityPath(char.lastLocation) ? char.lastLocation : '/',
      jailedUntil: char.jailedUntil, jailReason: char.jailReason }
  },
  async move(userId: string, path: string) {
    if (!validCityPath(path)) throw AppError.validation('Неизвестная локация')
    return withTransaction(async tx => {
      const char = await tx.character.findUniqueOrThrow({ where: { userId } })
      if (inPrison(char.jailedUntil) && path !== '/prison') throw AppError.forbidden('До освобождения персонаж находится в тюрьме')
      await tx.character.update({ where: { id: char.id }, data: { lastLocation: path, location: path } })
      return { path }
    })
  },
  async professions(characterId: string) {
    const owned = await prisma.characterProfession.findMany({ where: { characterId } })
    return { items: PROFESSION_CODES.map(code => ({ code, name: PROFESSION_NAMES[code], price: CityConfig.professionPrice,
      owned: owned.some(p => p.professionCode === code), level: owned.find(p => p.professionCode === code)?.level ?? 0 })) }
  },
  async learn(characterId: string, code: string, key: string) {
    if (!isProfessionCode(code)) throw AppError.validation('Неизвестная профессия')
    return withIdempotency({ characterId, scope: `city.profession.${code}`, key, execute: async tx => {
      if (await tx.characterProfession.findUnique({ where: { characterId_professionCode: { characterId, professionCode: code } } })) {
        throw AppError.conflict('Профессия уже изучена')
      }
      await EconomyService.debit(tx, { characterId, amount: CityConfig.professionPrice, reasonCode: 'SHOP_PURCHASE', refType: 'profession', refId: code })
      const profession = await tx.characterProfession.create({ data: { characterId, professionCode: code } })
      return { profession }
    } })
  },
  async catalog(kind: 'tsum' | 'berezka') {
    const codes = kind === 'tsum' ? CityConfig.namedItems.map(i => i.code) : [CityConfig.artifact.code]
    return { items: await prisma.itemTemplate.findMany({ where: { code: { in: codes }, isActive: true }, orderBy: { priceBase: 'asc' } }) }
  },
  async buyItem(characterId: string, kind: 'tsum' | 'berezka', templateId: string, key: string) {
    return withIdempotency({ characterId, scope: `city.${kind}.${templateId}`, key, execute: async tx => {
      const template = await tx.itemTemplate.findUnique({ where: { id: templateId } })
      const codes: readonly string[] = kind === 'tsum' ? CityConfig.namedItems.map(i => i.code) : [CityConfig.artifact.code]
      if (!template?.isActive || !codes.includes(template.code)) throw AppError.notFound('Предмет')
      const char = await tx.character.findUniqueOrThrow({ where: { id: characterId } })
      if (char.status === 'IN_BATTLE') throw AppError.conflict('Покупка недоступна во время боя')
      const newBalance = await EconomyService.debit(tx, { characterId, amount: template.priceBase, reasonCode: 'SHOP_PURCHASE', refType: kind, refId: template.id })
      const item = await tx.itemInstance.create({ data: { templateId, ownerId: characterId, sourceType: 'DONATE', quality: template.qualityBase,
        durabilityCurrent: template.durabilityMax, durabilityMax: template.durabilityMax, weight: template.weight,
        freePoints: template.allocationMode === 'PLAYER' ? template.statBudget : 0 } })
      await tx.itemLog.create({ data: { itemId: item.id, characterId, actionCode: 'CREATED_FROM_SHOP', details: { shop: kind, price: template.priceBase } } })
      return { item, newBalance }
    } })
  },
  async pets(characterId: string) {
    return { catalog: CityConfig.pets, foodPrice: CityConfig.foodPrice, feedingHours: CityConfig.feedingHours,
      owned: await prisma.characterPet.findMany({ where: { characterId }, orderBy: { createdAt: 'asc' } }) }
  },
  async buyPet(characterId: string, code: string, key: string) {
    const entry = CityConfig.pets.find(p => p.code === code)
    if (!entry) throw AppError.validation('Неизвестный питомец')
    return withIdempotency({ characterId, scope: `city.pet.${code}`, key, execute: async tx => {
      if (await tx.characterPet.findUnique({ where: { characterId_code: { characterId, code } } })) throw AppError.conflict('Этот питомец уже есть')
      await EconomyService.debit(tx, { characterId, amount: entry.price, reasonCode: 'SHOP_PURCHASE', refType: 'pet', refId: code })
      return { pet: await tx.characterPet.create({ data: { characterId, code, name: entry.name } }) }
    } })
  },
  async buyFood(characterId: string, petId: string, quantity: number, key: string) {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > CityConfig.maxFood) throw AppError.validation('Недопустимое количество корма')
    return withIdempotency({ characterId, scope: `city.food.${petId}`, key, execute: async tx => {
      const pet = await tx.characterPet.findFirst({ where: { id: petId, characterId } })
      if (!pet) throw AppError.notFound('Питомец')
      if (pet.food + quantity > CityConfig.maxFood) throw AppError.conflict('Запас корма не может превышать 100')
      await EconomyService.debit(tx, { characterId, amount: CityConfig.foodPrice * quantity, reasonCode: 'SHOP_PURCHASE', refType: 'pet-food', refId: petId })
      return { pet: await tx.characterPet.update({ where: { id: petId }, data: { food: { increment: quantity } } }) }
    } })
  },
  async feed(characterId: string, petId: string, key: string) {
    return withIdempotency({ characterId, scope: `city.feed.${petId}`, key, execute: async tx => {
      const pet = await tx.characterPet.findFirst({ where: { id: petId, characterId } })
      if (!pet) throw AppError.notFound('Питомец')
      if (pet.food < 1) throw AppError.conflict('Сначала купите корм')
      const now = new Date()
      if (pet.fedUntil && pet.fedUntil > now) throw AppError.conflict('Питомец уже сыт')
      return { pet: await tx.characterPet.update({ where: { id: petId }, data: {
        food: { decrement: 1 }, fedUntil: new Date(now.getTime() + CityConfig.feedingHours * 3600000),
      } }) }
    } })
  },
  async expBonus(characterId: string) {
    const items = await prisma.itemInstance.findMany({ where: { ownerId: characterId, isEquipped: true,
      status: { in: ['NORMAL', 'EQUIPPED'] }, durabilityCurrent: { gt: 0 }, template: { battleExpBonus: { gt: 0 } } },
      select: { template: { select: { battleExpBonus: true } } } })
    return artifactBonus(items.map(i => i.template.battleExpBonus))
  },
}
