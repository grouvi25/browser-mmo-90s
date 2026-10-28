// Хаот по рейтингу (правка заказчика 28.10): стороны равны по силе и по
// численности с точностью до одного бойца.
import { describe, expect, it } from 'vitest'
import { splitByRating } from '../../modules/battles/applications.service'

const sum = (list: { rating: number }[]) => list.reduce((acc, f) => acc + f.rating, 0)

describe('splitByRating', () => {
  it('сильнейших разводит по разным сторонам, суммы близки', () => {
    const [one, two] = splitByRating([100, 90, 50, 40, 10, 5].map(rating => ({ rating })))
    expect(one).toHaveLength(3)
    expect(two).toHaveLength(3)
    expect(one.map(f => f.rating)).toContain(100)
    expect(two.map(f => f.rating)).toContain(90)
    expect(Math.abs(sum(one) - sum(two))).toBeLessThanOrEqual(15)
  })

  it('при нечётном числе стороны отличаются на одного', () => {
    const [one, two] = splitByRating([30, 20, 10, 5, 1].map(rating => ({ rating })))
    expect(Math.abs(one.length - two.length)).toBe(1)
    expect(one.length + two.length).toBe(5)
  })

  it('не теряет и не дублирует бойцов', () => {
    const fighters = Array.from({ length: 7 }, (_, i) => ({ id: i, rating: (i * 37) % 11 }))
    const [one, two] = splitByRating(fighters)
    expect([...one, ...two].map(f => f.id).sort()).toEqual(fighters.map(f => f.id))
  })
})
