// =============================================================
// Собаки: уровни, свои характеристики, снаряжение (правка заказчика 21.10).
//
// «У собак так же уровни (количество опыта другое будет, не как у
// игроков), характеристики, и можно шмот на них покупать (намордник,
// защита, ошейник, обувь). На трёх базовых статы стандартные; одна
// собака за донат, где очков статов на 50% больше и полностью
// распределяются игроком».
//
// Все числа — стартовые, их пересчитает математик: они собраны здесь.
// =============================================================

export type DogStat = 'str' | 'agi' | 'rea' | 'acc' | 'end' | 'luck'
export const DOG_STATS: readonly DogStat[] = ['str', 'agi', 'rea', 'acc', 'end', 'luck']
export type PetStatBonus = Partial<Record<DogStat, number>>

export interface DogBreed {
  code: string
  name: string
  role: string
  /** Рубли; у донатной собаки — 0, цена в долларах. */
  price: number
  priceDollars?: number
  /** Стандартная собака: на что идут её очки. */
  mainStat?: DogStat
  /** Донатная: очки распределяет игрок. */
  freeAllocation?: boolean
}

export const DOG_BREEDS: readonly DogBreed[] = [
  { code: 'mastiff', name: 'Мастифф', role: 'Танк, защитник', price: 3000, mainStat: 'end' },
  { code: 'malinois', name: 'Малинуа', role: 'Ловкость', price: 3000, mainStat: 'agi' },
  { code: 'doberman', name: 'Доберман', role: 'Удача', price: 3000, mainStat: 'luck' },
  { code: 'pitbull', name: 'Питбуль', role: 'Свои очки: +50%, распределяете сами', price: 0, priceDollars: 25, freeAllocation: true },
]

export const DOG_BASE_POINTS = 2
/** Доля боевого опыта хозяина, которую получает сытая собака. */
export const DOG_EXP_SHARE = 0.5
export const DOG_MAX_LEVEL = 20

/** Опыт до следующего уровня: своя шкала, не как у игроков. */
export function dogExpToNext(level: number): number {
  return 60 * level * level
}

export function dogLevelFromExp(exp: number): number {
  let level = 1
  let need = 0
  while (level < DOG_MAX_LEVEL) {
    need += dogExpToNext(level)
    if (exp < need) break
    level += 1
  }
  return level
}

/** Сколько опыта всего нужно, чтобы дойти до уровня. */
export function dogExpForLevel(level: number): number {
  let sum = 0
  for (let l = 1; l < level; l++) sum += dogExpToNext(l)
  return sum
}

/** Очки собаки: база и +1 каждые два уровня; донатной — в полтора раза больше. */
export function dogPoints(level: number, freeAllocation: boolean): number {
  const standard = DOG_BASE_POINTS + Math.floor((level - 1) / 2)
  return freeAllocation ? Math.ceil(standard * 1.5) : standard
}

export type DogGearSlot = 'MUZZLE' | 'ARMOR' | 'COLLAR' | 'BOOTS'
export interface DogGear { code: string; slot: DogGearSlot; name: string; price: number; bonus: PetStatBonus }

export const DOG_GEAR_SLOTS: Record<DogGearSlot, string> = {
  MUZZLE: 'Намордник', ARMOR: 'Защита', COLLAR: 'Ошейник', BOOTS: 'Обувь',
}

export const DOG_GEAR: readonly DogGear[] = [
  { code: 'dog_muzzle_leather', slot: 'MUZZLE', name: 'Кожаный намордник', price: 1500, bonus: { rea: 1 } },
  { code: 'dog_armor_vest', slot: 'ARMOR', name: 'Защитный жилет', price: 2500, bonus: { end: 1 } },
  { code: 'dog_collar_spiked', slot: 'COLLAR', name: 'Ошейник с шипами', price: 1000, bonus: { luck: 1 } },
  { code: 'dog_boots', slot: 'BOOTS', name: 'Собачьи ботинки', price: 1200, bonus: { agi: 1 } },
]

export interface DogRow {
  id: string
  code: string
  fedUntil: Date | null
  level?: number
  exp?: number
  allocation?: unknown
  gear?: unknown
}

export const breedOf = (code: string) => DOG_BREEDS.find(b => b.code === code)

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function dogAllocation(row: DogRow): PetStatBonus {
  const raw = asRecord(row.allocation)
  const out: PetStatBonus = {}
  for (const stat of DOG_STATS) {
    const n = Number(raw[stat] ?? 0)
    if (Number.isInteger(n) && n > 0) out[stat] = n
  }
  return out
}

export function dogGear(row: DogRow): Partial<Record<DogGearSlot, DogGear>> {
  const raw = asRecord(row.gear)
  const out: Partial<Record<DogGearSlot, DogGear>> = {}
  for (const slot of Object.keys(DOG_GEAR_SLOTS) as DogGearSlot[]) {
    const item = DOG_GEAR.find(g => g.code === raw[slot] && g.slot === slot)
    if (item) out[slot] = item
  }
  return out
}

function add(into: PetStatBonus, from: PetStatBonus) {
  for (const [stat, n] of Object.entries(from) as Array<[DogStat, number]>) into[stat] = (into[stat] ?? 0) + n
}

/** Полный бонус собаки (без учёта сытости): очки уровня и снаряжение. */
export function dogBonus(row: DogRow): PetStatBonus {
  const breed = breedOf(row.code)
  if (!breed) return {}
  const level = row.level ?? 1
  const total: PetStatBonus = {}
  if (breed.freeAllocation) add(total, dogAllocation(row))
  else if (breed.mainStat) total[breed.mainStat] = dogPoints(level, false)
  for (const item of Object.values(dogGear(row))) if (item) add(total, item.bonus)
  return total
}

export function freeDogPoints(row: DogRow): number {
  const breed = breedOf(row.code)
  if (!breed?.freeAllocation) return 0
  const used = Object.values(dogAllocation(row)).reduce((s, n) => s + (n ?? 0), 0)
  return Math.max(0, dogPoints(row.level ?? 1, true) - used)
}
