// =============================================================
// Левая карточка «личное дело» на главном экране.
// Всё кликабельно: вкладки, портрет, слоты снаряжения и зоны тела.
// Данные — настоящие, из /api/characters/me и /api/inventory.
// =============================================================
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { charactersApi } from '../../shared/api/characters.api'
import { inventoryApi } from '../../shared/api/inventory.api'
import { MENU, ZONE_ARMOR_SLOTS } from '../../shared/lib/layout-map'
import { FitText, Layer } from '../../shared/lib/stage'
import { Hotspot, Sprite, SpriteButton } from '../../shared/ui/sprite'
import type { ItemInstance } from '../../shared/types/api.types'
import { ARMOR_SLOT_LABELS, WEAPON_TYPE_LABELS } from '../../shared/types/api.types'

const C = MENU.card

type CardTab = 'overview' | 'gear' | 'person'

/** Пять боевых зон: правая нога — часть зоны «ноги», отдельной цели не даёт. */
const ZONE_KEYS = ['HEAD', 'CHEST', 'LEFT_ARM', 'RIGHT_ARM', 'LEGS'] as const
type ZoneKey = (typeof ZONE_KEYS)[number]

const ZONE_LABELS: Record<ZoneKey, string> = {
  HEAD: 'Голова', CHEST: 'Корпус', LEFT_ARM: 'Левая рука',
  RIGHT_ARM: 'Правая рука', LEGS: 'Ноги',
}

/** Художка есть только на автомат и биту — выбираем по типу оружия. */
function weaponSprite(item: ItemInstance | undefined): string {
  if (!item) return 'item-ak'
  const t = item.template.weaponType
  if (t && ['PISTOL', 'SHOTGUN', 'SMG', 'RIFLE', 'SNIPER', 'HEAVY'].includes(t)) return 'item-ak'
  return 'item-bat'
}

export function CharacterCard() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<CardTab>('overview')
  const [zone, setZone] = useState<ZoneKey | null>(null)

  const { data: char } = useQuery({
    queryKey: ['character', 'me'],
    queryFn: () => charactersApi.getMe(),
    retry: false,
    refetchInterval: 30_000,
  })
  const { data: items } = useQuery({
    queryKey: ['inventory'],
    queryFn: () => inventoryApi.getItems(),
    retry: false,
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

  const hp = char?.hpCurrent ?? 0
  const energy = char?.battleLevel ?? 0

  return (
    <>
      {/* ── вкладки карточки ─────────────────────────────── */}
      {C.tabs.map(t => (
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
        box={C.portrait}
        className="portrait-hot"
        title={char ? `${char.nickname} — открыть личное дело` : 'Личное дело'}
        onClick={() => navigate('/profile')}
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
        title={char ? `Здоровье: ${hp} из ${char.hpMax}` : 'Здоровье'}
      >
        {hp}
      </FitText>

      {/* ── ник ──────────────────────────────────────────── */}
      <FitText
        x={C.nickname.x} y={C.nickname.y} w={C.nickname.w}
        size={C.nickname.size} className="nick-badge"
        title="Открыть личное дело"
        as="button"
        onClick={() => navigate('/profile')}
      >
        {char?.nickname ?? '—'}
      </FitText>

      {/* ── тело карточки: зависит от выбранной вкладки ──── */}
      {tab === 'overview' && (
        <>
          {/* слоты снаряжения */}
          <SpriteButton
            name={weaponSprite(weapon)}
            box={C.slots[0].box}
            empty={!weapon}
            title={weapon
              ? `${weapon.template.name} · прочность ${weapon.durabilityCurrent}/${weapon.durabilityMax}`
              : 'Оружие не надето — открыть снаряжение'}
            onClick={() => navigate('/inventory')}
          />
          <SpriteButton
            name="item-bat"
            box={C.slots[1].box}
            empty={!offhand}
            title={offhand
              ? `${offhand.template.name} · прочность ${offhand.durabilityCurrent}/${offhand.durabilityMax}`
              : 'Правая рука свободна — открыть снаряжение'}
            onClick={() => navigate('/inventory')}
          />
          <SpriteButton
            name="item-dog"
            box={C.slots[2].box}
            disabled
            title="Питомцы появятся в Этапе 3"
          />

          {/* зоны тела — цели ударов в бою */}
          {C.zones.map(z => {
            const key = (z.key === 'LEGS_R' ? 'LEGS' : z.key) as ZoneKey
            const armor = zoneArmor[key] ?? 0
            return (
              <SpriteButton
                key={z.key}
                name={z.sprite}
                box={z.box}
                className="zone-hot"
                active={zone === key}
                title={`${ZONE_LABELS[key]} · броня ${armor}`}
                onClick={() => setZone(zone === key ? null : key)}
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
        <Layer box={C.body} className="card-list card-list--sheet">
          <div className="card-list__title">Надето</div>
          {equipped.length === 0 && <div className="card-list__empty">Ничего не надето</div>}
          {equipped.map(i => (
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
        </Layer>
      )}

      {tab === 'person' && (
        <Layer box={C.body} className="card-list card-list--sheet">
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

      {/* невидимая область: клик по бумаге карточки уводит в личное дело */}
      <Hotspot
        box={C.topStrip}
        title="Личное дело"
        className="card-topstrip"
        onClick={() => navigate('/profile')}
      />
    </>
  )
}
