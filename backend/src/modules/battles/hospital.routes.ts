import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../shared/security/auth-middleware'
import { HospitalService } from './hospital.service'

/** Городская больница (травмпункт) и ЧМЦ: травмы после боёв на Стрелках. */
export async function hospitalRoutes(server: FastifyInstance) {
  server.get('/', { preHandler: authenticate }, req => HospitalService.status(req.authUser.userId))
  server.post('/treat', { preHandler: authenticate }, req => HospitalService.treat(req.authUser.userId))
  server.post('/clinic', { preHandler: authenticate }, req => HospitalService.clinic(req.authUser.userId))
}
