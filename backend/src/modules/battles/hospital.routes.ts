import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../shared/security/auth-middleware'
import { HospitalService } from './hospital.service'
import { AmbushService } from './ambush.service'

/** Городская больница (травмпункт, реанимация) и ЧМЦ: травмы v8. */
export async function hospitalRoutes(server: FastifyInstance) {
  server.get('/', { preHandler: authenticate }, req => HospitalService.status(req.authUser.userId))
  server.post('/treat', { preHandler: authenticate }, req => HospitalService.treat(req.authUser.userId))
  server.post('/clinic', { preHandler: authenticate }, req => HospitalService.clinic(req.authUser.userId))
  server.post('/shorten', { preHandler: authenticate }, req => {
    const { channel } = z.object({ channel: z.enum(['SELF', 'CLINIC']) }).parse(req.body)
    return HospitalService.shorten(req.authUser.userId, channel)
  })
  server.post('/aid', { preHandler: authenticate }, req => {
    const { patientId } = z.object({ patientId: z.string().uuid() }).parse(req.body)
    return HospitalService.brigadeAid(req.authUser.userId, patientId)
  })
}

/** Карманы, подпольная лавка и засада: травмы v8, раздел 12. */
export async function ambushRoutes(server: FastifyInstance) {
  server.get('/pockets', { preHandler: authenticate }, req => AmbushService.pockets(req.authUser.userId))
  server.post('/binoculars', { preHandler: authenticate }, req => AmbushService.buyBinoculars(req.authUser.userId))
  server.post('/', { preHandler: authenticate }, req => {
    const { targetId } = z.object({ targetId: z.string().uuid() }).parse(req.body)
    return AmbushService.ambush(req.authUser.userId, targetId)
  })
}
