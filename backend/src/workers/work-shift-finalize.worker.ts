import { prisma } from '../shared/db/prisma'
export async function runWorkShiftFinalize(): Promise<number> {
  const due = await prisma.workShift.findMany({ where: { status: 'ACTIVE', endsAt: { lte: new Date() } }, take: 200 })
  let finalized=0
  for(const shift of due){
    const result=await prisma.$transaction(async tx=>{
      const changed=await tx.workShift.updateMany({where:{id:shift.id,status:'ACTIVE'},data:{status:'READY_TO_CLAIM'}})
      if(changed.count!==1)return false
      await tx.character.updateMany({where:{id:shift.characterId,status:'WORKING'},data:{status:'ACTIVE'}})
      await tx.productionLog.create({data:{characterId:shift.characterId,productionObjectId:shift.productionObjectId,eventType:'SHIFT_READY',metadataJson:{shiftId:shift.id}}})
      return true
    })
    if(result)finalized++
  }
  return finalized
}
export const WORK_SHIFT_FINALIZE_MS=30_000
