// =============================================================
// Геометрия поля боя на клиенте.
//
// Зеркало backend/src/modules/battles/grid.ts: сервер остаётся
// единственным судьёй, но подсветка доступных клеток обязана
// совпадать с его правилами, иначе игрок жмёт туда, куда ход
// не примут.
//
// Координаты — смещённая сетка «odd-r»: нечётные ряды сдвинуты
// вправо на половину соты.
// =============================================================
export const GRID_COLS = 9
export const GRID_ROWS = 9

export interface Cell { x: number; y: number }

const NEIGHBOUR_OFFSETS = {
  even: [[+1, 0], [0, -1], [-1, -1], [-1, 0], [-1, +1], [0, +1]],
  odd: [[+1, 0], [+1, -1], [0, -1], [-1, 0], [0, +1], [+1, +1]],
} as const

export function isInsideGrid(cell: Cell): boolean {
  return cell.x >= 0 && cell.x < GRID_COLS && cell.y >= 0 && cell.y < GRID_ROWS
}

export function hexNeighbours(cell: Cell): Cell[] {
  const offsets = cell.y & 1 ? NEIGHBOUR_OFFSETS.odd : NEIGHBOUR_OFFSETS.even
  return offsets
    .map(([dx, dy]) => ({ x: cell.x + dx, y: cell.y + dy }))
    .filter(isInsideGrid)
}

export function isNeighbour(from: Cell, to: Cell): boolean {
  return hexNeighbours(from).some(cell => cell.x === to.x && cell.y === to.y)
}

/** Расстояние в сотах: смещённые координаты переводим в кубические. */
export function hexDistance(a: Cell, b: Cell): number {
  const aq = a.x - (a.y - (a.y & 1)) / 2
  const bq = b.x - (b.y - (b.y & 1)) / 2
  return (Math.abs(aq - bq) + Math.abs(a.y - b.y) + Math.abs(-aq - a.y + bq + b.y)) / 2
}

// ── Раскладка на экране ──────────────────────────────────────
// Сота «остриём вверх»: высота = ширина × 2/√3, ряды находят друг
// на друга на четверть высоты, нечётные сдвинуты на полсоты вправо.
// Поэтому по ширине помещается 9.5 сот, по высоте — 1 + 0.75×4.
const HEX_RATIO = 2 / Math.sqrt(3)
export const FIELD_COLUMNS_SPAN = GRID_COLS + 0.5
export const FIELD_ROWS_SPAN = 1 + 0.75 * (GRID_ROWS - 1)
/** Соотношение сторон всего поля — им задаётся aspect-ratio контейнера. */
export const FIELD_ASPECT = FIELD_COLUMNS_SPAN / (FIELD_ROWS_SPAN * HEX_RATIO)

/** Положение и размер соты в процентах от поля. */
export function cellStyle(cell: Cell): { left: string; top: string; width: string; height: string } {
  const width = 100 / FIELD_COLUMNS_SPAN
  const height = 100 / FIELD_ROWS_SPAN
  return {
    left: `${(cell.x + (cell.y & 1) * 0.5) * width}%`,
    top: `${cell.y * 0.75 * height}%`,
    width: `${width}%`,
    height: `${height}%`,
  }
}
