// =============================================================
// «Личное дело» — отдельный полноэкранный вид (участок милиции).
// Раньше профиль жил в общей колонке вместе со всем остальным;
// по макету это самостоятельный экран со своим фоном.
// =============================================================
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { charactersApi } from '../../shared/api/characters.api'
import { inventoryApi } from '../../shared/api/inventory.api'
import { PROFILE, PROFILE_STAGE } from '../../shared/lib/layout-map'
import { FitText, Stage } from '../../shared/lib/stage'
import { PLATES, SpriteButton } from '../../shared/ui/sprite'
import {
  ARCHETYPE_LABELS, WEAPON_TYPE_LABELS, type ItemInstance,
} from '../../shared/types/api.types'

const NOTES_KEY = 'mmo_notepad'

function daysSince(iso?: string): number {
  if (!iso) return 0
  const d = (Date.now() - new Date(iso).getTime()) / 86_400_000
  return Math.max(0, Math.floor(d))
}

/** Номер дела: стабильные 4 цифры из id — выглядит как канцелярский номер. */
function caseNumber(id?: string): string {
  if (!id) return '—'
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 9000
  return String(1000 + h)
}

function weaponSprite(item?: ItemInstance): string {
  const t = item?.template.weaponType
  if (t && ['PISTOL', 'SHOTGUN', 'SMG', 'RIFLE', 'SNIPER', 'HEAVY'].includes(t)) return 'p-item-ak'
  return 'p-item-bat'
}

