import { prisma } from '../shared/db/prisma'
import { pushLater } from '../modules/push/push.service'
export async function runWorkShiftFinalize(): Promise<number> {
  const due = await prisma.workShift.findMany({ where: { status: 'ACTIVE', endsAt: { lte: new Date() } }, take: 200, include: { productionObject: { select: { name: true } } } })
  let finalized=0
  for(const shift of due){
    const result=await prisma.$transaction(async tx=>{
      const changed=await tx.workShift.updateMany({where:{id:shift.id,status:'ACTIVE'},data:{status:'READY_TO_CLAIM'}})
      if(changed.count!==1)return false
      await tx.character.updateMany({where:{id:shift.characterId,status:'WORKING'},data:{status:'ACTIVE'}})
      await tx.productionLog.create({data:{characterId:shift.characterId,productionObjectId:shift.productionObjectId,eventType:'SHIFT_READY',metadataJson:{shiftId:shift.id}}})
      return true
    })
    if(result){
      finalized++
      // Пуш: смена закончилась (заказчик 06.11). Смены помощника хозяину не пишем, их забирают сами.
      if(!shift.helperId)pushLater(shift.characterId,{title:shift.craftRecipeId?'Изделие готово':'Смена закончилась',body:`«${shift.productionObject.name}»: заберите ${shift.craftRecipeId?'изделие':'награду'} на экране работы`,url:'/work',kind:'work'})
    }
  }
  return finalized
}
export const WORK_SHIFT_FINALIZE_MS=30_000
