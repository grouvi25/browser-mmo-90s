/**
 * Перевес статов и оберегов (обращение №76, схема Димы и Nobody 10.11).
 * Равные статы — 50%, каждый стат разницы плавно сдвигает шанс, разница 50
 * статов убирает рандом. Обереги только защищают цель (уточнение Nobody 14.11):
 * перевес оберега цели режет шанс до нуля, перекрытый минусом оберег открывает дорогу статам.
 */
import { describe, expect, it } from 'vitest'
import { calcCounterAttackChance, calcCritChance, calcHitChance, calcLuckyPierceChance, edgeChance } from '../../modules/battles/battle.formulas'

const atk = (o: Record<string, number> = {}) => ({ acc: 3, agi: 200, rea: 50, luck: 50, agr: 50, antiDodgeBonus: 0, antiCounterBonus: 0, weaponAccuracy: 0.7, critBonus: 0, blockPierce: 0, ...o })
const def = (o: Record<string, number> = {}) => ({ agi: 200, rea: 50, luck: 50, agr: 50, dodgeBonus: 0, antiCrit: 0, antiLuck: 0, ...o })

describe('перевес №76', () => {
  it('равные статы — 50%, 201 против 200 — 51%, разница 50 — без рандома', () => {
    expect(edgeChance(0, 0, 0.5).chance).toBe(0.5)
    expect(edgeChance(1, 0, 0.5).chance).toBeCloseTo(0.51)
    expect(edgeChance(40, 0, 0.5).chance).toBeCloseTo(0.9)
    expect(edgeChance(50, 0, 0.5)).toEqual({ chance: 1, decided: true })
    expect(edgeChance(-50, 0, 0.5)).toEqual({ chance: 0, decided: true })
  })

  it('оберег цели защищает: перевес 250% — не попасть даже с большей ловкостью, меньше — режет шанс', () => {
    expect(calcHitChance(atk({ agi: 400 }), def({ dodgeBonus: 2.6 }))).toBe(0)
    expect(calcHitChance(atk({ agi: 400, dodgeCharmEdge: -1.25 }), def())).toBeCloseTo(0.5)
  })

  it('минус бьющего, перекрывший оберег, ничего не гарантирует: дальше решает стат', () => {
    expect(calcHitChance(atk({ agi: 100, dodgeCharmEdge: 2.5 }), def())).toBe(0)
    expect(calcHitChance(atk({ agi: 200, dodgeCharmEdge: 100 }), def())).toBeCloseTo(0.5)
    expect(calcHitChance(atk({ agi: 250, dodgeCharmEdge: 2.5 }), def())).toBe(1)
  })

  it('пример Nobody 14.11: минус удачи 35000% против оберега 3500%, но удачи у цели на 1000 больше — удачного нет', () => {
    expect(calcLuckyPierceChance(atk({ luck: 500 }), def({ luck: 1500, luckCharmEdge: 35 - 350 }))).toBe(0)
    expect(calcLuckyPierceChance(atk({ luck: 1500 }), def({ luck: 500, luckCharmEdge: 35 - 350 }))).toBe(1)
    // И1 по И2 не попадает: ловкость 10 против 1000 и минус уворота 1000000% у цели.
    expect(calcHitChance(atk({ agi: 10, dodgeCharmEdge: 1 - 10000 }), def({ agi: 1000 }))).toBe(0)
  })

  it('попадание — ловкость против ловкости: 240 против 200 — 90%, точность оружия двигает шанс', () => {
    expect(calcHitChance(atk({ agi: 240 }), def())).toBeCloseTo(0.9)
    expect(calcHitChance(atk({ agi: 200, weaponAccuracy: 0.8 }), def())).toBeCloseTo(0.6)
  })

  it('крит — по агрессии, пробитие блока — по фарту, ответка — по реакции', () => {
    expect(calcCritChance(atk({ agr: 100 }), def({ agr: 50 }))).toBe(1)
    expect(calcCritChance(atk({ agr: 50 }), def({ agr: 50 }))).toBe(0.5)
    expect(calcLuckyPierceChance(atk({ luck: 100 }), def({ luck: 50 }))).toBe(1)
    // Блокер на обереге удачи: минус-оберег бьющего его перекрыл — дальше решает фарт (равный — 50%).
    expect(calcLuckyPierceChance(atk(), def({ luckCharmEdge: -2.5 }))).toBe(0.5)
    expect(calcLuckyPierceChance(atk(), def({ luckCharmEdge: 2.5 }))).toBe(0)
    // «Чтобы не получать ответ — на 50 реакции больше либо на 250% оберега ответа».
    expect(calcCounterAttackChance(def({ rea: 50 }), atk({ rea: 100 }))).toBe(0)
    expect(calcCounterAttackChance(def({ rea: 50 }), atk({ rea: 50, counterCharmEdge: 2.5 }))).toBe(0)
    expect(calcCounterAttackChance(def({ rea: 50 }), atk({ rea: 50 }))).toBe(0.5)
  })
})
