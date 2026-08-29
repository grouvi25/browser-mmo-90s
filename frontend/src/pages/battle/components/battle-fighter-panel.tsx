import type { AttackHand, BodyZone } from '../../../shared/api/battles.api'
import { itemImage } from '../../../shared/assets/shop/shop-images'
import { BATTLE_ZONES } from '../battle-view-model'
import zoneArmor from '../../../shared/assets/battle/zone-armor.png'
import zoneFist from '../../../shared/assets/battle/zone-fist.png'
import silhouette from '../../../shared/assets/battle/silhouette.png'

const ZONE_CLASS: Record<BodyZone, string> = {
  HEAD: 'head', CHEST: 'chest', LEFT_ARM: 'left-arm', RIGHT_ARM: 'right-arm', LEGS: 'legs',
}

// =============================================================
// Геометрия панели снята с макета «Профиль игрока Боевка.psd»
// (холст 1800x3200). Панель зоны блока занимает x 0…897,
// y 1313…1937 — отсюда система координат ниже: 897 x 624.
//
// Ячейка нарисована 103x103, и на каждую зону их ровно две.
// Ячейки НЕ стоят парами вплотную: слоты рук разнесены к обоим
// краям панели (69 и 561 для левой руки, 172 и 664 для правой),
// поэтому позиция задаётся каждой ячейке отдельно, а не блоку.
// Подпись лежит внутри ячейки сверху, а не под ней.
// =============================================================
const PANEL_W = 897
const PANEL_H = 624
const CELL = 103

interface ZoneCell { x: number; y: number; caption: string }

const ZONE_CELLS: Record<BodyZone, readonly [ZoneCell, ZoneCell]> = {
  HEAD:      [{ x: 310, y: 38, caption: 'Голова' }, { x: 413, y: 38, caption: 'Голова' }],
  CHEST:     [{ x: 309, y: 194, caption: 'Корпус' }, { x: 412, y: 194, caption: 'Корпус' }],
  LEFT_ARM:  [{ x: 69, y: 290, caption: 'Л.рука' }, { x: 561, y: 290, caption: 'Л.рука' }],
  RIGHT_ARM: [{ x: 172, y: 290, caption: 'П.рука' }, { x: 664, y: 290, caption: 'П.рука' }],
  LEGS:      [{ x: 308, y: 484, caption: 'Л.нога' }, { x: 411, y: 484, caption: 'П.нога' }],
}

/** Ячейка в долях панели — так пропорции макета держатся при любой ширине колонки. */
function cellStyle(cell: ZoneCell) {
  return {
    left: `${cell.x / PANEL_W * 100}%`,
    top: `${cell.y / PANEL_H * 100}%`,
    width: `${CELL / PANEL_W * 100}%`,
    height: `${CELL / PANEL_H * 100}%`,
  }
}

// Силуэт: слой «Силует 1», холст 283,1321 · 260x616 — то есть
// от верха панели он отступает на 8 px и занимает её почти целиком.
const SILHOUETTE_STYLE = {
  left: `${283 / PANEL_W * 100}%`,
  top: `${8 / PANEL_H * 100}%`,
  width: `${260 / PANEL_W * 100}%`,
  height: `${616 / PANEL_H * 100}%`,
}

