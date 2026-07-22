import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect, useRef } from 'react'
import { battlesApi } from '../../shared/api/battles.api'
import { inventoryApi } from '../../shared/api/inventory.api'
import { type BattleAction } from '../../shared/types/api.types'
import { ApiError } from '../../shared/api/client'
import { charactersApi } from '../../shared/api/characters.api'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface TurnEvent {
  actor: 'player' | 'enemy' | string
  action: string; hit: boolean; dodge: boolean; block: boolean
  crit: boolean; rawDamage: number; finalDamage: number; logParts: string[]
}
interface RoundRecord {
  round: number; events: TurnEvent[]; type: 'normal' | 'win' | 'lose'
  expGain?: number; weaponExpGain?: number; moneyReward?: number; newLevel?: number
}
interface RoundResult {
  roundNumber?: number; playerHp?: number; botHp?: number; battleOver?: boolean
  result?: string; expGain?: number; weaponExpGain?: number; moneyReward?: number
  newLevel?: number; waiting?: boolean; turns?: TurnEvent[]
}

// ── Иконки событий ────────────────────────────────────────────
function getEvent(t: TurnEvent) {
  if (!t.hit)  return { icon: '💨', label: 'Промах',  color: '#666',    badge: 'miss' }
  if (t.dodge) return { icon: '👻', label: 'Уворот',  color: '#88b048', badge: 'dodge' }
  if (t.block) return { icon: '🛡️', label: 'Блок',    color: '#6a8a3a', badge: 'block' }
  if (t.crit)  return { icon: '⚡', label: 'КРИТ!',   color: '#f0c030', badge: 'crit' }
  return              { icon: '💥', label: 'Удар',    color: '#c43030', badge: 'hit' }
}

// ── Плавающее число урона ─────────────────────────────────────
function FloatingDmg({ dmg, crit, side }: { dmg: number; crit: boolean; side: 'left'|'right' }) {
  return (
    <div className={`float-dmg float-dmg-${side} ${crit ? 'crit' : ''}`}>
      {crit && '⚡'}{dmg > 0 ? `-${dmg}` : 'Мимо!'}
    </div>
  )
}

