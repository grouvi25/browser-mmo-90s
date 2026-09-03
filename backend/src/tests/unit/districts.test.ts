import { describe, expect, it } from 'vitest'
import { DISTRICT_CODES, OBJECT_DISTRICTS, PRODUCTION_OBJECTS } from '../../../prisma/economy-data'

/**
 * Шаг F0 Этапа 4: у каждого производственного объекта есть район.
 *
 * До этого поле `ProductionObject.locationId` стояло в схеме заделом и не
 * заполнялось ничем. Территории Этапа 4 держатся на нём целиком: бонус
 * района применяется к объектам клана, а атаковать объект можно только в
 * своём районе или в районе врага. Объект без района выпадает из обеих
 * механик молча — поэтому проверяем, а не надеемся.
 */

/**
 * Объекты, которые сеются вне таблицы PRODUCTION_OBJECTS. Пивная приходит
 * вместе со своими рецептами отдельным блоком сида (`prisma/seed.ts`), но
 * район ей нужен наравне с остальными: без него бар не защитить и не
 * ограбить. Список ведётся руками — появится второй такой объект, тест
 * упадёт на проверке «нет объектов, которых нет в сиде».
 */
const OBJECTS_SEEDED_SEPARATELY = ['obj_bar_station']

describe('районы производственных объектов', () => {
  it('каждый объект сида стоит в каком-то районе', () => {
    for (const object of PRODUCTION_OBJECTS) {
      expect(OBJECT_DISTRICTS[object.code], `объект ${object.code} без района`).toBeDefined()
    }
  })

  it('объекты вне общей таблицы тоже получили район', () => {
    for (const code of OBJECTS_SEEDED_SEPARATELY) {
      expect(OBJECT_DISTRICTS[code], `объект ${code} без района`).toBeDefined()
    }
  })

  it('в раскладке нет объектов, которых нет в сиде', () => {
    const seeded = new Set([
      ...PRODUCTION_OBJECTS.map(object => object.code),
      ...OBJECTS_SEEDED_SEPARATELY,
    ])
    for (const code of Object.keys(OBJECT_DISTRICTS)) {
      expect(seeded.has(code), `район назначен несуществующему объекту ${code}`).toBe(true)
    }
  })

  it('все районы из раскладки известны', () => {
    for (const [code, district] of Object.entries(OBJECT_DISTRICTS)) {
      expect(DISTRICT_CODES, `объект ${code} стоит в неизвестном районе ${district}`)
        .toContain(district)
    }
  })

  it('ни один район не остался без объектов', () => {
    // Пустой район нечем атаковать и незачем защищать: война в нём
    // выродится в захват ради одного бонуса. Такой район — ошибка раскладки.
    const used = new Set(Object.values(OBJECT_DISTRICTS))
    for (const district of DISTRICT_CODES) {
      expect(used.has(district), `район ${district} остался без объектов`).toBe(true)
    }
  })

  it('ни один район не собрал больше трети объектов', () => {
    // Иначе один захват решает войну: клан, взявший такой район, получает
    // доступ к атаке на половину производства игры.
    const counts = new Map<string, number>()
    for (const district of Object.values(OBJECT_DISTRICTS)) {
      counts.set(district, (counts.get(district) ?? 0) + 1)
    }
    const total = PRODUCTION_OBJECTS.length + OBJECTS_SEEDED_SEPARATELY.length
    const limit = Math.ceil(total / 3)
    for (const [district, count] of counts) {
      expect(count, `в районе ${district} объектов ${count} при пределе ${limit}`)
        .toBeLessThanOrEqual(limit)
    }
  })
})
