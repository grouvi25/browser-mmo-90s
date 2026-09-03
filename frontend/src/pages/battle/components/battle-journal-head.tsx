// =============================================================
// Шапка журнала боя по макету «Профиль игрока Боевка.psd».
//
// В макете над строками журнала стоят две вещи, которых у нас не было:
//   «Тип боя: Бой с тенью  Время начала боя: 20-08-2026 21:16»
//        слой на 430,2000 холста 1800x3200;
//   строка участников между двумя линейками — 0,2048 и 0,2108, —
//        с иконкой, именем, уровнем, здоровьем и кружком «!»:
//        «ADMIN 15 [ 25/25 ] !   Тень ADMIN 1 15 [ 25/25 ] !».
//
// Кружок в макете ничем не подписан. Вешаем на него то единственное,
// что читается однозначно и уже есть в состоянии боя: сходил ли боец
// в этом раунде. Подпись даётся заголовком, чтобы значок не был немым.
// =============================================================

/** Названия типов боя из BattleType. «Бой с тенью» в макете — бой с ботом. */
const TYPE_LABEL: Record<string, string> = {
  PVE_BOT: 'Бой с тенью',
  PVP_DUEL: 'Дуэль',
  PVP_OPEN: 'Открытый бой',
  CLAN: 'Клановый бой',
  TERRITORY: 'Бой за территорию',
}

/** Дата в том виде, в каком она набрана в макете: 20-08-2026 21:16. */
function startedAtLabel(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export interface JournalFighter {
  name: string
  level?: number
  hp: number
  hpMax: number
  /** Сходил ли боец в текущем раунде — это и показывает кружок «!». */
  acted?: boolean
}

function Fighter({ fighter, side }: { fighter: JournalFighter; side: 'self' | 'enemy' }) {
  const waiting = !fighter.acted
  return (
    <span className={`battle-journal-head__fighter is-${side}`}>
      <i className="battle-journal-head__mark" aria-hidden="true" />
      <b>{fighter.name}</b>
      {fighter.level != null && <span className="battle-journal-head__lvl">{fighter.level}</span>}
      <em>[ {fighter.hp}/{fighter.hpMax} ]</em>
      <i className={'battle-journal-head__flag' + (waiting ? '' : ' is-done')}
        title={waiting ? 'Ход ещё не сделан' : 'Ход сделан'}
        aria-label={waiting ? 'Ход ещё не сделан' : 'Ход сделан'}>!</i>
    </span>
  )
}

export function BattleJournalHead({ type, startedAt, self, enemy }: {
  type?: string | null
  startedAt?: string | null
  self: JournalFighter
  enemy: JournalFighter
}) {
  return (
    <header className="battle-journal-head">
      <p className="battle-journal-head__meta">
        Тип боя: <b>{TYPE_LABEL[type ?? ''] ?? 'Бой'}</b>
        <span> Время начала боя: <b>{startedAtLabel(startedAt)}</b></span>
      </p>
      <div className="battle-journal-head__fighters">
        <Fighter fighter={self} side="self" />
        <Fighter fighter={enemy} side="enemy" />
      </div>
    </header>
  )
}
