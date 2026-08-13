import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { workApi } from '../../shared/api/work.api'

const STATUS:Record<string,string>={ACTIVE:'Идёт',READY_TO_CLAIM:'Можно забрать',CLAIMED:'Получено',CANCELLED:'Отменено'}
const time=(seconds:number)=>`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`

export function WorkPage(){
 const qc=useQueryClient();const [,setTick]=useState(0)
 useEffect(()=>{const id=setInterval(()=>setTick(x=>x+1),1000);return()=>clearInterval(id)},[])
 const objects=useQuery({queryKey:['work','objects'],queryFn:workApi.objects})
 const current=useQuery({queryKey:['work','current'],queryFn:workApi.current,refetchInterval:10_000})
 const refresh=()=>{void qc.invalidateQueries({queryKey:['work']});void qc.invalidateQueries({queryKey:['character']});void qc.invalidateQueries({queryKey:['resources']})}
 const start=useMutation({mutationFn:workApi.start,onSuccess:refresh})
 const claim=useMutation({mutationFn:workApi.claim,onSuccess:refresh})
 const cancel=useMutation({mutationFn:workApi.cancel,onSuccess:refresh})
 const shift=current.data?.shift
 const remaining=shift?Math.max(0,Math.ceil((new Date(shift.endsAt).getTime()-Date.now())/1000)):0
 return <div>
  <div className="panel"><div className="panel-header"><span className="panel-title">Рабочая смена</span><span>{current.data?.daily.shiftsUsedToday??0} / {current.data?.daily.shiftsLimit??8} за сутки</span></div>
   <div className="panel-body">{shift?<div><b>{shift.productionObject?.name??'Объект'}</b><div>Профессия: {shift.profession?.name??shift.professionCode}, ур. {shift.profession?.level??0}</div><div>Статус: {STATUS[shift.status]??shift.status}</div>{shift.toolInstance&&<div>Инструмент: {shift.toolInstance.template.name}, осталось {shift.toolInstance.usesLeft??0}</div>}<div style={{fontFamily:'var(--font-mono)',fontSize:24}}>{remaining>0?time(remaining):'ГОТОВО'}</div>
    <button className="btn btn-success" disabled={remaining>0||claim.isPending} onClick={()=>claim.mutate(shift.id)}>Забрать</button>{' '}
    <button className="btn" disabled={shift.status!=='ACTIVE'||cancel.isPending} onClick={()=>cancel.mutate(shift.id)}>Отменить</button></div>:<span className="text-dim">Смена не начата.</span>}</div>
  </div>
  <div className="panel"><div className="panel-header"><span className="panel-title">Профессии</span></div><div className="panel-body">{objects.data?.professions?.length?<div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{objects.data!.professions.map(p=><span key={p.code} className="badge">{p.name}: ур. {p.level}, {p.exp} XP</span>)}</div>:<span className="text-dim">Профессия откроется после первой смены.</span>}</div></div>
  <div className="panel"><div className="panel-header"><span className="panel-title">Объекты города</span></div><div className="panel-body"><table className="data-table"><thead><tr><th>Объект</th><th>Профессия</th><th>Ур.</th><th>Время</th><th>Оплата</th><th>Выработка</th><th>Оборудование</th><th/></tr></thead><tbody>{objects.data?.items.map(o=><tr key={o.id}><td>{o.name}</td><td>{o.profession.name} ({o.profession.level})</td><td>{o.requiredProfessionLevel}</td><td>{o.shiftDurationMinutes} мин</td><td>{o.baseSalary}</td><td>{o.producesResourceName?`${o.outputAmountMin}–${o.outputAmountMax} · ${o.producesResourceName}`:'—'}</td><td>{o.equipment?`${o.equipment.name} · инструмент T${o.equipment.requiredToolTier}`:'Не требуется'}</td><td><button className="btn btn-sm btn-primary" disabled={o.locked||!o.toolAvailable||!!shift||start.isPending} onClick={()=>start.mutate(o.id)}>{o.locked?'Закрыт':!o.toolAvailable?'Нужен инструмент':'Выйти'}</button></td></tr>)}</tbody></table></div></div>
 </div>
}
