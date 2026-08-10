import type{FastifyInstance}from'fastify'
import{z}from'zod'
import{authenticate}from'../../shared/security/auth-middleware'
import{CharactersRepository}from'../characters/characters.repository'
import{AppError}from'../../shared/errors/app-error'
import{ErrorCode}from'../../shared/errors/error-codes'
import{MarketService}from'./market.service'
const Create=z.discriminatedUnion('listingType',[z.object({listingType:z.literal('ITEM'),itemInstanceId:z.string().uuid(),price:z.number().int().min(1).max(1_000_000)}),z.object({listingType:z.literal('RESOURCE'),resourceTemplateId:z.string().uuid(),amount:z.number().int().min(1).max(10_000),price:z.number().int().min(1).max(1_000_000)})])
const Query=z.object({page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(50).default(20),type:z.enum(['ITEM','RESOURCE']).optional(),mine:z.coerce.boolean().optional(),combat:z.enum(['MELEE','RANGED']).optional(),level:z.coerce.number().int().min(0).max(30).optional()})
export async function marketRoutes(fastify:FastifyInstance){const character=async(userId:string)=>{const c=await CharactersRepository.findByUserId(userId);if(!c)throw new AppError(ErrorCode.CHARACTER_NOT_FOUND,'Character not found',404);return c}
 fastify.get('/listings',{preHandler:authenticate},async(req,reply)=>{const p=Query.safeParse(req.query);const q=p.success?p.data:{page:1,limit:20};const c=q.mine?await character(req.authUser.userId):null;return reply.send(await MarketService.list({...q,sellerCharacterId:c?.id}))})
 fastify.post('/listings',{preHandler:authenticate},async(req,reply)=>{const p=Create.safeParse(req.body);if(!p.success)return reply.code(422).send({code:'GEN_001',message:'Validation error'});const key=req.headers['idempotency-key'];if(typeof key!=='string')return reply.code(400).send({code:ErrorCode.ECON_IDEMPOTENCY_REQUIRED,message:'Idempotency-Key is required'});const c=await character(req.authUser.userId);return reply.code(201).send(p.data.listingType==='ITEM'?await MarketService.createItem(c.id,p.data.itemInstanceId,p.data.price,key):await MarketService.createResource(c.id,p.data.resourceTemplateId,p.data.amount,p.data.price,key))})
 fastify.post<{Params:{listingId:string}}>('/listings/:listingId/buy',{preHandler:authenticate},async(req,reply)=>{const key=req.headers['idempotency-key'];if(typeof key!=='string')return reply.code(400).send({code:ErrorCode.ECON_IDEMPOTENCY_REQUIRED,message:'Idempotency-Key is required'});return reply.send(await MarketService.buy((await character(req.authUser.userId)).id,req.params.listingId,key))})
 fastify.post<{Params:{listingId:string}}>('/listings/:listingId/cancel',{preHandler:authenticate},async(req,reply)=>reply.send(await MarketService.cancel((await character(req.authUser.userId)).id,req.params.listingId)))
}
