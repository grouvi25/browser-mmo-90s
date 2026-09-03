import type{Prisma}from'@prisma/client'
import{prisma}from'../../shared/db/prisma'
import{withIdempotency}from'../../shared/db/idempotency'
import{withTransaction}from'../../shared/db/transaction'
import{AppError}from'../../shared/errors/app-error'
import{ErrorCode}from'../../shared/errors/error-codes'
import{EconomyService}from'../economy/economy.service'
import{ResourcesService}from'../resources/resources.service'
import{calcListingFee,calcMarketSellerEcoExp,calcSaleTax,marketListingExpiresAt}from'./market.formulas'
import{auditSuspiciousPrice,recordMarketCancel,recordPairTrade}from'./market-abuse'
import{marketClanRelation,marketPriceForRelation}from'../clans/clans-market'
import{isBonusSuspended}from'../territories/territories.formulas'
const MELEE=['MELEE','KNIFE','CLUB'] as const

/**
 * Доля Рынка: 30% рыночного налога уходит в общак клана-владельца района.
 *
 * Весь игровой рынок стоит в районе «Рынок» — отдельной привязки сделки к
 * району нет и не нужно. Деньги не создаются: доля берётся из уже собранного
 * налога, а не начисляется сверху, иначе владение районом печатало бы рубли.
 */
async function creditMarketShare(tx: Prisma.TransactionClient, totalTax: number) {
  if (totalTax <= 0) return
  const market = await tx.territory.findUnique({
    where: { code: 'market' },
    select: { ownerClanId: true, status: true, bonusCode: true, bonusValue: true, upkeepDebt: true },
  })
  if (!market?.ownerClanId || market.status !== 'CONTROLLED') return
  if (market.bonusCode !== 'MARKET_SHARE') return
  if (isBonusSuspended(market.upkeepDebt)) return
  const share = Math.floor(totalTax * market.bonusValue)
  if (share <= 0) return
  const clan = await tx.clan.update({
    where: { id: market.ownerClanId },
    data: { treasury: { increment: share } },
  })
  await tx.clanTreasuryLog.create({
    data: {
      clanId: clan.id, amount: share, balanceAfter: clan.treasury,
      reason: 'TERRITORY_MARKET_SHARE',
    },
  })
}

