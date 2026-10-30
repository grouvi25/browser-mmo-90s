// ЦУМ и Берёзка — витрины за доллары (правка 30.10: «не понятно, как
// добавлять в Берёзку и в ЦУМ»). Новую вещь выставляют прямо в форме
// «Новая вещь»; здесь — уже выставленные: цена, снять или вернуть в
// продажу, и выставить существующую вещь по коду из справочника.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi, type DollarShopCode } from '../admin-api'
import { Skeleton, Fault, Empty, Note } from '../../stage3/stage3-ui'
import { Table } from '../admin-ui'

const SHOP_TITLE: Record<DollarShopCode, string> = { TSUM: 'ЦУМ', BEREZKA: 'Берёзка' }

export function DollarShops({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['admin', 'dollar-shops'], queryFn: adminApi.dollarShops })
  const [prices, setPrices] = useState<Record<string, number>>({})
  const [shop, setShop] = useState<DollarShopCode>('TSUM')
  const [code, setCode] = useState('')
  const [price, setPrice] = useState(10)
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)

  const save = useMutation({
    mutationFn: (v: { shop: DollarShopCode; code: string; fields: { priceDollars?: number; isAvailable?: boolean }; what: string }) =>
      adminApi.setDollarShopItem(v.shop, v.code, v.fields, `${SHOP_TITLE[v.shop]}: ${v.what}`),
    onSuccess: (_r, v) => { setBad(false); setMsg(`${SHOP_TITLE[v.shop]}: ${v.what}. Откатить можно в «Журнал → Действия».`); setCode(''); void qc.invalidateQueries({ queryKey: ['admin', 'dollar-shops'] }) },
    onError: (e: Error) => { setBad(true); setMsg(e.message) },
  })

  if (list.isLoading) return <Skeleton rows={3} />
  if (list.isError || !list.data) return <Fault retry={() => list.refetch()} />

  return (
    <>
      <Note text={msg} kind={bad ? 'bad' : 'ok'} />
      <p className="adm-hint">Новую вещь сразу в ЦУМ или Берёзку можно выставить в «Вещи → Новая вещь», шаг «Где продаётся». Здесь — то, что уже на витринах.</p>
      {list.data.items.length === 0
        ? <Empty title="Витрины пусты" hint="Выставьте вещь ниже или из формы новой вещи." />
        : <Table head={['Магазин', 'Вещь', 'Код', 'Цена, $', 'В продаже', '']}>
            {list.data.items.map(row => {
              const key = `${row.shop}:${row.template.code}`
              const value = prices[key] ?? row.priceDollars
              return (
                <tr key={row.id} className={row.isAvailable ? undefined : 'is-muted'}>
                  <td>{SHOP_TITLE[row.shop]}</td>
                  <td>{row.template.name}{row.template.levelReq > 0 && ` · с ${row.template.levelReq} ур.`}</td>
                  <td><code>{row.template.code}</code></td>
                  <td>
                    <input type="number" min={1} value={value} disabled={!canEdit} aria-label={`Цена: ${row.template.name}`}
                      onChange={e => setPrices({ ...prices, [key]: Number(e.target.value) || 0 })} style={{ width: 80 }} />
                    {canEdit && value !== row.priceDollars && value > 0 && (
                      <button type="button" disabled={save.isPending}
                        onClick={() => save.mutate({ shop: row.shop, code: row.template.code, fields: { priceDollars: value }, what: `цена «${row.template.name}» ${row.priceDollars} → ${value} $` })}>
                        Сохранить</button>)}
                  </td>
                  <td>{row.isAvailable ? 'да' : 'снята'}</td>
                  <td>{canEdit && <button type="button" disabled={save.isPending}
                    onClick={() => save.mutate({ shop: row.shop, code: row.template.code, fields: { isAvailable: !row.isAvailable }, what: `${row.isAvailable ? 'снята с продажи' : 'вернулась в продажу'} «${row.template.name}»` })}>
                    {row.isAvailable ? 'Снять с продажи' : 'Вернуть в продажу'}</button>}</td>
                </tr>
              )
            })}
          </Table>}

      {canEdit && <section className="adm-card-block">
        <h4>Выставить существующую вещь</h4>
        <p className="adm-hint">Код вещи — во вкладке «Вещи» справочника (например, <code>tsum_named_knife</code>).</p>
        <form className="admx-staff-add" onSubmit={e => { e.preventDefault(); if (code.trim()) save.mutate({ shop, code: code.trim(), fields: { priceDollars: price, isAvailable: true }, what: `выставлена вещь ${code.trim()} за ${price} $` }) }}>
          <select value={shop} onChange={e => setShop(e.target.value as DollarShopCode)} aria-label="Магазин">
            <option value="TSUM">ЦУМ</option><option value="BEREZKA">Берёзка</option>
          </select>
          <input value={code} onChange={e => setCode(e.target.value)} placeholder="Код вещи" aria-label="Код вещи" />
          <input type="number" min={1} value={price} onChange={e => setPrice(Number(e.target.value) || 0)} aria-label="Цена, $" style={{ width: 90 }} />
          <button type="submit" disabled={!code.trim() || price < 1 || save.isPending}>Выставить</button>
        </form>
      </section>}
    </>
  )
}
