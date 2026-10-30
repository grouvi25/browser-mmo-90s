// =============================================================
// Панель управления (переделка 30.10).
//
// Вход — ник и пароль игрового аккаунта сотрудника, затем код из письма
// (устройство можно запомнить на 30 дней). Слева — разделы по группам,
// у каждого свой адрес; сотрудник видит только то, на что у его роли есть
// право, а сервер то же право проверяет на каждой ручке.
//
// Разделы — прежние компоненты: переделана оболочка, а не их содержимое.
// На поддомене admin. панель живёт в корне, на основном сайте — в /admin.
// =============================================================
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LogOut, Menu, ShieldCheck, X } from 'lucide-react'
import { adminApi, adminDevice, adminToken, AdminApiError, type AdminRole, type Permission } from './admin-api'
import { Note } from '../stage3/stage3-ui'
import { ClansSection } from './sections/clans-section'
import { TerritoriesSection } from './sections/territories-section'
import { ClaimsSection } from './sections/claims-section'
import { SignalsSection } from './sections/signals-section'
import { ActionsSection } from './sections/actions-section'
import { TraceSection } from './sections/trace-section'
import { OverviewSection } from './sections/overview-section'
import { BalanceSection } from './sections/balance-section'
import { BalanceSandboxPage } from '../balance-sandbox/balance-sandbox-page'
import { CombatSandboxSection } from './sections/combat-sandbox-section'
import { CatalogSection } from './sections/catalog-section'
import { PlayersSection } from './sections/players-section'
import { SupportSection } from './sections/support-section'
import { ChatSection } from './sections/chat-section'
import { AnnouncementsSection } from './sections/announcements-section'
import { PayoutsSection } from './sections/payouts-section'
import { StaffSection } from './sections/staff-section'
import '../stage3/stage3.css'
import './admin.css'
import './admin-shell.css'

interface Ctx {
  can: (permission: Permission) => boolean
  /** Старые разделы знают только «SUPER_ADMIN может править»: даём его, если право есть. */
  roleFor: (permission: Permission) => AdminRole
  go: (section: string, focus?: string) => void
  focus?: string
}

interface Section {
  key: string
  title: string
  group: string
  /** Что видно в шапке раздела: одна строка о назначении. */
  hint: string
  need: Permission
  render: (ctx: Ctx) => ReactNode
}

const SECTIONS: Section[] = [
  { key: 'overview', group: 'Главное', title: 'Обзор', need: 'view', hint: 'Сводка: игроки, деньги в игре, сигналы о нарушениях.',
    render: c => <OverviewSection onGo={c.go} /> },
  { key: 'players', group: 'Игроки', title: 'Игроки', need: 'view', hint: 'Поиск игрока, его деньги, вещи, наказания.',
    render: c => <PlayersSection focusId={c.focus} onTrace={id => c.go('trace', id)} /> },
  { key: 'support', group: 'Игроки', title: 'Поддержка', need: 'support', hint: 'Обращения игроков: очередь и переписка.',
    render: () => <SupportSection /> },
  { key: 'chat', group: 'Игроки', title: 'Чат', need: 'view', hint: 'Сообщения игроков; модератор может скрыть.',
    render: () => <ChatSection /> },
  { key: 'signals', group: 'Игроки', title: 'Сигналы', need: 'view', hint: 'Подозрительные связи аккаунтов и переводы.',
    render: () => <SignalsSection /> },
  { key: 'news', group: 'Контент', title: 'Объявления', need: 'content', hint: 'Окно при входе, новости и обновления.',
    render: () => <AnnouncementsSection /> },
  { key: 'items', group: 'Экономика', title: 'Справочник', need: 'view', hint: 'Вещи, магазины, сырьё: создать и править.',
    render: c => <CatalogSection role={c.roleFor('catalog')} /> },
  { key: 'balance', group: 'Экономика', title: 'Баланс', need: 'view', hint: 'Формулы и их параметры.',
    render: c => <BalanceSection role={c.roleFor('balance')} focus={c.focus} /> },
  { key: 'sandbox', group: 'Экономика', title: 'Экономика', need: 'view', hint: 'Расчёт экономики на заданных параметрах.',
    render: c => <BalanceSandboxPage simulate={adminApi.simulateBalance} onGoFormula={id => c.go('balance', id)} /> },
  { key: 'duel', group: 'Экономика', title: 'Бой', need: 'view', hint: 'Песочница: два бойца и тысяча дуэлей.',
    render: () => <CombatSandboxSection /> },
  { key: 'payouts', group: 'Экономика', title: 'Выплаты', need: 'finance', hint: 'Заявки на вывод реферальных.',
    render: () => <PayoutsSection /> },
  { key: 'clans', group: 'Мир', title: 'Бригады', need: 'view', hint: 'Бригады, общак, авторитет.',
    render: () => <ClansSection /> },
  { key: 'territories', group: 'Мир', title: 'Районы', need: 'view', hint: 'Кому принадлежат районы.',
    render: c => <TerritoriesSection role={c.roleFor('grant')} /> },
  { key: 'claims', group: 'Мир', title: 'Заявки', need: 'view', hint: 'Заявки на районы и налёты.',
    render: c => <ClaimsSection role={c.roleFor('grant')} /> },
  { key: 'actions', group: 'Журнал', title: 'Действия', need: 'view', hint: 'Что делали в админке; откат.',
    render: c => <ActionsSection role={c.roleFor('grant')} /> },
  { key: 'trace', group: 'Журнал', title: 'Цепочка', need: 'view', hint: 'Откуда пришли и куда ушли деньги и вещи.',
    render: c => <TraceSection focus={c.focus} /> },
  { key: 'staff', group: 'Система', title: 'Сотрудники', need: 'staff', hint: 'Кто работает в админке и с какой ролью.',
    render: () => <StaffSection /> },
]

