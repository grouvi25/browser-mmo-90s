import type { AttackHand, BodyZone } from '../../../shared/api/battles.api'
import { itemImage } from '../../../shared/assets/shop/shop-images'
import { BATTLE_ZONES } from '../battle-view-model'
import zoneArmor from '../../../shared/assets/battle/zone-armor.png'
import zoneFist from '../../../shared/assets/battle/zone-fist.png'

const ZONE_CLASS: Record<BodyZone, string> = {
  HEAD: 'head', CHEST: 'chest', LEFT_ARM: 'left-arm', RIGHT_ARM: 'right-arm', LEGS: 'legs',
}

interface BattleFighterPanelProps {
  side: 'self' | 'enemy'
  name: string
  level?: number
  avatar?: string | null
  hp: number
  hpMax: number
  mode: 'attack' | 'block'
  selected: BodyZone[]
  selectedHands?: AttackHand[]
  limit: number
  disabled?: boolean
  disabledHands?: AttackHand[]
  disabledReason?: string
  primaryHand?: string | null
  secondaryHand?: string | null
  primaryWeaponCode?: string | null
  secondaryWeaponCode?: string | null
  primaryWeaponType?: string | null
  secondaryWeaponType?: string | null
  onZone: (zone: BodyZone, slot?: number) => void
  onHandZone?: (hand: AttackHand, zone: BodyZone) => void
}

function WeaponCell({
  hand, name, code, weaponType,
}: {
  hand: 'Левая' | 'Правая'
  name?: string | null
  code?: string | null
  weaponType?: string | null
}) {
  const image = itemImage(code ?? 'weapon_fists', weaponType ?? 'MELEE', 'WEAPON')
  return <div className="battle-profile-weapon">
    <span>{hand} рука</span>
    {image && <img src={image} alt="" draggable={false} />}
    <b title={name ?? 'Кулак'}>{name || 'Кулак'}</b>
  </div>
}


/**
 * Индикатор состояния зон из макета: фигурка по краю панели, где закрашены
 * те части тела, которые уже разобраны текущим планом хода.
 *
 * Макет рисует три цвета, но чем именно они различаются — бронёй, уроном
 * или и тем и другим — заказчиком не сказано (открытый вопрос 4 в разборе
 * макета). Пока показываем то, что читается однозначно: разобрана зона
 * планом или нет.
 */
function ZoneIndicator({ mode, selected }: { mode: 'attack' | 'block'; selected: BodyZone[] }) {
  const covered = (zone: BodyZone) => selected.includes(zone)
  const label = mode === 'attack' ? 'Куда бьём' : 'Что закрыто'
  return (
    <div className={`zone-indicator is-${mode}`} title={label} role="img" aria-label={label}>
      {BATTLE_ZONES.map(zone => (
        <i
          key={zone.key}
          className={`zone-indicator__part is-${ZONE_CLASS[zone.key]}${covered(zone.key) ? ' is-on' : ''}`}
        />
      ))}
    </div>
  )
}