export function DossierPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [notes, setNotes] = useState(() => localStorage.getItem(NOTES_KEY) ?? '')

  const { data: char } = useQuery({
    queryKey: ['character', 'me'],
    queryFn: () => charactersApi.getMe(),
    retry: false,
  })
  const { data: items } = useQuery({
    queryKey: ['inventory'],
    queryFn: () => inventoryApi.getItems(),
    retry: false,
  })

  useEffect(() => {
    const id = setTimeout(() => localStorage.setItem(NOTES_KEY, notes), 400)
    return () => clearTimeout(id)
  }, [notes])

  const equipped = useMemo(() => (items ?? []).filter(i => i.isEquipped), [items])
  const weapon = equipped.find(i => i.template.type === 'WEAPON' && i.armorSlot !== 'RIGHT_HAND')
  const offhand = equipped.find(i => i.armorSlot === 'RIGHT_HAND')

  const plate = `-webkit-image-set(url("${PLATES['profile-plate@2x']}") 2x, url("${PLATES['profile-plate']}") 1x)`

  const submitSearch = (e: FormEvent) => {
    e.preventDefault()
    const nick = search.trim()
    if (nick) navigate(`/u/${encodeURIComponent(nick)}`)
  }

  const skills = (char?.weaponSkills ?? [])
    .filter(s => s.skillLevel > 1)
    .sort((a, b) => b.skillLevel - a.skillLevel)
    .slice(0, 3)

  const dossier: string[] = char ? [
    `Местоположение: ${char.location ?? 'Центральная площадь'}`,
    `Состоит в клане: ${'не состоит'}`,
    '',
    'Уровни:',
    `1. Боевой — ${char.battleLevel}`,
    `2. Экономический — ${char.economicLevel}`,
    `3. Производственный — ${char.productionLevel}`,
    '',
    'Владение оружием:',
    ...(skills.length
      ? skills.map((s, i) => `${i + 1}. ${WEAPON_TYPE_LABELS[s.weaponType] ?? s.weaponType} — ${s.skillLevel}`)
      : ['1. Пока ничем не владеет']),
    '',
    `Колличество боёв: ${char.battlesTotal}`,
    `Из них побед: ${char.battlesWon}`,
    '',
    'Достижения:',
    '1. Появятся в Этапе 4',
  ] : ['Загрузка…']

  const fieldValues: Record<string, string> = {
    name: char?.nickname ?? '—',
    sex: char ? (ARCHETYPE_LABELS[char.archetype] ?? char.archetype) : '—',
    spouse: 'не женат',
    account: `${daysSince(char?.createdAt)} дней`,
  }
  const fieldLabels: Record<string, string> = {
    name: 'Имя', sex: 'Кто', spouse: 'Жена', account: 'Акаунт',
  }

  return (
    <Stage width={PROFILE_STAGE.w} height={PROFILE_STAGE.h}
      fit="width" maxScale={1} className="stage--profile">
      <div className="stage__plate" style={{ backgroundImage: plate }} />

      {/* поиск игрока — работает через /api/characters/by-nickname */}
      <form onSubmit={submitSearch}>
        <input
          className="dossier-search"
          style={{
            left: PROFILE.search.x, top: PROFILE.search.y,
            width: PROFILE.search.w, height: PROFILE.search.h,
            fontSize: PROFILE.fieldSize,
          }}
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Найти человека —"
          spellCheck={false}
        />
      </form>

      <FitText
        x={PROFILE.sign.x} y={PROFILE.sign.y} w={PROFILE.sign.w}
        size={PROFILE.sign.size} dy={PROFILE.sign.dy} className="t-sign"
      >
        участок милиции
      </FitText>

      {/* портрет и показатели */}
      <SpriteButton
        name="p-portrait" box={PROFILE.portrait} className="portrait-hot"
        title="Сменить портрет можно будет позже" onClick={() => navigate('/inventory')}
      />
      <FitText x={PROFILE.energyText.x} y={PROFILE.energyText.y} w={PROFILE.energyText.w}
        size={20.8} className="stat-num stat-num--energy" title="Боевой уровень">
        {char?.battleLevel ?? 0}
      </FitText>
      <FitText x={PROFILE.hpText.x} y={PROFILE.hpText.y} w={PROFILE.hpText.w}
        size={20.8} className="stat-num stat-num--hp"
        title={char ? `Здоровье ${char.hpCurrent} из ${char.hpMax}` : 'Здоровье'}>
        {char?.hpCurrent ?? 0}
      </FitText>

      {/* поля карточки */}
      {PROFILE.fields.map(f => (
        <FitText key={f.key} x={f.x} y={f.y} w={f.w} size={PROFILE.fieldSize}
          dy={-4} className="t-doc">
          {fieldLabels[f.key]}: {fieldValues[f.key]}
        </FitText>
      ))}

      {/* лист дела */}
      <FitText x={PROFILE.sheetTitle.x} y={PROFILE.sheetTitle.y} w={PROFILE.sheetTitle.w}
        size={PROFILE.sheetTitle.size} dy={-4} className="t-doc">
        Личное дело №{caseNumber(char?.id)}
      </FitText>

      <div
        className="dossier-body"
        style={{
          left: PROFILE.dossier.x, top: PROFILE.dossier.y,
          width: PROFILE.dossier.w, fontSize: PROFILE.dossier.size,
          lineHeight: `${PROFILE.dossier.lineHeight}px`,
        }}
      >
        {dossier.map((line, i) => <div key={i}>{line || ' '}</div>)}
      </div>

      {/* слоты снаряжения */}
      <SpriteButton
        name={weaponSprite(weapon)} box={PROFILE.slots[0].box} empty={!weapon}
        title={weapon ? `${weapon.template.name} · ${weapon.durabilityCurrent}/${weapon.durabilityMax}`
          : 'Оружие не надето'}
        onClick={() => navigate('/inventory')}
      />
      <SpriteButton
        name="p-item-bat" box={PROFILE.slots[1].box} empty={!offhand}
        title={offhand ? `${offhand.template.name} · ${offhand.durabilityCurrent}/${offhand.durabilityMax}`
          : 'Правая рука свободна'}
        onClick={() => navigate('/inventory')}
      />
      <SpriteButton
        name="p-item-dog" box={PROFILE.slots[2].box} disabled
        title="Питомцы появятся в Этапе 3"
      />

      {/* записная книжка — сохраняется локально */}
      <FitText x={PROFILE.notepadTitle.x} y={PROFILE.notepadTitle.y}
        w={PROFILE.notepadTitle.w} size={PROFILE.notepadTitle.size} dy={-4} className="t-doc">
        Записная книжка
      </FitText>
      <textarea
        className="dossier-notes"
        style={{
          left: PROFILE.notepad.x, top: PROFILE.notepad.y,
          width: PROFILE.notepad.w, height: PROFILE.notepad.h,
        }}
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="Заметки для себя…"
        spellCheck={false}
      />

      <button type="button" className="dossier-back" onClick={() => navigate('/')}>
        ← в город
      </button>
    </Stage>
  )
}
