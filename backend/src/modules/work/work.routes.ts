import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../shared/security/auth-middleware'
import { CharactersRepository } from '../characters/characters.repository'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { WorkService } from './work.service'
const Id=z.string().uuid()
export async function workRoutes(fastify: FastifyInstance): Promise<void> {
  const char=async(userId:string)=>{const c=await CharactersRepository.findByUserId(userId);if(!c)throw new AppError(ErrorCode.CHARACTER_NOT_FOUND,'Character not found',404);return c}
  fastify.get('/objects',{preHandler:authenticate},async(req,reply)=>reply.send(await WorkService.listObjects((await char(req.authUser.userId)).id)))
  fastify.get('/shifts/current',{preHandler:authenticate},async(req,reply)=>reply.send(await WorkService.current((await char(req.authUser.userId)).id)))
  fastify.post('/shifts/start',{preHandler:authenticate},async(req,reply)=>{const p=z.object({productionObjectId:Id}).safeParse(req.body);if(!p.success)return reply.code(422).send({code:'GEN_001',message:'Validation error'});return reply.code(201).send(await WorkService.start((await char(req.authUser.userId)).id,p.data.productionObjectId))})
  fastify.post<{Params:{shiftId:string}}>('/shifts/:shiftId/claim',{preHandler:authenticate},async(req,reply)=>{if(!Id.safeParse(req.params.shiftId).success)return reply.code(422).send({code:'GEN_001',message:'Validation error'});const key=req.headers['idempotency-key'];if(typeof key!=='string')return reply.code(400).send({code:'ECON_001',message:'Idempotency-Key is required'});return reply.send(await WorkService.claim((await char(req.authUser.userId)).id,req.params.shiftId,key))})
  fastify.post<{Params:{shiftId:string}}>('/shifts/:shiftId/cancel',{preHandler:authenticate},async(req,reply)=>reply.send(await WorkService.cancel((await char(req.authUser.userId)).id,req.params.shiftId)))
}
