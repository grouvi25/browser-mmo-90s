import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { workApi } from '../../shared/api/work.api'

const time=(seconds:number)=>`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`
export function WorkPage(){
 const qc=useQueryClient();const [,setTick]=useState(0)
 useEffect(()=>{const id=setInterval(()=>setTick(x=>x+1),1000);return()=>clearInterval(id)},[])
 const objects=useQuery({queryKey:['work','objects'],queryFn:workApi.objects})
 const current=useQuery({queryKey:['work','current'],queryFn:workApi.current,refetchInterval:10_000})
 const refresh=()=>{qc.invalidateQueries({queryKey:['work']});qc.invalidateQueries({queryKey:['character']});qc.invalidateQueries({queryKey:['resources']})}
 const start=useMutation({mutationFn:workApi.start,onSuccess:refresh})
 const claim=useMutation({mutationFn:workApi.claim,onSuccess:refresh})
 const cancel=useMutation({mutationFn:workApi.cancel,onSuccess:refresh})
 const shift=current.data?.shift
 const remaining=shift?Math.max(0,Math.ceil((new Date(shift.endsAt).getTime()-Date.now())/1000)):0
 return <div>
  <div className="panel"><div className="panel-header"><span className="panel-title">Work shift</span><span>{current.data?.daily.shiftsUsedToday??0} / {current.data?.daily.shiftsLimit??8} today</span></div>
   <div className="panel-body">{shift?<div><b>{shift.productionObject?.name??'Production object'}</b><div>Status: {shift.status}</div><div style={{fontFamily:'var(--font-mono)',fontSize:24}}>{remaining>0?time(remaining):'READY'}</div>
    <button className="btn btn-success" disabled={remaining>0||claim.isPending} onClick={()=>claim.mutate(shift.id)}>Claim reward</button>{' '}
    <button className="btn" disabled={shift.status!=='ACTIVE'||cancel.isPending} onClick={()=>cancel.mutate(shift.id)}>Cancel</button></div>:<span className="text-dim">No active shift.</span>}</div>
  </div>
  <div className="panel"><div className="panel-header"><span className="panel-title">Production objects</span></div><div className="panel-body"><table className="data-table"><thead><tr><th>Object</th><th>PL</th><th>Time</th><th>Salary</th><th>Output</th><th/></tr></thead><tbody>{objects.data?.items.map(o=><tr key={o.id}><td>{o.name}</td><td>{o.requiredProductionLevel}</td><td>{o.shiftDurationMinutes} min</td><td>{o.baseSalary}</td><td>{o.producesResourceCode?`${o.outputAmountMin}-${o.outputAmountMax} ${o.producesResourceCode}`:'-'}</td><td><button className="btn btn-sm btn-primary" disabled={o.locked||!!shift||start.isPending} onClick={()=>start.mutate(o.id)}>{o.locked?'Locked':'Start'}</button></td></tr>)}</tbody></table></div></div>
 </div>
}
