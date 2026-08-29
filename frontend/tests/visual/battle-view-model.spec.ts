import { test, expect } from '@playwright/test'
import { appendAttackZone, getActionBudget, getTurnPlanText, removeAttackZone, selectAutomaticAttack, toggleAutomaticBlockSlot, toggleZone, validateTurnPlan } from '../../src/pages/battle/battle-view-model'

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

  test('derives attack2 only when no defence choice would be erased', () => {
    const first = selectAutomaticAttack({ stance: 'defense4', attackZones: [], attackHands: [], blockZones: [] }, 'RIGHT_HAND', 'HEAD')
    const attack2 = selectAutomaticAttack(first, 'LEFT_HAND', 'CHEST')
    expect(attack2).toEqual({ stance: 'attack2', attackHands: ['LEFT_HAND', 'RIGHT_HAND'], attackZones: ['CHEST', 'HEAD'], blockZones: [] })
    expect(toggleAutomaticBlockSlot(attack2, 'LEFT_LEG', 0)).toEqual(attack2)
  })

  test('locks the second attack after defence starts and never deletes prior choices', () => {
    let plan = toggleAutomaticBlockSlot({ stance: 'defense4', attackZones: [], attackHands: [], blockZones: [] }, 'HEAD', 0)
    plan = toggleAutomaticBlockSlot(plan, 'CHEST', 0)
    plan = selectAutomaticAttack(plan, 'LEFT_HAND', 'LEFT_LEG')
    expect(plan).toEqual({ stance: 'mixed', attackHands: ['LEFT_HAND'], attackZones: ['LEFT_LEG'], blockZones: ['HEAD', 'CHEST'] })
    expect(selectAutomaticAttack(plan, 'RIGHT_HAND', 'CHEST')).toEqual(plan)
    expect(toggleAutomaticBlockSlot(plan, 'LEFT_LEG', 0)).toEqual(plan)
  })

  test('allows four blocks when no attack is selected', () => {
    const plan = { stance: 'defense4', attackZones: [], attackHands: [], blockZones: [] } as const
    let next = toggleAutomaticBlockSlot(plan, 'HEAD', 0)
    next = toggleAutomaticBlockSlot(next, 'CHEST', 0)
    next = toggleAutomaticBlockSlot(next, 'LEFT_ARM', 0)
    next = toggleAutomaticBlockSlot(next, 'LEFT_LEG', 0)
    expect(next).toEqual({ stance: 'defense4', attackHands: [], attackZones: [], blockZones: ['HEAD', 'CHEST', 'LEFT_ARM', 'LEFT_LEG'] })
  })

  test('принимает два блока на одну зону и отбрасывает третий', () => {
    const empty = { stance: 'defense4', attackZones: [], attackHands: [], blockZones: [] } as const
    let plan = toggleAutomaticBlockSlot(empty, 'CHEST', 0)
    plan = toggleAutomaticBlockSlot(plan, 'CHEST', 1)
    expect(plan.blockZones).toEqual(['CHEST', 'CHEST'])
    // третьей ячейки на зоне нет, но проверяем и саму границу
    expect(toggleAutomaticBlockSlot(plan, 'CHEST', 2).blockZones).toEqual(['CHEST', 'CHEST'])
    // повторный клик по занятой ячейке снимает блок
    expect(toggleAutomaticBlockSlot(plan, 'CHEST', 1).blockZones).toEqual(['CHEST'])
  })

  test('клик по второй ячейке пустой зоны кладёт блок в первую', () => {
    // Модель считает не ячейки, а количество блоков на зоне: номер слота
    // нужен ей только чтобы отличить постановку от снятия. Пустую вторую
    // ячейку гасит панель, а модель на всякий случай не создаёт дырок.
    const empty = { stance: 'defense4', attackZones: [], attackHands: [], blockZones: [] } as const
    expect(toggleAutomaticBlockSlot(empty, 'LEFT_LEG', 1).blockZones).toEqual(['LEFT_LEG'])
  })

  test('describes complete mixed plan', () => {
    expect(getTurnPlanText({ stance: 'mixed', attackZones: ['HEAD'], attackHands: ['RIGHT_HAND'], blockZones: ['CHEST', 'LEFT_LEG'] }))
      .toBe('1 удар: голова · 2 блока: корпус, левая нога')
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
    expect(validateTurnPlan({ stance: 'mixed', attackZones: ['HEAD'], attackHands: ['RIGHT_HAND'], blockZones: ['CHEST'], targetParticipantId: 'enemy', targetInRange: true }).reason)
      .toContain('зону блока')
  })

  test('requires a source hand for each attack and both hands for attack2', () => {
    expect(validateTurnPlan({ stance: 'mixed', attackZones: ['HEAD'], attackHands: [], blockZones: ['CHEST', 'LEFT_LEG'], targetParticipantId: 'enemy', targetInRange: true }).valid).toBe(false)
    expect(validateTurnPlan({ stance: 'attack2', attackZones: ['HEAD', 'CHEST'], attackHands: ['LEFT_HAND', 'LEFT_HAND'], blockZones: [], targetParticipantId: 'enemy', targetInRange: true }).reason).toContain('обе руки')
  })

  test('rejects out of range target', () => {
    expect(validateTurnPlan({ stance: 'attack2', attackZones: ['HEAD', 'CHEST'], attackHands: ['LEFT_HAND', 'RIGHT_HAND'], blockZones: [], targetParticipantId: 'enemy', targetInRange: false }))
      .toEqual({ valid: false, reason: 'Цель вне досягаемости' })
  })

  test('accepts all complete plans and movement', () => {
    expect(validateTurnPlan({ stance: 'attack2', attackZones: ['HEAD', 'CHEST'], attackHands: ['LEFT_HAND', 'RIGHT_HAND'], blockZones: [], targetParticipantId: 'enemy', targetInRange: true }).valid).toBe(true)
    expect(validateTurnPlan({ stance: 'mixed', attackZones: ['HEAD'], attackHands: ['RIGHT_HAND'], blockZones: ['CHEST', 'LEFT_LEG'], targetParticipantId: 'enemy', targetInRange: true }).valid).toBe(true)
    expect(validateTurnPlan({ stance: 'defense4', attackZones: [], blockZones: ['HEAD', 'CHEST', 'LEFT_ARM', 'LEFT_LEG'], targetParticipantId: null, targetInRange: false }).valid).toBe(true)
    expect(validateTurnPlan({ stance: 'attack2', attackZones: [], blockZones: [], targetParticipantId: null, targetInRange: false, selectedMove: { x: 2, y: 2 } }).valid).toBe(true)
  })
})