export function AdminPage({ base = '/admin' }: { base?: string }) {
  const [token, setToken] = useState(adminToken.get())
  // Админка — обычная длинная страница, а игровые экраны держат html и body
  // в высоту окна. Отпускаем высоту, пока открыта админка.
  useEffect(() => {
    const targets = [document.documentElement, document.body]
    const previous = targets.map(element => element.style.height)
    for (const element of targets) element.style.height = 'auto'
    return () => { targets.forEach((element, index) => { element.style.height = previous[index] }) }
  }, [])

  if (!token) return <AdminLogin onDone={next => { adminToken.set(next); setToken(next) }} />
  return <AdminShell base={base} onSignedOut={() => { adminToken.clear(); setToken(null) }} />
}

function AdminShell({ base, onSignedOut }: { base: string; onSignedOut: () => void }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const params = useParams()
  const [search] = useSearchParams()
  const [menuOpen, setMenuOpen] = useState(false)
  const me = useQuery({ queryKey: ['admin', 'me'], queryFn: adminApi.me, retry: false, staleTime: 60_000 })

  // Токен истёк или сессию закрыли — обратно ко входу.
  useEffect(() => {
    if (me.error instanceof AdminApiError && me.error.status === 401) onSignedOut()
  }, [me.error, onSignedOut])

  const allowed = useMemo(() => new Set(me.data?.permissions ?? []), [me.data])
  const visible = SECTIONS.filter(section => allowed.has(section.need))
  const key = (params['*'] ?? '').split('/')[0]
  const current = visible.find(section => section.key === key) ?? visible[0]
  const path = (section: string) => `${base}/${section}`

  const signOut = useMutation({
    mutationFn: (everywhere: boolean) => everywhere ? adminApi.logoutAll() : adminApi.logout(),
    onSettled: (_r, _e, everywhere) => {
      if (everywhere) adminDevice.clear()
      qc.removeQueries({ queryKey: ['admin'] })
      onSignedOut()
    },
  })

  if (me.isLoading) return <div className="admx-loading" role="status">Загрузка…</div>
  if (me.isError || !me.data) {
    return <div className="admx-loading" role="alert">
      Панель не загрузилась. <button type="button" onClick={() => void me.refetch()}>Повторить</button>{' '}
      <button type="button" onClick={onSignedOut}>Войти заново</button>
    </div>
  }
  if (!current) return <div className="admx-loading" role="alert">У вашей роли нет доступных разделов.</div>

  const ctx: Ctx = {
    can: permission => allowed.has(permission),
    roleFor: permission => allowed.has(permission) ? 'SUPER_ADMIN' : 'SUPPORT',
    go: (section, focus) => navigate(path(section) + (focus ? `?focus=${encodeURIComponent(focus)}` : '')),
    focus: search.get('focus') ?? undefined,
  }
  const groups = [...new Set(visible.map(section => section.group))]

  return (
    <div className={'admx' + (menuOpen ? ' is-menu' : '')}>
      <aside className="admx-side" aria-label="Разделы панели">
        <div className="admx-brand">
          <ShieldCheck size={18} aria-hidden="true" />
          <span><b>КООПЕРАТИВ</b><small>панель управления</small></span>
          <button type="button" className="admx-close" aria-label="Закрыть меню" onClick={() => setMenuOpen(false)}><X size={18} /></button>
        </div>
        <nav className="admx-nav">
          {groups.map(group => (
            <div key={group} className="admx-group">
              <span className="admx-group__title">{group}</span>
              {visible.filter(section => section.group === group).map(section => (
                <NavLink key={section.key} to={path(section.key)} onClick={() => setMenuOpen(false)}
                  className={() => 'admx-link' + (section === current ? ' is-active' : '')}
                  aria-current={section === current ? 'page' : undefined}>
                  {section.title}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="admx-user">
          <span className="admx-user__name">{me.data.label}</span>
          <span className="admx-user__role">{me.data.roleTitle}</span>
          <div className="admx-user__actions">
            <button type="button" disabled={signOut.isPending} onClick={() => signOut.mutate(false)}><LogOut size={13} /> Выйти</button>
            {me.data.staffRole && <button type="button" disabled={signOut.isPending} onClick={() => signOut.mutate(true)}
              title="Закрыть все входы и забыть запомненные устройства">Выйти везде</button>}
          </div>
        </div>
      </aside>
      <button type="button" className="admx-scrim" aria-label="Закрыть меню" tabIndex={-1} onClick={() => setMenuOpen(false)} />

      <div className="admx-main">
        <header className="admx-top">
          <button type="button" className="admx-burger" aria-label="Открыть меню" onClick={() => setMenuOpen(true)}><Menu size={20} /></button>
          <div>
            <h1>{current.title}</h1>
            <p>{current.hint}</p>
          </div>
        </header>
        <main className="s3 adm admx-content" key={current.key}>
          {current.render(ctx)}
        </main>
      </div>
    </div>
  )
}

/** Вход сотрудника: ник и пароль, затем код из письма. */
function AdminLogin({ onDone }: { onDone: (token: string) => void }) {
  const [nickname, setNickname] = useState('')
  const [password, setPassword] = useState('')
  const [challenge, setChallenge] = useState<{ id: string; email: string } | null>(null)
  const [code, setCode] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const codeRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (challenge) codeRef.current?.focus() }, [challenge])

  const finish = (step: { token: string; deviceToken?: string }) => {
    if (step.deviceToken) adminDevice.set(step.deviceToken)
    onDone(step.token)
  }
  const explain = (problem: unknown, fallback: string) =>
    setError(problem instanceof AdminApiError ? problem.message : fallback)

  const start = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const step = await adminApi.staffLogin({ nickname: nickname.trim(), password, deviceToken: adminDevice.get() })
      if (step.step === 'done') finish(step)
      else { setChallenge({ id: step.challengeId, email: step.email }); setCode('') }
    } catch (problem) {
      explain(problem, 'Не удалось войти. Проверьте связь и попробуйте ещё раз.')
    } finally { setBusy(false) }
  }

  const verify = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!challenge) return
    setBusy(true); setError('')
    try {
      const step = await adminApi.staffVerify({ challengeId: challenge.id, code, remember })
      if (step.step === 'done') finish(step)
    } catch (problem) {
      explain(problem, 'Код не подошёл.')
      if (problem instanceof AdminApiError && (problem.status === 410 || problem.status === 429)) setChallenge(null)
    } finally { setBusy(false) }
  }

  return (
    <div className="admx-login">
      <div className="admx-login__box">
        <div className="admx-brand admx-brand--login">
          <ShieldCheck size={20} aria-hidden="true" />
          <span><b>КООПЕРАТИВ</b><small>панель управления</small></span>
        </div>
        {!challenge ? (
          <form onSubmit={start}>
            <label htmlFor="adm-nick">Ник</label>
            <input id="adm-nick" value={nickname} onChange={event => setNickname(event.target.value)} autoComplete="username" autoFocus />
            <label htmlFor="adm-pass">Пароль от игрового аккаунта</label>
            <input id="adm-pass" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" />
            <button type="submit" disabled={busy || !nickname.trim() || !password}>{busy ? 'Проверяем…' : 'Дальше'}</button>
          </form>
        ) : (
          <form onSubmit={verify}>
            <p className="admx-login__hint">Код из 6 цифр отправлен на <b>{challenge.email}</b>. Он действует 10 минут.</p>
            <label htmlFor="adm-code">Код из письма</label>
            <input id="adm-code" ref={codeRef} className="admx-login__code" value={code} inputMode="numeric" autoComplete="one-time-code"
              maxLength={6} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} />
            <label className="admx-login__check">
              <input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} />
              Запомнить это устройство на 30 дней
            </label>
            <button type="submit" disabled={busy || code.length !== 6}>{busy ? 'Проверяем…' : 'Войти'}</button>
            <button type="button" className="admx-login__back" onClick={() => { setChallenge(null); setError('') }}>← Другой ник</button>
          </form>
        )}
        {error && <Note text={error} kind="bad" />}
        <p className="admx-login__foot">Вход только для сотрудников. <Link to="/">В игру</Link></p>
      </div>
    </div>
  )
}
