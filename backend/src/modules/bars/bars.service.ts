import { prisma } from '../../shared/db/prisma'
import { withIdempotency } from '../../shared/db/idempotency'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { EconomyService } from '../economy/economy.service'
import { ObjectInventoryService } from '../production/inventory.service'
import { barPriceRange, barSaleSplit, canTakeBuff, decayedAlcohol, intoxicationModifiers } from './bars.formulas'

export const BarsService = {
  async list() {
    const items = await prisma.productionObject.findMany({
      where: { type: 'BAR', isActive: true },
      include: { barOffers: { where: { isActive: true }, orderBy: { price: 'asc' } } },
      orderBy: { name: 'asc' },
    })
    return { items }
  },

  async status(characterId: string) {
    const character = await prisma.character.findUniqueOrThrow({ where: { id: characterId } })
    const now = new Date()
    const level = decayedAlcohol(character.alcoholLevel, character.alcoholUpdatedAt, now)
    const modifiers = intoxicationModifiers(level)
    return {
      level,
      ...modifiers,
      soberAt: level > 0 ? new Date(now.getTime() + level / 100 * 3 * 3_600_000) : null,
      hangoverUntil: character.hangoverUntil && character.hangoverUntil > now ? character.hangoverUntil : null,
      buff: character.barBuffExpiresAt && character.barBuffExpiresAt > now
        ? { accuracy: character.barBuffAccuracy, damage: character.barBuffDamage, expiresAt: character.barBuffExpiresAt }
        : null,
    }
  },

  async setPrice(characterId: string, offerId: string, price: number) {
    const offer = await prisma.barOffer.findUnique({ where: { id: offerId }, include: { productionObject: true } })
    if (!offer || offer.productionObject.ownerCharacterId !== characterId) throw new AppError(ErrorCode.PROD_NOT_OWNER, 'Bar is not owned by character', 403)
    const range = barPriceRange(offer.baseCost)
    if (!Number.isInteger(price) || price < range.min || price > range.max) throw new AppError(ErrorCode.BAR_PRICE_INVALID, 'Price is outside allowed range', 422, range)
    return prisma.barOffer.update({ where: { id: offerId }, data: { price } })
  },

  async buy(characterId: string, offerId: string, key: string) {
    return withIdempotency({ characterId, scope: 'bars.buy', key, execute: async tx => {
      const offer = await tx.barOffer.findUnique({ where: { id: offerId }, include: { productionObject: true } })
      if (!offer?.isActive || offer.productionObject.type !== 'BAR') throw new AppError(ErrorCode.BAR_OFFER_NOT_FOUND, 'Bar offer not found', 404)
      const character = await tx.character.findUniqueOrThrow({ where: { id: characterId } })
      const now = new Date()
      const currentAlcohol = decayedAlcohol(character.alcoholLevel, character.alcoholUpdatedAt, now)
      const crossedFromWasted = character.alcoholLevel >= 70 && currentAlcohol < 70
      const hangoverUntil = crossedFromWasted ? new Date(now.getTime() + 60 * 60_000) : character.hangoverUntil
      if (offer.alcoholDegrees > 0 && hangoverUntil && hangoverUntil > now) throw new AppError(ErrorCode.BAR_HANGOVER, 'Cannot drink during hangover', 409, { hangoverUntil })
      const hasBuff = offer.accuracyBuff !== 0 || offer.damageBuff !== 0
      if (hasBuff && !canTakeBuff(character.lastBarBuffAt, now)) throw new AppError(ErrorCode.BAR_BUFF_COOLDOWN, 'Bar buff is on cooldown', 409)

      const reserved = await ObjectInventoryService.reserve(tx, {
        objectId: offer.productionObjectId, resourceCode: offer.resourceCode, minQuality: 'POOR', amount: 1,
      }).catch(() => { throw new AppError(ErrorCode.BAR_OUT_OF_STOCK, 'Offer is out of stock', 409) })
      for (const row of reserved) await ObjectInventoryService.consumeReserved(tx, row.inventoryId, row.amount)
      const newBalance = await EconomyService.debit(tx, { characterId, amount: offer.price, reasonCode: 'BAR_PURCHASE', refType: 'bar_offer', refId: offer.id })
      const split = barSaleSplit(offer.price)
      await tx.productionObject.update({ where: { id: offer.productionObjectId }, data: { balance: { increment: split.ownerIncome } } })

      const alcoholLevel = character.status === 'IN_BATTLE' ? currentAlcohol : Math.min(100, currentAlcohol + offer.alcoholDegrees)
      const hpCurrent = Math.min(character.hpMax, character.hpCurrent + offer.hpRestore)
      const buffExpiresAt = hasBuff ? new Date(now.getTime() + offer.buffMinutes * 60_000) : character.barBuffExpiresAt
      await tx.character.update({ where: { id: characterId }, data: {
        hpCurrent,
        alcoholLevel: Math.round(alcoholLevel),
        alcoholUpdatedAt: now,
        hangoverUntil,
        ...(hasBuff ? { barBuffAccuracy: offer.accuracyBuff, barBuffDamage: offer.damageBuff, barBuffExpiresAt: buffExpiresAt, lastBarBuffAt: now } : {}),
      } })
      return { offerId, price: offer.price, tax: split.tax, ownerIncome: split.ownerIncome, hpCurrent, alcoholLevel, newBalance, buffExpiresAt }
    } })
  },
}
