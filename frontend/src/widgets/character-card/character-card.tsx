// =============================================================
// Левая карточка «личное дело» на главном экране.
// Всё кликабельно: вкладки, портрет, слоты снаряжения и зоны тела.
// Данные — настоящие, из /api/characters/me и /api/inventory.
//
// Второй режим — чужой профиль. Карточке отдают готовые данные
// (`profile`), и она перестаёт ходить в свои запросы: так тот же
// рисунок на псд-бумаге показывает противника на экране боя, а не
// только владельца аккаунта. В этом режиме карточка только
// показывает: вкладок, переходов и выбора зон нет, потому что о
// чужом персонаже мы знаем лишь то, что отдаёт боевой профиль.
// =============================================================
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { charactersApi } from '../../shared/api/characters.api'
import { inventoryApi } from '../../shared/api/inventory.api'
import { MENU, ZONE_ARMOR_SLOTS } from '../../shared/lib/layout-map'
import { FitText, Layer } from '../../shared/lib/stage'
import { Sprite, SpriteButton } from '../../shared/ui/sprite'
import type { ItemInstance } from '../../shared/types/api.types'
import { ARMOR_SLOT_LABELS, WEAPON_TYPE_LABELS } from '../../shared/types/api.types'
import { itemImage } from '../../shared/assets/shop/shop-images'
import { IntoxicationBadge } from '../intoxication-badge/intoxication-badge'

const C = MENU.card

type CardTab = 'overview' | 'gear' | 'person'

/** Шесть боевых зон: у ног, как и у рук, левая и правая — разные цели. */
const ZONE_KEYS = ['HEAD', 'CHEST', 'LEFT_ARM', 'RIGHT_ARM', 'LEFT_LEG', 'RIGHT_LEG'] as const
type ZoneKey = (typeof ZONE_KEYS)[number]

const ZONE_LABELS: Record<ZoneKey, string> = {
  HEAD: 'Голова', CHEST: 'Корпус', LEFT_ARM: 'Левая рука',
  RIGHT_ARM: 'Правая рука', LEFT_LEG: 'Левая нога', RIGHT_LEG: 'Правая нога',
}

/** Художка есть только на автомат и биту — выбираем по типу оружия. */
function weaponSprite(item: ItemInstance | undefined): string {
  if (!item) return 'item-ak'
  const t = item.template.weaponType
  if (t && ['PISTOL', 'SHOTGUN', 'SMG', 'RIFLE', 'SNIPER', 'HEAVY'].includes(t)) return 'item-ak'
  return 'item-bat'
}

/** Строк снаряжения помещается в бумагу карточки; остальное — ссылкой. */
const GEAR_ROWS = 5

/** Чужой профиль: ровно то, что о бойце известно боевому экрану. */
export interface CardProfile {
  nickname: string
  level: number
  hp: number
  hpMax: number
  avatar?: string | null
  weaponName?: string | null
  weaponCode?: string | null
  weaponType?: string | null
  offhandName?: string | null
  offhandCode?: string | null
}

