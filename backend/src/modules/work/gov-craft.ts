/**
 * Госкрафт (обещание игрокам 04.11: «будет гос крафт + можно купить себе завод»).
 *
 * Цех, который ещё никто не купил, раньше стоял закрытым с табличкой «продаётся»,
 * и сырьё с госточек некуда было нести. Теперь в таком цехе работают на себя:
 * игрок приносит своё сырьё по рецепту, отрабатывает смену и забирает изделие.
 * Сырьё резервируется на старте, списывается при получении, при отмене
 * возвращается. Зарплаты нет, платит само изделие; опыт профессии как за смену.
 *
 * Купленный цех работает по старым правилам: склад цеха, циклы, владелец.
 */
import type { Prisma } from '@prisma/client'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { ResourcesService } from '../resources/resources.service'
import { outputQuality, resourceToItemQuality } from '../production/cycle.formulas'
import { realShiftMinutes } from './work.formulas'

type Tx = Prisma.TransactionClient

/**
 * Сколько штук можно заказать за одну смену (Дима 10.11: «крафтить не по 1 ед,
 * а сразу выбирать 1-3-5-10 шт… ресурсы, износ. А время оставляем одинаковое»).
 * Экран берёт варианты отсюда, отдельно их нигде не прописываем.
 */
export const CRAFT_QUANTITIES = [1, 3, 5, 10] as const
export type CraftQuantity = typeof CRAFT_QUANTITIES[number]

export type GovCraftRecipe = Prisma.ProductionRecipeGetPayload<{ include: { inputs: true } }>

/** Рецепты госцеха с тем, что у игрока есть, и причиной, если сделать нельзя. */
export async function govCraftView(db: Tx, params: {
  characterId: string
  objectCode: string
  professionLevel: number
  /** Инструменты игрока: код → больше всего применений у одного экземпляра. */
  toolUses: Record<string, number>
  /** Сколько рабочих минут осталось сегодня. */
  minutesLeft: number
}) {
  const recipes = await db.productionRecipe.findMany({
    where: { productionObjectCode: params.objectCode, isActive: true },
    include: { inputs: true }, orderBy: { name: 'asc' },
  })
  const codes = [...new Set(recipes.flatMap(recipe => [
    ...recipe.inputs.map(input => input.resourceCode),
    ...(recipe.outputResourceCode ? [recipe.outputResourceCode] : []),
  ]))]
  const [resources, stacks, items, tools] = await Promise.all([
    db.resourceTemplate.findMany({ where: { code: { in: codes } }, select: { id: true, code: true, name: true } }),
    db.resourceStack.findMany({ where: { characterId: params.characterId, template: { code: { in: codes } } }, include: { template: { select: { code: true } } } }),
    db.itemTemplate.findMany({ where: { code: { in: recipes.map(recipe => recipe.outputItemTemplateCode).filter((code): code is string => !!code) } }, select: { code: true, name: true } }),
    db.itemTemplate.findMany({ where: { code: { in: recipes.map(recipe => recipe.requiredToolCode).filter((code): code is string => !!code) } }, select: { code: true, name: true } }),
  ])
  const nameOf = new Map(resources.map(row => [row.code, row.name]))
  const haveOf = new Map(stacks.map(stack => [stack.template.code, stack.amount - stack.reservedAmount]))
  const itemName = new Map(items.map(row => [row.code, row.name]))
  const toolName = new Map(tools.map(row => [row.code, row.name]))
  return recipes.map(recipe => {
    const inputs = recipe.inputs.map(input => ({
      code: input.resourceCode, name: nameOf.get(input.resourceCode) ?? input.resourceCode,
      need: input.amount, have: Math.max(0, haveOf.get(input.resourceCode) ?? 0),
    }))
    const tool = recipe.requiredToolCode ? { code: recipe.requiredToolCode, name: toolName.get(recipe.requiredToolCode) ?? recipe.requiredToolCode } : null
    const missing = inputs.filter(input => input.have < input.need)
    const reason = recipe.requiredProfessionLevel > params.professionLevel ? `Нужен ${recipe.requiredProfessionLevel} уровень профессии`
      : tool && !params.toolUses[tool.code] ? `Нужен инструмент: ${tool.name}`
      : missing.length ? `Не хватает: ${missing.map(input => `${input.name} ${input.have}/${input.need}`).join(', ')}`
      : realShiftMinutes(recipe.cycleMinutes) > params.minutesLeft ? `Не хватит времени сегодня: осталось ${Math.max(0, params.minutesLeft)} мин, нужно ${realShiftMinutes(recipe.cycleMinutes)}`
      : null
    const minutes = realShiftMinutes(recipe.cycleMinutes)
    // Партия упирается в сырьё и в применения одного инструмента: смена держит один экземпляр.
    const limits = [...inputs.map(input => Math.floor(input.have / Math.max(1, input.need))), ...(tool ? [params.toolUses[tool.code] ?? 0] : [])]
    const maxQuantity = reason ? 0 : Math.min(CRAFT_QUANTITIES[CRAFT_QUANTITIES.length - 1], ...limits)
    return {
      id: recipe.id, name: recipe.name, minutes,
      output: {
        name: recipe.outputResourceCode ? nameOf.get(recipe.outputResourceCode) ?? recipe.outputResourceCode
          : recipe.outputItemTemplateCode ? itemName.get(recipe.outputItemTemplateCode) ?? recipe.outputItemTemplateCode : '',
        amount: recipe.outputAmount,
      },
      inputs, tool, requiredLevel: recipe.requiredProfessionLevel, reason,
      quantities: [...CRAFT_QUANTITIES], maxQuantity,
    }
  })
}

