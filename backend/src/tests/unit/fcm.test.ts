import { createVerify, generateKeyPairSync } from 'crypto'
import { describe, expect, it } from 'vitest'
import { fcmMessage, parseServiceAccount, signedAssertion } from '../../modules/push/fcm'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const account = {
  project_id: 'kooperativ-test', client_email: 'push@kooperativ-test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
}

describe('пуши через FCM', () => {
  it('ключ сервисного аккаунта читается и как JSON, и как base64; битый — пуши выключены', () => {
    const json = JSON.stringify(account)
    expect(parseServiceAccount(json)).toMatchObject({ project_id: 'kooperativ-test' })
    expect(parseServiceAccount(Buffer.from(json).toString('base64'))).toMatchObject({ client_email: account.client_email })
    expect(parseServiceAccount('{"project_id":"x"}')).toBeNull()
    expect(parseServiceAccount(undefined)).toBeNull()
  })

  it('JWT подписан ключом аккаунта и просит только доступ к пушам', () => {
    const jwt = signedAssertion(account, 1_800_000_000)
    const [header, claims, signature] = jwt.split('.')
    const verifier = createVerify('RSA-SHA256')
    verifier.update(`${header}.${claims}`)
    expect(verifier.verify(publicKey, Buffer.from(signature.replace(/-/g, '+').replace(/_/g, '/'), 'base64'))).toBe(true)
    expect(JSON.parse(Buffer.from(claims, 'base64').toString())).toEqual({
      iss: account.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token', iat: 1_800_000_000, exp: 1_800_003_600,
    })
  })

  it('сообщение несёт экран для открытия по тапу строками в data', () => {
    expect(fcmMessage('tok', { title: 'Смена закончилась', body: 'Заберите награду', url: '/work', kind: 'work' })).toEqual({
      message: {
        token: 'tok', notification: { title: 'Смена закончилась', body: 'Заберите награду' },
        data: { url: '/work', kind: 'work' },
        android: { priority: 'HIGH', notification: { channel_id: 'work', tag: 'work' } },
      },
    })
  })
})