export const MarketService={
 async list(params:{page:number;limit:number;type?:'ITEM'|'RESOURCE';sellerCharacterId?:string;viewerCharacterId?:string;combat?:'MELEE'|'RANGED';level?:number;search?:string;priceMin?:number;priceMax?:number;sort?:'NEWEST'|'PRICE_ASC'|'PRICE_DESC'}){
  const where={status:'ACTIVE' as const,...(params.type?{type:params.type}:{}),...(params.sellerCharacterId?{sellerCharacterId:params.sellerCharacterId}:{}),...(params.priceMin!==undefined||params.priceMax!==undefined?{price:{...(params.priceMin!==undefined?{gte:params.priceMin}:{}),...(params.priceMax!==undefined?{lte:params.priceMax}:{})}}:{})}
  let listings=await prisma.marketListing.findMany({where,orderBy:[{createdAt:'desc'},{id:'asc'}]})
  const itemIds=listings.flatMap(x=>x.itemInstanceId?[x.itemInstanceId]:[])
  const resourceIds=listings.flatMap(x=>x.resourceTemplateId?[x.resourceTemplateId]:[])
  const [instances,resources]=await Promise.all([
   prisma.itemInstance.findMany({where:{id:{in:itemIds}},include:{template:true}}),
   prisma.resourceTemplate.findMany({where:{id:{in:resourceIds}}}),
  ])
  const byId=new Map(instances.map(x=>[x.id,x]))
  const resourcesById=new Map(resources.map(x=>[x.id,x]))
  const search=params.search?.trim().toLocaleLowerCase('ru')
  if(params.combat||params.level!==undefined||search)listings=listings.filter(x=>{
   const item=x.itemInstanceId?byId.get(x.itemInstanceId):undefined
   const resource=x.resourceTemplateId?resourcesById.get(x.resourceTemplateId):undefined
   if(params.level!==undefined&&item?.template.levelReq!==params.level)return false
   if(params.combat){if(!item||item.template.type!=='WEAPON')return false;const melee=MELEE.includes(item.template.weaponType as typeof MELEE[number]);if(params.combat==='MELEE'?!melee:melee)return false}
   if(search){const haystack=[item?.template.name,item?.template.code,resource?.name,resource?.code].filter(Boolean).join(' ').toLocaleLowerCase('ru');if(!haystack.includes(search))return false}
   return true
  })
  if(params.sort==='PRICE_ASC')listings.sort((a,b)=>a.price-b.price||a.id.localeCompare(b.id))
  else if(params.sort==='PRICE_DESC')listings.sort((a,b)=>b.price-a.price||a.id.localeCompare(b.id))
  const total=listings.length
  listings=listings.slice((params.page-1)*params.limit,params.page*params.limit)
  const sellers=await prisma.character.findMany({where:{id:{in:[...new Set(listings.map(x=>x.sellerCharacterId))]}},select:{id:true,nickname:true}})
  const names=new Map(sellers.map(x=>[x.id,x.nickname]))
  const relationRows=await Promise.all(listings.map(async x=>{const relation=params.viewerCharacterId?await marketClanRelation(prisma,params.viewerCharacterId,x.sellerCharacterId):'NEUTRAL';return{relation,finalPrice:marketPriceForRelation(x.price,relation)}}));return{items:listings.map((x,index)=>{const instance=x.itemInstanceId?byId.get(x.itemInstanceId):undefined;const resource=x.resourceTemplateId?resourcesById.get(x.resourceTemplateId):undefined;return{...x,...relationRows[index],sellerNickname:names.get(x.sellerCharacterId),sellerUrl:`/u/${names.get(x.sellerCharacterId)}`,item:instance?{name:instance.template.name,code:instance.template.code,type:instance.template.type,weaponType:instance.template.weaponType,levelReq:instance.template.levelReq,quality:instance.quality}:null,resource:resource?{name:resource.name,code:resource.code,tier:resource.tier}:null}}),total,page:params.page,limit:params.limit,totalPages:Math.ceil(total/params.limit)}
 },
 async createItem(characterId:string,itemInstanceId:string,price:number,key:string){return withIdempotency({characterId,scope:'market.listings.create',key,execute:async tx=>{if(await tx.marketListing.count({where:{sellerCharacterId:characterId,status:{in:['ACTIVE','LOCKED']}}})>=10)throw new AppError(ErrorCode.MARKET_LIMIT,'Maximum 10 active listings',409);const item=await tx.itemInstance.findUnique({where:{id:itemInstanceId},include:{template:true}});if(!item||item.ownerId!==characterId)throw new AppError(ErrorCode.ITEM_NOT_OWNED,'Not your item',403);if(item.isEquipped||item.status!=='NORMAL'||!item.template.isTradeable)throw new AppError(ErrorCode.MARKET_ITEM_INVALID,'Item cannot be listed',409);const fee=calcListingFee(price);const newBalance=await EconomyService.debit(tx,{characterId,amount:fee,reasonCode:'MARKET_LISTING_TAX',refType:'market_listing'});const listing=await tx.marketListing.create({data:{sellerCharacterId:characterId,type:'ITEM',itemInstanceId,price,listingFee:fee,expiresAt:marketListingExpiresAt()}});await tx.itemInstance.update({where:{id:item.id},data:{status:'ON_MARKET'}});await tx.itemLog.create({data:{itemId:item.id,characterId,actionCode:'LISTED_ON_MARKET',details:{listingId:listing.id,price,fee}}});auditSuspiciousPrice({characterId,listingId:listing.id,price,referencePrice:item.template.priceBase});return{listing,newBalance}}})},
 async createResource(characterId:string,resourceTemplateId:string,amount:number,price:number,key:string){return withIdempotency({characterId,scope:'market.listings.create',key,execute:async tx=>{if(await tx.marketListing.count({where:{sellerCharacterId:characterId,status:{in:['ACTIVE','LOCKED']}}})>=10)throw new AppError(ErrorCode.MARKET_LIMIT,'Maximum 10 active listings',409);const resource=await tx.resourceTemplate.findUnique({where:{id:resourceTemplateId}});if(!resource?.isTradable||!resource.isActive)throw new AppError(ErrorCode.MARKET_RESOURCE_INVALID,'Resource cannot be listed',409);await ResourcesService.reserve(tx,characterId,resourceTemplateId,amount);const fee=calcListingFee(price);const newBalance=await EconomyService.debit(tx,{characterId,amount:fee,reasonCode:'MARKET_LISTING_TAX',refType:'market_listing'});const listing=await tx.marketListing.create({data:{sellerCharacterId:characterId,type:'RESOURCE',resourceTemplateId,resourceAmount:amount,price,listingFee:fee,expiresAt:marketListingExpiresAt()}});await tx.resourceLog.create({data:{characterId,resourceTemplateId,amountDelta:0,balanceAfter:(await tx.resourceStack.findUniqueOrThrow({where:{characterId_resourceTemplateId:{characterId,resourceTemplateId}}})).amount,reasonCode:'MARKET_LIST',refType:'market_listing',refId:listing.id}});auditSuspiciousPrice({characterId,listingId:listing.id,price,referencePrice:resource.basePrice*amount});return{listing,newBalance}}})},
 async buy(buyerId:string,listingId:string,key:string){return withIdempotency({characterId:buyerId,scope:'market.listings.buy',key,execute:async tx=>{const listing=await tx.marketListing.findUnique({where:{id:listingId}});if(!listing||listing.status!=='ACTIVE')throw new AppError(ErrorCode.MARKET_UNAVAILABLE,'Listing is unavailable',409);if(listing.sellerCharacterId===buyerId)throw new AppError(ErrorCode.MARKET_OWN_LISTING,'Cannot buy own listing',403);const relation=await marketClanRelation(tx,buyerId,listing.sellerCharacterId);const finalPrice=marketPriceForRelation(listing.price,relation);const sellerGross=relation==='ENEMY'?listing.price:finalPrice;const sellerTax=calcSaleTax(sellerGross);const payout=sellerGross-sellerTax;const totalTax=finalPrice-payout;const claimed=await tx.marketListing.updateMany({where:{id:listingId,status:'ACTIVE'},data:{status:'SOLD',buyerCharacterId:buyerId,soldAt:new Date(),saleTax:totalTax}});if(claimed.count!==1)throw new AppError(ErrorCode.MARKET_ALREADY_PROCESSED,'Listing already processed',409);const buyerBalance=await EconomyService.debit(tx,{characterId:buyerId,amount:finalPrice,reasonCode:'MARKET_BUY',refType:'market_listing',refId:listing.id});await EconomyService.credit(tx,{characterId:listing.sellerCharacterId,amount:sellerGross,reasonCode:'MARKET_SELL',refType:'market_listing',refId:listing.id});await EconomyService.debit(tx,{characterId:listing.sellerCharacterId,amount:sellerTax,reasonCode:'MARKET_SELL_TAX',refType:'market_listing',refId:listing.id});await EconomyService.grantEconomicExp(tx,listing.sellerCharacterId,calcMarketSellerEcoExp(sellerGross));if(listing.type==='ITEM'&&listing.itemInstanceId){await tx.itemInstance.update({where:{id:listing.itemInstanceId},data:{ownerId:buyerId,status:'NORMAL',isEquipped:false}});await tx.itemLog.create({data:{itemId:listing.itemInstanceId,characterId:listing.sellerCharacterId,actionCode:'MARKET_SOLD',details:{listingId,buyerId}}});await tx.itemLog.create({data:{itemId:listing.itemInstanceId,characterId:buyerId,actionCode:'MARKET_BOUGHT',details:{listingId,sellerCharacterId:listing.sellerCharacterId}}})}else if(listing.resourceTemplateId&&listing.resourceAmount){await ResourcesService.release(tx,listing.sellerCharacterId,listing.resourceTemplateId,listing.resourceAmount);await ResourcesService.consume(tx,{characterId:listing.sellerCharacterId,resourceTemplateId:listing.resourceTemplateId,amount:listing.resourceAmount,reasonCode:'MARKET_SELL',refType:'market_listing',refId:listing.id});await ResourcesService.add(tx,{characterId:buyerId,resourceTemplateId:listing.resourceTemplateId,amount:listing.resourceAmount,reasonCode:'MARKET_BUY',refType:'market_listing',refId:listing.id})}await creditMarketShare(tx,totalTax);void recordPairTrade(listing.sellerCharacterId,buyerId,listing.id).catch(()=>undefined);return{listingId,status:'SOLD',buyerBalance,payout,finalPrice,relation,tax:totalTax}}})},
 async cancel(characterId:string,listingId:string){return withTransaction(async tx=>{const listing=await tx.marketListing.findUnique({where:{id:listingId}});if(!listing||listing.sellerCharacterId!==characterId)throw new AppError(ErrorCode.MARKET_NOT_OWNER,'Listing not found',404);const changed=await tx.marketListing.updateMany({where:{id:listingId,sellerCharacterId:characterId,status:'ACTIVE'},data:{status:'CANCELLED'}});if(changed.count!==1)throw new AppError(ErrorCode.MARKET_ALREADY_PROCESSED,'Listing cannot be cancelled',409);if(listing.itemInstanceId){await tx.itemInstance.updateMany({where:{id:listing.itemInstanceId,status:'ON_MARKET'},data:{status:'NORMAL'}});await tx.itemLog.create({data:{itemId:listing.itemInstanceId,characterId,actionCode:'MARKET_LISTING_CANCELLED',details:{listingId,reason:'CANCELLED_BY_OWNER'}}})}if(listing.resourceTemplateId&&listing.resourceAmount){const stack=await ResourcesService.release(tx,characterId,listing.resourceTemplateId,listing.resourceAmount);await tx.resourceLog.create({data:{characterId,resourceTemplateId:listing.resourceTemplateId,amountDelta:0,balanceAfter:stack.amount,reasonCode:'MARKET_LIST',refType:'market_listing',refId:listingId}})}void recordMarketCancel(characterId,listingId).catch(()=>undefined);return{listingId,status:'CANCELLED'}})}
}
