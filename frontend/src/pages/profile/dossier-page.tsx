// =============================================================
// «Личное дело» — отдельный полноэкранный вид (участок милиции).
// Раньше профиль жил в общей колонке вместе со всем остальным;
// по макету это самостоятельный экран со своим фоном.
// =============================================================
import { dogBonusText, dogTitle } from '../../shared/lib/dog'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { charactersApi } from '../../shared/api/characters.api'
import { inventoryApi } from '../../shared/api/inventory.api'
import { PROFILE, PROFILE_STAGE } from '../../shared/lib/layout-map'
import { locationLabel } from '../../shared/lib/city-locations'
import { FitText, Stage } from '../../shared/lib/stage'
import { useIsMobile } from '../../shared/lib/use-media-query'
import { PLATES, Sprite, SpriteButton, SPRITES } from '../../shared/ui/sprite'
import {
  ARCHETYPE_LABELS, WEAPON_TYPE_LABELS, type Character,
} from '../../shared/types/api.types'
import { itemImage } from '../../shared/assets/shop/shop-images'

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

function weaponSprite(t?: string | null): string {
  if (t && ['PISTOL', 'SHOTGUN', 'SMG', 'RIFLE', 'SNIPER', 'HEAVY'].includes(t)) return 'p-item-ak'
  return 'p-item-bat'
}

/** Что показывает «Личное дело» — своё или чужое (правка заказчика 21.10:
    «профиль другого персонажа должен выглядеть как свой»). */
interface DossierView {
  id?: string
  nickname: string
  archetype?: string
  gender?: 'MALE' | 'FEMALE'
  battleLevel: number
  economicLevel: number
  /** Рейтинг (книга заказчика 23.10): статы с весами + надетые вещи. */
  rating?: number
  hpCurrent: number
  hpMax: number
  battlesTotal: number
  battlesWon: number
  location?: string | null
  clan?: { name: string } | null
  createdAt?: string
  professions: Array<{ name: string; level: number; exp?: number }>
  skills: Array<{ weaponType: string; skillLevel: number }>
  dog: Character['dog']
  weapon?: { name: string; code: string; weaponType: string | null; title: string }
  offhand?: { name: string; code: string; title: string }
}

