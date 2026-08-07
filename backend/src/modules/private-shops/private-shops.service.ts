import { prisma } from '../../shared/db/prisma'
import { withIdempotency } from '../../shared/db/idempotency'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { EconomyService } from '../economy/economy.service'
import { ResourcesService } from '../resources/resources.service'

export const PrivateShopsService={
 async listShops(){return[{code:'kommersant',name:'Коммерсант'},{code:'armory_garage',name:'Оружейный гараж'}]},
 async listItems(shopCode:string){
  const entries=await prisma.privateShopItem.findMany({where:{shopCode,isActive:true},orderBy:{price:'asc'}})
  return Promise.all(entries.map(async entry=>{
   const itemTemplate=entry.itemTemplateId?await prisma.itemTemplate.findUnique({where:{id:entry.itemTemplateId}}):null
   const resourceTemplate=entry.resourceTemplateId?await prisma.resourceTemplate.findUnique({where:{id:entry.resourceTemplateId}}):null
   return{...entry,kind:itemTemplate?'ITEM':'RESOURCE',name:itemTemplate?.name??resourceTemplate?.name??'Unknown',code:itemTemplate?.code??resourceTemplate?.code,itemTier:itemTemplate?.itemTier??resourceTemplate?.tier??1,levelReq:itemTemplate?.levelReq??0}
  }))
 },
 async buy(characterId:string,shopCode:string,privateShopItemId:string,quantity:number,key:string){
  return withIdempotency({characterId,scope:'private-shop.buy',key,execute:async tx=>{
   const [character,entry]=await Promise.all([tx.character.findUniqueOrThrow({where:{id:characterId}}),tx.privateShopItem.findFirst({where:{id:privateShopItemId,shopCode,isActive:true}})])
   if(!entry)throw new AppError(ErrorCode.CONFLICT,'Shop item unavailable',404)
   const profession=entry.minProfessionCode?await tx.characterProfession.findUnique({where:{characterId_professionCode:{characterId,professionCode:entry.minProfessionCode}}}):null
   if(character.battleLevel<entry.minBattleLevel||character.economicLevel<entry.minEconomicLevel||(entry.minProfessionCode&&(profession?.level??0)<entry.minProfessionLevel))throw new AppError(ErrorCode.CONFLICT,'Requirements not met',403)
   if(entry.stockMode==='LIMITED'){
    const changed=await tx.privateShopItem.updateMany({where:{id:entry.id,stockAmount:{gte:quantity}},data:{stockAmount:{decrement:quantity}}})
    if(changed.count!==1)throw new AppError(ErrorCode.CONFLICT,'Out of stock',409)
   }
   const total=entry.price*quantity
   const newBalance=await EconomyService.debit(tx,{characterId,amount:total,reasonCode:'PRIVATE_SHOP_BUY',refType:'private_shop',refId:entry.id})
   const itemIds:string[]=[]
   if(entry.itemTemplateId){
    const template=await tx.itemTemplate.findUniqueOrThrow({where:{id:entry.itemTemplateId}})
    for(let i=0;i<quantity;i++){const item=await tx.itemInstance.create({data:{templateId:template.id,ownerId:characterId,quality:template.qualityBase,durabilityCurrent:template.durabilityMax,durabilityMax:template.durabilityMax,weight:template.weight,sourceType:'PRIVATE',freePoints:template.allocationMode==='PLAYER'?template.statBudget:0}});itemIds.push(item.id);await tx.itemLog.create({data:{itemId:item.id,characterId,actionCode:'CREATED_FROM_PRIVATE_SHOP',details:{shopCode,price:entry.price}}})}
   }else if(entry.resourceTemplateId){await ResourcesService.add(tx,{characterId,resourceTemplateId:entry.resourceTemplateId,amount:quantity,reasonCode:'PRIVATE_SHOP_BUY',refType:'private_shop',refId:entry.id})}
   return{privateShopItemId,quantity,total,newBalance,itemIds}
  }})
 }
}
