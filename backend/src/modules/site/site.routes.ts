import type { FastifyInstance } from 'fastify'
import { BalanceConfig } from '../../config/balance.config'
import { requirePermission } from '../../shared/security/auth-middleware'
import { SiteService } from './site.service'

/** Окно при входе для игроков — /api/site/welcome. Открыто без входа: текст общий. */
export async function siteRoutes(fastify: FastifyInstance) {
  fastify.get('/welcome', async () => {
    const welcome = await SiteService.welcome()
    return { welcome: welcome?.enabled ? welcome : null }
  })

  // Числа для главной страницы: она открыта без входа, а стартовые деньги
  // меняются в админке. В тексте главной они уже однажды разошлись с игрой.
  fastify.get('/facts', async () => ({ startMoney: BalanceConfig.character.startMoney }))
}

const SITE_ADMIN = { preHandler: requirePermission('content') }

/** Правка окна в админке — /api/admin/site/welcome. */
export async function adminSiteRoutes(fastify: FastifyInstance) {
  fastify.get('/welcome', SITE_ADMIN, async () => ({ welcome: await SiteService.welcome() }))

  fastify.put('/welcome', SITE_ADMIN, async req => {
    return { welcome: await SiteService.saveWelcome(req.body, req.adminUser.label) }
  })
}
