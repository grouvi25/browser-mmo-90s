/**
 * Вход и регистрация по нику (правка Дмитрия 29.10: «везде по нику, ник
 * и пароль»). Старые аккаунты входят и по прежнему логину или почте.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanDatabase, testPrisma, uid } from './helpers'
import { getRedis, disconnectRedis } from '../../shared/db/redis'
import { AuthService } from '../../modules/auth/auth.service'
import { CharactersService } from '../../modules/characters/characters.service'
import { PasswordResetService } from '../../modules/auth/password-reset.service'
import { EconomyService } from '../../modules/economy/economy.service'
import { BalanceConfig } from '../../config/balance.config'
import { prisma } from '../../shared/db/prisma'

const policy = { acceptPolicy: true as const }

describe('Вход по нику', () => {
  beforeAll(async () => { await testPrisma.$connect(); await getRedis().ping() })
  beforeEach(async () => { await cleanDatabase(); await getRedis().flushdb() })
  afterAll(async () => { await testPrisma.$disconnect(); await disconnectRedis() })

  it('регистрация по нику: ник — имя для входа, персонаж получает его и 5 000 ₽', async () => {
    const reg = await AuthService.register({ nickname: '  Вася   Пупкин ', email: `${uid('n')}@test.local`, password: 'secret12', ...policy })
    expect(reg.login).toBe('Вася Пупкин')

    const char = await CharactersService.create(reg.id, { archetype: 'STREET' })
    expect(char).toMatchObject({ nickname: 'Вася Пупкин', money: 5000 })
    expect(BalanceConfig.character.startMoney).toBe(5000)

    const byNick = await AuthService.login({ login: 'вася пупкин', password: 'secret12' })
    expect(byNick.userId).toBe(reg.id)
  })

  it('ник занят — чужим персонажем или чужим логином, без учёта регистра', async () => {
    const old = await AuthService.register({ login: 'oldboy', email: `${uid('o')}@test.local`, password: 'secret12', ...policy })
    await CharactersService.create(old.id, { nickname: 'Старик', archetype: 'STREET' })
    await expect(AuthService.register({ nickname: 'старик', email: `${uid('a')}@test.local`, password: 'secret12', ...policy })).rejects.toMatchObject({ statusCode: 409 })
    await expect(AuthService.register({ nickname: 'OldBoy', email: `${uid('b')}@test.local`, password: 'secret12', ...policy })).rejects.toMatchObject({ statusCode: 409 })

    const fresh = await AuthService.register({ login: 'freshman', email: `${uid('c')}@test.local`, password: 'secret12', ...policy })
    await expect(CharactersService.create(fresh.id, { nickname: 'СТАРИК', archetype: 'STREET' })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('старый аккаунт входит по логину, нику и почте', async () => {
    const email = `${uid('m')}@test.local`
    const old = await AuthService.register({ login: 'legacy_user', email, password: 'secret12', ...policy })
    await CharactersService.create(old.id, { nickname: 'Легаси', archetype: 'STREET' })
    for (const name of ['legacy_user', 'Легаси', email.toUpperCase()]) {
      expect((await AuthService.login({ login: name, password: 'secret12' })).userId).toBe(old.id)
    }
    await expect(AuthService.login({ login: 'Легаси', password: 'wrong' })).rejects.toMatchObject({ statusCode: 401 })
    await expect(AuthService.login({ login: 'никто', password: 'secret12' })).rejects.toMatchObject({ statusCode: 401 })
  })

  it('чужой логин совпал с ником — каждый входит своим паролем', async () => {
    // Старый игрок с логином «Ivan», новый — с ником «ivan» у другого логина.
    const a = await AuthService.register({ login: 'Ivan', email: `${uid('i')}@test.local`, password: 'password-a', ...policy })
    const b = await AuthService.register({ login: 'bob_old', email: `${uid('j')}@test.local`, password: 'password-b', ...policy })
    await prisma.character.create({ data: { userId: b.id, nickname: 'ivan', archetype: 'STREET', hpCurrent: 100, hpMax: 100 } })
    expect((await AuthService.login({ login: 'Ivan', password: 'password-a' })).userId).toBe(a.id)
    expect((await AuthService.login({ login: 'ivan', password: 'password-b' })).userId).toBe(b.id)
  })

  it('десять неверных паролей к нику закрывают вход в любом регистре', async () => {
    const reg = await AuthService.register({ nickname: 'Замок', email: `${uid('z')}@test.local`, password: 'secret12', ...policy })
    for (let i = 0; i < 10; i++) await AuthService.login({ login: i % 2 ? 'замок' : 'ЗАМОК', password: 'bad' }).catch(() => undefined)
    await expect(AuthService.login({ login: 'Замок', password: 'secret12' })).rejects.toMatchObject({ statusCode: 429 })
    void reg
  })

  it('восстановление пароля находит аккаунт по нику', async () => {
    const reg = await AuthService.register({ nickname: 'Забывашка', email: `${uid('f')}@test.local`, password: 'secret12', ...policy })
    await PasswordResetService.request('забывашка')
    expect(await testPrisma.passwordReset.count({ where: { userId: reg.id } })).toBe(1)
  })

  it('новый экономический уровень — уведомление с премией', async () => {
    const reg = await AuthService.register({ nickname: 'Барыга', email: `${uid('e')}@test.local`, password: 'secret12', ...policy })
    const char = await CharactersService.create(reg.id, { archetype: 'STREET' })
    const result = await prisma.$transaction(tx => EconomyService.grantEconomicExp(tx, char.id, BalanceConfig.economicExp.levelThresholds[1]))
    expect(result.levelsGained).toBe(1)
    const notice = await testPrisma.gameNotice.findFirstOrThrow({ where: { characterId: char.id } })
    expect(notice.text).toBe(`Новый экономический уровень 1: +1 к силе, +${result.levelMoney.toLocaleString('ru-RU')} ₽.`)
  })
})
