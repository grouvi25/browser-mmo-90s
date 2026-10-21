import type{FastifyInstance}from'fastify'
import{z}from'zod'
import{authenticate}from'../../shared/security/auth-middleware'
import{CharactersRepository}from'../characters/characters.repository'
import{AppError}from'../../shared/errors/app-error'
import{ErrorCode}from'../../shared/errors/error-codes'
import{MarketService}from'./market.service'
import{TraderService}from'./trader'
const Create=z.discriminatedUnion('listingType',[z.object({listingType:z.literal('ITEM'),itemInstanceId:z.string().uuid(),price:z.number().int().min(1).max(1_000_000),currency:z.enum(['RUB','USD']).default('RUB')}),z.object({listingType:z.literal('RESOURCE'),resourceTemplateId:z.string().uuid(),amount:z.number().int().min(1).max(10_000),price:z.number().int().min(1).max(1_000_000),currency:z.enum(['RUB','USD']).default('RUB')})])
const Query=z.object({page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(50).default(20),type:z.enum(['ITEM','RESOURCE']).optional(),mine:z.coerce.boolean().optional(),combat:z.enum(['MELEE','RANGED']).optional(),level:z.coerce.number().int().min(0).max(30).optional(),search:z.string().trim().min(2).max(50).optional(),priceMin:z.coerce.number().int().min(1).max(1_000_000).optional(),priceMax:z.coerce.number().int().min(1).max(1_000_000).optional(),sort:z.enum(['NEWEST','PRICE_ASC','PRICE_DESC']).default('NEWEST')})
export async function marketRoutes(fastify:FastifyInstance){const character=async(userId:string)=>{const c=await CharactersRepository.findByUserId(userId);if(!c)throw new AppError(ErrorCode.CHARACTER_NOT_FOUND,'Персонаж не найден',404);return c}
 fastify.get('/listings',{preHandler:authenticate},async(req,reply)=>{const p=Query.safeParse(req.query);if(!p.success)return reply.code(422).send({code:'GEN_001',message:'Validation error'});const q=p.data;const c=await character(req.authUser.userId);// Общий рынок — только ресурсы (правка 21.10); вещи — в магазинах торгашей и в «моих лотах».
return reply.send(await MarketService.list({...q,type:q.type??(q.mine?undefined:'RESOURCE'),sellerCharacterId:q.mine?c.id:undefined,viewerCharacterId:c.id}))})
 fastify.post('/listings',{preHandler:authenticate},async(req,reply)=>{const p=Create.safeParse(req.body);if(!p.success)return reply.code(422).send({code:'GEN_001',message:'Validation error'});const key=req.headers['idempotency-key'];if(typeof key!=='string')return reply.code(400).send({code:ErrorCode.ECON_IDEMPOTENCY_REQUIRED,message:'Idempotency-Key is required'});const c=await character(req.authUser.userId);return reply.code(201).send(p.data.listingType==='ITEM'?await MarketService.createItem(c.id,p.data.itemInstanceId,p.data.price,key,p.data.currency):await MarketService.createResource(c.id,p.data.resourceTemplateId,p.data.amount,p.data.price,key,p.data.currency))})
 fastify.post<{Params:{listingId:string}}>('/listings/:listingId/buy',{preHandler:authenticate},async(req,reply)=>{const key=req.headers['idempotency-key'];if(typeof key!=='string')return reply.code(400).send({code:ErrorCode.ECON_IDEMPOTENCY_REQUIRED,message:'Idempotency-Key is required'});return reply.send(await MarketService.buy((await character(req.authUser.userId)).id,req.params.listingId,key))})
 fastify.post<{Params:{listingId:string}}>('/listings/:listingId/cancel',{preHandler:authenticate},async(req,reply)=>reply.send(await MarketService.cancel((await character(req.authUser.userId)).id,req.params.listingId)))

 // Торгаш и магазины (правка 21.10)
 fastify.get('/trader',{preHandler:authenticate},async(req,reply)=>reply.send(await TraderService.status((await character(req.authUser.userId)).id)))
 fastify.post<{Body:{level:number}}>('/trader',{preHandler:authenticate},async(req,reply)=>{const p=z.object({level:z.union([z.literal(1),z.literal(2)])}).safeParse(req.body);if(!p.success)return reply.code(422).send({code:'GEN_001',message:'Уровень Торгаша: 1 или 2'});return reply.send(await TraderService.buyLevel((await character(req.authUser.userId)).id,p.data.level))})
 fastify.get('/shops',{preHandler:authenticate},async(_req,reply)=>reply.send({items:await TraderService.directory()}))
 fastify.get<{Params:{number:string}}>('/shops/:number',{preHandler:authenticate},async(req,reply)=>{const n=Number(req.params.number);if(!Number.isInteger(n)||n<1)return reply.code(422).send({code:'GEN_001',message:'Номер магазина — число'});const owner=await TraderService.shop(n);const c=await character(req.authUser.userId);return reply.send({owner,listings:await MarketService.list({page:1,limit:50,sellerCharacterId:owner.id,viewerCharacterId:c.id,sort:'NEWEST'})})})
}
