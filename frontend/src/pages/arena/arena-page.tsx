// =============================================================
// Арена: бой с ботом и открытые дуэли на одном экране.
// =============================================================
import { PveStart } from '../../widgets/pve-start/pve-start'
import { PvpPage } from '../pvp/pvp-page'

export function ArenaPage() {
  return (
    <div className="arena">
      <PveStart />
      <PvpPage />
    </div>
  )
}
