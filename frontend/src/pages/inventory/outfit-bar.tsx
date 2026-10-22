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
    mutationFn: (slot: number) => inventoryApi.saveOutfit(slot),
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
  return (
    <div className="inv-outfits" aria-label="Комплекты">
      {slots.map(slot => {
        const preset = list.data?.items?.find(p => p.slot === slot)
        return <span key={slot} className="inv-outfit">
          <button type="button" className="btn btn-sm btn-primary" disabled={busy || !preset}
            title={preset ? `Надеть: ${preset.count} вещ.` : 'Комплект пуст'} onClick={() => wear.mutate(slot)}>
            {preset?.name ?? `Комплект ${slot}`}
          </button>
          <button type="button" className="btn btn-sm" disabled={busy}
            title="Сохранить сюда то, что надето сейчас"
            onClick={() => { if (!preset || window.confirm(`Перезаписать «${preset.name}» тем, что надето сейчас?`)) save.mutate(slot) }}>
            Сохранить
          </button>
        </span>
      })}
    </div>
  )
}
