/**
 * Почта при регистрации (просьба 28.10): без псевдонимов и одноразовых ящиков.
 */
import { describe, expect, it } from 'vitest'
import { isDisposableEmail, normalizeEmail } from '../../modules/auth/email-policy'

describe('нормализация почты', () => {
  it('Gmail: точки и «+метка» — тот же ящик, googlemail — тот же домен', () => {
    expect(normalizeEmail('Vasya.Pupkin+bot1@Gmail.com')).toBe('vasyapupkin@gmail.com')
    expect(normalizeEmail('v.a.s.y.a.pupkin@googlemail.com')).toBe('vasyapupkin@gmail.com')
  })

  it('«+метка» срезается у всех, точки — только у Gmail', () => {
    expect(normalizeEmail('ivan.petrov+game@mail.ru')).toBe('ivan.petrov@mail.ru')
    expect(normalizeEmail('ivan.petrov@mail.ru')).not.toBe(normalizeEmail('ivanpetrov@mail.ru'))
  })

  it('Яндекс: домены-синонимы и «-» вместо «.» — один ящик', () => {
    expect(normalizeEmail('ivan-petrov@ya.ru')).toBe('ivan.petrov@yandex.ru')
    expect(normalizeEmail('Ivan.Petrov+x@yandex.com')).toBe('ivan.petrov@yandex.ru')
  })
})

describe('одноразовая почта', () => {
  it('ловит домены из списка и их поддомены, обычные почтовики пропускает', () => {
    expect(isDisposableEmail('x@mailinator.com')).toBe(true)
    expect(isDisposableEmail('x@temp-mail.org')).toBe(true)
    expect(isDisposableEmail('x@sub.mailinator.com')).toBe(true)
    for (const ok of ['x@gmail.com', 'x@mail.ru', 'x@yandex.ru', 'x@bk.ru', 'x@outlook.com']) expect(isDisposableEmail(ok)).toBe(false)
  })
})
