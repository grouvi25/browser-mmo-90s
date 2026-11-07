import { describe, expect, it } from 'vitest'
import { tbankNotificationValid, tbankToken } from '../../modules/payments/tbank'

// Контрольные примеры — из документации Т-Банка (developer.tbank.ru/eacq/intro/developer/token и /notification).
describe('подпись Т-Банка', () => {
  it('запрос Init: вложенные объекты не участвуют, пароль добавлен, ключи по алфавиту', () => {
    expect(tbankToken({
      TerminalKey: 'MerchantTerminalKey', Amount: 19200, OrderId: '00000', Description: 'Подарочная карта на 1000 рублей',
      DATA: { Phone: '+71234567890' }, Receipt: { Email: 'a@test.ru' },
    }, '11111111111111')).toBe('72dd466f8ace0a37a1f740ce5fb78101712bc0665d91a8108c7c8a0ccd426db2')
  })

  it('уведомление: пример банка проходит, подделка и чужой терминал — нет', () => {
    const body = {
      TerminalKey: '1234567890DEMO', OrderId: '000000', Success: true, Status: 'AUTHORIZED', PaymentId: '0000000', ErrorCode: '0',
      Amount: 1111, CardId: '000000', Pan: '200000******0000', ExpDate: '1111', RebillId: '000000',
      Token: '1c0964277d0213349243065a0d5b838b8e90d2d25f740d0f2767836e710e80c8',
    }
    expect(tbankToken(body, '11111111111')).toBe(body.Token)
    expect(tbankNotificationValid(body, '1234567890DEMO', '11111111111')).toBe(true)
    expect(tbankNotificationValid({ ...body, Amount: 999999 }, '1234567890DEMO', '11111111111')).toBe(false)
    expect(tbankNotificationValid(body, 'ДругойТерминал', '11111111111')).toBe(false)
    expect(tbankNotificationValid(body, '1234567890DEMO', 'чужой пароль')).toBe(false)
  })
})
