import { describe, expect, it } from 'vitest'
import { addressedNicknames } from '../../modules/chat/chat.formulas'

describe('обращение в общем чате (№191)', () => {
  it('ник в начале строки с запятой — обращение', () => {
    expect(addressedNicknames('Metallica, идёшь на стрелку?')).toEqual(['metallica'])
  })
  it('несколько ников подряд, не больше трёх', () => {
    expect(addressedNicknames('Nemo, Mayday, Amadeus, Nobody, сбор')).toEqual(['nemo', 'mayday', 'amadeus'])
  })
  it('без запятой и ник в середине — не обращение', () => {
    expect(addressedNicknames('привет всем')).toEqual([])
    expect(addressedNicknames('где Nemo')).toEqual([])
  })
  it('@ перед ником и повторы', () => {
    expect(addressedNicknames('@Nemo, nemo, ты тут')).toEqual(['nemo'])
  })
  it('слишком длинный кусок до запятой — не ник', () => {
    expect(addressedNicknames(`${'а'.repeat(40)}, текст`)).toEqual([])
  })
})
