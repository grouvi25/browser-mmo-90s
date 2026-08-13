import { Pill } from 'lucide-react'
import type { ItemInstance } from '../../../shared/types/api.types'

export function BattlePockets({
  slots, canAct, open, onOpenChange, onUse,
}: {
  slots: (ItemInstance | null)[]
  canAct: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onUse: (id: string) => void
}) {
  const filled = slots.filter(Boolean).length
  return (
    <section className="battle-disclosure">
      <button type="button" className="battle-disclosure__toggle" aria-expanded={open} onClick={() => onOpenChange(!open)}>
        <Pill size={14} /> <span>Карман {filled} / 4</span>
        <span className="battle-pocket-dots" aria-hidden="true">{slots.map((item, index) => <i key={index} className={item ? 'is-filled' : ''} />)}</span>
      </button>
      {open && (
        <div className="battle-pocket-list">
          {slots.map((item, index) => (
            <div key={index} className={item ? 'battle-pocket is-filled' : 'battle-pocket'}>
              <span className="battle-pocket__num">#{index + 1}</span>
              {item ? (
                <>
                  <div><b>{item.template.name}</b><small>{(item.template.hpBonus ?? 0) > 0 ? `+${item.template.hpBonus} HP` : 'Расходник'}</small></div>
                  <button type="button" className="btn btn-sm btn-success" disabled={!canAct} onClick={() => onUse(item.id)}>Использовать</button>
                </>
              ) : <span className="text-dim">Пусто</span>}
            </div>
          ))}
          <p>Состав выбран до боя и сейчас не меняется.</p>
        </div>
      )}
    </section>
  )
}
