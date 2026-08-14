import type { AttackHand, BodyZone } from '../../../shared/api/battles.api'
import { BATTLE_ZONES } from '../battle-view-model'

const ZONE_CLASS: Record<BodyZone, string> = {
  HEAD: 'head', CHEST: 'chest', LEFT_ARM: 'left-arm', RIGHT_ARM: 'right-arm', LEGS: 'legs',
}
interface BattleFighterPanelProps {
  side: 'self' | 'enemy'; name: string; level?: number; hp: number; hpMax: number
  mode: 'attack' | 'block'; selected: BodyZone[]; selectedHands?: AttackHand[]; limit: number
  disabled?: boolean; disabledHands?: AttackHand[]; disabledReason?: string; primaryHand?: string | null; secondaryHand?: string | null
  stats?: { str: number; agi: number; rea: number; acc: number; end: number; luck: number; agr: number } | null
  onZone: (zone: BodyZone) => void; onHandZone?: (hand: AttackHand, zone: BodyZone) => void
}
export function BattleFighterPanel(props: BattleFighterPanelProps) {
  const pct = props.hpMax > 0 ? Math.max(0, Math.min(100, props.hp / props.hpMax * 100)) : 0
  const instruction = props.mode === 'attack' ? 'Удары руками' : 'Зоны блока'
  const handSelected = (hand: AttackHand, zone: BodyZone) => props.selected.some((value, index) => value === zone && props.selectedHands?.[index] === hand)
  const handUsed = (hand: AttackHand) => props.selectedHands?.includes(hand) ?? false
  return <section className={`battle-fighter-panel is-${props.side}`} aria-label={`${props.name}: ${instruction.toLowerCase()}`}>
    <header className="battle-fighter-panel__head"><div><b>{props.name}</b>{props.level != null && <small>ур. {props.level}</small>}</div>
      <div className="battle-fighter-panel__hp" aria-label={`Здоровье ${props.hp} из ${props.hpMax}`}><i style={{ transform:`scaleX(${pct / 100})` }}/><span>{props.hp} / {props.hpMax}</span></div>
    </header>
    <div className="battle-fighter-panel__mode"><span>{instruction}</span><b>{props.selected.length} / {props.limit}</b></div>
    {props.stats && <dl className="battle-fighter-panel__stats" aria-label="?????? ??????????????">
      {([['???', props.stats.str], ['???', props.stats.agi], ['???', props.stats.rea], ['???', props.stats.acc], ['???', props.stats.end], ['???', props.stats.luck], ['???', props.stats.agr]] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>}
    <div className="battle-fighter-panel__figure">
      <div className="battle-fighter-panel__body" aria-hidden="true"><i className="battle-body-part is-head"/><i className="battle-body-part is-chest"/><i className="battle-body-part is-left-arm"/><i className="battle-body-part is-right-arm"/><i className="battle-body-part is-left-leg"/><i className="battle-body-part is-right-leg"/></div>
      {BATTLE_ZONES.map(zone => {
        const active = props.selected.includes(zone.key)
        const full = props.mode === 'block' && !active && props.selected.length >= props.limit
        if (props.mode === 'block') return <button key={zone.key} type="button" className={`battle-fighter-zone is-${ZONE_CLASS[zone.key]}${active?' is-selected':''}`}
          aria-label={`Блок: ${zone.label.toLocaleLowerCase('ru')}`} aria-pressed={active} disabled={props.disabled || props.limit === 0 || full} onClick={() => props.onZone(zone.key)}><span>{zone.label}</span></button>
        return <div key={zone.key} className={`battle-fighter-zone battle-hand-zone is-${ZONE_CLASS[zone.key]}`}>
          <span>{zone.label}</span><div>
            {(['LEFT_HAND','RIGHT_HAND'] as const).map(hand => <button key={hand} type="button"
              className={handSelected(hand, zone.key) ? 'is-selected' : ''}
              aria-label={`???? ${hand === 'LEFT_HAND' ? '?????' : '??????'} ?????, ????: ${zone.label.toLocaleLowerCase('ru')}`}
              aria-pressed={handSelected(hand, zone.key)}
              disabled={props.disabled || props.disabledHands?.includes(hand) || props.limit === 0 || (handUsed(hand) && !handSelected(hand, zone.key)) || (!handSelected(hand, zone.key) && props.selected.length >= props.limit)}
              onClick={() => props.onHandZone?.(hand, zone.key)}>{hand === 'LEFT_HAND' ? 'Л' : 'П'}</button>)}
          </div></div>
      })}
    </div>
    {props.disabledReason && <p className="battle-fighter-panel__reason">{props.disabledReason}</p>}
    <footer className="battle-fighter-panel__hands" aria-label="Предметы в руках"><div><span>Левая рука</span><b>{props.primaryHand || 'Кулак'}</b></div><div><span>Правая рука</span><b>{props.secondaryHand || 'Кулак'}</b></div></footer>
  </section>
}
