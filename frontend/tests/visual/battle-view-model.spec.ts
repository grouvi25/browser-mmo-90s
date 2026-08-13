import { test, expect } from '@playwright/test'
import { appendAttackZone, getActionBudget, getTurnPlanText, removeAttackZone, toggleZone, validateTurnPlan } from '../../src/pages/battle/battle-view-model'

test.describe('battle phase A view model', () => {
  for (const [stance, attacks, blocks] of [
    ['attack2', 2, 0],
    ['mixed', 1, 2],
    ['defense4', 0, 4],
  ] as const) {
    test(`exposes ${stance} budget`, () => {
      expect(getActionBudget(stance)).toMatchObject({ attacks, blocks })
    })
  }

  test('toggles a zone without silently replacing a full selection', () => {
    expect(toggleZone([], 'HEAD', 1)).toEqual(['HEAD'])
    expect(toggleZone(['HEAD'], 'CHEST', 1)).toEqual(['HEAD'])
    expect(toggleZone(['HEAD'], 'HEAD', 1)).toEqual([])
  })

  test('keeps attacks ordered and allows duplicate target zones', () => {
    expect(appendAttackZone([], 'RIGHT_ARM', 2)).toEqual(['RIGHT_ARM'])
    expect(appendAttackZone(['RIGHT_ARM'], 'RIGHT_ARM', 2)).toEqual(['RIGHT_ARM', 'RIGHT_ARM'])
    expect(appendAttackZone(['RIGHT_ARM', 'RIGHT_ARM'], 'HEAD', 2)).toEqual(['RIGHT_ARM', 'RIGHT_ARM'])
    expect(removeAttackZone(['RIGHT_ARM', 'LEFT_ARM'], 0)).toEqual(['LEFT_ARM'])
  })

  test('describes complete mixed plan', () => {
    expect(getTurnPlanText({ stance: 'mixed', attackZones: ['HEAD'], blockZones: ['CHEST', 'LEGS'] }))
      .toBe('1 удар: голова · 2 блока: корпус, ноги')
  })

  test('describes movement instead of zonal plan', () => {
    expect(getTurnPlanText({ stance: 'attack2', attackZones: ['HEAD'], blockZones: [], selectedMove: { x: 3, y: 2 } }))
      .toBe('Движение: клетка 3:2')
  })

  test('rejects missing target and incomplete budgets', () => {
    expect(validateTurnPlan({ stance: 'attack2', attackZones: [], blockZones: [], targetParticipantId: null, targetInRange: true }).reason)
      .toBe('Выберите цель')
    expect(validateTurnPlan({ stance: 'attack2', attackZones: ['HEAD'], blockZones: [], targetParticipantId: 'enemy', targetInRange: true }).valid)
      .toBe(false)
    expect(validateTurnPlan({ stance: 'mixed', attackZones: ['HEAD'], blockZones: ['CHEST'], targetParticipantId: 'enemy', targetInRange: true }).reason)
      .toContain('зону блока')
  })

  test('rejects out of range target', () => {
    expect(validateTurnPlan({ stance: 'attack2', attackZones: ['HEAD', 'CHEST'], blockZones: [], targetParticipantId: 'enemy', targetInRange: false }))
      .toEqual({ valid: false, reason: 'Цель вне досягаемости' })
  })

  test('accepts all complete plans and movement', () => {
    expect(validateTurnPlan({ stance: 'attack2', attackZones: ['HEAD', 'CHEST'], blockZones: [], targetParticipantId: 'enemy', targetInRange: true }).valid).toBe(true)
    expect(validateTurnPlan({ stance: 'mixed', attackZones: ['HEAD'], blockZones: ['CHEST', 'LEGS'], targetParticipantId: 'enemy', targetInRange: true }).valid).toBe(true)
    expect(validateTurnPlan({ stance: 'defense4', attackZones: [], blockZones: ['HEAD', 'CHEST', 'LEFT_ARM', 'LEGS'], targetParticipantId: null, targetInRange: false }).valid).toBe(true)
    expect(validateTurnPlan({ stance: 'attack2', attackZones: [], blockZones: [], targetParticipantId: null, targetInRange: false, selectedMove: { x: 2, y: 2 } }).valid).toBe(true)
  })
})
