/**
 * Согласия при регистрации (Дима 25.11). Три галочки, первые две обязательны:
 * 1) соглашение и ознакомление с политикой; 2) согласие на обработку ПДн;
 * 3) рекламно-информационные материалы, по желанию.
 *
 * Редакции документов должны совпадать с frontend/src/pages/legal/legal-docs.ts
 * (сверяет юнит-тест). Тексты галочек — с register-page.tsx: меняя одно,
 * меняйте и другое, иначе журнал разойдётся с тем, что видел игрок.
 */
export const LEGAL_EDITIONS = {
  soglashenie: '27.11.2026',
  politika: '27.11.2026',
  soglasie: '27.11.2026',
  rassylka: '27.11.2026',
} as const

export const CONSENT_STATEMENTS = {
  terms: 'Я принимаю условия Пользовательского соглашения и ознакомлен(а) с Политикой обработки персональных данных',
  pd: 'Я даю Согласие на обработку персональных данных',
  marketing: 'Я согласен(на) на получение рекламно-информационных материалов игры «Кооператив» (ООО «АРТЕФАКТУМ»)',
} as const

export interface ConsentRecord {
  kind: 'TERMS' | 'POLICY' | 'PD_CONSENT' | 'MARKETING'
  document: keyof typeof LEGAL_EDITIONS
  edition: string
  statement: string
  ip?: string
  userAgent?: string
}

/** Записи журнала: по одной на каждый документ, с которым согласился игрок. */
export function consentRecords(marketing: boolean, ip?: string, userAgent?: string): ConsentRecord[] {
  const row = (kind: ConsentRecord['kind'], document: keyof typeof LEGAL_EDITIONS, statement: string): ConsentRecord =>
    ({ kind, document, edition: LEGAL_EDITIONS[document], statement, ip, userAgent: userAgent?.slice(0, 500) })
  return [
    row('TERMS', 'soglashenie', CONSENT_STATEMENTS.terms),
    row('POLICY', 'politika', CONSENT_STATEMENTS.terms),
    row('PD_CONSENT', 'soglasie', CONSENT_STATEMENTS.pd),
    ...(marketing ? [row('MARKETING', 'rassylka', CONSENT_STATEMENTS.marketing)] : []),
  ]
}