export function CharacterCard({ profile }: { profile?: CardProfile } = {}) {
  const navigate = useNavigate()
  const [tab, setTab] = useState<CardTab>('overview')
  const [zone, setZone] = useState<ZoneKey | null>(null)
  // Чужая карточка не ходит в наши запросы: иначе она показала бы
  // владельца аккаунта под чужим именем.
  const own = !profile

  const { data: char } = useQuery({
    queryKey: ['character', 'me'],
    queryFn: () => charactersApi.getMe(),
    retry: false,
    refetchInterval: 30_000,
    enabled: own,
  })
  const { data: items } = useQuery({
    queryKey: ['inventory'],
    queryFn: () => inventoryApi.getItems(),
    retry: false,
    enabled: own,
  })

  const equipped = useMemo(
    () => (items ?? []).filter(i => i.isEquipped),
    [items],
  )

  /** Броня по зоне — та же карта слотов, что на бэкенде в zones.ts */
  const zoneArmor = useMemo(() => {
    const out: Record<string, number> = {}
    for (const z of ZONE_KEYS) {
      const slots = ZONE_ARMOR_SLOTS[z] ?? []
      out[z] = equipped
        .filter(i => i.armorSlot && slots.includes(i.armorSlot))
        .reduce((s, i) => s + (i.template.armor ?? 0), 0)
    }
    return out
  }, [equipped])

  const weapon = equipped.find(i => i.template.type === 'WEAPON'
    && i.armorSlot !== 'RIGHT_HAND')
  const offhand = equipped.find(i => i.armorSlot === 'RIGHT_HAND')

  const hp = profile?.hp ?? char?.hpCurrent ?? 0
  const energy = profile?.level ?? char?.battleLevel ?? 0
  const nickname = profile?.nickname ?? char?.nickname ?? '—'
  const hpMax = profile?.hpMax ?? char?.hpMax

  return (
    <>
      {/* ── вкладки карточки ─────────────────────────────── */}
      {/* У чужой карточки вкладок нет: «Надето» и «Личное дело»
          показывать нечем — боевой профиль этих данных не отдаёт. */}
      {own && C.tabs.map(t => (
        <SpriteButton
          key={t.key}
          name={t.sprite}
          box={t.box}
          title={t.label}
          active={tab === t.key}
          onClick={() => setTab(t.key as CardTab)}
        />
      ))}

      {/* ── портрет ──────────────────────────────────────── */}
      <SpriteButton
        name="portrait"
        src={profile?.avatar ?? undefined}
        box={C.portrait}
        className="portrait-hot"
        disabled={!own}
        title={own
          ? (char ? `${char.nickname} — открыть личное дело` : 'Личное дело')
          : nickname}
        onClick={own ? () => navigate('/profile') : undefined}
      />

      {/* ── показатели поверх портрета ───────────────────── */}
      {/* Иконки вырезаны из подложки отдельными спрайтами, поэтому
          рисуем их сами — иначе над цифрами будет пустое место. */}
      <Sprite name="icon-energy" box={C.energyIcon} />
      <Sprite name="icon-hp" box={C.hpIcon} />
      <FitText
        x={C.energyText.x} y={C.energyText.y} w={C.energyText.w}
        size={20.8} className="stat-num stat-num--energy"
        title={`Боевой уровень: ${energy}`}
      >
        {energy}
      </FitText>
      <FitText
        x={C.hpText.x} y={C.hpText.y} w={C.hpText.w}
        size={20.8} className="stat-num stat-num--hp"
        title={hpMax != null ? `Здоровье: ${hp} из ${hpMax}` : 'Здоровье'}
      >
        {hp}
      </FitText>

      {/* Этап 3: градус рядом с ХП — сам прячется, пока персонаж трезв.
          У чужой карточки его нет: градус читается только у себя. */}
      {own && <IntoxicationBadge />}

      {/* ── ник ──────────────────────────────────────────── */}
      <FitText
        x={C.nickname.x} y={C.nickname.y} w={C.nickname.w}
        size={C.nickname.size} className="nick-badge"
        title={own ? 'Открыть личное дело' : nickname}
        as={own ? 'button' : 'div'}
        onClick={own ? () => navigate('/profile') : undefined}
      >
        {nickname}
      </FitText>

      {/* ── тело карточки: зависит от выбранной вкладки ──── */}
      {(!own || tab === 'overview') && (
        <>
          {/* рамки слотов: вырезаны из подложки, поэтому рисуем их сами
              и только здесь — на других вкладках карточка остаётся чистой */}
          {C.slots.map(s => <Sprite key={s.key} name={`slot-frame-${s.key}`} box={s.frame} />)}

          <SpriteButton
            name={own ? weaponSprite(weapon) : 'item-ak'}
            src={own
              ? (weapon ? itemImage(weapon.template.code, weapon.template.weaponType) : undefined)
              : (profile?.weaponCode
                ? itemImage(profile.weaponCode, profile.weaponType ?? undefined, 'WEAPON') ?? undefined
                : undefined)}
            box={C.slots[0].box}
            empty={own ? !weapon : !profile?.weaponCode}
            disabled={!own}
            title={own
              ? (weapon
                ? `${weapon.template.name} · прочность ${weapon.durabilityCurrent}/${weapon.durabilityMax}`
                : 'Оружие не надето — открыть снаряжение')
              : `Левая рука: ${profile?.weaponName || 'кулак'}`}
            onClick={own ? () => navigate('/inventory') : undefined}
          />
          <SpriteButton
            name="item-bat"
            src={!own && profile?.offhandCode
              ? itemImage(profile.offhandCode, undefined, 'WEAPON') ?? undefined
              : undefined}
            box={C.slots[1].box}
            empty={own ? !offhand : !profile?.offhandCode}
            disabled={!own}
            title={own
              ? (offhand
                ? `${offhand.template.name} · прочность ${offhand.durabilityCurrent}/${offhand.durabilityMax}`
                : 'Правая рука свободна — открыть снаряжение')
              : `Правая рука: ${profile?.offhandName || 'кулак'}`}
            onClick={own ? () => navigate('/inventory') : undefined}
          />
          <SpriteButton
            name="item-dog"
            box={C.slots[2].box}
            disabled
            title="Питомцы появятся в Этапе 3"
          />

          {/* зоны тела — цели ударов в бою */}
          {C.zones.map(z => {
            const key = z.key as ZoneKey
            const armor = zoneArmor[key] ?? 0
            return (
              <SpriteButton
                key={z.key}
                name={z.sprite}
                box={z.box}
                className="zone-hot"
                active={own && zone === key}
                disabled={!own}
                // Броня чужого бойца нам неизвестна: боевой профиль
                // отдаёт оружие и характеристики, но не зональную защиту.
                title={own ? `${z.label} · броня ${armor}` : z.label}
                onClick={own ? () => setZone(zone === key ? null : key) : undefined}
              />
            )
          })}

          {/* подпись выбранной зоны */}
          {zone && (
            <Layer box={C.zoneNote} className="card-note">
              {ZONE_LABELS[zone]}: броня {zoneArmor[zone] ?? 0}
            </Layer>
          )}
        </>
      )}

      {tab === 'gear' && (
        <Layer box={C.body} className="card-list">
          <div className="card-list__title">Надето</div>
          {equipped.length === 0 && <div className="card-list__empty">Ничего не надето</div>}
          {equipped.slice(0, GEAR_ROWS).map(i => (
            <button
              key={i.id}
              type="button"
              className="card-list__row"
              onClick={() => navigate('/inventory')}
              title="Открыть снаряжение"
            >
              <span className="card-list__name">{i.template.name}</span>
              <span className="card-list__meta">
                {i.armorSlot ? ARMOR_SLOT_LABELS[i.armorSlot] ?? i.armorSlot
                  : i.template.weaponType ? WEAPON_TYPE_LABELS[i.template.weaponType] : ''}
              </span>
              <span className="card-list__dur">{i.durabilityCurrent}/{i.durabilityMax}</span>
            </button>
          ))}
          {equipped.length > GEAR_ROWS && (
            <button type="button" className="card-list__more" onClick={() => navigate('/inventory')}>
              ещё {equipped.length - GEAR_ROWS} →
            </button>
          )}
        </Layer>
      )}

      {tab === 'person' && (
        <Layer box={C.body} className="card-list">
          <div className="card-list__title">Личное дело</div>
          <div className="card-list__kv"><span>Уровень</span><b>{char?.battleLevel ?? '—'}</b></div>
          <div className="card-list__kv"><span>Здоровье</span><b>{hp} / {char?.hpMax ?? '—'}</b></div>
          <div className="card-list__kv"><span>Наличные</span><b>{(char?.money ?? 0).toLocaleString('ru')} ₽</b></div>
          <div className="card-list__kv"><span>Боёв</span><b>{char?.battlesTotal ?? 0}</b></div>
          <div className="card-list__kv"><span>Побед</span><b>{char?.battlesWon ?? 0}</b></div>
          <div className="card-list__kv"><span>Очки статов</span><b>{char?.stats?.pointsAvailable ?? 0}</b></div>
          <button type="button" className="card-list__more" onClick={() => navigate('/profile')}>
            Открыть полностью →
          </button>
        </Layer>
      )}

    </>
  )
}
