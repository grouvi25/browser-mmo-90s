import { useState } from 'react'
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { privateShopsApi } from '../../shared/api/private-shops.api'
const KIND:Record<string,string>={ITEM:'вещь',RESOURCE:'сырьё',PART:'деталь'}
export function PrivateShopsPage(){
 const qc=useQueryClient();const[shop,setShop]=useState('kommersant');const[msg,setMsg]=useState('')
 const shops=useQuery({queryKey:['private-shops'],queryFn:privateShopsApi.shops})
 const items=useQuery({queryKey:['private-shops',shop],queryFn:()=>privateShopsApi.items(shop)})
 const buy=useMutation({mutationFn:(id:string)=>privateShopsApi.buy(shop,id),onSuccess:r=>{setMsg(`Куплено за ${r.total} ₽`);qc.invalidateQueries({queryKey:['private-shops']});qc.invalidateQueries({queryKey:['inventory']});qc.invalidateQueries({queryKey:['resources']});qc.invalidateQueries({queryKey:['character']})},onError:(e:Error)=>setMsg(e.message)})
 return <div>{msg&&<div className="alert mb8">{msg}</div>}<div style={{display:'flex',gap:6,marginBottom:8}}>{shops.data?.map(s=><button key={s.code} className={`btn ${shop===s.code?'btn-primary':''}`} onClick={()=>setShop(s.code)}>{s.name}</button>)}</div><div className="panel"><div className="panel-header"><span className="panel-title">Частная лавка</span></div><div className="panel-body"><table className="data-table"><thead><tr><th>Товар</th><th>Вид</th><th>Уровень</th><th>Требуется</th><th>В наличии</th><th>Цена</th><th/></tr></thead><tbody>{items.data?.map(i=><tr key={i.id}><td>{i.name}</td><td>{KIND[i.kind]??i.kind}</td><td>{i.itemTier}</td><td>BL {i.minBattleLevel}, EL {i.minEconomicLevel}, PL {i.minProductionLevel}</td><td>{i.stockMode==='INFINITE'?'∞':i.stockAmount}</td><td>{i.price.toLocaleString()} ₽</td><td><button className="btn btn-sm btn-gold" disabled={buy.isPending||i.stockAmount===0} onClick={()=>buy.mutate(i.id)}>Купить</button></td></tr>)}</tbody></table></div></div></div>
}
