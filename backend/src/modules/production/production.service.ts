import { ProductionRepository } from './production.repository'
import { ProductionErrors } from './production.errors'
import { prisma } from '../../shared/db/prisma'
import { RecipeService } from './recipe.service'
import { CycleService } from './cycle.service'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { BalanceConfig } from '../../config/balance.config'
export const ProductionService = {
  list: async () => ({ items: await ProductionRepository.listActive() }),
  get: async (id: string) => { const item = await ProductionRepository.findActiveById(id); if (!item) throw ProductionErrors.notFound(); return item },
  /** Объекты государства. Цена у всех одна и в долларах (заказчик 28.10). */
  market: async () => {
    const objects = await prisma.productionObject.findMany({
      where: { ownerType: 'SYSTEM', isForSale: true, isActive: true },
      include: { equipment: true },
      orderBy: { name: 'asc' },
    })
    return objects.map(object => ({ ...object, priceUsd: BalanceConfig.economy.production.objectPriceUsd }))
  },
  /** Свои объекты: склад с названиями ресурсов, кто сейчас на смене и
   *  сколько выплачено за сутки — владелец видит, что завод работает. */
  mine: async (characterId: string) => {
    const objects = await prisma.productionObject.findMany({
      where: { ownerType: 'PRIVATE', ownerCharacterId: characterId },
      include: { equipment: true, inventory: true, cycles: { where: { status: { in: ['PENDING', 'RUNNING'] } }, include: { recipe: true } } },
      orderBy: { name: 'asc' },
    })
    if (objects.length === 0) return []
    const ids = objects.map(object => object.id)
    const since = new Date(Date.now() - 24 * 3600_000)
    const [templates, active, paid] = await Promise.all([
      prisma.resourceTemplate.findMany({ select: { code: true, name: true } }),
      prisma.workShift.findMany({
        where: { productionObjectId: { in: ids }, helperId: null, status: { in: ['ACTIVE', 'READY_TO_CLAIM'] } },
        select: { productionObjectId: true, endsAt: true, character: { select: { nickname: true } } },
        orderBy: { endsAt: 'asc' },
      }),
      prisma.workShift.groupBy({
        by: ['productionObjectId'],
        where: { productionObjectId: { in: ids }, status: 'CLAIMED', claimedAt: { gte: since } },
        _sum: { finalSalary: true }, _count: { _all: true },
      }),
    ])
    const names = new Map(templates.map(item => [item.code, item.name]))
    return objects.map(object => {
      const day = paid.find(row => row.productionObjectId === object.id)
      return {
        ...object,
        inventory: object.inventory.map(row => ({ ...row, resourceName: names.get(row.resourceCode) ?? row.resourceCode })),
        producesResourceName: object.producesResourceCode ? names.get(object.producesResourceCode) ?? object.producesResourceCode : null,
        workers: active.filter(shift => shift.productionObjectId === object.id).map(shift => ({ nickname: shift.character.nickname, endsAt: shift.endsAt })),
        day: { shifts: day?._count._all ?? 0, salaryPaid: day?._sum.finalSalary ?? 0 },
      }
    })
  },
  recipes: (objectCode: string, characterId: string) => RecipeService.listForObject(objectCode, characterId),
  /** Запустить цикл может только хозяин: владелец частного объекта или
   *  член бригады-владельца. Раньше ручка запускала цикл на любом объекте
   *  любому вошедшему — и тратила чужое сырьё со склада (28.10). Объекты
   *  государства запускает сам сервер (production-cycle.worker). */
  startCycle: async (objectId: string, characterId: string) => {
    const object = await prisma.productionObject.findUnique({ where: { id: objectId }, select: { ownerType: true, ownerCharacterId: true, ownerClanId: true } })
    if (!object) throw ProductionErrors.notFound()
    const allowed = object.ownerType === 'PRIVATE' ? object.ownerCharacterId === characterId
      : object.ownerType === 'CLAN' ? !!(await prisma.clanMember.findFirst({ where: { characterId, clanId: object.ownerClanId ?? '', status: 'ACTIVE' }, select: { id: true } }))
        : false
    if (!allowed) throw new AppError(ErrorCode.PROD_NOT_OWNER, 'Запускать цикл может только хозяин объекта', 403)
    return CycleService.tryStart(objectId)
  },
  cycles: (objectId: string, limit = 20) => prisma.productionCycle.findMany({
    where: { productionObjectId: objectId },
    include: { recipe: true, contributions: true, inputReservations: true },
    orderBy: { createdAt: 'desc' },
    take: Math.min(100, Math.max(1, limit)),
  }),
}