export function DossierPage({ nickname }: { nickname?: string } = {}) {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')

  const { data: char } = useQuery({
    queryKey: ['character', 'me'],
    queryFn: () => charactersApi.getMe(),
    retry: false,
  })
  const foreign = !!nickname && !!char && nickname.toLocaleLowerCase('ru') !== char.nickname.toLocaleLowerCase('ru')
  const other = useQuery({
    queryKey: ['character', 'public', nickname],
    queryFn: () => charactersApi.getByNickname(nickname!),
    enabled: foreign,
    retry: false,
  })
  const { data: items } = useQuery({
    queryKey: ['inventory'],
    queryFn: () => inventoryApi.getItems(),
    retry: false,
    enabled: !foreign,
  })

  const equipped = useMemo(() => (items ?? []).filter(i => i.isEquipped), [items])
  const myWeapon = equipped.find(i => i.template.type === 'WEAPON' && i.armorSlot !== 'RIGHT_HAND')
  const myOffhand = equipped.find(i => i.armorSlot === 'RIGHT_HAND')

  let view: DossierView | null = null
  if (foreign) {
    const o = other.data
    if (o && !o.hidden) {
      const w = o.weapons?.find(x => x.armorSlot !== 'RIGHT_HAND')
      const off = o.weapons?.find(x => x.armorSlot === 'RIGHT_HAND')
      view = {
        id: o.id, nickname: o.nickname, archetype: o.archetype, gender: o.gender,
        battleLevel: o.battleLevel ?? 0, economicLevel: o.economicLevel ?? 0, rating: o.rating,
        hpCurrent: o.hpCurrent ?? 0, hpMax: o.hpMax ?? 0,
        battlesTotal: o.battlesTotal ?? 0, battlesWon: o.battlesWon ?? 0,
        location: o.location, clan: o.clan, createdAt: o.createdAt,
        professions: o.professions ?? [], skills: o.weaponSkills ?? [], dog: o.dog ?? null,
        weapon: w && { name: w.name, code: w.code, weaponType: w.weaponType, title: w.name },
        offhand: off && { name: off.name, code: off.code, title: off.name },
      }
    }
  } else if (char) {
    view = {
      id: char.id, nickname: char.nickname, archetype: char.archetype, gender: char.gender,
      battleLevel: char.battleLevel, economicLevel: char.economicLevel, rating: char.rating,
      hpCurrent: char.hpCurrent, hpMax: char.hpMax,
      battlesTotal: char.battlesTotal, battlesWon: char.battlesWon,
      location: char.location, clan: char.clan, createdAt: char.createdAt,
      professions: (char.economy?.professions ?? []).map(p => ({ name: p.name ?? p.professionCode, level: p.level, exp: p.exp })),
      skills: (char.weaponSkills ?? []).filter(s => s.skillLevel > 1).sort((a, b) => b.skillLevel - a.skillLevel).slice(0, 3),
      dog: char.dog ?? null,
      weapon: myWeapon && { name: myWeapon.template.name, code: myWeapon.template.code, weaponType: myWeapon.template.weaponType ?? null,
        title: `${myWeapon.template.name} · ${myWeapon.durabilityCurrent}/${myWeapon.durabilityMax}` },
      offhand: myOffhand && { name: myOffhand.template.name, code: myOffhand.template.code,
        title: `${myOffhand.template.name} · ${myOffhand.durabilityCurrent}/${myOffhand.durabilityMax}` },
    }
  }

  // Записная книжка на сервере: у каждого — свои заметки о себе и о любом
  // игроке, видит их только автор. Старые локальные заметки о себе
  // переносятся при первом открытии.
  const noteTarget = view?.id
  const note = useQuery({
    queryKey: ['character', 'note', noteTarget],
    queryFn: () => charactersApi.note(noteTarget!),
    enabled: !!noteTarget,
  })
  const [notes, setNotes] = useState('')
  const [dirty, setDirty] = useState(false)
  useEffect(() => { setDirty(false) }, [noteTarget])
  useEffect(() => {
    if (!note.data || dirty) return
    const legacy = !foreign ? localStorage.getItem(NOTES_KEY) ?? '' : ''
    setNotes(note.data.text || legacy)
    if (!note.data.text && legacy) setDirty(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.data, foreign])
  useEffect(() => {
    if (!dirty || !noteTarget) return
    const id = setTimeout(() => {
      void charactersApi.saveNote(noteTarget, notes).then(() => {
        if (!foreign) localStorage.removeItem(NOTES_KEY)
        qc.setQueryData(['character', 'note', noteTarget], { text: notes })
        setDirty(false)
      })
    }, 600)
    return () => clearTimeout(id)
  }, [notes, dirty, noteTarget, foreign, qc])
  const editNotes = (text: string) => { setNotes(text); setDirty(true) }

  const plate = `-webkit-image-set(url("${PLATES['profile-plate@2x']}") 2x, url("${PLATES['profile-plate']}") 1x)`

  const submitSearch = (e: FormEvent) => {
    e.preventDefault()
    const nick = search.trim()
    if (nick) navigate(`/u/${encodeURIComponent(nick)}`)
  }

  const dossier: string[] = view ? [
    `Местоположение: ${locationLabel(view.location)}`,
    `Бригада: ${view.clan ? `«${view.clan.name}»` : 'не состоит'}`,
    `Собака: ${view.dog ? `${view.dog.name}${view.dog.fed ? ` (${dogBonusText(view.dog.bonus)})` : ' — голодная'}` : 'нет'}`,
    '',
    'Уровни:',
    `1. Боевой — ${view.battleLevel}`,
    `2. Экономический — ${view.economicLevel}`,
    `3. Рейтинг — ${view.rating != null ? String(view.rating).replace('.', ',') : '—'}`,
    ...(view.professions.length
      ? ['4. Профессии:', ...view.professions.map(p => `   ${p.name}: ур. ${p.level}${p.exp != null ? `, опыт ${p.exp}` : ''}`)]
      : ['4. Профессии — не открыты']),
    '',
    'Владение оружием:',
    ...(view.skills.length
      ? view.skills.map((s, i) => `${i + 1}. ${WEAPON_TYPE_LABELS[s.weaponType] ?? s.weaponType} — ${s.skillLevel}`)
      : ['1. Пока ничем не владеет']),
    '',
    `Количество боёв: ${view.battlesTotal}`,
    `Из них побед: ${view.battlesWon}`,
    '',
    'Достижения:',
    '1. Появятся в Этапе 4',
  ] : [foreign && (other.isError || other.data?.hidden) ? 'Дело засекречено или не найдено.' : 'Загрузка…']

  const fieldValues: Record<string, string> = {
    name: view?.nickname ?? nickname ?? '—',
    sex: view?.archetype ? (ARCHETYPE_LABELS[view.archetype] ?? view.archetype) : '—',
    spouse: view?.gender === 'FEMALE' ? 'не замужем' : 'не женат',
    account: `${daysSince(view?.createdAt)} дней`,
  }
  // Пол меняется кликом по графе «Жена/Муж» (правка заказчика: «пол
  // женский»): персонажи, созданные раньше, тоже должны его выбрать.
  const gender = useMutation({
    mutationFn: () => charactersApi.setGender(char?.gender === 'FEMALE' ? 'MALE' : 'FEMALE'),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['character'] }) },
  })
  const own = !foreign
  const toggleGender = () => {
    if (!own || !char || gender.isPending) return
    const next = char.gender === 'FEMALE' ? 'мужской' : 'женский'
    if (window.confirm(`Сменить пол персонажа на ${next}?`)) gender.mutate()
  }
  const genderTitle = own ? 'Нажмите, чтобы сменить пол персонажа' : undefined
  const notesPlaceholder = own ? 'Заметки для себя…' : `Ваши заметки о ${view?.nickname ?? 'игроке'} — видите только вы…`
  const weapon = view?.weapon
  const offhand = view?.offhand

  const fieldLabels: Record<string, string> = {
    name: 'Имя', sex: 'Кто', spouse: view?.gender === 'FEMALE' ? 'Муж' : 'Жена', account: 'Аккаунт',
  }

  // На телефоне бумажный разворот участка милиции нечитаем целиком,
  // поэтому те же данные показываем колонкой. Портрет и предметы —
  // те же спрайты, что и на большом экране.
  if (isMobile) {
    return (
      <div className="m-dossier">
        <div className="m-dossier__bar">
          <button type="button" onClick={() => navigate('/')}>← ЦЕНТР</button>
          <span>Участок милиции</span>
        </div>

        <form onSubmit={submitSearch} className="m-dossier__search">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Найти человека —"
            spellCheck={false}
          />
          <button type="submit">→</button>
        </form>

        <div className="m-dossier__head">
          <img className="m-dossier__portrait" src={SPRITES[view?.gender === 'FEMALE' ? 'p-portrait-female' : 'p-portrait']} alt="" draggable={false} />
          <div className="m-dossier__fields">
            <div className="m-dossier__title">Личное дело №{caseNumber(view?.id)}</div>
            {PROFILE.fields.map(f => (
              <div key={f.key} className="m-dossier__kv">
                <span>{fieldLabels[f.key]}</span>
                {f.key === 'spouse' && own
                  ? <button type="button" className="m-dossier__gender" title={genderTitle} onClick={toggleGender}>{fieldValues[f.key]}</button>
                  : <b>{fieldValues[f.key]}</b>}
              </div>
            ))}
          </div>
        </div>

        <div className="m-dossier__body">
          {dossier.map((line, i) => <div key={i}>{line || ' '}</div>)}
        </div>

        <div className="m-dossier__slots">
          <SpriteButton name={weaponSprite(weapon?.weaponType)} src={weapon ? itemImage(weapon.code, weapon.weaponType) : undefined} box={{ x: 0, y: 0, w: 92, h: 94 }} empty={!weapon}
            title={weapon ? weapon.title : 'Оружие не надето'} disabled={!own} onClick={own ? () => navigate('/inventory') : undefined} />
          <SpriteButton name="p-item-bat" box={{ x: 0, y: 0, w: 84, h: 88 }} empty={!offhand}
            title={offhand ? offhand.title : 'Правая рука свободна'} disabled={!own} onClick={own ? () => navigate('/inventory') : undefined} />
          <SpriteButton name="p-item-dog" box={{ x: 0, y: 0, w: 62, h: 93 }} empty={!view?.dog}
            title={dogTitle(view?.dog)} disabled={!own} onClick={own ? () => navigate('/pet-shop') : undefined} />
        </div>

        <div className="m-dossier__notes">
          <div className="m-dossier__title">Записная книжка</div>
          <textarea
            value={notes}
            onChange={e => editNotes(e.target.value)}
            placeholder={notesPlaceholder}
            maxLength={4000}
            spellCheck={false}
          />
        </div>
      </div>
    )
  }

  return (
    <Stage width={PROFILE_STAGE.w} height={PROFILE_STAGE.h}
      fit="contain" backdrop={plate} className="stage--profile">
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
        name={view?.gender === 'FEMALE' ? 'p-portrait-female' : 'p-portrait'} box={PROFILE.portrait} className="portrait-hot"
        title={own ? 'Сменить портрет можно будет позже' : view?.nickname} disabled={!own} onClick={own ? () => navigate('/inventory') : undefined}
      />
      <Sprite name="p-icon-energy" box={PROFILE.energyIcon} />
      <Sprite name="p-icon-hp" box={PROFILE.hpIcon} />
      <FitText x={PROFILE.energyText.x} y={PROFILE.energyText.y} w={PROFILE.energyText.w}
        size={20.8} className="stat-num stat-num--energy" title="Боевой уровень">
        {view?.battleLevel ?? 0}
      </FitText>
      <FitText x={PROFILE.hpText.x} y={PROFILE.hpText.y} w={PROFILE.hpText.w}
        size={20.8} className="stat-num stat-num--hp"
        title={view ? `Здоровье ${view.hpCurrent} из ${view.hpMax}` : 'Здоровье'}>
        {view?.hpCurrent ?? 0}
      </FitText>

      {/* поля карточки */}
      {PROFILE.fields.map(f => (
        <FitText key={f.key} x={f.x} y={f.y} w={f.w} size={PROFILE.fieldSize}
          dy={-4} className={'t-doc' + (f.key === 'spouse' && own ? ' dossier-gender' : '')}
          as={f.key === 'spouse' && own ? 'button' : 'div'}
          onClick={f.key === 'spouse' && own ? toggleGender : undefined}
          title={f.key === 'spouse' ? genderTitle : undefined}>
          {fieldLabels[f.key]}: {fieldValues[f.key]}
        </FitText>
      ))}

      {/* лист дела */}
      <FitText x={PROFILE.sheetTitle.x} y={PROFILE.sheetTitle.y} w={PROFILE.sheetTitle.w}
        size={PROFILE.sheetTitle.size} dy={-4} className="t-doc">
        Личное дело №{caseNumber(view?.id)}
      </FitText>

      <div
        className="dossier-body"
        style={{
          left: PROFILE.dossier.x, top: PROFILE.dossier.y,
          width: PROFILE.dossier.w, height: PROFILE.dossier.h, fontSize: PROFILE.dossier.size,
          lineHeight: `${PROFILE.dossier.lineHeight}px`,
        }}
      >
        {dossier.map((line, i) => <div key={i}>{line || ' '}</div>)}
      </div>

      {/* слоты снаряжения */}
      <SpriteButton
        name={weaponSprite(weapon?.weaponType)} src={weapon ? itemImage(weapon.code, weapon.weaponType) : undefined} box={PROFILE.slots[0].box} empty={!weapon}
        title={weapon ? weapon.title : 'Оружие не надето'}
        disabled={!own} onClick={own ? () => navigate('/inventory') : undefined}
      />
      <SpriteButton
        name="p-item-bat" box={PROFILE.slots[1].box} empty={!offhand}
        title={offhand ? offhand.title : 'Правая рука свободна'}
        disabled={!own} onClick={own ? () => navigate('/inventory') : undefined}
      />
      <SpriteButton
        name="p-item-dog" box={PROFILE.slots[2].box} empty={!view?.dog}
        title={dogTitle(view?.dog)} disabled={!own} onClick={own ? () => navigate('/pet-shop') : undefined}
      />

      {/* записная книжка — своя у каждого игрока, хранится на сервере */}
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
        onChange={e => editNotes(e.target.value)}
        placeholder={notesPlaceholder}
        maxLength={4000}
        spellCheck={false}
      />

      <button type="button" className="dossier-back" onClick={() => navigate('/')}>
        ← ЦЕНТР
      </button>
    </Stage>
  )
}
