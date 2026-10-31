// =============================================================
// Настройка именной вещи на Складе (заказчик 30.10): «удобнее, чтобы как
// столбики для заполнения были, а не плюсики. И было видно, сколько заполнили
// статов, сколько осталось. И в конце СОХРАНИТЬ». Образец — «Примерочная»
// клана «Инквизиция»: те же группы и столько же параметров.
//
// Здесь же итог всего надетого: те же группы, только считать ничего не надо.
// =============================================================
import { useEffect, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { inventoryApi } from '../../shared/api/inventory.api'
import { ApiError } from '../../shared/api/client'
import { squareImage } from '../../shared/lib/image-resize'
import { CHARM_LABELS, MASTERY_LABELS, STAT_LABELS, instanceImage } from '../../shared/lib/item-bonuses'
import type { Character, ItemBonuses, ItemInstance, ItemStatKey } from '../../shared/types/api.types'

const OWN_STATS: Record<string, [ItemStatKey, string, string][]> = {
  WEAPON: [['DAMAGE', 'Урон', '+4% или хотя бы +1'], ['ACCURACY', 'Точность', '+1%'], ['CRIT', 'Крит', '+0,5%']],
  ARMOR: [['ARMOR', 'Броня', '+6% или хотя бы +1'], ['ANTI_CRIT', 'Защита от крита', '+0,5%']],
  SHIELD: [['ARMOR', 'Броня', '+6% или хотя бы +1'], ['ANTI_CRIT', 'Защита от крита', '+0,5%']],
}

type Numbers = Record<string, number>
const sum = (values: Numbers) => Object.values(values).reduce((total, value) => total + Math.abs(value || 0), 0)
const emptyBonuses = (): ItemBonuses => ({ stats: {}, mastery: {}, minusMastery: {}, charms: {}, minusCharms: {} })

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="inv-setup__group"><h4>{title}</h4>{children}</section>
}

function Field({ label, hint, value, min, onChange, disabled }: {
  label: string; hint?: string; value: number; min: number; disabled: boolean; onChange: (value: number) => void
}) {
  return (
    <label className="inv-setup__row">
      <input type="number" min={min} step={1} value={value || ''} placeholder="0" disabled={disabled}
        onChange={event => {
          const next = Math.trunc(Number(event.target.value.replace(',', '.'))) || 0
          onChange(Math.max(min, next))
        }} />
      <span>{label}{hint && <small> · {hint}</small>}</span>
    </label>
  )
}

/** Своя картинка вещи из ЦУМа: ужимается в браузере и сразу уходит на сервер. */
export function ItemIconPicker({ itemId, label = 'Загрузить картинку', onDone }: { itemId: string; label?: string; onDone?: () => void }) {
  const qc = useQueryClient()
  const [error, setError] = useState('')
  const save = useMutation({
    mutationFn: (dataUrl: string) => inventoryApi.setIcon(itemId, dataUrl),
    onSuccess: () => { setError(''); void qc.invalidateQueries({ queryKey: ['inventory'] }); onDone?.() },
    onError: err => setError(err instanceof ApiError ? err.message : 'Не сохранилось'),
  })
  return (
    <span className="inv-icon-picker">
      <label className={'btn btn-sm' + (save.isPending ? ' is-busy' : '')}>
        {save.isPending ? 'Загружаем…' : label}
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden disabled={save.isPending} onChange={async event => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          try { save.mutate(await squareImage(file, 128)) } catch (err) { setError(err instanceof Error ? err.message : 'Не вышло') }
        }} />
      </label>
      {error && <small role="alert" className="inv-setup__bad">{error}</small>}
    </span>
  )
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="inv-setup__back" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <div className="inv-setup" role="dialog" aria-modal="true" aria-label={title}>
        <header className="inv-setup__head">
          <h3>{title}</h3>
          <button type="button" className="inv-setup__close" aria-label="Закрыть" onClick={onClose}><X size={16} /></button>
        </header>
        {children}
      </div>
    </div>
  )
}

