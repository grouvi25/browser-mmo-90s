import { Fragment, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { workApi, type GovCraftRecipe, type ProductionObjectView } from '../../shared/api/work.api'

/** Госкрафт: что выйдет, из чего, сколько своего сырья есть. */
function CraftRecipes({recipes,blocked,pending,onMake}:{recipes:GovCraftRecipe[];blocked:string;pending:boolean;onMake:(recipe:GovCraftRecipe)=>void}){
  if(!recipes.length)return <div className="text-dim">Рецептов в этом цехе пока нет.</div>
  return <ul className="gov-craft">{recipes.map(recipe=>{const reason=blocked||recipe.reason;return <li key={recipe.id} className={reason?'is-muted':''}>
    <div className="gov-craft__what"><b>{recipe.output.name}{recipe.output.amount>1?` ×${recipe.output.amount}`:''}</b><small>{recipe.minutes} мин{recipe.requiredLevel>0?` · с ${recipe.requiredLevel} уровня профессии`:''}{recipe.tool?` · инструмент: ${recipe.tool.name}`:''}</small></div>
    <div className="gov-craft__from">{recipe.inputs.length?recipe.inputs.map(input=><span key={input.code} className={input.have<input.need?'text-danger':''}>{input.name} ×{input.need} <small>(есть {input.have})</small></span>):<span className="text-dim">без сырья</span>}</div>
    <button type="button" className="btn btn-sm btn-primary" disabled={!!reason||pending} title={reason||undefined} onClick={()=>onMake(recipe)}>Сделать</button>
    {recipe.reason&&!blocked&&<small className="work-reason gov-craft__reason">{recipe.reason}</small>}
  </li>})}</ul>
}

const XP = [0, 500, 1_500, 3_500, 8_000, 16_000, 30_000]
const time = (seconds:number) => {
  const safe=Math.max(0,seconds), h=Math.floor(safe/3600), m=Math.floor((safe%3600)/60), s=safe%60
  return h?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`
}
const errorText=(error:unknown)=>error instanceof Error?error.message:'Не удалось выполнить действие'
type Receipt={crafted?:{kind:'resource'|'item';name:string;amount:number}|null;salary:number;professionExpGain:number;professionLevel:number;resourceReward:{code:string;amount:number}|null;resourceToOwner?:{code:string;amount:number}|null;toolUse:{itemId:string;usesLeft:number}|null;newBalance?:number;resourceName?:string;levelBefore:number}

function Progress({level,exp}:{level:number;exp:number}){
  const floor=XP[level]??XP[XP.length-1], ceiling=XP[level+1]
  const value=ceiling?Math.max(0,Math.min(100,((exp-floor)/(ceiling-floor))*100)):100
  return <div className="work-xp"><div><i style={{transform:`scaleX(${value/100})`}}/></div><small>{ceiling?`${exp.toLocaleString('ru')} / ${ceiling.toLocaleString('ru')} XP`:`${exp.toLocaleString('ru')} XP`}</small></div>
}
/** Минуты рабочего дня словами: «2 ч 10 мин». */
const hm=(minutes:number)=>{const safe=Math.max(0,Math.round(minutes)),h=Math.floor(safe/60),m=safe%60;return h&&m?`${h} ч ${m} мин`:h?`${h} ч`:`${m} мин`}
function lockReason(object:ProductionObjectView,busy:boolean,limit:boolean,rest:number,minutesLeft:number){
  if(object.forSaleUsd&&!object.craft)return `Продаётся за ${object.forSaleUsd.toLocaleString('ru')} $`
  if(!object.profession.learned)return `Профессия «${object.profession.name}» не изучена — её покупают в Училище`
  // Замок и инструмент называем вместе: иначе игрок покупает инструмент и только потом узнаёт про уровень.
  const tool=object.toolAvailable?'':object.requiredToolName?`Нужен инструмент: ${object.requiredToolName}`:`Нужен инструмент ${object.equipment?.requiredToolTier??1} уровня`
  if(object.locked){const gate=object.admission?`Нужен ${object.admission.requiredLevel} уровень профессии «${object.admission.professionName}»`:`Нужен ${object.requiredProfessionLevel} уровень профессии`;return tool?`${gate}. ${tool}`:gate}
  if(tool)return tool
  if(limit)return 'Лимит смен на сегодня исчерпан'
  // Обращения №38, №42, №47: счётчик обещал 16 смен, а день кончался по минутам раньше.
  if(!object.craft&&object.shiftDurationMinutes>minutesLeft)return `Не хватит времени сегодня: осталось ${hm(minutesLeft)}, смена ${object.shiftDurationMinutes} мин`
  if(busy)return 'Сначала завершите текущую смену'
  if(rest>0)return `Отдых после смены: ещё ${time(rest)}`
  if(object.employer&&!object.employer.canPay)return 'У владельца нет денег на зарплату'
  return ''
}

export function WorkPage(){
  const qc=useQueryClient();const[,setTick]=useState(0)
  const[message,setMessage]=useState<{type:'success'|'error';text:string}|null>(null)
  const[receipt,setReceipt]=useState<Receipt|null>(null);const[cancelConfirm,setCancelConfirm]=useState(false)
  const[filter,setFilter]=useState('mine');const[openCraft,setOpenCraft]=useState<string|null>(null)
  useEffect(()=>{const id=setInterval(()=>setTick(x=>x+1),1000);return()=>clearInterval(id)},[])
  const objects=useQuery({queryKey:['work','objects'],queryFn:workApi.objects})
  const current=useQuery({queryKey:['work','current'],queryFn:workApi.current,refetchInterval:10_000})
  const refresh=()=>{void qc.invalidateQueries({queryKey:['work']});void qc.invalidateQueries({queryKey:['character']});void qc.invalidateQueries({queryKey:['resources']})}
  const start=useMutation({mutationFn:({object,recipe}:{object:ProductionObjectView;recipe?:GovCraftRecipe})=>workApi.start(object.id,recipe?.id),onSuccess:(_,{object,recipe})=>{setReceipt(null);setOpenCraft(null);setMessage({type:'success',text:recipe?`Делаете «${recipe.output.name}» в цехе «${object.name}»`:`Смена «${object.name}» началась`});refresh()},onError:e=>setMessage({type:'error',text:errorText(e)})})
  const claim=useMutation({mutationFn:workApi.claim,onSuccess:data=>{const before=current.data?.shift?.profession?.level??data.professionLevel;const object=objects.data?.items?.find(x=>x.code===current.data?.shift?.productionObject?.code);setReceipt({...data,levelBefore:before,resourceName:object?.producesResourceName??undefined});setMessage(null);refresh()},onError:e=>setMessage({type:'error',text:errorText(e)})})
  const cancel=useMutation({mutationFn:workApi.cancel,onSuccess:()=>{setCancelConfirm(false);setMessage({type:'success',text:'Смена отменена. Инструмент возвращён'});refresh()},onError:e=>setMessage({type:'error',text:errorText(e)})})
  const shift=current.data?.shift
  const remaining=shift?Math.max(0,Math.ceil((new Date(shift.endsAt).getTime()-Date.now())/1000)):0
  const total=shift?Math.max(1,Math.ceil((new Date(shift.endsAt).getTime()-new Date(shift.startedAt).getTime())/1000)):1
  const done=shift?Math.max(0,Math.min(100,((total-remaining)/total)*100)):0
  const used=current.data?.daily?.shiftsUsedToday??objects.data?.daily?.shiftsUsedToday??0
  const limit=current.data?.daily?.shiftsLimit??objects.data?.daily?.shiftsLimit??12
  const nextShiftRate=Math.round(Math.max(0.20,1-0.20*used)*100)
  const minutesLimit=current.data?.daily?.minutesLimit??objects.data?.daily?.minutesLimit??360
  const minutesLeft=Math.max(0,minutesLimit-(current.data?.daily?.minutesUsedToday??objects.data?.daily?.minutesUsedToday??0))
  // Отдых считается по часам в браузере, поэтому кнопки включаются сами, когда он кончился.
  const restUntil=current.data?.restUntil??objects.data?.restUntil
  const rest=!shift&&restUntil?Math.max(0,Math.ceil((new Date(restUntil).getTime()-Date.now())/1000)):0

  return <div className="work-sheet">
    {message&&<div className={`alert ${message.type==='error'?'alert-error':'alert-success'} mb8`}>{message.text}</div>}
    {/* Новичок без профессии не может выйти ни на одну смену. Раньше это выглядело как сломанная работа: причина была только мелким шрифтом в каждой строке. */}
    {objects.data&&!objects.data.professions?.length&&!shift&&<div className="alert alert-error mb8" role="status"><b>Чтобы устроиться на работу, сначала изучите профессию.</b> Её покупают в Училище (500 ₽), после этого вакансии станут доступны. <Link to="/school">Перейти в Училище →</Link></div>}

    {receipt&&<div className="panel mb8 work-award">
      <div className="panel-header"><span className="panel-title">Расчётный лист</span><span className="text-success">Смена принята</span></div>
      <div className="panel-body"><table className="data-table"><tbody>
        {receipt.crafted&&<tr><td>Сделано</td><td className="num"><b>{receipt.crafted.name}{receipt.crafted.amount>1?` ×${receipt.crafted.amount}`:''}</b></td></tr>}
        <tr><td>Заработок</td><td className="num"><b>+{receipt.salary.toLocaleString('ru')} ₽</b></td></tr>
        <tr><td>Опыт профессии</td><td className="num">+{receipt.professionExpGain} XP</td></tr>
        {receipt.resourceReward&&<tr><td>{receipt.resourceName??receipt.resourceReward.code}</td><td className="num">+{receipt.resourceReward.amount}</td></tr>}
        {receipt.resourceToOwner&&<tr><td>Сырьё ушло владельцу завода</td><td className="num">{receipt.resourceToOwner.amount}</td></tr>}
        {receipt.toolUse&&<tr><td>Осталось использований инструмента</td><td className="num">{receipt.toolUse.usesLeft}</td></tr>}
        {receipt.professionLevel>receipt.levelBefore&&<tr><td>Новый уровень профессии</td><td className="num"><b>{receipt.professionLevel}</b></td></tr>}
        <tr><td>Новый баланс</td><td className="num">{(receipt.newBalance??0).toLocaleString('ru')} ₽</td></tr>
      </tbody></table><div className="work-actions"><button className="btn" onClick={()=>setReceipt(null)}>Закрыть</button><button className="btn btn-primary" onClick={()=>{setReceipt(null);document.querySelector('#vacancies')?.scrollIntoView()}}>Выбрать новую смену</button></div></div>
    </div>}

    <div className="panel mb8"><div className="panel-header"><span className="panel-title">Рабочая смена</span><span>Сегодня: смен {used} из {limit} · времени осталось {hm(minutesLeft)} из {hm(minutesLimit)} · следующая смена: {nextShiftRate}% ставки</span></div><div className="panel-body">
      {shift?<><div className="work-shift-line"><div><b>{shift.productionObject?.name}</b><small>{shift.profession?.name??shift.professionCode}, ур. {shift.profession?.level??0}</small></div><strong>{remaining?time(remaining):'ГОТОВО'}</strong></div>
        <div className="work-shift-progress"><i style={{transform:`scaleX(${done/100})`}}/></div>
        {shift.toolInstance&&<div className="text-dim mt8">Инструмент: {shift.toolInstance.template.name}, осталось {shift.toolInstance.usesLeft??0} использований</div>}
        <div className="work-actions"><button className="btn btn-primary" disabled={remaining>0||claim.isPending} onClick={()=>claim.mutate(shift.id)}>{claim.isPending?'Начисляем…':remaining?'Смена идёт':'Забрать награду'}</button>
          {!cancelConfirm?<button className="btn" disabled={!remaining} onClick={()=>setCancelConfirm(true)}>Отменить</button>:<><span className="text-danger">Награды не будет.</span><button className="btn" onClick={()=>setCancelConfirm(false)}>Назад</button><button className="btn btn-danger" onClick={()=>cancel.mutate(shift.id)}>Подтвердить</button></>}
        </div></>:<div className="work-empty-line"><span>{rest>0?<>Отдых после смены: ещё <b>{time(rest)}</b></>:'Смена не начата. Выберите доступную вакансию ниже.'}</span><a href="#vacancies">к вакансиям ↓</a></div>}
    </div></div>

    <div className="panel mb8"><div className="panel-header"><span className="panel-title">Профессии</span></div><div className="panel-body">
      {objects.data?.professions?.length?<table className="data-table"><thead><tr><th>Профессия</th><th>Уровень</th><th>Прогресс</th></tr></thead><tbody>{objects.data.professions.map(p=><tr key={p.code}><td>{p.name}</td><td>{p.level}</td><td><Progress level={p.level} exp={p.exp}/></td></tr>)}</tbody></table>:<span className="text-dim">Профессий пока нет. <Link to="/school">Купить профессию в Училище →</Link></span>}
    </div></div>

    <div className="panel" id="vacancies"><div className="panel-header"><span className="panel-title">Вакансии</span><span>Оплата и выработка за смену</span></div><div className="panel-body">
      <label className="work-filter">Профессия{' '}
        <select value={filter} onChange={event=>setFilter(event.target.value)}>
          <option value="mine">Мои</option>
          <option value="all">Все</option>
          {[...new Map(objects.data?.items?.map(object=>[object.profession.code,object.profession.name])).entries()].map(([code,name])=><option key={code} value={code}>{name}</option>)}
        </select>
      </label>
      {objects.isLoading?<div className="loading"><span className="spinner"/>Загружаем вакансии…</div>:objects.isError?<div className="alert alert-error">Вакансии не загрузились.</div>:<table className="data-table"><thead><tr><th>Объект</th><th>Профессия</th><th>Время</th><th>Оплата</th><th>Опыт</th><th>Выработка</th><th/></tr></thead><tbody>{objects.data?.items?.filter(object=>filter==='all'||(filter==='mine'?object.profession.learned||!objects.data?.professions?.length:object.profession.code===filter)).map(object=>{const reason=lockReason(object,!!shift,used>=limit,rest,minutesLeft);const craft=object.craft;const open=openCraft===object.id;return <Fragment key={object.id}><tr className={reason?'is-muted':''}><td><b>{object.name}</b>{craft&&<small className="work-employer">госцех · делаете из своего сырья · можно купить за {object.forSaleUsd?.toLocaleString('ru')} $</small>}{object.employer&&<small className="work-employer">{object.employer.isMe?'ваш завод':`частный · ${object.employer.nickname??'владелец'}`}</small>}{reason&&<small className="work-reason">{reason}{object.forSaleUsd&&!object.craft?<> · <Link to="/objects">в Мои объекты</Link></>:!object.profession.learned?<> · <Link to="/school">в Училище</Link></>:<>{object.locked&&<> · <Link to="/school">в Училище</Link></>}{!object.toolAvailable&&<> · <Link to={`/shop?tab=tools&profession=${object.profession.code}`}>в магазин</Link></>}</>}</small>}</td><td>{object.profession.name}, ур. {object.profession.level}</td><td>{object.shiftDurationMinutes} мин</td><td>{craft?'изделие себе':`${(object.offeredSalary??object.baseSalary).toLocaleString('ru')} ₽`}</td><td>+{object.baseProductionExp} XP</td><td>{object.products?.length?object.products.join(', '):object.producesResourceName?`${object.outputAmountMin}–${object.outputAmountMax} ${object.producesResourceName}${object.employer&&!object.employer.isMe?' — владельцу':''}`:'—'}</td><td>{craft?<button type="button" className="btn btn-sm btn-primary" aria-expanded={open} onClick={()=>setOpenCraft(open?null:object.id)}>{open?'Скрыть':'Сделать'}</button>:<button className="btn btn-sm btn-primary" disabled={!!reason||start.isPending} onClick={()=>start.mutate({object})}>Выйти</button>}</td></tr>
        {craft&&open&&<tr className="gov-craft-row"><td colSpan={7}><CraftRecipes recipes={craft} blocked={reason} pending={start.isPending} onMake={recipe=>start.mutate({object,recipe})}/></td></tr>}</Fragment>})}</tbody></table>}
    </div></div>
  </div>
}
