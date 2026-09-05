import { describe, expect, it } from 'vitest'
import { trimTo } from '../../modules/announcements/announcements.formulas'

describe('announcement text', () => {
  it('keeps a short text as it is, only trimming the edges', () => {
    expect(trimTo('  Патч 1.2 вышел  ', 120)).toBe('Патч 1.2 вышел')
  })

  it('refuses to invent content out of whitespace', () => {
    expect(trimTo('   \n\n  ', 120)).toBe('')
  })

  it('flattens a ladder of blank lines but keeps a single break', () => {
    expect(trimTo('первое\n\nвторое', 120)).toBe('первое\n\nвторое')
    expect(trimTo('первое\n\n\n\n\nвторое', 120)).toBe('первое\n\nвторое')
  })

  it('cuts on a word boundary when the tail word is short enough', () => {
    // Граница на 20: последний пробел стоит на 16, это больше 0.75×20.
    expect(trimTo('раз два три четыре пять', 20)).toBe('раз два три четыре')
  })

  it('breaks a word rather than losing a quarter of the text', () => {
    // Единственный пробел стоит слишком рано — обрезать по нему значило бы
    // выбросить почти всё, поэтому рвём слово.
    expect(trimTo('раз ааааааааааааааааааааааа', 20)).toBe('раз аааааааааааааааа')
  })

  it('never returns more than the column can hold', () => {
    expect(trimTo('я'.repeat(500), 120)).toHaveLength(120)
  })
})