// Карточка индикатора: слой «Индикатор», холст 27,1313 · 186x216.
const INDICATOR_STYLE = {
  left: `${27 / PANEL_W * 100}%`,
  top: '0%',
  width: `${186 / PANEL_W * 100}%`,
  height: `${216 / PANEL_H * 100}%`,
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
  // Макет рисует шесть частей: голова, торс, две руки и две ноги.
  // Ног в боевой системе одна зона, поэтому обе фигурки ведёт LEGS.
  const parts: { part: string; zone: BodyZone }[] = [
    { part: 'head', zone: 'HEAD' },
    { part: 'chest', zone: 'CHEST' },
    { part: 'arm-l', zone: 'LEFT_ARM' },
    { part: 'arm-r', zone: 'RIGHT_ARM' },
    { part: 'leg-l', zone: 'LEGS' },
    { part: 'leg-r', zone: 'LEGS' },
  ]
  return (
    <div className={`zone-indicator is-${mode}`} style={INDICATOR_STYLE}
      title={label} role="img" aria-label={label}>
      {parts.map(({ part, zone }) => (
        <i
          key={part}
          className={`zone-indicator__part is-${part}${covered(zone) ? ' is-on' : ''}`}
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
      {/* Цифры здоровья продублированы у имени: в макете полоса чистая, на
          ней нет ни числа, ни подписи. На телефоне число с полосы снимается
          и остаётся только здесь, на десктопе видны оба. */}
      <div><b>{props.name}</b>{props.level != null && <small>ур. {props.level}</small>}
        <small className="battle-fighter-panel__hp-num">{props.hp} / {props.hpMax}</small></div>
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

    {/* Обёртка нужна, чтобы коробка макета вписывалась по обеим осям:
        во flex-контексте max-width действительно поджимает ширину,
        а aspect-ratio следом уменьшает высоту. В голом grid-треке
        коробка просто вылезала за панель. */}
    <div className="battle-fighter-panel__stage">
    <div className="battle-fighter-panel__figure">
      <ZoneIndicator mode={props.mode} selected={props.selected} />
      <img className="battle-fighter-panel__body" src={silhouette} alt="" aria-hidden="true"
        draggable={false} style={SILHOUETTE_STYLE} />

      {BATTLE_ZONES.map(zone => {
        const cells = ZONE_CELLS[zone.key]
        const full = props.mode === 'block' && props.selected.length >= props.limit
        if (props.mode === 'block') {
          // Две ячейки на зону — как две руки для удара. Второй блок
          // держит удачный удар, который одиночный пропускает.
          const placed = props.selected.filter(value => value === zone.key).length
          return <div key={zone.key} className="battle-zone-pair">
            {cells.map((cell, slot) => {
              const taken = placed > slot
              return <button key={slot} type="button"
                style={cellStyle(cell)}
                className={`battle-zone-cell is-${ZONE_CLASS[zone.key]}${taken ? ' is-selected' : ''}`}
                aria-label={`${taken ? 'Снять блок' : 'Поставить блок'}: ${zone.label.toLocaleLowerCase('ru')}${slot ? ', второй' : ''}`}
                aria-pressed={taken}
                disabled={props.disabled || props.limit === 0 || (!taken && (full || placed < slot))}
                onClick={() => props.onZone(zone.key, slot)}>
                <span className="battle-zone-cell__caption">{cell.caption}</span>
                {taken
                  ? <img src={zoneArmor} alt="" className="zone-mark" draggable={false} />
                  : <i className="zone-dot" aria-hidden="true" />}
              </button>
            })}
          </div>
        }
        return <div key={zone.key} className="battle-zone-pair">
          {(['LEFT_HAND', 'RIGHT_HAND'] as const).map((hand, slot) => {
            const cell = cells[slot]
            return <button key={hand} type="button"
              style={cellStyle(cell)}
              className={`battle-zone-cell is-${ZONE_CLASS[zone.key]}${handSelected(hand, zone.key) ? ' is-selected' : ''}`}
              aria-label={`Удар ${hand === 'LEFT_HAND' ? 'левой' : 'правой'} рукой, цель: ${zone.label.toLocaleLowerCase('ru')}`}
              aria-pressed={handSelected(hand, zone.key)}
              disabled={props.disabled || props.disabledHands?.includes(hand) || props.limit === 0 || (handUsed(hand) && !handSelected(hand, zone.key)) || (!handSelected(hand, zone.key) && props.selected.length >= props.limit)}
              onClick={() => props.onHandZone?.(hand, zone.key)}>
              <span className="battle-zone-cell__caption">{cell.caption}</span>
              {handSelected(hand, zone.key)
                ? <img src={zoneFist} alt="" className="zone-mark" draggable={false} />
                : <span className="zone-hand">{hand === 'LEFT_HAND' ? 'Л' : 'П'}</span>}
            </button>
          })}
        </div>
      })}
    </div>
    </div>

    {props.disabledReason && <p className="battle-fighter-panel__reason">{props.disabledReason}</p>}
  </section>
}
