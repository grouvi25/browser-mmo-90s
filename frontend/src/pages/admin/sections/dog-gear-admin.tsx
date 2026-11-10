// Шмот для собак (Дима 10.11: «в админке вкладка нужна под шмот для собак. Это
// отдельный будет. Статы так же разбивать сам игрок будет. И именные для собак
// отдельно (ЦУМ)»). Обычный продаётся за рубли в Зоомагазине и госмагазине,
// именной — за доллары в ЦУМе. Очки вещи игрок раскладывает сам после покупки.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi, type DogGearRow, type DogGearSlot } from '../admin-api'
import { Skeleton, Fault, Empty, Note } from '../../stage3/stage3-ui'
import { Table } from '../admin-ui'

const SLOTS: Record<DogGearSlot, string> = { MUZZLE: 'Намордник', ARMOR: 'Защита', COLLAR: 'Ошейник', BOOTS: 'Обувь' }
type Kind = 'zoo' | 'named'

export function DogGearAdmin({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['admin', 'dog-gear'], queryFn: adminApi.dogGear })
  const [kind, setKind] = useState<Kind>('zoo')
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)
  const [edits, setEdits] = useState<Record<string, { price?: number; statBudget?: number }>>({})
  const [form, setForm] = useState({ name: '', slot: 'ARMOR' as DogGearSlot, statBudget: 20, price: 1000 })

  const done = (text: string) => { setBad(false); setMsg(`${text}. Откатить можно в «Журнал → Действия».`); void qc.invalidateQueries({ queryKey: ['admin', 'dog-gear'] }) }
  const fail = (e: Error) => { setBad(true); setMsg(e.message) }
  const create = useMutation({
    mutationFn: () => {
      const named = kind === 'named'
      return adminApi.createDogGear({ name: form.name.trim(), slot: form.slot, statBudget: form.statBudget, named, ...(named ? { priceDollars: form.price } : { price: form.price }) },
        `Шмот для собак: новая ${named ? 'именная ' : ''}вещь «${form.name.trim()}»`)
    },
    onSuccess: () => { done(`Добавлено: «${form.name.trim()}»`); setForm(f => ({ ...f, name: '' })) },
    onError: fail,
  })
  const save = useMutation({
    mutationFn: (v: { row: DogGearRow; fields: { price?: number; priceDollars?: number; statBudget?: number; isActive?: boolean }; what: string }) =>
      adminApi.updateDogGear(v.row.code, v.fields, `Шмот для собак: ${v.what}`),
    onSuccess: (_r, v) => { done(v.what); setEdits(e => { const next = { ...e }; delete next[v.row.code]; return next }) },
    onError: fail,
  })

  if (list.isLoading) return <Skeleton rows={3} />
  if (list.isError || !list.data) return <Fault retry={() => list.refetch()} />
  const rows = list.data.items.filter(row => (kind === 'named') === row.named)
  const unit = kind === 'named' ? '$' : '₽'
  const nameOk = form.name.trim().length >= 2

  return (
    <>
      <div className="s3-tabs" role="tablist" aria-label="Какой шмот">
        <button type="button" role="tab" aria-selected={kind === 'zoo'} className={kind === 'zoo' ? 'active' : ''} onClick={() => setKind('zoo')}>Зоомагазин, за рубли</button>
        <button type="button" role="tab" aria-selected={kind === 'named'} className={kind === 'named' ? 'active' : ''} onClick={() => setKind('named')}>Именные, ЦУМ за доллары</button>
      </div>
      <Note text={msg} kind={bad ? 'bad' : 'ok'} />
      <p className="adm-hint">Очки вещи игрок распределяет сам после покупки: сила, ловкость, реакция, меткость, выносливость, фарт. Правка цены и очков касается только новых покупок.</p>
      {rows.length === 0
        ? <Empty title="Пока пусто" hint="Добавьте вещь формой ниже." />
        : <Table head={['Вещь', 'Слот', 'Очков', `Цена, ${unit}`, 'В продаже', '']}>
            {rows.map(row => {
              const price = kind === 'named' ? row.priceDollars : row.price
              const e = edits[row.code] ?? {}
              const newPrice = e.price ?? price
              const newBudget = e.statBudget ?? row.statBudget
              const dirty = newPrice !== price || newBudget !== row.statBudget
              return (
                <tr key={row.id} className={row.isActive ? undefined : 'is-muted'}>
                  <td>{row.name}</td>
                  <td>{SLOTS[row.slot] ?? row.slot}</td>
                  <td><input type="number" min={0} max={1000} value={newBudget} disabled={!canEdit} aria-label={`Очков: ${row.name}`} style={{ width: 70 }}
                    onChange={ev => setEdits({ ...edits, [row.code]: { ...e, statBudget: Number(ev.target.value) || 0 } })} /></td>
                  <td><input type="number" min={1} value={newPrice} disabled={!canEdit} aria-label={`Цена: ${row.name}`} style={{ width: 90 }}
                    onChange={ev => setEdits({ ...edits, [row.code]: { ...e, price: Number(ev.target.value) || 0 } })} />
                    {canEdit && dirty && newPrice > 0 && <button type="button" disabled={save.isPending}
                      onClick={() => save.mutate({ row, fields: { ...(kind === 'named' ? { priceDollars: newPrice } : { price: newPrice }), statBudget: newBudget }, what: `«${row.name}»: ${newPrice} ${unit}, ${newBudget} очков` })}>Сохранить</button>}
                  </td>
                  <td>{row.isActive ? 'да' : 'снята'}</td>
                  <td>{canEdit && <button type="button" disabled={save.isPending}
                    onClick={() => save.mutate({ row, fields: { isActive: !row.isActive }, what: `«${row.name}» ${row.isActive ? 'снята с продажи' : 'вернулась в продажу'}` })}>
                    {row.isActive ? 'Снять с продажи' : 'Вернуть в продажу'}</button>}</td>
                </tr>
              )
            })}
          </Table>}

      {canEdit && <section className="adm-card-block">
        <h4>{kind === 'named' ? 'Новая именная вещь для собак (ЦУМ)' : 'Новая вещь для собак (Зоомагазин)'}</h4>
        <form className="admx-staff-add" onSubmit={ev => { ev.preventDefault(); if (nameOk && form.price > 0) create.mutate() }}>
          <input value={form.name} onChange={ev => setForm({ ...form, name: ev.target.value })} placeholder="Название" aria-label="Название" maxLength={60} />
          <select value={form.slot} onChange={ev => setForm({ ...form, slot: ev.target.value as DogGearSlot })} aria-label="Слот">
            {(Object.keys(SLOTS) as DogGearSlot[]).map(slot => <option key={slot} value={slot}>{SLOTS[slot]}</option>)}
          </select>
          <label className="adm-inline">Очков <input type="number" min={0} max={1000} value={form.statBudget} onChange={ev => setForm({ ...form, statBudget: Number(ev.target.value) || 0 })} style={{ width: 70 }} /></label>
          <label className="adm-inline">Цена, {unit} <input type="number" min={1} value={form.price} onChange={ev => setForm({ ...form, price: Number(ev.target.value) || 0 })} style={{ width: 90 }} /></label>
          <button type="submit" disabled={!nameOk || form.price < 1 || create.isPending}>{create.isPending ? 'Добавляем…' : 'Добавить'}</button>
        </form>
      </section>}
    </>
  )
}
