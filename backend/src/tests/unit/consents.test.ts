import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LEGAL_EDITIONS } from '../../modules/auth/consents'

describe('журнал согласий', () => {
  it('редакции документов совпадают с теми, что видит игрок на сайте', () => {
    const docs = readFileSync(join(__dirname, '../../../../frontend/src/pages/legal/legal-docs.ts'), 'utf8')
    for (const [slug, edition] of Object.entries(LEGAL_EDITIONS)) {
      const block = docs.slice(docs.indexOf(`"slug": "${slug}"`))
      expect(block.match(/"edition": "Редакция от ([\d.]+)"/)?.[1], slug).toBe(edition)
    }
  })
})
