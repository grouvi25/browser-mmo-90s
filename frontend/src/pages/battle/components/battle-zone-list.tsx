// =============================================================
// Зоны удара и блока — компактным списком (правка заказчика 22.10:
// «зоны удара и блока можно сделать меньше, такие большие смысла нет
// держать»). Правила выбора те же, что у большой панели макета
// (battle-fighter-panel.tsx): у каждой зоны две ячейки — два блока или
// удар каждой рукой своей кнопкой. Ноги — одна зона (правка 22.10).
//
// Точка у зоны — её рана: зелёная, жёлтая, оранжевая, красная.
// =============================================================
import type { AttackHand, BodyZone } from '../../../shared/api/battles.api'
import { BATTLE_ZONES } from '../battle-view-model'

const HANDS: readonly AttackHand[] = ['LEFT_HAND', 'RIGHT_HAND']

interface Common {
  title: string
  selected: BodyZone[]
  limit: number
  disabled?: boolean
  wounds?: Partial<Record<string, number>>
}

type Props = Common & (
  | { mode: 'block'; onZone: (zone: BodyZone, slot: number) => void }
  | { mode: 'attack'; selectedHands: AttackHand[]; disabledHands?: AttackHand[]; note?: string; onHandZone: (hand: AttackHand, zone: BodyZone) => void }
)

export function BattleZoneList(props: Props) {
  const full = props.selected.length >= props.limit
  return (
    <section className={`zone-list is-${props.mode}`} aria-label={props.title}>
      <header><b>{props.title}</b><span>{props.selected.length} / {props.limit}</span></header>
      {BATTLE_ZONES.map(zone => {
        const cells = 2
        const wound = Math.min(3, props.wounds?.[zone.key] ?? 0)
        return (
          <div key={zone.key} className="zone-list__row">
            <i className={`zone-list__wound is-${wound}`} title={wound >= 3 ? 'Вещь снята' : `Попаданий: ${wound}`} />
            <span className="zone-list__label">{zone.label}</span>
            {props.mode === 'block' ? Array.from({ length: cells }, (_, slot) => {
              const placed = props.selected.filter(value => value === zone.key).length
              const taken = placed > slot
              return (
                <button key={slot} type="button" className={'zone-list__btn' + (taken ? ' is-on' : '')}
                  aria-pressed={taken}
                  aria-label={`${taken ? 'Снять блок' : 'Поставить блок'}: ${zone.short}${slot ? ', второй' : ''}`}
                  disabled={props.disabled || props.limit === 0 || (!taken && (full || placed < slot))}
                  onClick={() => props.onZone(zone.key, slot)}>
                  {taken ? 'блок' : '·'}
                </button>
              )
            }) : (() => {
              const used = (hand: AttackHand) => props.selectedHands.includes(hand)
              const picked = (hand: AttackHand) => props.selected.some((value, index) => value === zone.key && props.selectedHands[index] === hand)
              const hands = cells > 1 ? HANDS : [used('LEFT_HAND') ? 'RIGHT_HAND' : 'LEFT_HAND'] as AttackHand[]
              return hands.map(hand => {
                const on = picked(hand)
                return (
                  <button key={hand} type="button" className={'zone-list__btn' + (on ? ' is-on' : '')}
                    aria-pressed={on}
                    aria-label={`Удар ${hand === 'LEFT_HAND' ? 'левой' : 'правой'} рукой, цель: ${zone.short}`}
                    disabled={props.disabled || props.disabledHands?.includes(hand) || props.limit === 0
                      || (used(hand) && !on) || (!on && full)}
                    onClick={() => props.onHandZone(hand, zone.key)}>
                    {hand === 'LEFT_HAND' ? 'Л' : 'П'}
                  </button>
                )
              })
            })()}
          </div>
        )
      })}
      {props.mode === 'attack' && props.note && <p className="zone-list__note">{props.note}</p>}
    </section>
  )
}
