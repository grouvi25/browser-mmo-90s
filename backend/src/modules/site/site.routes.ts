import type { FastifyInstance } from 'fastify'
import { requireAdminRole } from '../../shared/security/auth-middleware'
import { prisma } from '../../shared/db/prisma'
import { SiteService } from './site.service'

/** Окно при входе для игроков — /api/site/welcome. Открыто без входа: текст общий. */
export async function siteRoutes(fastify: FastifyInstance) {
  fastify.get('/welcome', async () => {
    const welcome = await SiteService.welcome()
    return { welcome: welcome?.enabled ? welcome : null }
  })
}

const SITE_ADMIN = { preHandler: requireAdminRole('SUPER_ADMIN', 'MODERATOR') }

/** Правка окна в админке — /api/admin/site/welcome. */
export async function adminSiteRoutes(fastify: FastifyInstance) {
  fastify.get('/welcome', SITE_ADMIN, async () => ({ welcome: await SiteService.welcome() }))

  fastify.put('/welcome', SITE_ADMIN, async req => {
    const admin = await prisma.adminUser.findUnique({ where: { id: req.adminUser.adminId }, select: { username: true } })
    return { welcome: await SiteService.saveWelcome(req.body, admin?.username ?? 'admin') }
  })
}
