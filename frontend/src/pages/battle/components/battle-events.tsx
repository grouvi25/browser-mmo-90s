// Разбор событий раунда: подпись, цвет и значок. Общий для боевого экрана,
// хроники под полем и лога — иначе одно и то же событие называлось бы
// в трёх местах по-разному.
import { ArrowRight, RotateCcw, Shield, Sword, Zap } from 'lucide-react'
import type { AttackHand, BodyZone } from '../../../shared/api/battles.api'
import { ZONE_LABEL } from '../battle-view-model'

export interface TurnEvent {
  actor: 'player' | 'enemy' | string
  action: string; hit: boolean; dodge: boolean; block: boolean
  crit: boolean; lucky?: boolean; blockPierced?: boolean; zone?: BodyZone
  counterDamage?: number; sourceHand?: AttackHand
  rawDamage: number; finalDamage: number; logParts: string[]
}

export interface RoundRecord {
  round: number; events: TurnEvent[]; type: 'normal' | 'win' | 'lose'
  /** Момент получения раунда клиентом: макет пишет строки журнала со
   *  временем — «[16:31] Раунд № 1 начался». Сервер времени раунда не
   *  отдаёт, поэтому берём время, когда он пришёл. */
  at?: number
  expGain?: number; weaponExpGain?: number; moneyReward?: number; newLevel?: number
}

export function EventIcon({ type, size = 13 }: { type: string; size?: number }) {
  if (type === 'dodge')   return <ArrowRight size={size} />
  if (type === 'block')   return <Shield size={size} />
  if (type === 'counter') return <RotateCcw size={size} />
  if (type === 'crit')    return <Zap size={size} />
  if (type === 'lucky')   return <Zap size={size} />
  if (type === 'move')    return <ArrowRight size={size} />
  return <Sword size={size} />
}

export function getEvent(t: TurnEvent) {
  const hand = t.sourceHand ? (t.sourceHand === 'LEFT_HAND' ? 'Л: ' : 'П: ') : ''
  const z = t.zone ? ` (${ZONE_LABEL[t.zone]})` : ''
  if (t.action === 'move') return { type: 'move', label: 'Сближение', color: '#365d91' }
  if (!t.hit && t.dodge) return { type: 'dodge',   label: hand + 'Уворот' + z,   color: '#88b048' }
  if (!t.hit)            return { type: 'dodge',   label: hand + 'Уворот' + z,   color: '#88b048' } // нет промаха
  if (t.block)           return { type: 'block',   label: ((t.counterDamage ?? 0) > 0 ? 'Блок + ответка' : 'Блок') + z, color: '#6a9a3a' }
  if (t.blockPierced)    return { type: 'lucky',   label: hand + 'Пробил блок' + z, color: '#9a60c0' }
  if (t.lucky)           return { type: 'lucky',   label: hand + 'Пробитие' + z, color: '#9a60c0' }
  if (t.crit)            return { type: 'crit',    label: 'КРИТ' + z,     color: '#d4a017' }
  return                        { type: 'hit',     label: hand + 'Удар' + z,     color: '#c43030' }
}
