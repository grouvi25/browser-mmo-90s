import type{FastifyInstance}from'fastify'
import{z}from'zod'
import{authenticate}from'../../shared/security/auth-middleware'
import{CharactersRepository}from'../characters/characters.repository'
import{AppError}from'../../shared/errors/app-error'
import{ErrorCode}from'../../shared/errors/error-codes'
import{UpgradesService}from'./upgrades.service'
const Input=z.object({itemInstanceId:z.string().uuid(),upgradeType:z.enum(['DAMAGE','ACCURACY','CRIT','ARMOR','DURABILITY','ANTI_CRIT'])})
export async function upgradesRoutes(fastify:FastifyInstance){const char=async(id:string)=>{const c=await CharactersRepository.findByUserId(id);if(!c)throw new AppError(ErrorCode.CHARACTER_NOT_FOUND,'Character not found',404);return c}
 fastify.get('/items',{preHandler:authenticate},async(req,reply)=>reply.send(await UpgradesService.items((await char(req.authUser.userId)).id)))
 fastify.post('/preview',{preHandler:authenticate},async(req,reply)=>{const p=Input.safeParse(req.body);if(!p.success)return reply.code(422).send({code:'GEN_001',message:'Validation error'});return reply.send(await UpgradesService.preview((await char(req.authUser.userId)).id,p.data.itemInstanceId,p.data.upgradeType))})
 fastify.post('/commit',{preHandler:authenticate},async(req,reply)=>{const p=Input.safeParse(req.body);if(!p.success)return reply.code(422).send({code:'GEN_001',message:'Validation error'});const key=req.headers['idempotency-key'];if(typeof key!=='string')return reply.code(400).send({code:'ECON_001',message:'Idempotency-Key is required'});return reply.send(await UpgradesService.commit((await char(req.authUser.userId)).id,p.data.itemInstanceId,p.data.upgradeType,key))})
}
