import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { workApi, type ProductionObjectView } from '../../shared/api/work.api'

const XP = [0, 500, 1_500, 3_500, 8_000, 16_000, 30_000]
const time = (seconds:number) => {
  const safe=Math.max(0,seconds), h=Math.floor(safe/3600), m=Math.floor((safe%3600)/60), s=safe%60
  return h?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`
}
const errorText=(error:unknown)=>error instanceof Error?error.message:'Не удалось выполнить действие'
type Receipt={salary:number;professionExpGain:number;professionLevel:number;resourceReward:{code:string;amount:number}|null;toolUse:{itemId:string;usesLeft:number}|null;newBalance?:number;resourceName?:string;levelBefore:number}

function Progress({level,exp}:{level:number;exp:number}){
  const floor=XP[level]??XP[XP.length-1], ceiling=XP[level+1]
  const value=ceiling?Math.max(0,Math.min(100,((exp-floor)/(ceiling-floor))*100)):100
  return <div className="work-xp"><div><i style={{transform:`scaleX(${value/100})`}}/></div><small>{ceiling?`${exp.toLocaleString('ru')} / ${ceiling.toLocaleString('ru')} XP`:`${exp.toLocaleString('ru')} XP`}</small></div>
}
function lockReason(object:ProductionObjectView,busy:boolean,limit:boolean){
  if(object.locked)return `Нужен ${object.requiredProfessionLevel} уровень профессии`
  if(!object.toolAvailable)return `Нужен инструмент T${object.equipment?.requiredToolTier??1}`
  if(limit)return 'Лимит смен на сегодня исчерпан'
  if(busy)return 'Сначала завершите текущую смену'
  return ''
}

export function WorkPage(){
  const qc=useQueryClient();const[,setTick]=useState(0)
  const[message,setMessage]=useState<{type:'success'|'error';text:string}|null>(null)
  const[receipt,setReceipt]=useState<Receipt|null>(null);const[cancelConfirm,setCancelConfirm]=useState(false)
  useEffect(()=>{const id=setInterval(()=>setTick(x=>x+1),1000);return()=>clearInterval(id)},[])
  const objects=useQuery({queryKey:['work','objects'],queryFn:workApi.objects})
  const current=useQuery({queryKey:['work','current'],queryFn:workApi.current,refetchInterval:10_000})
  const refresh=()=>{void qc.invalidateQueries({queryKey:['work']});void qc.invalidateQueries({queryKey:['character']});void qc.invalidateQueries({queryKey:['resources']})}
  const start=useMutation({mutationFn:(object:ProductionObjectView)=>workApi.start(object.id),onSuccess:(_,object)=>{setReceipt(null);setMessage({type:'success',text:`Смена «${object.name}» началась`});refresh()},onError:e=>setMessage({type:'error',text:errorText(e)})})
  const claim=useMutation({mutationFn:workApi.claim,onSuccess:data=>{const before=current.data?.shift?.profession?.level??data.professionLevel;const object=objects.data?.items.find(x=>x.code===current.data?.shift?.productionObject.code);setReceipt({...data,levelBefore:before,resourceName:object?.producesResourceName??undefined});setMessage(null);refresh()},onError:e=>setMessage({type:'error',text:errorText(e)})})
  const cancel=useMutation({mutationFn:workApi.cancel,onSuccess:()=>{setCancelConfirm(false);setMessage({type:'success',text:'Смена отменена. Инструмент возвращён'});refresh()},onError:e=>setMessage({type:'error',text:errorText(e)})})
  const shift=current.data?.shift
  const remaining=shift?Math.max(0,Math.ceil((new Date(shift.endsAt).getTime()-Date.now())/1000)):0
  const total=shift?Math.max(1,Math.ceil((new Date(shift.endsAt).getTime()-new Date(shift.startedAt).getTime())/1000)):1
  const done=shift?Math.max(0,Math.min(100,((total-remaining)/total)*100)):0
  const used=current.data?.daily.shiftsUsedToday??objects.data?.daily.shiftsUsedToday??0
  const limit=current.data?.daily.shiftsLimit??objects.data?.daily.shiftsLimit??8

  return <div className="work-sheet">
    {message&&<div className={`alert ${message.type==='error'?'alert-error':'alert-success'} mb8`}>{message.text}</div>}

    {receipt&&<div className="panel mb8 work-award">
      <div className="panel-header"><span className="panel-title">Расчётный лист</span><span className="text-success">Смена принята</span></div>
      <div className="panel-body"><table className="data-table"><tbody>
        <tr><td>Заработок</td><td className="num"><b>+{receipt.salary.toLocaleString('ru')} ₽</b></td></tr>
        <tr><td>Опыт профессии</td><td className="num">+{receipt.professionExpGain} XP</td></tr>
        {receipt.resourceReward&&<tr><td>{receipt.resourceName??receipt.resourceReward.code}</td><td className="num">+{receipt.resourceReward.amount}</td></tr>}
        {receipt.toolUse&&<tr><td>Осталось использований инструмента</td><td className="num">{receipt.toolUse.usesLeft}</td></tr>}
        {receipt.professionLevel>receipt.levelBefore&&<tr><td>Новый уровень профессии</td><td className="num"><b>{receipt.professionLevel}</b></td></tr>}
        <tr><td>Новый баланс</td><td className="num">{(receipt.newBalance??0).toLocaleString('ru')} ₽</td></tr>
      </tbody></table><div className="work-actions"><button className="btn" onClick={()=>setReceipt(null)}>Закрыть</button><button className="btn btn-primary" onClick={()=>{setReceipt(null);document.querySelector('#vacancies')?.scrollIntoView()}}>Выбрать новую смену</button></div></div>
    </div>}

    <div className="panel mb8"><div className="panel-header"><span className="panel-title">Рабочая смена</span><span>{used} / {limit} за сутки</span></div><div className="panel-body">
      {shift?<><div className="work-shift-line"><div><b>{shift.productionObject.name}</b><small>{shift.profession?.name??shift.professionCode}, ур. {shift.profession?.level??0}</small></div><strong>{remaining?time(remaining):'ГОТОВО'}</strong></div>
        <div className="work-shift-progress"><i style={{transform:`scaleX(${done/100})`}}/></div>
        {shift.toolInstance&&<div className="text-dim mt8">Инструмент: {shift.toolInstance.template.name}, осталось {shift.toolInstance.usesLeft??0} использований</div>}
        <div className="work-actions"><button className="btn btn-primary" disabled={remaining>0||claim.isPending} onClick={()=>claim.mutate(shift.id)}>{claim.isPending?'Начисляем…':remaining?'Смена идёт':'Забрать награду'}</button>
          {!cancelConfirm?<button className="btn" disabled={!remaining} onClick={()=>setCancelConfirm(true)}>Отменить</button>:<><span className="text-danger">Награды не будет.</span><button className="btn" onClick={()=>setCancelConfirm(false)}>Назад</button><button className="btn btn-danger" onClick={()=>cancel.mutate(shift.id)}>Подтвердить</button></>}
        </div></>:<div className="work-empty-line"><span>Смена не начата. Выберите доступную вакансию ниже.</span><a href="#vacancies">к вакансиям ↓</a></div>}
    </div></div>

    <div className="panel mb8"><div className="panel-header"><span className="panel-title">Профессии</span></div><div className="panel-body">
      {objects.data?.professions.length?<table className="data-table"><thead><tr><th>Профессия</th><th>Уровень</th><th>Прогресс</th></tr></thead><tbody>{objects.data.professions.map(p=><tr key={p.code}><td>{p.name}</td><td>{p.level}</td><td><Progress level={p.level} exp={p.exp}/></td></tr>)}</tbody></table>:<span className="text-dim">Профессия откроется после первой смены.</span>}
    </div></div>

    <div className="panel" id="vacancies"><div className="panel-header"><span className="panel-title">Вакансии</span><span>Оплата и выработка за смену</span></div><div className="panel-body">
      {objects.isLoading?<div className="loading"><span className="spinner"/>Загружаем вакансии…</div>:objects.isError?<div className="alert alert-error">Вакансии не загрузились.</div>:<table className="data-table"><thead><tr><th>Объект</th><th>Профессия</th><th>Время</th><th>Оплата</th><th>Опыт</th><th>Выработка</th><th/></tr></thead><tbody>{objects.data?.items.map(object=>{const reason=lockReason(object,!!shift,used>=limit);return <tr key={object.id} className={reason?'is-muted':''}><td><b>{object.name}</b>{reason&&<small className="work-reason">{reason}</small>}</td><td>{object.profession.name}, ур. {object.profession.level}</td><td>{object.shiftDurationMinutes} мин</td><td>{object.baseSalary.toLocaleString('ru')} ₽</td><td>+{object.baseProductionExp} XP</td><td>{object.producesResourceName?`${object.outputAmountMin}–${object.outputAmountMax} ${object.producesResourceName}`:'—'}</td><td><button className="btn btn-sm btn-primary" disabled={!!reason||start.isPending} onClick={()=>start.mutate(object)}>Выйти</button></td></tr>})}</tbody></table>}
    </div></div>
  </div>
}
