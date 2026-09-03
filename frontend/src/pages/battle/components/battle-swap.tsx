// =============================================================
// Переодевание в бою — Этап 4, шаг F7.
//
// Живёт в выдвижном ящике рядом с карманом, а не на самой сцене: макет
// боевого экрана переодевания не рисует, и вставлять кнопку в его
// геометрию значило бы ломать пиксель-перфект ради механики, которой там
// нет. Ящик — наложение, к макету он не относится.
//
// Цена показана на кнопке, потому что она и есть решение: смена оружия
// стоит одно очко хода из двух (то есть один удар), смена брони — весь
// ход. Игрок должен видеть размен до того, как нажмёт.
// =============================================================
import { Repeat, Shirt } from 'lucide-react'
import type { AttackHand, BodyZone } from '../../../shared/api/battles.api'
import type { ItemInstance } from '../../../shared/types/api.types'
import { ZONE_LABEL } from '../battle-view-model'

export interface SwapPlan {
  weapon?: { hand: AttackHand; itemInstanceId: string }
  armor?: { zone: BodyZone; itemInstanceId: string }
}

/** Слоты брони, которые ложатся на боевые зоны. */
const ARMOR_ZONE: Partial<Record<string, BodyZone>> = {
  HEAD: 'HEAD', CHEST: 'CHEST', LEGS: 'LEFT_LEG', GLOVES: 'LEFT_ARM',
}

export function BattleSwap({
  inventory, plan, canAct, open, onOpenChange, onChange,
}: {
  inventory: ItemInstance[]
  plan: SwapPlan
  canAct: boolean
  open: boolean
  /** Нет обработчика — нечего сворачивать: подпись остаётся заголовком. */
  onOpenChange?: (open: boolean) => void
  onChange: (plan: SwapPlan) => void
}) {
  const weapons = inventory.filter(item => item.template.type === 'WEAPON' && !item.isEquipped)
  const armor = inventory.filter(item =>
    item.template.type === 'ARMOR' && !item.isEquipped
    && item.armorSlot && ARMOR_ZONE[item.armorSlot])
  const picked = (plan.weapon ? 1 : 0) + (plan.armor ? 1 : 0)

  return (
    <section className="battle-disclosure battle-swap-block">
      {onOpenChange ? (
        <button
          type="button"
          className="battle-disclosure__toggle"
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
        >
          <Repeat size={14} /> <span>Переодеться{picked > 0 ? ` · ${picked}` : ''}</span>
        </button>
      ) : (
        <h4 className="battle-disclosure__toggle">
          <Repeat size={14} /> <span>Переодеться{picked > 0 ? ` · ${picked}` : ''}</span>
        </h4>
      )}

      {open && (
        <div className="battle-pocket-list battle-swap">
          <p className="battle-swap__hint">
            Смена оружия стоит одно очко хода — вместо двух ударов останется
            один. Смена брони съедает ход целиком.
          </p>

          <label className="battle-swap__row">
            <span><Repeat size={12} /> Оружие в левую руку</span>
            <select
              value={plan.weapon?.itemInstanceId ?? ''}
              disabled={!canAct || weapons.length === 0}
              onChange={event => onChange({
                ...plan,
                weapon: event.target.value
                  ? { hand: 'LEFT_HAND', itemInstanceId: event.target.value }
                  : undefined,
              })}
            >
              <option value="">не менять</option>
              {weapons.map(item => (
                <option key={item.id} value={item.id}>{item.template.name}</option>
              ))}
            </select>
          </label>

          <label className="battle-swap__row">
            <span><Shirt size={12} /> Броня</span>
            <select
              value={plan.armor?.itemInstanceId ?? ''}
              disabled={!canAct || armor.length === 0}
              onChange={event => {
                const item = armor.find(x => x.id === event.target.value)
                onChange({
                  ...plan,
                  armor: item && item.armorSlot
                    ? { zone: ARMOR_ZONE[item.armorSlot]!, itemInstanceId: item.id }
                    : undefined,
                })
              }}
            >
              <option value="">не менять</option>
              {armor.map(item => (
                <option key={item.id} value={item.id}>
                  {item.template.name} · {ZONE_LABEL[ARMOR_ZONE[item.armorSlot!]!]}
                </option>
              ))}
            </select>
          </label>

          {weapons.length === 0 && armor.length === 0 && (
            <p className="battle-swap__hint">В сумке нет ничего, во что можно переодеться.</p>
          )}

          {plan.armor && (
            <p className="battle-swap__hint battle-swap__hint--warn">
              Смена брони заберёт весь ход: ни ударов, ни блоков не будет.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
