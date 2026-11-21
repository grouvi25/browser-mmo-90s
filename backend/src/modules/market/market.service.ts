import { assertCanList, type Currency } from './trader'
import { DollarsService } from '../dollars/dollars.service'
import { boundsError, craftPriceBounds } from './price-bounds'
import { listingItemDetail } from './listing-item-detail'
import type{Prisma}from'@prisma/client'
import{prisma}from'../../shared/db/prisma'
import{BalanceConfig}from'../../config/balance.config'
import{withIdempotency}from'../../shared/db/idempotency'
import{withTransaction}from'../../shared/db/transaction'
import{AppError}from'../../shared/errors/app-error'
import{ErrorCode}from'../../shared/errors/error-codes'
import{EconomyService}from'../economy/economy.service'
import{ResourcesService}from'../resources/resources.service'
import { calcListingFee, marketListingExpiresAt, marketPriceInRub } from './market.formulas'
import{auditSuspiciousPrice,recordMarketCancel,recordPairTrade}from'./market-abuse'
import{checkPairFlow,pairFlowToday}from'../antiabuse/antiabuse.limits'
import{marketClanRelation,marketPriceForRelation}from'../clans/clans-market'
import { canBuyPart, marketBuyerPrice, marketSaleAmounts, quoteMarketPurchase, type MarketPurchase } from './market-sale'
const MELEE=['MELEE','KNIFE','CLUB'] as const

/**
 * Доля Рынка: 30% рыночного налога уходит в общак клана-владельца района.
 *
 * Весь игровой рынок стоит в районе «Рынок» — отдельной привязки сделки к
 * району нет и не нужно. Деньги не создаются: доля берётся из уже собранного
 * налога, а не начисляется сверху, иначе владение районом печатало бы рубли.
 */
async function creditMarketShare(tx: Prisma.TransactionClient, clanId: string, share: number) {
  const clan = await tx.clan.update({
    where: { id: clanId }, data: { treasury: { increment: share } },
  })
  await tx.clanTreasuryLog.create({
    data: { clanId, amount: share, balanceAfter: clan.treasury, reason: 'TERRITORY_MARKET_SHARE' },
  })
}

/** Лимит активных лотов из баланса; 0 — без ограничения (лимит снят 10.11, вернуть можно из админки). */
async function assertListingRoom(tx:Prisma.TransactionClient,characterId:string){const limit=BalanceConfig.economy.market.maxActiveListings;if(limit>0&&await tx.marketListing.count({where:{sellerCharacterId:characterId,status:{in:['ACTIVE','LOCKED']}}})>=limit)throw new AppError(ErrorCode.MARKET_LIMIT,`Не больше ${limit} лотов одновременно`,409)}