/** Рецепт для смены в госцехе: свой, включён, по уровню профессии. */
export async function govCraftRecipe(db: Tx, objectCode: string, recipeId: string | undefined, professionLevel: number): Promise<GovCraftRecipe> {
  if (!recipeId) throw new AppError(ErrorCode.WORK_OBJECT_UNAVAILABLE, 'Выберите, что сделать в этом цехе', 409)
  const recipe = await db.productionRecipe.findUnique({ where: { id: recipeId }, include: { inputs: true } })
  if (!recipe || recipe.productionObjectCode !== objectCode || !recipe.isActive) {
    throw new AppError(ErrorCode.PROD_RECIPE_INVALID, 'Этот рецепт не для этого цеха', 422)
  }
  if (recipe.requiredProfessionLevel > professionLevel) {
    throw new AppError(ErrorCode.WORK_LEVEL_REQUIRED, `Для «${recipe.name}» нужен ${recipe.requiredProfessionLevel} уровень профессии`, 400)
  }
  return recipe
}

/** Резерв сырья игрока на старте смены. Не хватает чего-то — смена не начнётся. */
export async function reserveGovCraftInputs(db: Tx, characterId: string, recipe: GovCraftRecipe, quantity = 1) {
  for (const input of recipe.inputs) {
    const amount = input.amount * quantity
    const template = await db.resourceTemplate.findUnique({ where: { code: input.resourceCode }, select: { id: true, name: true } })
    if (!template) throw new AppError(ErrorCode.PROD_RECIPE_INVALID, `Нет такого ресурса: ${input.resourceCode}`, 422)
    try {
      await ResourcesService.reserve(db, characterId, template.id, amount)
    } catch (error) {
      if (error instanceof AppError) throw new AppError(ErrorCode.RES_INSUFFICIENT, `Не хватает сырья: ${template.name}, нужно ${amount}`, 409)
      throw error
    }
  }
}

/** Отмена смены: зарезервированное сырьё возвращается. */
export async function releaseGovCraftInputs(db: Tx, characterId: string, recipeId: string, quantity = 1) {
  const recipe = await db.productionRecipe.findUnique({ where: { id: recipeId }, include: { inputs: true } })
  if (!recipe) return
  for (const input of recipe.inputs) {
    const template = await db.resourceTemplate.findUnique({ where: { code: input.resourceCode }, select: { id: true } })
    if (template) await ResourcesService.release(db, characterId, template.id, input.amount * quantity)
  }
}

/** Конец смены: сырьё списывается, изделие уходит игроку. */
export async function finishGovCraft(db: Tx, params: {
  characterId: string; shiftId: string; recipeId: string; professionLevel: number; toolTier: number; quantity?: number
}) {
  const quantity = params.quantity ?? 1
  const recipe = await db.productionRecipe.findUniqueOrThrow({ where: { id: params.recipeId }, include: { inputs: true } })
  for (const input of recipe.inputs) {
    const template = await db.resourceTemplate.findUniqueOrThrow({ where: { code: input.resourceCode }, select: { id: true } })
    await ResourcesService.release(db, params.characterId, template.id, input.amount * quantity)
    await ResourcesService.consume(db, { characterId: params.characterId, resourceTemplateId: template.id, amount: input.amount * quantity, reasonCode: 'CYCLE_INPUT', refType: 'work_shift', refId: params.shiftId })
  }
  const quality = outputQuality({ professionLevel: params.professionLevel, toolTier: params.toolTier, requiredToolTier: recipe.requiredToolTier, minInputQuality: null })
  if (recipe.outputResourceCode) {
    const template = await db.resourceTemplate.findUniqueOrThrow({ where: { code: recipe.outputResourceCode }, select: { id: true, name: true } })
    await ResourcesService.add(db, { characterId: params.characterId, resourceTemplateId: template.id, amount: recipe.outputAmount * quantity, reasonCode: 'CYCLE_OUTPUT', refType: 'work_shift', refId: params.shiftId })
    return { kind: 'resource' as const, code: recipe.outputResourceCode, name: template.name, amount: recipe.outputAmount * quantity }
  }
  if (!recipe.outputItemTemplateCode) return null
  const template = await db.itemTemplate.findUniqueOrThrow({ where: { code: recipe.outputItemTemplateCode } })
  for (let index = 0; index < recipe.outputAmount * quantity; index += 1) {
    const item = await db.itemInstance.create({ data: {
      templateId: template.id, ownerId: params.characterId, sourceType: 'CRAFTED', quality: resourceToItemQuality(quality),
      durabilityCurrent: template.durabilityMax, durabilityMax: template.durabilityMax, weight: template.weight,
      freePoints: template.allocationMode === 'PLAYER' ? template.statBudget : 0,
      usesLeft: template.type === 'TOOL' ? template.usesMax : null,
    } })
    await db.itemLog.create({ data: { itemId: item.id, characterId: params.characterId, actionCode: 'CREATED_BY_CRAFT', details: { govCraft: true, shiftId: params.shiftId, recipe: recipe.code } } })
  }
  return { kind: 'item' as const, code: template.code, name: template.name, amount: recipe.outputAmount * quantity }
}
