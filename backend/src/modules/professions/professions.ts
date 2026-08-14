export const PROFESSION_CODES = [
  'scrap_collector', 'foundry_worker', 'gunsmith',
  'supplier', 'carpenter', 'cooperative_builder',
  'procurer', 'pharmacist', 'chemist',
] as const
export type ProfessionCode = typeof PROFESSION_CODES[number]

export const PROFESSION_NAMES: Record<ProfessionCode, string> = {
  scrap_collector: 'Сборщик металлолома',
  foundry_worker: 'Литейщик',
  gunsmith: 'Оружейник',
  supplier: 'Снабженец',
  carpenter: 'Столяр',
  cooperative_builder: 'Строитель кооператива',
  procurer: 'Заготовитель',
  pharmacist: 'Фармацевт',
  chemist: 'Химик',
}

/**
 * Три направления по три передела — модель ТЗ 2.2 и симулятора прогрессии.
 * Порядок внутри направления и есть лестница: второй передел открывается
 * уровнем первого, третий — уровнем второго.
 */
export const PROFESSION_CHAINS: Readonly<Record<'metal' | 'construction' | 'chemistry', readonly ProfessionCode[]>> = {
  metal: ['scrap_collector', 'foundry_worker', 'gunsmith'],
  construction: ['supplier', 'carpenter', 'cooperative_builder'],
  chemistry: ['procurer', 'pharmacist', 'chemist'],
}

/**
 * Профессия предыдущего передела в том же направлении.
 *
 * Допуск на объект проверяется именно по ней. Требовать уровень той же
 * профессии, которую объект и качает, нельзя: опыт профессии начисляется
 * только за смены на её объектах, и объект второго передела оказывался
 * заперт собственным требованием — открыть его было нечем.
 */
export function previousProfession(code: ProfessionCode): ProfessionCode | null {
  for (const chain of Object.values(PROFESSION_CHAINS)) {
    const index = chain.indexOf(code)
    if (index > 0) return chain[index - 1]
    if (index === 0) return null
  }
  return null
}

export const PROFESSION_CUMULATIVE_XP = [0, 500, 1_500, 3_500, 8_000, 16_000, 30_000] as const

export function professionLevelFromExp(exp: number): number {
  let level = 0
  for (let i = 0; i < PROFESSION_CUMULATIVE_XP.length; i++) {
    if (exp >= PROFESSION_CUMULATIVE_XP[i]) level = i
  }
  return Math.min(6, level)
}

export function professionEfficiency(level: number): number {
  return 1 + Math.max(0, Math.min(6, level)) * 0.03
}

export function craftProfessionForItem(itemType: string): ProfessionCode {
  if (itemType === 'WEAPON') return 'gunsmith'
  if (itemType === 'CONSUMABLE') return 'pharmacist'
  return 'cooperative_builder'
}

export function isProfessionCode(value: string): value is ProfessionCode {
  return (PROFESSION_CODES as readonly string[]).includes(value)
}
