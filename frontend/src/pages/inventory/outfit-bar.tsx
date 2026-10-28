import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { inventoryApi } from '../../shared/api/inventory.api'
import { ApiError } from '../../shared/api/client'

/** Комплекты одежды (обещание игрокам 22.10): сохранить надетое и надеть
    одной кнопкой. Переодеваются только на Складе — сюда же ведёт дом. */
export function OutfitBar({ disabled, onMessage }: { disabled: boolean; onMessage: (type: 'success' | 'error', text: string) => void }) {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['inventory', 'outfits'], queryFn: inventoryApi.outfits })
  const fail = (e: unknown) => onMessage('error', e instanceof ApiError ? e.message : 'Не получилось')
  const save = useMutation({
    mutationFn: ({ slot, name }: { slot: number; name?: string }) => inventoryApi.saveOutfit(slot, name),
    onSuccess: r => { void qc.invalidateQueries({ queryKey: ['inventory', 'outfits'] }); onMessage('success', `${r.name}: сохранено вещей — ${r.count}`) },
    onError: fail,
  })
  const wear = useMutation({
    mutationFn: (slot: number) => inventoryApi.wearOutfit(slot),
    onSuccess: r => {
      void qc.invalidateQueries({ queryKey: ['inventory'] }); void qc.invalidateQueries({ queryKey: ['character'] })
      onMessage(r.skipped.length ? 'error' : 'success', `Надето вещей: ${r.equipped}${r.skipped.length ? `. Не надето: ${r.skipped.join(', ')}` : ''}`)
    },
    onError: fail,
  })
  const slots = Array.from({ length: list.data?.slots ?? 3 }, (_, i) => i + 1)
  const busy = disabled || save.isPending || wear.isPending
  // Правка заказчика 28.10: «есть комплекты, а создать их нельзя». Создавались
  // они кнопкой «Сохранить», но пустой комплект выглядел мёртвой кнопкой и
  // было неясно, что сохраняется. Теперь подписи прямые и имя задаётся сразу.
  const remember = (slot: number, current?: string) => {
    if (current && !window.confirm(`Перезаписать «${current}» тем, что надето сейчас?`)) return
    const name = window.prompt('Как назвать комплект? Сохранится то, что сейчас надето.', current ?? `Комплект ${slot}`)
    if (name === null) return
    save.mutate({ slot, name: name.trim().slice(0, 30) || undefined })
  }
  return (
    <div className="inv-outfits" aria-label="Комплекты">
      <span className="inv-outfits__title">Комплекты:</span>
      {slots.map(slot => {
        const preset = list.data?.items?.find(p => p.slot === slot)
        return <span key={slot} className="inv-outfit">
          <button type="button" className="btn btn-sm btn-primary" disabled={busy || !preset}
            title={preset ? `Надеть: ${preset.count} вещ.` : 'Пусто: наденьте вещи и нажмите «Запомнить надетое»'} onClick={() => wear.mutate(slot)}>
            {preset ? `Надеть «${preset.name}»` : `Комплект ${slot} пуст`}
          </button>
          <button type="button" className="btn btn-sm" disabled={busy}
            title="Запомнить в этот комплект всё, что надето сейчас"
            onClick={() => remember(slot, preset?.name)}>
            Запомнить надетое
          </button>
        </span>
      })}
    </div>
  )
}
