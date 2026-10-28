// Таблицы Библиотеки: уровни, премии и профессии — из настроек сервера.
import { api } from './client'

export interface LibraryTables {
  battle: Array<{ level: number; exp: number; money: number; statPoints: number | null }>
  economic: Array<{ level: number; exp: number; money: number; str: number }>
  professions: Array<{
    chain: string
    steps: Array<{
      code: string; name: string; after: string | null
      objects: Array<{ name: string; minutes: number; salary: number; exp: number; admission: { profession: string; level: number } | null }>
    }>
  }>
  professionLevels: Array<{ level: number; exp: number; efficiencyPct: number }>
  statPointsPerLevel: number
}

export const libraryApi = {
  tables: () => api.get<LibraryTables>('/api/library/tables'),
}
