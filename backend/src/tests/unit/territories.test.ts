import { describe, expect, it } from 'vitest'
import {
  assignTiers, bonusText, clanDailyUpkeep, isBonusSuspended, isProtected,
  isTerritoryBonusCode, shouldRelease, territoryUpkeepPerDay,
  TERRITORY_BONUS_CODES, TERRITORY_LIMIT,
} from '../../modules/territories/territories.formulas'
import { TERRITORIES, DISTRICT_CODES } from '../../../prisma/economy-data'
import { CLAN_MAINTENANCE_DAILY } from '../../modules/clans/clans.formulas'

const at = (iso: string) => new Date(iso)

describe('сид территорий', () => {
  it('шесть районов, ровно те же коды, что у объектов', () => {
    expect(TERRITORIES).toHaveLength(6)
    expect(TERRITORIES.map(t => t.code).sort()).toEqual([...DISTRICT_CODES].sort())
  })

  it('у каждой территории известный код бонуса', () => {
    for (const territory of TERRITORIES) {
      expect(isTerritoryBonusCode(territory.bonusCode), territory.code).toBe(true)
    }
  })

  it('ни один бонус не повторяется', () => {
    // Два района с одним бонусом складывались бы молча, и владелец обоих
    // получал бы вдвое больше, чем задумано балансом.
    const codes = TERRITORIES.map(t => t.bonusCode)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('каждый код бонуса из закрытого списка кем-то занят', () => {
    const used = new Set(TERRITORIES.map(t => t.bonusCode))
    for (const code of TERRITORY_BONUS_CODES) expect(used.has(code), code).toBe(true)
  })

  it('у каждого бонуса есть подпись словами', () => {
    for (const territory of TERRITORIES) {
      expect(bonusText(territory.bonusCode, territory.bonusValue).length,
        territory.bonusCode).toBeGreaterThan(0)
    }
  })
})

describe('содержание территории', () => {
  it('вторая ступень дороже первой в два с половиной раза', () => {
    // Это главный ограничитель монополии, а не украшение: клан на двух
    // районах живёт впритык и третий не потянул бы.
    expect(territoryUpkeepPerDay(2) / territoryUpkeepPerDay(1)).toBe(2.5)
  })

  it('ступень выше второй считается по второй', () => {
    // Лимит не даёт третью территорию, но формула не должна падать,
    // если лимит когда-нибудь поднимут.
    expect(territoryUpkeepPerDay(3)).toBe(territoryUpkeepPerDay(2))
  })

  it('клан без территорий платит только своё содержание', () => {
    expect(clanDailyUpkeep(CLAN_MAINTENANCE_DAILY, [], false, 0)).toBe(500)
  })

  it('одна территория: 500 своих плюс 2000', () => {
    expect(clanDailyUpkeep(CLAN_MAINTENANCE_DAILY, [1], false, 0)).toBe(2500)
  })

  it('две территории: 500 плюс 2000 плюс 5000', () => {
    expect(clanDailyUpkeep(CLAN_MAINTENANCE_DAILY, [1, 2], false, 0)).toBe(7500)
  })

  it('Спальный район режет четверть со всей суммы, включая содержание клана', () => {
    // Скидка идёт на сумму, а не на каждую территорию: иначе содержание
    // самого клана осталось бы без неё, а ТЗ обещает обратное.
    expect(clanDailyUpkeep(CLAN_MAINTENANCE_DAILY, [1, 2], true, 0.25)).toBe(5625)
  })

  it('окупаемость Спального района не быстрее пяти суток', () => {
    // Коридор приёмки: быстрее — и район забирается первым же кланом
    // в первый день, после чего война за него не переигрывается.
    const full = clanDailyUpkeep(CLAN_MAINTENANCE_DAILY, [1, 2], false, 0)
    const saved = full - clanDailyUpkeep(CLAN_MAINTENANCE_DAILY, [1, 2], true, 0.25)
    expect(10000 / saved).toBeGreaterThanOrEqual(5)
  })
})

describe('долг содержания', () => {
  it('до десяти тысяч бонус работает', () => {
    expect(isBonusSuspended(9999)).toBe(false)
    expect(shouldRelease(9999)).toBe(false)
  })

  it('с десяти тысяч бонус гаснет, но район ещё у клана', () => {
    expect(isBonusSuspended(10000)).toBe(true)
    expect(shouldRelease(10000)).toBe(false)
  })

  it('с двадцати пяти тысяч район уходит', () => {
    expect(shouldRelease(25000)).toBe(true)
  })

  it('между отключением бонуса и потерей есть запас', () => {
    // Клан обязан увидеть проблему раньше, чем потеряет вложенное:
    // 15 000 разницы при расходе 2 500 в сутки — это шесть суток.
    const gap = 25000 - 10000
    expect(gap / 2500).toBeGreaterThanOrEqual(5)
  })
})

describe('ступени по порядку захвата', () => {
  it('первая захваченная остаётся первой ступенью', () => {
    const tiers = assignTiers([
      { id: 'b', controlledAt: at('2026-09-02T10:00:00Z') },
      { id: 'a', controlledAt: at('2026-09-01T10:00:00Z') },
    ])
    expect(tiers.get('a')).toBe(1)
    expect(tiers.get('b')).toBe(2)
  })

  it('захваты в одну миллисекунду упорядочены устойчиво', () => {
    const same = at('2026-09-01T10:00:00Z')
    const first = assignTiers([{ id: 'b', controlledAt: same }, { id: 'a', controlledAt: same }])
    const second = assignTiers([{ id: 'a', controlledAt: same }, { id: 'b', controlledAt: same }])
    expect(first.get('a')).toBe(second.get('a'))
    expect(first.get('b')).toBe(second.get('b'))
  })

  it('потеря первой территории удешевляет оставшуюся', () => {
    const both = assignTiers([
      { id: 'a', controlledAt: at('2026-09-01T10:00:00Z') },
      { id: 'b', controlledAt: at('2026-09-02T10:00:00Z') },
    ])
    expect(territoryUpkeepPerDay(both.get('b')!)).toBe(5000)
    const alone = assignTiers([{ id: 'b', controlledAt: at('2026-09-02T10:00:00Z') }])
    expect(territoryUpkeepPerDay(alone.get('b')!)).toBe(2000)
  })
})

describe('защита после захвата', () => {
  const now = at('2026-09-03T12:00:00Z')

  it('ничейный район защиты не имеет', () => {
    expect(isProtected(null, now)).toBe(false)
  })

  it('защита действует, пока не истекла', () => {
    expect(isProtected(at('2026-09-03T13:00:00Z'), now)).toBe(true)
  })

  it('истёкшая защита не считается', () => {
    expect(isProtected(at('2026-09-03T11:00:00Z'), now)).toBe(false)
  })
})

describe('лимит территорий', () => {
  it('карта не делится между менее чем тремя кланами', () => {
    // Шесть районов при лимите два требуют минимум трёх кланов —
    // это и есть проектная цель, а не следствие.
    expect(Math.ceil(TERRITORIES.length / TERRITORY_LIMIT)).toBeGreaterThanOrEqual(3)
  })
})
