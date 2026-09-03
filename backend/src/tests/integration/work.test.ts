import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanDatabase, testPrisma, uid } from './helpers'
import { getRedis, disconnectRedis } from '../../shared/db/redis'
import { WorkService } from '../../modules/work/work.service'
import { runWorkShiftFinalize } from '../../workers/work-shift-finalize.worker'

async function fixture(pl=0){
 const login=uid('work');const user=await testPrisma.user.create({data:{login,email:`${login}@test.local`,passwordHash:'x'}})
 const character=await testPrisma.character.create({data:{userId:user.id,nickname:login,archetype:'WORKER',hpCurrent:80,hpMax:80,money:100,productionLevel:pl}})
 const resource=await testPrisma.resourceTemplate.create({data:{code:uid('scrap'),name:'Scrap',category:'PRIMARY',tier:1,basePrice:8,weight:.5}})
 const object=await testPrisma.productionObject.create({data:{code:uid('obj'),name:'Scrapyard',type:'SCRAPYARD',requiredProductionLevel:0,requiredProfessionCode:'scrap_collector',requiredProfessionLevel:0,shiftDurationMinutes:30,baseSalary:80,baseProductionExp:10,producesResourceCode:resource.code,outputAmountMin:2,outputAmountMax:4}})
 return{character,object,resource}
}

async function addEquipmentAndTool(characterId:string,objectId:string,usesLeft=2){
 const equipment=await testPrisma.productionEquipment.upsert({where:{productionObjectId:objectId},update:{isActive:true},create:{productionObjectId:objectId,code:uid('equip'),name:'Sorter',tier:1,requiredToolTier:1}})
 const template=await testPrisma.itemTemplate.create({data:{code:uid('tool'),name:'Work kit',type:'TOOL',toolTier:1,usesMax:usesLeft,weight:1,durabilityMax:1,priceBase:500,isEquippable:false}})
 const tool=await testPrisma.itemInstance.create({data:{templateId:template.id,ownerId:characterId,quality:'COMMON',durabilityCurrent:1,durabilityMax:1,weight:1,sourceType:'GOVERNMENT',usesLeft}})
 return{equipment,template,tool}
}

