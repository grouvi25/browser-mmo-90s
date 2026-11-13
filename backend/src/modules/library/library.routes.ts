// =============================================================
// Таблицы для Библиотеки (просьба заказчика 28.10: «таблицу опыта в
// Библиотеку добавить и инфу по прокачке профессий»).
//
// Числа берутся из тех же настроек и объектов, по которым считает сервер,
// а не переписываются в текст: правка баланса в админке сразу видна
// игрокам, а таблица не разъезжается с игрой.
// =============================================================
import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../shared/security/auth-middleware'
import { prisma } from '../../shared/db/prisma'
import { BalanceConfig } from '../../config/balance.config'
import { PROFESSION_CUMULATIVE_XP, PROFESSION_GROUPS, PROFESSION_NAMES, professionEfficiency, previousProfession, type ProfessionCode } from '../professions/professions'
import { soldGeneralTools, toolForTier } from '../work/tool-names'
import { awaitsOwner, realShiftMinutes } from '../work/work.formulas'
import { effectText, parseUseEffect } from '../items/item-effects'

const CHAIN_TITLES: Record<keyof typeof PROFESSION_GROUPS, string> = {
  metal: 'Металл', construction: 'Стройка', chemistry: 'Химия и еда', crafts: 'Ремёсла',
}

export async function libraryRoutes(fastify: FastifyInstance) {
  fastify.get('/tables', { preHandler: authenticate }, async (_req, reply) => {
    const B = BalanceConfig
    const battle = B.battleExp.levelThresholds.map((exp, i) => ({
      level: i + 1,
      exp,
      // Премия выдаётся при переходе на уровень; у 1-го — стартовые деньги.
      money: i === 0 ? B.character.startMoney : B.battleExp.levelMoneyBonus[i] ?? 0,
      statPoints: i === 0 ? null : B.battleExp.statPointsPerLevel,
    }))
    const economic = B.economicExp.levelThresholds.map((exp, level) => ({
      level,
      exp,
      money: level === 0 ? 0 : B.economicExp.levelMoney,
      str: level === 0 ? 0 : B.economicExp.strPerLevel,
    }))
    const objects = await prisma.productionObject.findMany({
      where: { isActive: true, ownerType: { not: 'CLAN' } },
      select: {
        code: true, name: true, requiredProfessionCode: true, requiredProfessionLevel: true, shiftDurationMinutes: true, baseSalary: true, baseProductionExp: true,
        ownerType: true, isForSale: true, producesResourceCode: true, activeRecipeId: true,
        equipment: { select: { isActive: true, requiredToolTier: true } },
      },
      orderBy: [{ requiredProfessionLevel: 'asc' }, { name: 'asc' }],
    })
    // Что объект даёт и чем на нём работают: из тех же объектов и рецептов, что
    // и экран работы, иначе Библиотека снова разъедется с игрой (5.11 она
    // описывала три направления при семнадцати профессиях).
    const [recipes, resources, templates, soldTools] = await Promise.all([
      prisma.productionRecipe.findMany({
        where: { isActive: true, productionObjectCode: { in: objects.map(o => o.code) } },
        select: { id: true, name: true, productionObjectCode: true, requiredToolCode: true, outputItemTemplateCode: true },
        orderBy: { name: 'asc' },
      }),
      prisma.resourceTemplate.findMany({ select: { code: true, name: true } }),
      prisma.itemTemplate.findMany({ select: { code: true, name: true } }),
      soldGeneralTools(prisma),
    ])
    const resourceName = new Map(resources.map(r => [r.code, r.name]))
    const itemName = new Map(templates.map(t => [t.code, t.name]))
    const toolOf = (o: typeof objects[number]) => {
      const named = recipes.find(r => r.id === o.activeRecipeId)?.requiredToolCode
      if (named) return itemName.get(named) ?? named
      return o.equipment?.isActive ? toolForTier(soldTools, o.equipment.requiredToolTier) : null
    }
    // Один объект может быть и государственным, и частным — показываем по разу.
    const seen = new Set<string>()
    const professions = Object.entries(PROFESSION_GROUPS).map(([chain, codes]) => ({
      chain: CHAIN_TITLES[chain as keyof typeof PROFESSION_GROUPS],
      steps: codes.map((code: ProfessionCode) => {
        const previous = previousProfession(code)
        return {
          code,
          name: PROFESSION_NAMES[code],
          after: previous ? PROFESSION_NAMES[previous] : null,
          objects: objects
            .filter(o => o.requiredProfessionCode === code && !seen.has(o.name) && seen.add(o.name))
            .map(o => ({
              name: o.name,
              minutes: realShiftMinutes(o.shiftDurationMinutes),
              salary: o.baseSalary,
              exp: o.baseProductionExp,
              admission: o.requiredProfessionLevel > 0 && previous ? { profession: PROFESSION_NAMES[previous], level: o.requiredProfessionLevel } : null,
              gives: o.producesResourceCode
                ? resourceName.get(o.producesResourceCode) ?? o.producesResourceCode
                : recipes.filter(r => r.productionObjectCode === o.code).map(r => r.name).join(', ') || null,
              tool: toolOf(o),
              forSaleUsd: awaitsOwner(o) ? B.economy.production.objectPriceUsd : null,
            })),
        }
      }),
    }))
    // Расходники, которые делают в цехах: что каждый делает и где его делают.
    const consumables = await prisma.itemTemplate.findMany({
      where: { type: 'CONSUMABLE', isActive: true, code: { in: recipes.map(r => r.outputItemTemplateCode).filter((c): c is string => !!c) } },
      select: { code: true, name: true, healPercent: true, soberAmount: true, useEffect: true },
      orderBy: { name: 'asc' },
    })
    const madeAt = (code: string) => {
      const recipe = recipes.find(r => r.outputItemTemplateCode === code)
      return objects.find(o => o.code === recipe?.productionObjectCode)?.name ?? null
    }
    const items = consumables.map(item => {
      const effect = parseUseEffect(item.useEffect)
      const does = [
        item.healPercent > 0 ? `лечит ${item.healPercent}% здоровья` : '',
        item.soberAmount > 0 ? (item.soberAmount >= 100 ? 'полностью снимает опьянение' : `снимает ${item.soberAmount} опьянения`) : '',
        effect ? effectText(effect) : '',
      ].filter(Boolean).join(', ')
      const where = effect ? (effect.minutes ? 'где угодно' : 'в бою, из кармана') : item.healPercent > 0 ? 'в бою и вне боя' : 'вне боя'
      return { name: item.name, does: does || 'пока ничего', where, madeAt: madeAt(item.code) }
    })
    const professionLevels = PROFESSION_CUMULATIVE_XP.map((exp, level) => ({ level, exp, efficiencyPct: Math.round((professionEfficiency(level) - 1) * 100) }))
    return reply.send({ battle, economic, professions, professionLevels, statPointsPerLevel: B.battleExp.statPointsPerLevel, botExpPenalty: B.battleExp.pveDailyPenaltyPerKill, botExpMin: B.battleExp.pveDailyMin, consumables: items, objectPriceUsd: B.economy.production.objectPriceUsd })
  })
}