export const MarketService={
 async list(params:{page:number;limit:number;type?:'ITEM'|'RESOURCE';sellerCharacterId?:string;viewerCharacterId?:string;combat?:'MELEE'|'RANGED';level?:number;search?:string;priceMin?:number;priceMax?:number;sort?:'NEWEST'|'PRICE_ASC'|'PRICE_DESC'}){
  const where={status:'ACTIVE' as const,expiresAt:{gt:new Date()},...(params.type?{type:params.type}:{}),...(params.sellerCharacterId?{sellerCharacterId:params.sellerCharacterId}:{}),...(params.priceMin!==undefined||params.priceMax!==undefined?{price:{...(params.priceMin!==undefined?{gte:params.priceMin}:{}),...(params.priceMax!==undefined?{lte:params.priceMax}:{})}}:{})}
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
  const relationRows=await Promise.all(listings.map(async x=>{const relation=params.viewerCharacterId?await marketClanRelation(prisma,params.viewerCharacterId,x.sellerCharacterId):'NEUTRAL';const finalPrice = params.viewerCharacterId && x.revision > 0 ? await marketBuyerPrice(prisma, x.id, params.viewerCharacterId, relation, x.price) : marketPriceForRelation(x.price, relation);return{relation,finalPrice,canBuyPart:canBuyPart(x)}}));return{items:listings.map((x,index)=>{const instance=x.itemInstanceId?byId.get(x.itemInstanceId):undefined;const resource=x.resourceTemplateId?resourcesById.get(x.resourceTemplateId):undefined;return{...x,...relationRows[index],sellerNickname:names.get(x.sellerCharacterId),sellerUrl:`/u/${names.get(x.sellerCharacterId)}`,item:instance?{name:instance.template.name,code:instance.template.code,type:instance.template.type,weaponType:instance.template.weaponType,levelReq:instance.template.levelReq,quality:instance.quality,detail:listingItemDetail(instance)}:null,resource:resource?{name:resource.name,code:resource.code,tier:resource.tier}:null}}),total,page:params.page,limit:params.limit,totalPages:Math.ceil(total/params.limit)}
 },
 async createItem(characterId:string,itemInstanceId:string,price:number,key:string,currency:Currency='RUB'){return withIdempotency({characterId,scope:'market.listings.create',key,execute:async tx=>{await assertCanList(tx,characterId,'ITEM',currency);await assertListingRoom(tx,characterId);const item=await tx.itemInstance.findUnique({where:{id:itemInstanceId},include:{template:true}});if(!item||item.ownerId!==characterId)throw new AppError(ErrorCode.ITEM_NOT_OWNED,'Not your item',403);if(item.isEquipped||item.status!=='NORMAL'||!item.template.isTradeable)throw new AppError(ErrorCode.MARKET_ITEM_INVALID,'Item cannot be listed',409);const fee=calcListingFee(marketPriceInRub(price,currency));const newBalance=fee>0?await EconomyService.debit(tx,{characterId,amount:fee,reasonCode:'MARKET_LISTING_TAX',refType:'market_listing'}):(await tx.character.findUniqueOrThrow({where:{id:characterId},select:{money:true}})).money;const listing=await tx.marketListing.create({data:{sellerCharacterId:characterId,type:'ITEM',itemInstanceId,price,currency,listingFee:fee,expiresAt:marketListingExpiresAt()}});await tx.itemInstance.update({where:{id:item.id},data:{status:'ON_MARKET'}});await tx.itemLog.create({data:{itemId:item.id,characterId,actionCode:'LISTED_ON_MARKET',details:{listingId:listing.id,price,fee}}});auditSuspiciousPrice({characterId,listingId:listing.id,price,referencePrice:item.template.priceBase});return{listing,newBalance}}})},
 async createResource(characterId:string,resourceTemplateId:string,amount:number,price:number,key:string,currency:Currency='RUB'){return withIdempotency({characterId,scope:'market.listings.create',key,execute:async tx=>{await assertCanList(tx,characterId,'RESOURCE',currency);await assertListingRoom(tx,characterId);const resource=await tx.resourceTemplate.findUnique({where:{id:resourceTemplateId}});if(!resource?.isTradable||!resource.isActive)throw new AppError(ErrorCode.MARKET_RESOURCE_INVALID,'Resource cannot be listed',409);const bounds=await craftPriceBounds(tx,resourceTemplateId);const outOfBounds=bounds&&boundsError(resource.name,bounds,(marketPriceInRub(price,currency))/amount);if(outOfBounds)throw new AppError(ErrorCode.VALIDATION_ERROR,outOfBounds,422,bounds);await ResourcesService.reserve(tx,characterId,resourceTemplateId,amount);const fee=calcListingFee(marketPriceInRub(price,currency));const newBalance=fee>0?await EconomyService.debit(tx,{characterId,amount:fee,reasonCode:'MARKET_LISTING_TAX',refType:'market_listing'}):(await tx.character.findUniqueOrThrow({where:{id:characterId},select:{money:true}})).money;const listing=await tx.marketListing.create({data:{sellerCharacterId:characterId,type:'RESOURCE',resourceTemplateId,resourceAmount:amount,price,currency,listingFee:fee,expiresAt:marketListingExpiresAt()}});await tx.resourceLog.create({data:{characterId,resourceTemplateId,amountDelta:0,balanceAfter:(await tx.resourceStack.findUniqueOrThrow({where:{characterId_resourceTemplateId:{characterId,resourceTemplateId}}})).amount,reasonCode:'MARKET_LIST',refType:'market_listing',refId:listing.id}});auditSuspiciousPrice({characterId,listingId:listing.id,price,referencePrice:resource.basePrice*amount});return{listing,newBalance}}})},
 async quote(buyerId: string, listingId: string, amount?: number) {
  return withTransaction(async tx => {
   const { listing, finalPrice, amount: quantity } = await quoteMarketPurchase(tx, buyerId, listingId, amount)
   return { amount: quantity, available: listing.resourceAmount ?? 1, revision: listing.revision, currency: listing.currency, finalPrice }
  })
 },

 async buy(buyerId: string, listingId: string, key: string, purchase?: MarketPurchase) {
  const result = await withIdempotency({ characterId: buyerId, scope: 'market.listings.buy', key, execute: async tx => {
   const quote = await quoteMarketPurchase(tx, buyerId, listingId, purchase?.amount, purchase?.revision)
   const { listing, amount, basePrice, finalPrice, relation, remainingAmount } = quote
   if (purchase && purchase.finalPrice !== finalPrice) {
    throw new AppError(ErrorCode.MARKET_UNAVAILABLE, 'Количество или цена изменились. Проверьте лот ещё раз', 409)
   }
   const sellerId = listing.sellerCharacterId
   const pairFlow = await pairFlowToday(tx, buyerId, sellerId)
   const verdict = checkPairFlow(pairFlow, marketPriceInRub(basePrice, listing.currency), listing.type === 'ITEM')
   if (!verdict.allowed) {
    const message = verdict.reason === 'MONEY_CAP'
     ? `Суточный предел между двумя аккаунтами: ${verdict.moneyCap} ₽`
     : `Суточный предел между двумя аккаунтами: ${verdict.itemsCap} предметов`
    throw new AppError(ErrorCode.MARKET_PAIR_LIMIT, message, 409, { money: verdict.money, items: verdict.items })
   }
   const accounting = await marketSaleAmounts(tx, quote)
   const { sellerGross, sellerTaxRate, sellerTax, ecoExpRate, ecoExp, payout, tax, marketClanId, marketShareRate, marketShare } = accounting
   const soldAt = new Date()
   const status = remainingAmount ? 'ACTIVE' : 'SOLD'
   const changed = await tx.marketListing.updateMany({
    where: { id: listingId, status: 'ACTIVE', revision: listing.revision, expiresAt: { gt: soldAt } },
    data: {
     revision: { increment: 1 },
     ...(remainingAmount
      ? { resourceAmount: remainingAmount, price: listing.price - basePrice }
      : { status: 'SOLD', buyerCharacterId: buyerId, soldAt, saleTax: tax }),
    },
   })
   if (changed.count !== 1) throw new AppError(ErrorCode.MARKET_ALREADY_PROCESSED, 'Лот изменился или уже продан', 409)
   const sale = await tx.marketSale.create({
    data: {
     listingId, sellerCharacterId: sellerId, buyerCharacterId: buyerId, type: listing.type,
     amount, basePrice, currency: listing.currency, finalPrice, relation, sellerGross, sellerTaxRate,
     ecoExpRate, tax, payout, marketClanId, marketShareRate, soldAt,
    },
   })
   const reference = listing.type === 'ITEM'
    ? { refType: 'market_listing', refId: listingId }
    : { refType: 'market_sale', refId: sale.id }
   let buyerBalance: number
   if (listing.currency === 'USD') {
    buyerBalance = finalPrice > 0
     ? await DollarsService.debit(tx, { characterId: buyerId, amount: finalPrice, reason: 'PURCHASE', counterpartyId: sellerId, refId: reference.refId, note: 'Покупка на рынке' })
     : (await tx.character.findUniqueOrThrow({ where: { id: buyerId }, select: { dollars: true } })).dollars
    if (sellerGross > 0) await DollarsService.credit(tx, { characterId: sellerId, amount: sellerGross, reason: 'MARKET_SALE', counterpartyId: buyerId, refId: reference.refId })
    if (sellerTax > 0) await DollarsService.debit(tx, { characterId: sellerId, amount: sellerTax, reason: 'MARKET_TAX', refId: reference.refId })
   } else {
    buyerBalance = finalPrice > 0
     ? await EconomyService.debit(tx, { characterId: buyerId, amount: finalPrice, reasonCode: 'MARKET_BUY', ...reference })
     : (await tx.character.findUniqueOrThrow({ where: { id: buyerId }, select: { money: true } })).money
    if (sellerGross > 0) await EconomyService.credit(tx, { characterId: sellerId, amount: sellerGross, reasonCode: 'MARKET_SELL', ...reference })
    if (sellerTax > 0) await EconomyService.debit(tx, { characterId: sellerId, amount: sellerTax, reasonCode: 'MARKET_SELL_TAX', ...reference })
    if (ecoExp > 0) await EconomyService.grantEconomicExp(tx, sellerId, ecoExp)
   }
   let what: string
   if (listing.type === 'ITEM' && listing.itemInstanceId) {
    const itemId = listing.itemInstanceId
    const item = await tx.itemInstance.update({
     where: { id: itemId }, data: { ownerId: buyerId, status: 'NORMAL', isEquipped: false },
     select: { template: { select: { name: true } } },
    })
    await tx.itemLog.createMany({ data: [
     { itemId, characterId: sellerId, actionCode: 'MARKET_SOLD', details: { listingId, buyerId } },
     { itemId, characterId: buyerId, actionCode: 'MARKET_BOUGHT', details: { listingId, sellerCharacterId: sellerId } },
    ] })
    what = item.template.name
   } else if (listing.resourceTemplateId) {
    const resourceTemplateId = listing.resourceTemplateId
    await ResourcesService.release(tx, sellerId, resourceTemplateId, amount)
    await ResourcesService.consume(tx, { characterId: sellerId, resourceTemplateId, amount, reasonCode: 'MARKET_SELL', ...reference })
    await ResourcesService.add(tx, { characterId: buyerId, resourceTemplateId, amount, reasonCode: 'MARKET_BUY', ...reference })
    const resource = await tx.resourceTemplate.findUniqueOrThrow({ where: { id: resourceTemplateId }, select: { name: true } })
    what = amount > 1 ? `${resource.name} ×${amount}` : resource.name
   } else {
    throw new AppError(ErrorCode.MARKET_UNAVAILABLE, 'Лот больше недоступен', 409)
   }
   const buyer = await tx.character.findUniqueOrThrow({ where: { id: buyerId }, select: { nickname: true } })
   const unit = listing.currency === 'USD' ? '$' : '₽'
   await tx.gameNotice.create({ data: {
    characterId: sellerId,
    text: (`Ваш лот «${what}» купил ${buyer.nickname} за ${finalPrice.toLocaleString('ru-RU')} ${unit}, на руки ${payout.toLocaleString('ru-RU')} ${unit} после налога.`
      + (remainingAmount ? ` В лоте осталось ${remainingAmount} шт.` : '')).slice(0, 300),
   } })
   if (marketClanId && marketShare > 0) await creditMarketShare(tx, marketClanId, marketShare)
   return { listingId, saleId: sale.id, sellerId, status, amount, remainingAmount, buyerBalance, payout, finalPrice, relation, tax, what, currency: listing.currency }
  } })
  if (!result.replayed) void recordPairTrade(result.sellerId, buyerId, listingId).catch(() => undefined)
  return result
 },
 /**
  * Правка цены своего лота (обращение №40). Сбор за выставление берётся с самой
  * высокой цены, что была у лота: подняли цену — доплатили разницу сбора,
  * снизили — сбор не возвращается, как и при снятии.
  */
 async updatePrice(characterId:string,listingId:string,price:number){return withTransaction(async tx=>{
  const listing=await tx.marketListing.findUnique({where:{id:listingId}})
  if(!listing||listing.sellerCharacterId!==characterId)throw new AppError(ErrorCode.MARKET_NOT_OWNER,'Лот не найден',404)
  if(listing.status!=='ACTIVE')throw new AppError(ErrorCode.MARKET_ALREADY_PROCESSED,'Лот уже продан или снят',409)
  if(listing.price===price)return{listing,feeCharged:0,newBalance:null}
  if(listing.resourceTemplateId){const bounds=await craftPriceBounds(tx,listing.resourceTemplateId);const name=(await tx.resourceTemplate.findUnique({where:{id:listing.resourceTemplateId},select:{name:true}}))?.name??'';const outOfBounds=bounds&&boundsError(name,bounds,(marketPriceInRub(price,listing.currency))/(listing.resourceAmount??1));if(outOfBounds)throw new AppError(ErrorCode.VALIDATION_ERROR,outOfBounds,422,bounds)}
  const sold = await tx.marketSale.aggregate({where:{listingId},_sum:{basePrice:true}})
  const fee=calcListingFee(marketPriceInRub(price+(sold._sum.basePrice??0),listing.currency))
  const extra=Math.max(0,fee-listing.listingFee)
  const changed=await tx.marketListing.updateMany({where:{id:listingId,sellerCharacterId:characterId,status:'ACTIVE',expiresAt:{gt:new Date()},revision:listing.revision},data:{price,revision:{increment:1},listingFee:Math.max(fee,listing.listingFee)}})
  if(changed.count!==1)throw new AppError(ErrorCode.MARKET_ALREADY_PROCESSED,'Лот уже продан или снят',409)
  const newBalance=extra>0?await EconomyService.debit(tx,{characterId,amount:extra,reasonCode:'MARKET_LISTING_TAX',refType:'market_listing',refId:listingId}):null
  if(listing.itemInstanceId)await tx.itemLog.create({data:{itemId:listing.itemInstanceId,characterId,actionCode:'LISTED_ON_MARKET',details:{listingId,price,oldPrice:listing.price,fee:extra,reason:'PRICE_CHANGED'}}})
  const reference=listing.itemInstanceId?(await tx.itemInstance.findUnique({where:{id:listing.itemInstanceId},include:{template:true}}))?.template.priceBase
   :((await tx.resourceTemplate.findUnique({where:{id:listing.resourceTemplateId??''}}))?.basePrice??0)*(listing.resourceAmount??1)
  auditSuspiciousPrice({characterId,listingId,price,referencePrice:reference??0})
  return{listing:{...listing,price,listingFee:Math.max(fee,listing.listingFee),revision:listing.revision+1},feeCharged:extra,newBalance}
 })},
 async cancel(characterId:string,listingId:string){return withTransaction(async tx=>{const listing=await tx.marketListing.findUnique({where:{id:listingId}});if(!listing||listing.sellerCharacterId!==characterId)throw new AppError(ErrorCode.MARKET_NOT_OWNER,'Listing not found',404);const changed=await tx.marketListing.updateMany({where:{id:listingId,sellerCharacterId:characterId,status:'ACTIVE',revision:listing.revision},data:{status:'CANCELLED',revision:{increment:1}}});if(changed.count!==1)throw new AppError(ErrorCode.MARKET_ALREADY_PROCESSED,'Listing cannot be cancelled',409);if(listing.itemInstanceId){await tx.itemInstance.updateMany({where:{id:listing.itemInstanceId,status:'ON_MARKET'},data:{status:'NORMAL'}});await tx.itemLog.create({data:{itemId:listing.itemInstanceId,characterId,actionCode:'MARKET_LISTING_CANCELLED',details:{listingId,reason:'CANCELLED_BY_OWNER'}}})}if(listing.resourceTemplateId&&listing.resourceAmount){const stack=await ResourcesService.release(tx,characterId,listing.resourceTemplateId,listing.resourceAmount);await tx.resourceLog.create({data:{characterId,resourceTemplateId:listing.resourceTemplateId,amountDelta:0,balanceAfter:stack.amount,reasonCode:'MARKET_LIST',refType:'market_listing',refId:listingId}})}void recordMarketCancel(characterId,listingId).catch(()=>undefined);return{listingId,status:'CANCELLED'}})}
}
