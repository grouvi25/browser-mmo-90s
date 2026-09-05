// =============================================================
// Экран администратора — Этап 5.
//
// Восемь разделов на одной странице, вход отдельный от игрового. Админка не
// витрина: та же вёрстка, что и у экранов игры, никакого своего дизайна.
//
// Главное, что экран обязан доносить без справки: каждое действие требует
// причину и каждое можно отменить. Поэтому журнал действий — такой же
// раздел, как остальные, а не спрятанная страница логов.
// =============================================================
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ShieldAlert, LogOut } from 'lucide-react'
import { adminApi, adminToken, AdminApiError, type AdminRole } from './admin-api'
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
import '../stage3/stage3.css'
import './admin.css'

type Tab = 'overview' | 'clans' | 'territories' | 'claims' | 'signals' | 'actions' | 'trace'
  | 'balance' | 'sandbox'

const TABS: { key: Tab; title: string }[] = [
  { key: 'overview', title: 'Обзор' },
  { key: 'clans', title: 'Бригады' },
  { key: 'territories', title: 'Районы' },
  { key: 'claims', title: 'Заявки' },
  { key: 'signals', title: 'Сигналы' },
  { key: 'actions', title: 'Журнал' },
  { key: 'trace', title: 'Цепочка' },
  // Устройство игры — рядом с её состоянием: администратор видит и
  // последствия, и причину, не уходя с экрана.
  { key: 'balance', title: 'Баланс' },
  { key: 'sandbox', title: 'Песочница' },
]

export function AdminPage() {
  const [token, setTokenState] = useState(adminToken.get())
  const [role, setRole] = useState<AdminRole | null>(adminToken.role())
  const [tab, setTab] = useState<Tab>('overview')
  const qc = useQueryClient()

  // Игровые экраны держат html и body ровно в высоту окна: сцена вписывается
  // в неё и скроллиться не должна. Админка — обычная длинная страница (один
  // «Баланс» это 29 формул), и под тем же правилом прокрутка уезжала внутрь
  // body: документ оставался 1000 px при содержимом в 2500. Отпускаем высоту
  // на время, пока открыта админка, и возвращаем при уходе.
  useEffect(() => {
    const targets = [document.documentElement, document.body]
    const previous = targets.map(element => element.style.height)
    for (const element of targets) element.style.height = 'auto'
    return () => { targets.forEach((element, index) => { element.style.height = previous[index] }) }
  }, [])

  if (!token) {
    return <AdminLogin onDone={(next, nextRole) => { setTokenState(next); setRole(nextRole) }} />
  }

  const logout = () => {
    adminToken.clear()
    void qc.invalidateQueries({ queryKey: ['admin'] })
    setTokenState(null)
    setRole(null)
  }

  return (
    <main className="s3 adm">
      <header className="adm-head">
        <span className="adm-role">
          <ShieldAlert size={13} /> {role ?? 'ADMIN'}
        </span>
        <button type="button" className="adm-logout" onClick={logout}>
          <LogOut size={12} /> Выйти
        </button>
      </header>

      <nav className="s3-group" aria-label="Разделы админки">
        {TABS.map(item => (
          <button
            key={item.key}
            type="button"
            className={tab === item.key ? 'active' : ''}
            onClick={() => setTab(item.key)}
          >
            {item.title}
          </button>
        ))}
      </nav>

      {tab === 'overview' && <OverviewSection onGo={next => setTab(next as Tab)} />}
      {tab === 'clans' && <ClansSection />}
      {tab === 'territories' && <TerritoriesSection role={role} />}
      {tab === 'claims' && <ClaimsSection role={role} />}
      {tab === 'signals' && <SignalsSection />}
      {tab === 'actions' && <ActionsSection role={role} />}
      {tab === 'trace' && <TraceSection />}
      {tab === 'balance' && <BalanceSection />}
      {/* Расчёт тот же, что на игровой ручке, но под админским токеном:
          требовать от администратора игровой аккаунт незачем. */}
      {tab === 'sandbox' && <BalanceSandboxPage simulate={adminApi.simulateBalance} />}
    </main>
  )
}

/**
 * Вход в админку.
 *
 * Отдельный от игрового намеренно: у администратора своя учётная запись и
 * свой токен. Старая страница ходила в админские ручки с игровым токеном и
 * получала 401 — то есть не работала ни разу.
 */
function AdminLogin({ onDone }: { onDone: (token: string, role: AdminRole) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await adminApi.login(username.trim(), password)
      onDone(result.token, result.role)
    } catch (problem) {
      setError(problem instanceof AdminApiError && problem.status === 429
        ? 'Слишком много попыток входа. Подождите минуту.'
        : 'Неверный логин или пароль.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="s3 adm">
      <form className="adm-login" onSubmit={submit}>
        <h3><ShieldAlert size={14} /> Вход в админку</h3>
        <p className="adm-hint">
          Учётная запись администратора отдельная от игровой: игровой токен
          сюда не пускают.
        </p>
        <input
          value={username}
          onChange={event => setUsername(event.target.value)}
          placeholder="Логин администратора"
          autoComplete="username"
          aria-label="Логин администратора"
        />
        <input
          type="password"
          value={password}
          onChange={event => setPassword(event.target.value)}
          placeholder="Пароль"
          autoComplete="current-password"
          aria-label="Пароль"
        />
        <button type="submit" disabled={busy || !username.trim() || !password}>Войти</button>
        {error && <Note text={error} kind="bad" />}
      </form>
    </main>
  )
}
