// =============================================================
// Краткий профиль бойца — карточка в боковом поле боевого экрана.
//
// Сцена макета вертикальная (900x1600), а экран горизонтальный: на
// 1440x900 она занимает 617 px, и по бокам остаётся по 411 px пустоты.
// Туда и уходят карточки: своя слева, противника справа — тем же
// порядком, что карточка персонажа на главном экране города.
//
// В макет боя они не входят и потому живут ВНЕ сцены, в экранном
// масштабе: ужимать их вместе с ней смысла нет, а читаться они должны
// всегда. На узком экране, где поля нет, карточки просто не рисуются.
// =============================================================
import { itemImage } from '../../../shared/assets/shop/shop-images'

export interface SideCardFighter {
  name: string
  level?: number
  avatar?: string | null
  hp: number
  hpMax: number
  primaryHand?: string | null
  secondaryHand?: string | null
  primaryWeaponCode?: string | null
  secondaryWeaponCode?: string | null
  primaryWeaponType?: string | null
  secondaryWeaponType?: string | null
  primaryRange?: number
  secondaryRange?: number
  stats?: { str: number; agi: number; rea: number; acc: number; end: number; luck: number; agr: number } | null
}

const STAT_LABELS: [keyof NonNullable<SideCardFighter['stats']>, string][] = [
  ['str', 'СИЛ'], ['agi', 'ЛВК'], ['rea', 'РЕА'],
  ['acc', 'МТК'], ['end', 'ВЫН'], ['luck', 'ФРТ'], ['agr', 'АГР'],
]

function Weapon({ hand, name, code, type, range }: {
  hand: string; name?: string | null; code?: string | null; type?: string | null; range?: number
}) {
  const image = itemImage(code ?? 'weapon_fists', type ?? 'MELEE', 'WEAPON')
  return (
    <div className="battle-side-card__weapon">
      <span className="battle-side-card__hand">{hand}</span>
      {image && <img src={image} alt="" draggable={false} />}
      <b title={name ?? 'Кулак'}>{name || 'Кулак'}</b>
      {range != null && <i>{range}</i>}
    </div>
  )
}

export function BattleSideCard({ side, fighter }: { side: 'self' | 'enemy'; fighter: SideCardFighter }) {
  const pct = fighter.hpMax > 0 ? Math.max(0, Math.min(100, fighter.hp / fighter.hpMax * 100)) : 0
  return (
    <aside className={`battle-side-card is-${side}`}
      aria-label={side === 'self' ? 'Ваш профиль' : 'Профиль противника'}>
      <header>
        <b>{fighter.name}</b>
        {fighter.level != null && <small>ур. {fighter.level}</small>}
      </header>

      {fighter.avatar
        ? <img className="battle-side-card__portrait" src={fighter.avatar} alt="" draggable={false} />
        : <div className="battle-side-card__portrait is-empty" aria-hidden="true" />}

      <div className="battle-side-card__hp" role="progressbar"
        aria-label={`Здоровье ${fighter.hp} из ${fighter.hpMax}`}
        aria-valuenow={fighter.hp} aria-valuemin={0} aria-valuemax={fighter.hpMax}>
        <i style={{ transform: `scaleX(${pct / 100})` }} />
        <span>{fighter.hp} / {fighter.hpMax}</span>
      </div>

      <div className="battle-side-card__weapons">
        <Weapon hand="Левая" name={fighter.primaryHand} code={fighter.primaryWeaponCode}
          type={fighter.primaryWeaponType} range={fighter.primaryRange} />
        <Weapon hand="Правая" name={fighter.secondaryHand} code={fighter.secondaryWeaponCode}
          type={fighter.secondaryWeaponType} range={fighter.secondaryRange} />
      </div>

      {fighter.stats && (
        <dl className="battle-side-card__stats">
          {STAT_LABELS.map(([key, label]) => (
            <div key={key}><dt>{label}</dt><dd>{fighter.stats![key]}</dd></div>
          ))}
        </dl>
      )}
    </aside>
  )
}
