import { describe, expect, it } from 'vitest'
import { ActionSchema } from '../../modules/battles/battles.routes'

// Дима 15.11: «не бьются собаки, по ним бить ещё нельзя». Цель-фигура приходит
// как «dog:<uuid>» / «helper:<uuid>», а схема пускала только uuid бойца.
describe('цель удара в ходе боя', () => {
  const id = '3f2c1d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f'
  const turn = (targetParticipantId: string) => ActionSchema.safeParse({ action: 'attack', stance: 'attack2', attackZones: ['HEAD'], targetParticipantId })

  it('боец по uuid', () => expect(turn(id).success).toBe(true))
  it('чужая собака и помощник на поле', () => {
    expect(turn(`dog:${id}`).success).toBe(true)
    expect(turn(`helper:${id}`).success).toBe(true)
  })
  it('мусор не проходит', () => {
    expect(turn('cat:' + id).success).toBe(false)
    expect(turn('dog:123').success).toBe(false)
    expect(turn('').success).toBe(false)
  })
})
