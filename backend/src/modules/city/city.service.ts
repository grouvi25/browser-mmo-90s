import { prisma } from '../../shared/db/prisma'
import { withIdempotency } from '../../shared/db/idempotency'
import { withTransaction } from '../../shared/db/transaction'
import { AppError } from '../../shared/errors/app-error'
import { EconomyService } from '../economy/economy.service'
import { DollarsService } from '../dollars/dollars.service'
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
    const items = await prisma.itemTemplate.findMany({ where: { code: { in: codes }, isActive: true }, orderBy: { priceBase: 'asc' } })
    return { currency: 'USD' as const, items: items.map(item => ({ ...item, priceDollars: CityConfig.dollarPrices[item.code] ?? null })) }
  },
  async buyItem(characterId: string, kind: 'tsum' | 'berezka', templateId: string, key: string) {
    return withIdempotency({ characterId, scope: `city.${kind}.${templateId}`, key, execute: async tx => {
      const template = await tx.itemTemplate.findUnique({ where: { id: templateId } })
      const codes: readonly string[] = kind === 'tsum' ? CityConfig.namedItems.map(i => i.code) : [CityConfig.artifact.code]
      if (!template?.isActive || !codes.includes(template.code)) throw AppError.notFound('Предмет')
      const char = await tx.character.findUniqueOrThrow({ where: { id: characterId } })
      if (char.status === 'IN_BATTLE') throw AppError.conflict('Покупка недоступна во время боя')
      const priceDollars = CityConfig.dollarPrices[template.code]
      if (!priceDollars) throw AppError.notFound('Предмет')
      const dollars = await DollarsService.debit(tx, { characterId, amount: priceDollars, reason: 'PURCHASE', refId: template.id, note: template.name })
      const item = await tx.itemInstance.create({ data: { templateId, ownerId: characterId, sourceType: 'DONATE', quality: template.qualityBase,
        durabilityCurrent: template.durabilityMax, durabilityMax: template.durabilityMax, weight: template.weight,
        freePoints: template.allocationMode === 'PLAYER' ? template.statBudget : 0 } })
      await tx.itemLog.create({ data: { itemId: item.id, characterId, actionCode: 'CREATED_FROM_SHOP', details: { shop: kind, priceDollars } } })
      return { item, dollars }
    } })
  },
  async pets(characterId: string) {
    return { catalog: CityConfig.pets, packs: CityConfig.feedPacks, feedingHours: CityConfig.feedingHours,
      owned: await prisma.characterPet.findMany({ where: { characterId }, orderBy: { createdAt: 'asc' } }) }
  },
  async buyPet(characterId: string, code: string, key: string) {
    const entry = CityConfig.pets.find(p => p.code === code)
    if (!entry) throw AppError.validation('Неизвестный питомец')
    return withIdempotency({ characterId, scope: `city.pet`, key, execute: async tx => {
      // Одна собака на персонажа: в профиле под неё одна ячейка. Строка
      // персонажа блокируется, чтобы две разные породы, купленные разом,
      // не прошли проверку обе.
      await tx.$executeRaw`SELECT id FROM characters WHERE id = ${characterId} FOR UPDATE`
      const dogs = CityConfig.pets.map(p => p.code)
      if (await tx.characterPet.findFirst({ where: { characterId, code: { in: dogs } } })) throw AppError.conflict('Собака у вас уже есть')
      await EconomyService.debit(tx, { characterId, amount: entry.price, reasonCode: 'SHOP_PURCHASE', refType: 'pet', refId: code })
      return { pet: await tx.characterPet.create({ data: { characterId, code, name: entry.name } }) }
    } })
  },
  /** Корм покупается сроком: собака сыта ещё на столько часов. */
  async buyFeedPack(characterId: string, petId: string, packCode: string, key: string) {
    const pack = CityConfig.feedPacks.find(p => p.code === packCode)
    if (!pack) throw AppError.validation('Неизвестный корм')
    return withIdempotency({ characterId, scope: `city.food.${petId}`, key, execute: async tx => {
      const pet = await tx.characterPet.findFirst({ where: { id: petId, characterId } })
      if (!pet) throw AppError.notFound('Питомец')
      const now = Date.now()
      const from = Math.max(now, pet.fedUntil?.getTime() ?? 0)
      const until = from + pack.hours * 3_600_000
      if (until > now + CityConfig.maxFedDays * 86_400_000) throw AppError.conflict(`Больше чем на ${CityConfig.maxFedDays} дней вперёд не накормить`)
      if (pack.currency === 'USD') {
        await DollarsService.debit(tx, { characterId, amount: pack.price, reason: 'PURCHASE', refId: pet.id, note: pack.name })
      } else {
        await EconomyService.debit(tx, { characterId, amount: pack.price, reasonCode: 'SHOP_PURCHASE', refType: 'pet-food', refId: petId })
      }
      return { pet: await tx.characterPet.update({ where: { id: petId }, data: { fedUntil: new Date(until) } }) }
    } })
  },
  /** Замена кота и пса прошлого выката на собаку (решение заказчика):
      порода на выбор, бесплатно, один раз. Сытость и непотраченные порции
      корма переходят к собаке. Оба старых питомца дают одну собаку —
      правило «одна собака на персонажа». */
  async exchangeLegacyPet(characterId: string, code: string, key: string) {
    const entry = CityConfig.pets.find(p => p.code === code)
    if (!entry) throw AppError.validation('Неизвестная порода')
    return withIdempotency({ characterId, scope: 'city.pet.exchange', key, execute: async tx => {
      await tx.$executeRaw`SELECT id FROM characters WHERE id = ${characterId} FOR UPDATE`
      const legacy = await tx.characterPet.findMany({ where: { characterId, code: { in: [...CityConfig.legacyPetCodes] } } })
      if (legacy.length === 0) throw AppError.conflict('Менять нечего: старого питомца нет')
      if (await tx.characterPet.findFirst({ where: { characterId, code: { in: CityConfig.pets.map(p => p.code) } } })) throw AppError.conflict('Собака у вас уже есть')
      const fedUntil = legacy.reduce<Date | null>((max, p) => (p.fedUntil && (!max || p.fedUntil > max) ? p.fedUntil : max), null)
      const food = legacy.reduce((sum, p) => sum + p.food, 0)
      await tx.characterPet.deleteMany({ where: { id: { in: legacy.map(p => p.id) } } })
      return { pet: await tx.characterPet.create({ data: { characterId, code, name: entry.name, fedUntil, food } }) }
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
