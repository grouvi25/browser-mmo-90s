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
import { PROFESSION_CHAINS, PROFESSION_CUMULATIVE_XP, PROFESSION_NAMES, professionEfficiency, previousProfession, type ProfessionCode } from '../professions/professions'

const CHAIN_TITLES: Record<keyof typeof PROFESSION_CHAINS, string> = {
  metal: 'Металл', construction: 'Стройка', chemistry: 'Химия и еда',
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
      select: { code: true, name: true, requiredProfessionCode: true, requiredProfessionLevel: true, shiftDurationMinutes: true, baseSalary: true, baseProductionExp: true },
      orderBy: [{ requiredProfessionLevel: 'asc' }, { name: 'asc' }],
    })
    // Один объект может быть и государственным, и частным — показываем по разу.
    const seen = new Set<string>()
    const professions = Object.entries(PROFESSION_CHAINS).map(([chain, codes]) => ({
      chain: CHAIN_TITLES[chain as keyof typeof PROFESSION_CHAINS],
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
              minutes: o.shiftDurationMinutes,
              salary: o.baseSalary,
              exp: o.baseProductionExp,
              admission: o.requiredProfessionLevel > 0 && previous ? { profession: PROFESSION_NAMES[previous], level: o.requiredProfessionLevel } : null,
            })),
        }
      }),
    }))
    const professionLevels = PROFESSION_CUMULATIVE_XP.map((exp, level) => ({ level, exp, efficiencyPct: Math.round((professionEfficiency(level) - 1) * 100) }))
    return reply.send({ battle, economic, professions, professionLevels, statPointsPerLevel: B.battleExp.statPointsPerLevel })
  })
}
