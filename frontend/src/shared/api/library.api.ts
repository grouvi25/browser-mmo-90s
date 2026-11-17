// Таблицы Библиотеки: уровни, премии и профессии — из настроек сервера.
import { api } from './client'

export interface LibraryTables {
  battle: Array<{ level: number; exp: number; money: number; statPoints: number | null }>
  economic: Array<{ level: number; exp: number; money: number; str: number }>
  production?: Array<{ level: number; exp: number; money: number; end: number; shifts: number }>
  /** Числа для разделов «Бой» и «Заработок». */
  rules?: {
    statGap: number; charmGapPct: number; critMult: number; dodgeCritPct?: number; dodgeLuckPct?: number; endArmor: number; armorPerPoint: number; damageScale: number
    defenseFullPct: number; strengthFullPct: number; strengthFloor: [number, number]; antiFartPct: number; antiFartCapPct: number
    saleTaxPct: number; listingFree: boolean; craftMinPct: number; craftMaxPct: number
  }
  professions: Array<{
    chain: string
    steps: Array<{
      code: string; name: string; after: string | null
      objects: Array<{
        name: string; minutes: number; salary: number; exp: number; admission: { profession: string; level: number } | null
        /** Сырьё, которое добывают, или что выпускает цех. */
        gives?: string | null
        tool?: string | null
        /** Цех ещё у государства: работает после покупки. */
        forSaleUsd?: number | null
      }>
    }>
  }>
  professionLevels: Array<{ level: number; exp: number; efficiencyPct: number }>
  statPointsPerLevel: number
  /** Опыт за повтор одного бота за сутки (Дима 13.11: «эту инфу в библиотеку»). */
  botExpPenalty?: number
  botExpMin?: number
  consumables?: Array<{ name: string; does: string; where: string; madeAt: string | null }>
  objectPriceUsd?: number
}

export const libraryApi = {
  tables: () => api.get<LibraryTables>('/api/library/tables'),
}
