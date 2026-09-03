// =============================================================
// Камни и огранки — «Государственная вставка камней» из макета
// «Фон основного мнею Улучшения.psd».
//
// Панель макета складывает вставку из трёх частей: вещь, камень и
// огранка. Отсюда и разделение обязанностей:
//   камень  — сколько очков даёт вставка (сорт);
//   огранка — куда эти очки лягут (какая характеристика).
// Так три слота макета получают каждый свой смысл, а очки попадают в
// ту же единицу, которой уже считаются улучшения: mergeAllocations
// складывает их вместе с распределением очков и уровнями.
//
// ЧИСЛА ЗДЕСЬ — ДОПУЩЕНИЕ. Со столбца макета взяты только цены:
// 5, 10, 15 и 20 рублей. Что означают его «+23/+115%/-110%», Дмитрий
// не объяснял, поэтому сила камня выражена в очках нашей игры — по
// одному на сорт. Всё, что нужно поменять, когда числа придут, лежит
// в этом файле.
//
// Цена — это плата казённой мастерской за работу, а не стоимость
// камня: камень и огранка уже лежат у игрока в сумке и тратятся при
// вставке. Отсюда и название панели.
// =============================================================
import type { UpgradeKind } from './upgrades.formulas'

/** Гнёзд у вещи два — столько их нарисовано под каждой ячейкой
 *  снаряжения в макете инвентаря. */
export const SOCKETS_PER_ITEM = 2

export interface StoneGrade { code: string; name: string; points: number; fee: number }
export interface StoneCut { kind: UpgradeKind; name: string }

export const STONE_GRADES: readonly StoneGrade[] = [
  { code: 'stone_grade_1', name: 'Камень мутный', points: 1, fee: 5 },
  { code: 'stone_grade_2', name: 'Камень чистый', points: 2, fee: 10 },
  { code: 'stone_grade_3', name: 'Камень отборный', points: 3, fee: 15 },
  { code: 'stone_grade_4', name: 'Камень царский', points: 4, fee: 20 },
]

/** Огранка опознаётся видом характеристики: отдельного кода ей не
 *  нужно, соответствие один к одному. */
export const STONE_CUTS: readonly StoneCut[] = [
  { kind: 'DAMAGE', name: 'Огранка на урон' },
  { kind: 'ACCURACY', name: 'Огранка на точность' },
  { kind: 'CRIT', name: 'Огранка на крит' },
  { kind: 'ARMOR', name: 'Огранка на броню' },
  { kind: 'DURABILITY', name: 'Огранка на прочность' },
  { kind: 'ANTI_CRIT', name: 'Огранка от крита' },
]

export const stoneByCode = (code: string) => STONE_GRADES.find(x => x.code === code)
export const cutByKind = (kind: string) => STONE_CUTS.find(x => x.kind === kind)

/** Одно занятое гнездо. */
/** Занятое гнездо: сорт камня и вид характеристики от огранки. */
export interface Socket { stone: string; cut: UpgradeKind }

/** Читает столбец `sockets_json`, отбрасывая всё, чего не знает:
 *  сорт или огранку могли переименовать, и старая запись не должна
 *  ронять расчёт боя. */
export function readSockets(value: unknown): Socket[] {
  if (!Array.isArray(value)) return []
  const out: Socket[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const { stone, cut } = entry as Record<string, unknown>
    if (typeof stone !== 'string' || typeof cut !== 'string') continue
    const shape = cutByKind(cut)
    if (!stoneByCode(stone) || !shape) continue
    out.push({ stone, cut: shape.kind })
    if (out.length >= SOCKETS_PER_ITEM) break
  }
  return out
}

/** Очки, которые дают вставленные камни, в той же форме, что и
 *  распределение очков вещи, — чтобы просто сложить их вместе. */
export function socketAllocation(value: unknown): Partial<Record<UpgradeKind, number>> {
  const out: Partial<Record<UpgradeKind, number>> = {}
  for (const socket of readSockets(value)) {
    const grade = stoneByCode(socket.stone)
    const cut = cutByKind(socket.cut)
    if (!grade || !cut) continue
    out[cut.kind] = (out[cut.kind] ?? 0) + grade.points
  }
  return out
}