export function ItemSetupDialog({ item, disabled, onClose, onMessage }: {
  item: ItemInstance
  disabled: boolean
  onClose: () => void
  onMessage: (type: 'success' | 'error', text: string) => void
}) {
  const qc = useQueryClient()
  const t = item.template
  // У вещей ЦУМа блока «Сама вещь» нет: там только то, что распределяет игрок.
  const ownStats = item.canSetIcon ? [] : OWN_STATS[t.type] ?? []
  const [own, setOwn] = useState<Numbers>(() => (item.canSetIcon ? {} : { ...(item.statAllocation ?? {}) }) as Numbers)
  const [bonuses, setBonuses] = useState<ItemBonuses>(() => ({ ...emptyBonuses(), ...(item.bonuses ?? {}) }))
  const budget = item.budget ?? t.statBudget
  const perPoint = item.percentPerPoint ?? 5
  // Очки прочности — старые записи: в полях их нет, но бюджет они занимают.
  const spent = sum(own) + sum(bonuses.stats as Numbers) + sum(bonuses.mastery as Numbers) + sum(bonuses.minusMastery as Numbers)
    + sum(bonuses.charms as Numbers) + sum(bonuses.minusCharms as Numbers)
  const left = budget - spent
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['inventory'] })
    void qc.invalidateQueries({ queryKey: ['character'] })
  }
  const save = useMutation({
    mutationFn: () => inventoryApi.configure(item.id, own as Partial<Record<ItemStatKey, number>>, bonuses),
    onSuccess: () => { refresh(); onMessage('success', 'Вещь настроена'); onClose() },
    onError: err => onMessage('error', err instanceof ApiError ? err.message : 'Не сохранилось'),
  })
  const levelUp = useMutation({
    mutationFn: () => inventoryApi.levelUp(item.id),
    onSuccess: result => { refresh(); onMessage('success', `Уровень вещи: ${result.namedLevel}. Очков стало больше`); onClose() },
    onError: err => onMessage('error', err instanceof ApiError ? err.message : 'Не получилось'),
  })
  const set = <G extends keyof ItemBonuses>(group: G, key: string) => (value: number) =>
    setBonuses(prev => ({ ...prev, [group]: { ...prev[group], [key]: value } }))
  const offer = item.levelUp
  const busy = disabled || save.isPending || levelUp.isPending
  const percentField = (group: 'mastery' | 'minusMastery' | 'charms' | 'minusCharms', key: string, label: string) => {
    const value = (bonuses[group] as Numbers)[key] ?? 0
    return <Field key={key} label={label} hint={value ? `${value * perPoint}%` : undefined} min={0} disabled={busy} value={value} onChange={set(group, key)} />
  }

  return (
    <Dialog title={t.name} onClose={onClose}>
      <div className="inv-setup__top">
        <img src={instanceImage(item)} alt="" width={64} height={64} />
        <div>
          <div className={'inv-setup__count' + (left < 0 ? ' is-over' : '')} role="status">
            Заполнено <b>{spent}</b> из <b>{budget}</b> · осталось <b>{left}</b>
          </div>
          <small>Одно очко — единица стата или {perPoint}%. Стат можно увести в минус, очки это не возвращает.</small>
          {item.canSetIcon && <ItemIconPicker itemId={item.id} label={item.iconVersion ? 'Сменить картинку' : 'Загрузить картинку'} />}
        </div>
      </div>

      <div className="inv-setup__groups">
        {ownStats.length > 0 && <Section title="Сама вещь">
          {ownStats.map(([key, label, hint]) => <Field key={key} label={label} hint={hint} min={0} disabled={busy} value={own[key] ?? 0}
            onChange={value => setOwn(prev => ({ ...prev, [key]: value }))} />)}
        </Section>}
        <Section title="Статы">
          {STAT_LABELS.map(([key, label]) => <Field key={key} label={label} min={-budget} disabled={busy} value={bonuses.stats[key] ?? 0} onChange={set('stats', key)} />)}
        </Section>
        <Section title="Мастерства, %">
          {MASTERY_LABELS.map(([key, label]) => percentField('mastery', key, label))}
        </Section>
        <Section title="Минус мастерства, %">
          {MASTERY_LABELS.map(([key, label]) => percentField('minusMastery', key, `${label} [противнику]`))}
        </Section>
        <Section title="Обереги, %">
          {CHARM_LABELS.map(([key, label]) => percentField('charms', key, label))}
        </Section>
        <Section title="Минус обереги, %">
          {CHARM_LABELS.map(([key, label]) => percentField('minusCharms', key, `${label} [противнику]`))}
        </Section>
      </div>

      <footer className="inv-setup__foot">
        {offer && (item.namedLevel ?? 0) < offer.maxLevel && (
          <button type="button" className="btn btn-sm" disabled={busy}
            onClick={() => { if (window.confirm(`Поднять уровень вещи за ${offer.priceUsd.toLocaleString('ru')} $? Добавится ${offer.points} очков.`)) levelUp.mutate() }}>
            {levelUp.isPending ? 'Поднимаем…' : `Уровень ${(item.namedLevel ?? 0) + 1}: +${offer.points} очков за ${offer.priceUsd.toLocaleString('ru')} $`}
          </button>
        )}
        <button type="button" className="btn btn-primary" disabled={busy || left < 0}
          title={left < 0 ? `Лишних очков: ${-left}` : undefined} onClick={() => save.mutate()}>
          {save.isPending ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </footer>
    </Dialog>
  )
}

const pct = (share = 0) => `${Math.round(share * 1000) / 10}%`
const minusPct = (share = 0) => (share > 0 ? `−${pct(share)}` : '0%')

function Totals({ rows }: { rows: [key: string, label: string, value: string][] }) {
  return <dl className="inv-setup__totals">{rows.map(([key, label, value]) => <div key={key}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
}

/** Итог всего надетого: статы персонажа с прибавками, мастерства и обереги. */
export function GearSummaryDialog({ char, onClose }: { char: Character; onClose: () => void }) {
  const gear = char.gear
  return (
    <Dialog title="Итог комплекта" onClose={onClose}>
      <div className="inv-setup__groups">
        <Section title="Статы">
          <Totals rows={STAT_LABELS.map(([key, label]) => {
            const base = char.stats?.[key] ?? 0
            const plus = gear?.stats[key] ?? 0
            return [key, label, plus ? `${base + plus} (${plus > 0 ? '+' : '−'}${Math.abs(plus)})` : String(base)]
          })} />
        </Section>
        <Section title="Мастерства">
          <Totals rows={MASTERY_LABELS.map(([key, label]) => [key, label, pct(gear?.mastery?.[key])])} />
        </Section>
        <Section title="Минус мастерства">
          <Totals rows={MASTERY_LABELS.map(([key, label]) => [key, `${label} [противнику]`, minusPct(gear?.minusMastery?.[key])])} />
        </Section>
        <Section title="Обереги">
          <Totals rows={CHARM_LABELS.map(([key, label]) => [key, label, pct(gear?.[key])])} />
        </Section>
        <Section title="Минус обереги">
          <Totals rows={CHARM_LABELS.map(([key, label]) => [key, `${label} [противнику]`, minusPct(gear?.minus?.[key])])} />
        </Section>
      </div>
    </Dialog>
  )
}
