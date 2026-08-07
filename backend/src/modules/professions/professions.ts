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
