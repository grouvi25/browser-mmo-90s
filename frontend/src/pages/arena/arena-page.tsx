// =============================================================
// Стрелки: бой с ботом и общий список заявок на бои с игроками.
// =============================================================
import { PveStart } from '../../widgets/pve-start/pve-start'
import { BattleApplications } from '../pvp/applications'

export function ArenaPage() {
  return (
    <div className="arena">
      <PveStart />
      <BattleApplications />
    </div>
  )
}