export function BattleFighterPanel(props: BattleFighterPanelProps) {
  const pct = props.hpMax > 0 ? Math.max(0, Math.min(100, props.hp / props.hpMax * 100)) : 0
  // Подписи панелей взяты с макета: «Зона удара» и «Зона блока».
  const instruction = props.mode === 'attack' ? 'Зона удара' : 'Зона блока'
  const handSelected = (hand: AttackHand, zone: BodyZone) => props.selected.some((value, index) => value === zone && props.selectedHands?.[index] === hand)
  const handUsed = (hand: AttackHand) => props.selectedHands?.includes(hand) ?? false

  return <section className={`battle-fighter-panel is-${props.side}`} aria-label={`${props.name}: ${instruction.toLowerCase()}`}>
    <header className="battle-fighter-panel__head">
      <div><b>{props.name}</b>{props.level != null && <small>ур. {props.level}</small>}</div>
      <div className="battle-fighter-panel__hp" aria-label={`Здоровье ${props.hp} из ${props.hpMax}`}>
        <i style={{ transform: `scaleX(${pct / 100})` }} />
        <span>{props.hp} / {props.hpMax}</span>
      </div>
    </header>

    <div className="battle-profile-summary battle-profile-summary--flat">
      <div className="battle-profile-weapons" aria-label="Оружие в руках">
        <WeaponCell hand="Левая" name={props.primaryHand} code={props.primaryWeaponCode} weaponType={props.primaryWeaponType} />
        <WeaponCell hand="Правая" name={props.secondaryHand} code={props.secondaryWeaponCode} weaponType={props.secondaryWeaponType} />
      </div>
    </div>

    <div className="battle-fighter-panel__mode"><span>{instruction}</span><b>{props.selected.length} / {props.limit}</b></div>

    <div className="battle-fighter-panel__figure">
      <ZoneIndicator mode={props.mode} selected={props.selected} />
      <div className="battle-fighter-panel__body" aria-hidden="true">
        <i className="battle-body-part is-head" />
        <i className="battle-body-part is-chest" />
        <i className="battle-body-part is-left-arm" />
        <i className="battle-body-part is-right-arm" />
        <i className="battle-body-part is-left-leg" />
        <i className="battle-body-part is-right-leg" />
      </div>

      {BATTLE_ZONES.map(zone => {
        const full = props.mode === 'block' && props.selected.length >= props.limit
        if (props.mode === 'block') {
          // Две ячейки на зону — как две руки для удара. Второй блок
          // держит удачный удар, который одиночный пропускает.
          const placed = props.selected.filter(value => value === zone.key).length
          return <div key={zone.key} className={`battle-fighter-zone battle-hand-zone is-${ZONE_CLASS[zone.key]}`}>
            <span>{zone.caption}</span><div>
              {[0, 1].map(slot => {
                const taken = placed > slot
                return <button key={slot} type="button"
                  className={taken ? 'is-selected' : ''}
                  aria-label={`${taken ? 'Снять блок' : 'Поставить блок'}: ${zone.label.toLocaleLowerCase('ru')}${slot ? ', второй' : ''}`}
                  aria-pressed={taken}
                  disabled={props.disabled || props.limit === 0 || (!taken && (full || placed < slot))}
                  onClick={() => props.onZone(zone.key, slot)}>
                  {taken
                    ? <img src={zoneArmor} alt="" className="zone-mark" draggable={false} />
                    : <i className="zone-dot" aria-hidden="true" />}
                </button>
              })}
            </div>
          </div>
        }
        return <div key={zone.key} className={`battle-fighter-zone battle-hand-zone is-${ZONE_CLASS[zone.key]}`}>
          <span>{zone.caption}</span><div>
            {(['LEFT_HAND', 'RIGHT_HAND'] as const).map(hand => <button key={hand} type="button"
              className={handSelected(hand, zone.key) ? 'is-selected' : ''}
              aria-label={`Удар ${hand === 'LEFT_HAND' ? 'левой' : 'правой'} рукой, цель: ${zone.label.toLocaleLowerCase('ru')}`}
              aria-pressed={handSelected(hand, zone.key)}
              disabled={props.disabled || props.disabledHands?.includes(hand) || props.limit === 0 || (handUsed(hand) && !handSelected(hand, zone.key)) || (!handSelected(hand, zone.key) && props.selected.length >= props.limit)}
              onClick={() => props.onHandZone?.(hand, zone.key)}>
              {handSelected(hand, zone.key)
                ? <img src={zoneFist} alt="" className="zone-mark" draggable={false} />
                : <span className="zone-hand">{hand === 'LEFT_HAND' ? 'Л' : 'П'}</span>}
            </button>)}
          </div>
        </div>
      })}
    </div>

    {props.disabledReason && <p className="battle-fighter-panel__reason">{props.disabledReason}</p>}
  </section>
}