// ══ ГЛАВНЫЙ КОМПОНЕНТ ═════════════════════════════════════════
export function BattlePage() {
  const { id: battleId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const logRef = useRef<HTMLDivElement>(null)

  const [rounds, setRounds] = useState<RoundRecord[]>([])
  const [floatingDmg, setFloatingDmg] = useState<{side:'left'|'right';dmg:number;crit:boolean;key:number}|null>(null)
  const [playerShake, setPlayerShake] = useState(false)
  const [enemyShake, setEnemyShake] = useState(false)
  const [playerHp, setPlayerHp] = useState<number|null>(null)
  const [enemyHp, setEnemyHp] = useState<number|null>(null)
  const [playerDmgTotal, setPlayerDmgTotal] = useState(0)
  const [enemyDmgTotal, setEnemyDmgTotal] = useState(0)
  const [currentRound, setCurrentRound] = useState(1)
  const [battleOver, setBattleOver] = useState(false)
  const [result, setResult] = useState<RoundResult|null>(null)
  const [actionError, setActionError] = useState('')
  const [selectedWeapon, setSelectedWeapon] = useState('')
  const [showLog, setShowLog] = useState(false)

  const isValid = !!battleId && UUID_RE.test(battleId)

  useEffect(() => { if (!isValid) navigate('/profile', { replace: true }) }, [isValid, navigate])

  const { data: char } = useQuery({ queryKey: ['character','me'], queryFn: () => charactersApi.getMe(), enabled: isValid })
  const { data: items = [] } = useQuery({ queryKey: ['inventory'], queryFn: () => inventoryApi.getItems(), enabled: isValid && !!char })
  const { data: battleData } = useQuery({
    queryKey: ['battle', battleId],
    queryFn: () => battlesApi.getBattle(battleId!),
    enabled: isValid && !battleOver,
    refetchInterval: q => q.state.data?.battle?.status === 'FINISHED' || battleOver ? false : 3000,
  })

  const live = battleData?.liveState
  const playerPart = live?.participants.find(p => p.characterId === char?.id)
  const enemyPart  = live?.participants.find(p => !!p.botId || p.characterId !== char?.id)

  const pHp    = playerHp ?? playerPart?.hpCurrent ?? char?.hpCurrent ?? 0
  const pHpMax = playerPart?.hpMax ?? char?.hpMax ?? 1
  const eHp    = enemyHp ?? enemyPart?.hpCurrent ?? 0
  const eHpMax = enemyPart?.hpMax ?? 1
  const pHpPct = Math.max(0, Math.min(100, pHp / pHpMax * 100))
  const eHpPct = Math.max(0, Math.min(100, eHp / eHpMax * 100))

  const weapon     = items.find(i => i.isEquipped && i.template.type === 'WEAPON')
  const consumables = items.filter(i => i.template.type === 'CONSUMABLE' && i.status !== 'DELETED' && i.status !== 'CONSUMED')
  const weapons    = items.filter(i => i.template.type === 'WEAPON' && i.status !== 'BROKEN' && !i.isEquipped)

  function shake(side: 'player'|'enemy', dmg: number, crit: boolean) {
    if (side === 'player') setPlayerShake(true)
    else setEnemyShake(true)
    setFloatingDmg({ side: side === 'player' ? 'left' : 'right', dmg, crit, key: Date.now() })
    setTimeout(() => { setPlayerShake(false); setEnemyShake(false); setFloatingDmg(null) }, 900)
  }

  const actionMut = useMutation({
    mutationFn: ({ action, itemId }: { action: BattleAction; itemId?: string }) =>
      battlesApi.submitAction(battleId!, action, itemId) as unknown as Promise<RoundResult>,
    onSuccess: (data) => {
      const rn = data.roundNumber ?? currentRound
      setCurrentRound(rn)
      if (data.playerHp != null) setPlayerHp(data.playerHp)
      if (data.botHp    != null) setEnemyHp(data.botHp)

      let pDmg = 0, eDmg = 0
      const events: TurnEvent[] = data.turns?.map(t => ({
        actor: t.actor === 'player' ? 'player' : 'enemy',
        action: t.action, hit: t.hit, dodge: t.dodge, block: t.block,
        crit: t.crit, rawDamage: t.rawDamage, finalDamage: t.finalDamage, logParts: t.logParts,
      })) ?? []

      events.forEach(t => {
        if (t.hit && !t.dodge) {
          if (t.actor === 'player') { shake('enemy', t.finalDamage, t.crit); pDmg += t.finalDamage }
          else { shake('player', t.finalDamage, t.crit); eDmg += t.finalDamage }
        }
      })
      setPlayerDmgTotal(p => p + pDmg)
      setEnemyDmgTotal(p => p + eDmg)

      setRounds(prev => [...prev, {
        round: rn, events,
        type: data.battleOver ? (data.result === 'PVE_WIN' ? 'win' : 'lose') : 'normal',
        ...data,
      }])

      if (data.battleOver) {
        setBattleOver(true); setResult(data)
        localStorage.removeItem('mmo_current_battle')
        qc.invalidateQueries({ queryKey: ['character','me'] })
        qc.invalidateQueries({ queryKey: ['inventory'] })
      }
    },
    onError: (err) => {
      setActionError(err instanceof ApiError ? err.message : 'Ошибка')
      setTimeout(() => setActionError(''), 4000)
    },
  })

  const canAct = !battleOver && !actionMut.isPending
  const act = (action: BattleAction, itemId?: string) => actionMut.mutate({ action, itemId })
  const lastRound = rounds[rounds.length - 1]

  if (!isValid) return null

  // ── Финальный экран ───────────────────────────────────────────
  if (battleOver && result) {
    const won = result.result === 'PVE_WIN'
    return (
      <div className="battle-scene-wrap">
        <div className={`battle-result-screen ${won ? 'win' : 'lose'}`}>
          <div className="brs-title">{won ? '🏆 ПОБЕДА!' : '💀 ПОРАЖЕНИЕ'}</div>
          {won && (
            <div className="brs-rewards">
              {(result.expGain ?? 0) > 0 && <div className="brs-reward"><span>⭐</span><strong>+{result.expGain}</strong><small>боевой опыт</small></div>}
              {(result.weaponExpGain ?? 0) > 0 && <div className="brs-reward"><span>🗡️</span><strong>+{Number(result.weaponExpGain).toFixed(1)}</strong><small>навык</small></div>}
              {(result.moneyReward ?? 0) > 0 && <div className="brs-reward"><span>💰</span><strong>+{result.moneyReward}₽</strong><small>деньги</small></div>}
            </div>
          )}
          {(result.newLevel ?? 0) > 1 && <div className="brs-levelup">🎉 НОВЫЙ УРОВЕНЬ {result.newLevel}!</div>}
          <div className="brs-actions">
            <button className="btn btn-primary" onClick={() => navigate('/profile')}>← Профиль</button>
            <button className="btn btn-gold" onClick={() => navigate('/repair')}>🔧 Ремонт</button>
            <button className="btn btn-danger" onClick={() => navigate('/profile')}>⚔️ Снова</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="battle-scene-wrap">

      {/* ══ ЕДИНАЯ СЦЕНА БОЯ ═══════════════════════════════════ */}
      <div className="battle-scene">

        {/* Фоновый слой — промзона 90-х (заменить на арт дизайнера) */}
        <div className="battle-bg">
          <div className="battle-bg-ground" />
          <div className="battle-bg-sky" />
          {/* Элементы сцены — промышленный двор */}
          <div className="scene-barrel scene-barrel-1" />
          <div className="scene-barrel scene-barrel-2" />
          <div className="scene-crate scene-crate-1" />
          <div className="scene-crate scene-crate-2" />
          <div className="scene-lamp" />
          {/* Ограничители дуэли — будут скрыты для массовых боёв */}
          <div className="duel-fence duel-fence-left" />
          <div className="duel-fence duel-fence-right" />
        </div>

        {/* Плавающий урон */}
        {floatingDmg && (
          <FloatingDmg key={floatingDmg.key} dmg={floatingDmg.dmg} crit={floatingDmg.crit} side={floatingDmg.side} />
        )}

        {/* ── Левый боец (игрок) ── */}
        <div className={`battle-fighter battle-fighter-left ${playerShake ? 'fighter-shake' : ''} ${battleOver && result?.result !== 'PVE_WIN' ? 'fighter-dead' : ''}`}>
          <div className="fighter-shadow" />
          <div className="fighter-sprite fighter-sprite-player">
            {pHpPct < 25 ? '🤕' : pHpPct < 60 ? '😤' : '🧍'}
          </div>
          <div className="fighter-info fighter-info-left">
            <div className="fighter-name-badge">{char?.nickname ?? 'Вы'}</div>
            <div className="fighter-weapon-badge">{weapon?.template.name ?? '✊ Кулаки'}</div>
          </div>
          {/* HP bar */}
          <div className="fighter-hp-block fighter-hp-left">
            <div className="fhp-bar-bg">
              <div className="fhp-bar-fill" style={{
                width: `${pHpPct}%`,
                background: pHpPct > 60 ? '#4a8a35' : pHpPct > 25 ? '#c4802a' : '#c43030',
              }} />
            </div>
            <div className="fhp-text">{pHp}/{pHpMax}</div>
          </div>
          <div className="fighter-dmg-badge">⚔️ {playerDmgTotal + (playerPart?.damageDealt ?? 0)}</div>
        </div>

        {/* ── Центр: раунд + VS ── */}
        <div className="battle-center">
          <div className="battle-round-pill">
            Раунд {currentRound}
          </div>
          <div className="battle-vs-glow">
            {actionMut.isPending ? <span className="vs-loading">⏳</span> : 'VS'}
          </div>
        </div>

        {/* ── Правый боец (враг) ── */}
        <div className={`battle-fighter battle-fighter-right ${enemyShake ? 'fighter-shake' : ''} ${battleOver && result?.result === 'PVE_WIN' ? 'fighter-dead' : ''}`}>
          <div className="fighter-shadow" />
          <div className="fighter-sprite fighter-sprite-enemy">
            {eHpPct < 25 ? '💀' : eHpPct < 60 ? '😠' : '💀'}
          </div>
          <div className="fighter-info fighter-info-right">
            <div className="fighter-name-badge">Противник</div>
          </div>
          {/* HP bar */}
          <div className="fighter-hp-block fighter-hp-right">
            <div className="fhp-bar-bg">
              <div className="fhp-bar-fill" style={{
                width: `${eHpPct}%`,
                background: eHpPct > 60 ? '#4a8a35' : eHpPct > 25 ? '#c4802a' : '#c43030',
              }} />
            </div>
            <div className="fhp-text">{eHp}/{eHpMax}</div>
          </div>
          <div className="fighter-dmg-badge">⚔️ {enemyDmgTotal + (enemyPart?.damageDealt ?? 0)}</div>
        </div>

        {/* ── Последнее событие поверх сцены ── */}
        {lastRound && lastRound.events.length > 0 && (
          <div className="scene-events-overlay">
            {lastRound.events.slice(-2).map((t, i) => {
              const e = getEvent(t)
              return (
                <div key={i} className={`scene-event scene-event-${e.badge}`} style={{ color: e.color }}>
                  <span>{e.icon}</span>
                  <span className="se-actor">{t.actor === 'player' ? char?.nickname ?? 'Вы' : 'Враг'}</span>
                  <span className="se-label">{e.label}</span>
                  {t.finalDamage > 0 && <span className="se-dmg">−{t.finalDamage}</span>}
                </div>
              )
            })}
          </div>
        )}

      </div>{/* /battle-scene */}

      {/* ══ ПАНЕЛЬ ДЕЙСТВИЙ ════════════════════════════════════ */}
      {!battleOver && (
        <div className="battle-hud">
          {actionError && <div className="battle-hud-error">{actionError}</div>}

          <div className="battle-hud-actions">
            <button className="hud-btn hud-attack" disabled={!canAct} onClick={() => act('attack')}>
              <span className="hud-btn-icon">⚔️</span>
              <span className="hud-btn-label">Атака</span>
            </button>
            <button className="hud-btn hud-block" disabled={!canAct} onClick={() => act('block')}>
              <span className="hud-btn-icon">🛡️</span>
              <span className="hud-btn-label">Блок</span>
            </button>
            {consumables.map(c => (
              <button key={c.id} className="hud-btn hud-heal" disabled={!canAct} onClick={() => act('use_item', c.id)}>
                <span className="hud-btn-icon">💊</span>
                <span className="hud-btn-label">+{c.template.hpBonus}HP</span>
              </button>
            ))}
            {weapons.length > 0 && (
              <div className="hud-weapon-switch">
                <select className="hud-select" disabled={!canAct} value={selectedWeapon}
                  onChange={e => setSelectedWeapon(e.target.value)}>
                  <option value="">🔄 Смена...</option>
                  {weapons.map(w => <option key={w.id} value={w.id}>{w.template.name}</option>)}
                </select>
                {selectedWeapon && (
                  <button className="hud-btn hud-switch-confirm" disabled={!canAct}
                    onClick={() => { act('change_weapon', selectedWeapon); setSelectedWeapon('') }}>OK</button>
                )}
              </div>
            )}
            <button className="hud-btn hud-surrender" disabled={!canAct} onClick={() => act('surrender')}>🏳️</button>
          </div>

          {/* Лог — сворачиваемый */}
          <div className="battle-log-toggle" onClick={() => setShowLog(v => !v)}>
            📜 Лог боя (раунд {currentRound}) {showLog ? '▲' : '▼'}
          </div>
          {showLog && (
            <div className="battle-log-mini" ref={logRef}>
              {rounds.slice().reverse().map(r => (
                <div key={r.round} className="log-round-row">
                  <span className="log-rn">[{r.round}]</span>
                  {r.events.map((t, i) => {
                    const e = getEvent(t)
                    return (
                      <span key={i} className="log-ev" style={{ color: e.color }}>
                        {t.actor === 'player' ? '👤' : '💀'}{e.icon}
                        {t.finalDamage > 0 && `−${t.finalDamage}`}{' '}
                      </span>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

    </div>
  )
}
