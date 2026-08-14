import { DESIGNER_BATTLE_COLUMNS, DESIGNER_BATTLE_ROWS } from './designer-battle-grid'
import { DESIGNER_CELL_NEIGHBOURS, type BattleCellKey } from './designer-battle-adjacency'

// =============================================================
// Геометрия поля боя на клиенте.
//
// Зеркало backend/src/modules/battles/grid.ts: сервер остаётся
// единственным судьёй, но подсветка доступных клеток обязана
// совпадать с его правилами, иначе игрок жмёт туда, куда ход
// не примут.
//
// Размер и соседство берутся из таблицы, снятой с решётки PSD, —
// размножать здесь константы нельзя, иначе они разъедутся с рисунком.
// =============================================================
export const GRID_COLS = DESIGNER_BATTLE_COLUMNS
export const GRID_ROWS = DESIGNER_BATTLE_ROWS

export interface Cell { x: number; y: number }

export function isInsideGrid(cell: Cell): boolean {
  return cell.x >= 0 && cell.x < GRID_COLS && cell.y >= 0 && cell.y < GRID_ROWS
}

export function hexNeighbours(cell: Cell): Cell[] {
  const key = `${cell.x}:${cell.y}` as BattleCellKey
  return (DESIGNER_CELL_NEIGHBOURS[key] ?? []).map(value => {
    const [x, y] = value.split(':').map(Number)
    return { x, y }
  })
}

export function isNeighbour(from: Cell, to: Cell): boolean {
  return hexNeighbours(from).some(cell => cell.x === to.x && cell.y === to.y)
}

/** Расстояние в сотах: смещённые координаты переводим в кубические. */
export function hexDistance(a: Cell, b: Cell): number {
  if (a.x === b.x && a.y === b.y) return 0
  const target = `${b.x}:${b.y}`
  const visited = new Set([`${a.x}:${a.y}`])
  let frontier = [a]
  for (let distance = 1; frontier.length > 0; distance++) {
    const next: Cell[] = []
    for (const cell of frontier) {
      for (const neighbour of hexNeighbours(cell)) {
        const key = `${neighbour.x}:${neighbour.y}`
        if (visited.has(key)) continue
        if (key === target) return distance
        visited.add(key)
        next.push(neighbour)
      }
    }
    frontier = next
  }
  return Number.POSITIVE_INFINITY
}
