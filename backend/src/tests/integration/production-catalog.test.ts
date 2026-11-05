/**
 * Справочник «как сделать»: цепочка книги читается от изделия до добычи, а бывшие
 * цехи в него не попадают. Без авторизации закрыт.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../app'
import { storeSession } from '../../shared/security/jwt'
import { seedEconomyTable } from '../../../prisma/seed-economy-table'
import { TABLE_RECIPES } from '../../../prisma/economy-table'
import { cleanDatabase, testPrisma, uid } from './helpers'

let app: FastifyInstance
beforeAll(async () => { await testPrisma.$connect(); app = await buildApp(); await app.ready() })
beforeEach(async () => { await cleanDatabase(); await seedEconomyTable(testPrisma) })
afterAll(async () => { await app.close(); await testPrisma.$disconnect() })

async function player(professions: string[] = []) {
  const login = uid('cat')
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  const character = await testPrisma.character.create({ data: { userId: user.id, nickname: login.slice(0, 20), archetype: 'STREET', hpCurrent: 80, hpMax: 80 } })
  for (const professionCode of professions) await testPrisma.characterProfession.create({ data: { characterId: character.id, professionCode } })
  const jti = randomUUID()
  await storeSession(jti, user.id)
  return { authorization: `Bearer ${app.jwt.sign({ sub: user.id, jti })}` }
}

type Product = {
  code: string; name: string; kind: string; ways: { objectCode: string; gather: boolean; forSaleUsd: number | null; labor: number; professionName: string; professionKnown: boolean; toolName: string | null; inputs: { code: string; amount: number }[] }[]
  usedIn: { code: string }[]
}
const catalog = async (headers: Record<string, string>) => {
  const res = await app.inject({ method: 'GET', url: '/api/production/catalog', headers })
  expect(res.statusCode).toBe(200)
  return res.json().items as Product[]
}

describe('Справочник «как сделать»', () => {
  it('изделие: завод, цена, профессия, инструмент, состав', async () => {
    const items = await catalog(await player(['tailor']))
    const vest = items.find(item => item.code === 'tb_item_c09')!
    expect(vest.name).toBe('Бронежилет')
    expect(vest.kind).toBe('item')
    expect(vest.ways).toHaveLength(1)
    expect(vest.ways[0]).toMatchObject({ objectCode: 'obj_tb_armor_shop', gather: false, forSaleUsd: 15_000, labor: 10_500, professionName: 'Портной', professionKnown: true, toolName: 'Швейный набор' })
    expect(vest.ways[0].inputs.length).toBeGreaterThan(0)
  })

  it('любой компонент любого изделия находится в справочнике, цепочка доходит до добычи', async () => {
    const items = await catalog(await player())
    const byCode = new Map(items.map(item => [item.code, item]))
    const reachesGather = (code: string, seen = new Set<string>()): boolean => {
      if (seen.has(code)) return false
      seen.add(code)
      const product = byCode.get(code)
      if (!product) return false
      return product.ways.some(way => way.gather || way.inputs.every(input => reachesGather(input.code, new Set(seen))))
    }
    for (const recipe of TABLE_RECIPES) {
      const output = (recipe.resource ?? recipe.item)!
      expect(reachesGather(output), output).toBe(true)
    }
    const iron = byCode.get('tb_iron_ore')!
    expect(iron.ways.some(way => way.gather)).toBe(true)
    expect(iron.usedIn.map(next => next.code)).toContain('tb_steel_blank')
  })

  it('профессии нет: помечено, а бывшие цехи в справочник не попадают', async () => {
    const items = await catalog(await player())
    const vest = items.find(item => item.code === 'tb_item_c09')!
    expect(vest.ways[0].professionKnown).toBe(false)
    const places = new Set(items.flatMap(item => item.ways.map(way => way.objectCode)))
    for (const gone of ['obj_tb_clothes', 'obj_tb_weaving', 'obj_tb_rune_1']) expect(places.has(gone)).toBe(false)
  })

  it('без входа закрыт', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/production/catalog' })).statusCode).toBe(401)
  })
})
