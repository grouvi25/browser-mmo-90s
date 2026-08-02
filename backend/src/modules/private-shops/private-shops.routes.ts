import type{FastifyInstance}from'fastify'
import{z}from'zod'
import{authenticate}from'../../shared/security/auth-middleware'
import{CharactersRepository}from'../characters/characters.repository'
import{PrivateShopsService}from'./private-shops.service'
import{AppError}from'../../shared/errors/app-error'
import{ErrorCode}from'../../shared/errors/error-codes'
const Buy=z.object({privateShopItemId:z.string().uuid(),quantity:z.number().int().min(1).max(10).default(1)})
export async function privateShopsRoutes(fastify:FastifyInstance){
 fastify.get('/',{preHandler:authenticate},async(_r,reply)=>reply.send(await PrivateShopsService.listShops()))
 fastify.get<{Params:{shopCode:string}}>('/:shopCode/items',{preHandler:authenticate},async(req,reply)=>reply.send(await PrivateShopsService.listItems(req.params.shopCode)))
 fastify.post<{Params:{shopCode:string}}>('/:shopCode/buy',{preHandler:authenticate},async(req,reply)=>{const p=Buy.safeParse(req.body);if(!p.success)return reply.code(422).send({code:'GEN_001',message:'Validation error'});const key=req.headers['idempotency-key'];if(typeof key!=='string')return reply.code(400).send({code:'ECON_001',message:'Idempotency-Key is required'});const c=await CharactersRepository.findByUserId(req.authUser.userId);if(!c)throw new AppError(ErrorCode.CHARACTER_NOT_FOUND,'Character not found',404);return reply.send(await PrivateShopsService.buy(c.id,req.params.shopCode,p.data.privateShopItemId,p.data.quantity,key))})
}
