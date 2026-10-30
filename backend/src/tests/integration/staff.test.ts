/**
 * Сотрудники и вход в админку (правка 30.10): ник и пароль игрового
 * аккаунта, код из письма, запомненное устройство, права по ролям,
 * снятие роли закрывает сессии, последнего владельца не снять.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

const mail = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; text: string; html?: string }[] }))
vi.mock('../../shared/mail/mailer', () => ({
  mailConfigured: () => true,
  sendMail: async (message: { to: string; subject: string; text: string; html?: string }) => { mail.sent.push(message); return { ok: true } },
}))

import { buildApp } from '../../app'
import { cleanDatabase, testPrisma, uid } from './helpers'
import { getRedis, disconnectRedis } from '../../shared/db/redis'
import { AuthService } from '../../modules/auth/auth.service'
import { CharactersService } from '../../modules/characters/characters.service'

let app: FastifyInstance

async function member(role: 'OWNER' | 'ADMIN' | 'GAMEDESIGNER' | 'MODERATOR' | 'SUPPORT' | 'FINANCE', nick = uid('St').slice(0, 20)) {
  const reg = await AuthService.register({ nickname: nick, email: `${uid('s')}@test.local`, password: 'staff-pass-1', acceptPolicy: true })
  await CharactersService.create(reg.id, { archetype: 'STREET' })
  const row = await testPrisma.staffMember.create({ data: { userId: reg.id, role } })
  return { nick, userId: reg.id, staffId: row.id }
}

const codeFromMail = () => /Ваш код: (\d{6})/.exec(mail.sent.at(-1)!.text)![1]

async function signIn(nick: string, remember = false) {
  const first = await app.inject({ method: 'POST', url: '/api/admin/auth/staff/login', payload: { nickname: nick, password: 'staff-pass-1' } })
  expect(first.json()).toMatchObject({ step: 'code' })
  const done = await app.inject({ method: 'POST', url: '/api/admin/auth/staff/verify', payload: { challengeId: first.json().challengeId, code: codeFromMail(), remember } })
  expect(done.statusCode).toBe(200)
  return done.json() as { token: string; deviceToken?: string }
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` })

describe('Вход сотрудника в админку', () => {
  beforeAll(async () => { app = await buildApp(); await app.ready(); await testPrisma.$connect() })
  beforeEach(async () => { await cleanDatabase(); await getRedis().flushdb(); mail.sent.length = 0; await testPrisma.staffMember.deleteMany(); await testPrisma.staffLoginCode.deleteMany(); await testPrisma.staffTrustedDevice.deleteMany(); await testPrisma.staffEvent.deleteMany() })
  afterAll(async () => { await app.close(); await testPrisma.$disconnect(); await disconnectRedis() })

  it('ник и пароль → код на почту → вход; письмо в стиле игры', async () => {
    const owner = await member('OWNER')
    const first = await app.inject({ method: 'POST', url: '/api/admin/auth/staff/login', payload: { nickname: owner.nick.toLowerCase(), password: 'staff-pass-1' } })
    expect(first.json()).toMatchObject({ step: 'code', email: expect.stringContaining('***@test.local') })
    expect(mail.sent).toHaveLength(1)
    expect(mail.sent[0].html).toContain('КООПЕРАТИВ')

    // Повторный вход за минуту не шлёт второе письмо.
    const again = await app.inject({ method: 'POST', url: '/api/admin/auth/staff/login', payload: { nickname: owner.nick, password: 'staff-pass-1' } })
    expect(again.json().challengeId).toBe(first.json().challengeId)
    expect(mail.sent).toHaveLength(1)

    const wrong = await app.inject({ method: 'POST', url: '/api/admin/auth/staff/verify', payload: { challengeId: first.json().challengeId, code: '000000' === codeFromMail() ? '111111' : '000000' } })
    expect(wrong.statusCode).toBe(401)
    expect(wrong.json().message).toContain('Осталось попыток: 4')

    const done = await app.inject({ method: 'POST', url: '/api/admin/auth/staff/verify', payload: { challengeId: first.json().challengeId, code: codeFromMail() } })
    expect(done.json()).toMatchObject({ step: 'done', staffRole: 'OWNER' })
    const me = await app.inject({ url: '/api/admin/auth/me', headers: auth(done.json().token) })
    expect(me.json()).toMatchObject({ label: owner.nick, roleTitle: 'Владелец' })
    expect(me.json().permissions).toContain('staff')

    // Код одноразовый.
    const reuse = await app.inject({ method: 'POST', url: '/api/admin/auth/staff/verify', payload: { challengeId: first.json().challengeId, code: codeFromMail() } })
    expect(reuse.statusCode).toBe(410)
  })

  it('не сотрудник и неверный пароль — одинаковый отказ без письма', async () => {
    const reg = await AuthService.register({ nickname: 'ПростоИгрок', email: `${uid('p')}@test.local`, password: 'staff-pass-1', acceptPolicy: true })
    void reg
    const owner = await member('OWNER')
    for (const payload of [{ nickname: 'ПростоИгрок', password: 'staff-pass-1' }, { nickname: owner.nick, password: 'wrong' }]) {
      const res = await app.inject({ method: 'POST', url: '/api/admin/auth/staff/login', payload })
      expect(res.statusCode).toBe(401)
      expect(res.json().message).toBe('Неверный ник или пароль')
    }
    expect(mail.sent).toHaveLength(0)
  })

  it('запомненное устройство входит без кода; «выйти везде» его забывает', async () => {
    const owner = await member('OWNER')
    const { token, deviceToken } = await signIn(owner.nick, true)
    expect(deviceToken).toBeTruthy()
    mail.sent.length = 0
    const quick = await app.inject({ method: 'POST', url: '/api/admin/auth/staff/login', payload: { nickname: owner.nick, password: 'staff-pass-1', deviceToken } })
    expect(quick.json()).toMatchObject({ step: 'done' })
    expect(mail.sent).toHaveLength(0)

    const out = await app.inject({ method: 'POST', url: '/api/admin/auth/logout-all', headers: auth(token) })
    expect(out.json()).toMatchObject({ sessions: 2, devices: 1 })
    expect((await app.inject({ url: '/api/admin/auth/me', headers: auth(quick.json().token) })).statusCode).toBe(401)
    const again = await app.inject({ method: 'POST', url: '/api/admin/auth/staff/login', payload: { nickname: owner.nick, password: 'staff-pass-1', deviceToken } })
    expect(again.json()).toMatchObject({ step: 'code' })
  })

  it('права по ролям: поддержка видит обращения, но не выдаёт деньги и не правит вещи', async () => {
    const support = await member('SUPPORT')
    const { token } = await signIn(support.nick)
    expect((await app.inject({ url: '/api/admin/support', headers: auth(token) })).statusCode).toBe(200)
    expect((await app.inject({ url: '/api/admin/players', headers: auth(token) })).statusCode).toBe(200)
    const money = await app.inject({ method: 'POST', url: '/api/admin/characters/money', headers: auth(token), payload: {} })
    expect(money.statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: '/api/admin/items', headers: auth(token), payload: {} })).statusCode).toBe(403)
    expect((await app.inject({ url: '/api/admin/staff', headers: auth(token) })).statusCode).toBe(403)
  })

  it('геймдизайнер правит справочник, модератор — объявления; финансы — выплаты', async () => {
    const gd = await signIn((await member('GAMEDESIGNER')).nick)
    const items = await app.inject({ method: 'POST', url: '/api/admin/items', headers: auth(gd.token), payload: {} })
    expect(items.statusCode).not.toBe(403)
    const mod = await signIn((await member('MODERATOR')).nick)
    expect((await app.inject({ method: 'POST', url: '/api/announcements', headers: auth(mod.token), payload: {} })).statusCode).not.toBe(403)
    const fin = await signIn((await member('FINANCE')).nick)
    expect((await app.inject({ url: '/api/referral/admin/payouts', headers: auth(fin.token) })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/api/announcements', headers: auth(fin.token), payload: {} })).statusCode).toBe(403)
  })

  it('владелец назначает по нику; снятая роль закрывает сессии; последнего владельца не снять', async () => {
    const owner = await member('OWNER')
    const { token } = await signIn(owner.nick)
    const reg = await AuthService.register({ nickname: 'Новичок', email: `${uid('n')}@test.local`, password: 'staff-pass-1', acceptPolicy: true })
    await CharactersService.create(reg.id, { archetype: 'STREET' })

    const added = await app.inject({ method: 'POST', url: '/api/admin/staff', headers: auth(token), payload: { nickname: 'новичок', role: 'MODERATOR' } })
    expect(added.statusCode).toBe(200)
    const helper = await signIn('Новичок')
    expect((await app.inject({ url: '/api/admin/auth/me', headers: auth(helper.token) })).statusCode).toBe(200)

    await app.inject({ method: 'PATCH', url: `/api/admin/staff/${added.json().id}`, headers: auth(token), payload: { isActive: false } })
    expect((await app.inject({ url: '/api/admin/auth/me', headers: auth(helper.token) })).statusCode).toBe(401)

    const self = await app.inject({ method: 'PATCH', url: `/api/admin/staff/${owner.staffId}`, headers: auth(token), payload: { role: 'ADMIN' } })
    expect(self.statusCode).toBe(409)

    const list = await app.inject({ url: '/api/admin/staff', headers: auth(token) })
    expect(list.json().items).toHaveLength(2)
    const events = await app.inject({ url: '/api/admin/staff/events', headers: auth(token) })
    expect(events.json().items.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(['login', 'code_sent', 'staff_added', 'staff_disabled']))
  })

  it('десять неверных паролей запирают вход сотрудника', async () => {
    const owner = await member('OWNER')
    for (let i = 0; i < 10; i++) await app.inject({ method: 'POST', url: '/api/admin/auth/staff/login', payload: { nickname: owner.nick, password: `bad-${i}` } })
    const locked = await app.inject({ method: 'POST', url: '/api/admin/auth/staff/login', payload: { nickname: owner.nick, password: 'staff-pass-1' } })
    expect(locked.statusCode).toBe(429)
  })
})
