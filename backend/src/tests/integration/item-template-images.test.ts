/**
 * Картинка вещи из админки (Дима 09.11: «хочу оружие добавлять, а фото крепить
 * нельзя»). Загружает каталог, отдаётся всем без входа, замена меняет версию.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../app'
import { storeAdminSession } from '../../shared/security/jwt'
import { cleanDatabase, testPrisma, uid } from './helpers'

let app: FastifyInstance
beforeAll(async () => { app = await buildApp(); await app.ready() })
afterAll(async () => { await app.close(); await testPrisma.$disconnect() })
beforeEach(async () => { await cleanDatabase(); await testPrisma.itemTemplateImage.deleteMany() })

async function adminHeaders(role: 'SUPER_ADMIN' | 'SUPPORT') {
  const jti = randomUUID()
  const admin = await testPrisma.adminUser.create({ data: { username: uid('adm'), passwordHash: 'x', role } })
  await storeAdminSession(jti, admin.id)
  return { authorization: `Bearer ${app.jwt.sign({ role: 'admin', adminId: admin.id, jti })}` }
}

// Прозрачный PNG 1×1.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

describe('картинка вещи из админки', () => {
  it('каталог загружает и меняет, игра видит версию и картинку без входа, сброс убирает', async () => {
    const template = await testPrisma.itemTemplate.create({ data: { code: uid('gun'), name: 'Наган', type: 'WEAPON', weight: 1, durabilityMax: 100, priceBase: 100, sourceType: 'GOVERNMENT' } })
    const headers = await adminHeaders('SUPER_ADMIN')
    const url = `/api/admin/catalog/item/${template.code}/image`

    const first = await app.inject({ method: 'PUT', url, headers, payload: { dataUrl: PNG } })
    expect(first.statusCode).toBe(200)
    expect(first.json()).toMatchObject({ code: template.code, version: 1 })
    const second = await app.inject({ method: 'PUT', url, headers, payload: { dataUrl: PNG } })
    expect(second.json().version).toBe(2)

    const list = await app.inject({ url: '/api/inventory/template-images' })
    expect(list.json()).toMatchObject({ [template.code]: 2 })
    const image = await app.inject({ url: `/api/inventory/template-images/${template.code}` })
    expect(image.statusCode).toBe(200)
    expect(image.headers['content-type']).toBe('image/png')
    expect(image.rawPayload.length).toBeGreaterThan(50)

    expect((await app.inject({ method: 'DELETE', url, headers })).statusCode).toBe(200)
    expect((await app.inject({ url: '/api/inventory/template-images' })).json()).toEqual({})
  })

  it('без права каталога нельзя, не картинка и несуществующая вещь — отказ', async () => {
    const template = await testPrisma.itemTemplate.create({ data: { code: uid('gun'), name: 'Наган', type: 'WEAPON', weight: 1, durabilityMax: 100, priceBase: 100, sourceType: 'GOVERNMENT' } })
    const support = await adminHeaders('SUPPORT')
    expect((await app.inject({ method: 'PUT', url: `/api/admin/catalog/item/${template.code}/image`, headers: support, payload: { dataUrl: PNG } })).statusCode).toBe(403)
    const headers = await adminHeaders('SUPER_ADMIN')
    expect((await app.inject({ method: 'PUT', url: `/api/admin/catalog/item/${template.code}/image`, headers, payload: { dataUrl: 'data:text/html;base64,PGgxPg==' } })).statusCode).toBe(422)
    expect((await app.inject({ method: 'PUT', url: '/api/admin/catalog/item/net_takoy/image', headers, payload: { dataUrl: PNG } })).statusCode).toBe(404)
  })
})