describe('WorkService E2',()=>{
 beforeAll(async()=>{await testPrisma.$connect();await getRedis().ping()})
 beforeEach(async()=>{await cleanDatabase();await getRedis().flushdb()})
 afterAll(async()=>{await testPrisma.$disconnect();await disconnectRedis()})
 it('starts one shift and locks character to WORKING',async()=>{const{character,object}=await fixture();const r=await WorkService.start(character.id,object.id);expect(r.shift.status).toBe('ACTIVE');expect(r.shift.endsAt.getTime()-r.shift.startedAt.getTime()).toBe(30*60_000);expect((await testPrisma.character.findUniqueOrThrow({where:{id:character.id}})).status).toBe('WORKING');expect((await WorkService.current(character.id)).shift?.id).toBe(r.shift.id);await expect(WorkService.start(character.id,object.id)).rejects.toMatchObject({statusCode:400})})
 it('opens a second-stage object by the previous stage, not by itself',async()=>{const{character}=await fixture();const foundry=await testPrisma.productionObject.create({data:{code:uid('foundry'),name:'Foundry',type:'WORKSHOP',requiredProductionLevel:1,requiredProfessionCode:'foundry_worker',requiredProfessionLevel:1,shiftDurationMinutes:60,baseSalary:160,baseProductionExp:15}});await expect(WorkService.start(character.id,foundry.id)).rejects.toMatchObject({statusCode:400});await testPrisma.characterProfession.create({data:{characterId:character.id,professionCode:'scrap_collector',exp:500,level:1}});const started=await WorkService.start(character.id,foundry.id);expect(started.shift.professionCode).toBe('foundry_worker');const listed=await WorkService.listObjects(character.id);const view=listed.items.find(item=>item.id===foundry.id);expect(view?.admission?.professionCode).toBe('scrap_collector');expect(view?.locked).toBe(false)})
 it('rejects PL-locked object and busy character',async()=>{const{character,object}=await fixture();await testPrisma.productionObject.update({where:{id:object.id},data:{requiredProfessionLevel:3}});await expect(WorkService.start(character.id,object.id)).rejects.toMatchObject({statusCode:400});expect(await testPrisma.characterProfession.count({where:{characterId:character.id}})).toBe(0);await testPrisma.character.update({where:{id:character.id},data:{status:'IN_BATTLE'}});await testPrisma.productionObject.update({where:{id:object.id},data:{requiredProfessionLevel:0}});await expect(WorkService.start(character.id,object.id)).rejects.toMatchObject({statusCode:400})})
 it('finalizes, claims salary, PL exp, resources and logs once',async()=>{const{character,object}=await fixture();const started=await WorkService.start(character.id,object.id);await testPrisma.workShift.update({where:{id:started.shift.id},data:{endsAt:new Date(Date.now()-1000)}});expect(await runWorkShiftFinalize()).toBe(1);const claimed=await WorkService.claim(character.id,started.shift.id,'work-claim-key-0001');expect(claimed.salary).toBeGreaterThanOrEqual(72);expect(claimed.salary).toBeLessThanOrEqual(240);expect(claimed.professionCode).toBe('scrap_collector');expect(claimed.professionExpGain).toBe(10);expect((await testPrisma.characterProfession.findUniqueOrThrow({where:{characterId_professionCode:{characterId:character.id,professionCode:'scrap_collector'}}})).exp).toBe(10);expect(await testPrisma.characterProfession.count({where:{characterId:character.id,professionCode:{not:'scrap_collector'}}})).toBe(0);expect(claimed.resourceReward?.amount).toBeGreaterThanOrEqual(2);expect((await testPrisma.character.findUniqueOrThrow({where:{id:character.id}})).status).toBe('ACTIVE');expect(await testPrisma.currencyLog.count({where:{characterId:character.id,reasonCode:'WORK_SALARY'}})).toBe(1);expect(await testPrisma.resourceLog.count({where:{characterId:character.id,reasonCode:'WORK_REWARD'}})).toBe(1);const replay=await WorkService.claim(character.id,started.shift.id,'work-claim-key-0001');expect(replay.replayed).toBe(true);expect(await testPrisma.currencyLog.count({where:{characterId:character.id,reasonCode:'WORK_SALARY'}})).toBe(1)})
 it('rejects early claim and cancels without reward',async()=>{const{character,object}=await fixture();const started=await WorkService.start(character.id,object.id);await expect(WorkService.claim(character.id,started.shift.id,'work-claim-key-0002')).rejects.toMatchObject({statusCode:400});expect((await WorkService.cancel(character.id,started.shift.id)).cancelled).toBe(true);expect(await testPrisma.currencyLog.count({where:{characterId:character.id}})).toBe(0);expect((await testPrisma.workShift.findUniqueOrThrow({where:{id:started.shift.id}})).status).toBe('CANCELLED')})
 it('keeps profession XP isolated between different jobs',async()=>{const{character,object}=await fixture();const second=await testPrisma.productionObject.create({data:{code:uid('supplier'),name:'Warehouse',type:'WAREHOUSE',requiredProfessionCode:'supplier',requiredProfessionLevel:0,shiftDurationMinutes:30,baseSalary:100,baseProductionExp:8}});const first=await WorkService.start(character.id,object.id);await testPrisma.workShift.update({where:{id:first.shift.id},data:{endsAt:new Date(Date.now()-1000)}});await runWorkShiftFinalize();await WorkService.claim(character.id,first.shift.id,'profession-isolation-one');const other=await WorkService.start(character.id,second.id);await testPrisma.workShift.update({where:{id:other.shift.id},data:{endsAt:new Date(Date.now()-1000)}});await runWorkShiftFinalize();await WorkService.claim(character.id,other.shift.id,'profession-isolation-two');const professions=await testPrisma.characterProfession.findMany({where:{characterId:character.id}});expect(professions.find(x=>x.professionCode==='scrap_collector')?.exp).toBe(10);expect(professions.find(x=>x.professionCode==='supplier')?.exp).toBe(8)})
 it('keeps the UTC day budget after Redis is flushed',async()=>{const{character,object}=await fixture();for(let i=0;i<12;i++){const s=await WorkService.start(character.id,object.id);await WorkService.cancel(character.id,s.shift.id);if(i===3)await getRedis().flushdb()}const daily=(await WorkService.current(character.id)).daily;expect(daily.shiftsUsedToday).toBe(12);expect(daily.minutesUsedToday).toBe(360);await expect(WorkService.start(character.id,object.id)).rejects.toMatchObject({statusCode:400})})
 it('stops on minutes before the shift count on long shifts',async()=>{const{character,object}=await fixture();await testPrisma.productionObject.update({where:{id:object.id},data:{shiftDurationMinutes:90}});for(let i=0;i<4;i++){const s=await WorkService.start(character.id,object.id);await WorkService.cancel(character.id,s.shift.id)}const daily=(await WorkService.current(character.id)).daily;expect(daily.shiftsUsedToday).toBe(4);expect(daily.minutesUsedToday).toBe(360);await expect(WorkService.start(character.id,object.id)).rejects.toMatchObject({statusCode:400})})
 it('requires the equipment tool and exposes availability',async()=>{const{character,object}=await fixture();await testPrisma.productionEquipment.create({data:{productionObjectId:object.id,code:uid('equip'),name:'Sorter',tier:1,requiredToolTier:1}});const listed=await WorkService.listObjects(character.id);expect(listed.items[0].toolAvailable).toBe(false);await expect(WorkService.start(character.id,object.id)).rejects.toMatchObject({code:'WORK_011'});await addEquipmentAndTool(character.id,object.id);const refreshed=await WorkService.listObjects(character.id);expect(refreshed.items[0].toolAvailable).toBe(true)})
 it('allows only one concurrent start to reserve the character and tool',async()=>{const{character,object}=await fixture();const{tool}=await addEquipmentAndTool(character.id,object.id,2);const attempts=await Promise.allSettled([WorkService.start(character.id,object.id),WorkService.start(character.id,object.id)]);expect(attempts.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(attempts.filter(x=>x.status==='rejected')).toHaveLength(1);expect(await testPrisma.workShift.count({where:{characterId:character.id,status:'ACTIVE'}})).toBe(1);expect((await testPrisma.itemInstance.findUniqueOrThrow({where:{id:tool.id}})).status).toBe('LOCKED')})
 it('reserves a tool, restores it on cancel and consumes exactly one use on idempotent claim',async()=>{const{character,object}=await fixture();const{tool}=await addEquipmentAndTool(character.id,object.id,2);const cancelled=await WorkService.start(character.id,object.id);expect((await testPrisma.itemInstance.findUniqueOrThrow({where:{id:tool.id}})).status).toBe('LOCKED');await WorkService.cancel(character.id,cancelled.shift.id);expect((await testPrisma.itemInstance.findUniqueOrThrow({where:{id:tool.id}})).status).toBe('NORMAL');expect((await testPrisma.itemInstance.findUniqueOrThrow({where:{id:tool.id}})).usesLeft).toBe(2);const started=await WorkService.start(character.id,object.id);await testPrisma.workShift.update({where:{id:started.shift.id},data:{endsAt:new Date(Date.now()-1000)}});await runWorkShiftFinalize();const claimed=await WorkService.claim(character.id,started.shift.id,'tool-claim-once');expect(claimed.toolUse?.usesLeft).toBe(1);const replay=await WorkService.claim(character.id,started.shift.id,'tool-claim-once');expect(replay.replayed).toBe(true);const saved=await testPrisma.itemInstance.findUniqueOrThrow({where:{id:tool.id}});expect(saved.usesLeft).toBe(1);expect(saved.status).toBe('NORMAL');expect(await testPrisma.itemLog.count({where:{itemId:tool.id,actionCode:'TOOL_USE'}})).toBe(1)})

 it('подписка действительно даёт больше смен, а не только больший потолок', async () => {
  // Дефект, найденный сквозным прогоном Этапа 5: потолок смен поднимался до
  // шестнадцати, а fitsDailyBudget проверял бюджет с настройками по
  // умолчанию — двенадцать смен и 360 минут. Подписчик работал ровно
  // столько же, сколько бесплатный игрок, при заявленных шестнадцати сменах.
  const { character, object } = await fixture()
  const view = await WorkService.listObjects(character.id)
  expect(view.daily.shiftsLimit).toBe(12)
  expect(view.daily.minutesLimit).toBe(360)

  await testPrisma.character.update({
   where: { id: character.id },
   data: { isPremium: true, premiumExpiresAt: new Date(Date.now() + 30 * 24 * 3_600_000) },
  })
  const premiumView = await WorkService.listObjects(character.id)
  expect(premiumView.daily.shiftsLimit).toBe(16)
  // Бюджет минут растёт пропорционально: иначе шестнадцать смен по полчаса
  // не влезают в 360 минут и потолок остаётся мёртвым.
  expect(premiumView.daily.minutesLimit).toBe(480)

  // И тринадцатая смена действительно начинается.
  const day = new Date(); day.setUTCHours(0, 0, 0, 0)
  for (let i = 0; i < 12; i++) {
   await testPrisma.workShift.create({ data: {
    characterId: character.id, productionObjectId: object.id,
    professionCode: object.requiredProfessionCode, status: 'CLAIMED',
    startedAt: new Date(day.getTime() + i * 60_000),
    endsAt: new Date(day.getTime() + i * 60_000 + 30 * 60_000),
    baseSalary: object.baseSalary,
   } })
  }
  await expect(WorkService.start(character.id, object.id)).resolves.toBeTruthy()
 })

})
