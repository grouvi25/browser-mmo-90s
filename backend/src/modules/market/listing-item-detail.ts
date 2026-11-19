// Вещь в лоте рынка и в магазине торгаша — так же подробно, как на Складе
// (Дима 19.11: «игроки выставляют шмот, который сами сделали, а не видно
// статы, описание»). Те же поля и та же формула итогов, что у /api/inventory.
import type { ItemInstance, ItemTemplate } from '@prisma/client'
import { BalanceConfig } from '../../config/balance.config'
import { applyUpgradeModifiers, type UpgradeKind } from '../upgrades/upgrades.formulas'

export function listingItemDetail(instance: ItemInstance & { template: ItemTemplate }) {
  const { ownerId: _owner, ...item } = instance
  return {
    ...item,
    percentPerPoint: BalanceConfig.economy.namedItems.percentPerPoint,
    damagePerPoint: BalanceConfig.economy.namedItems.damagePerPoint,
    armorPerPoint: BalanceConfig.strike.armorPerPoint,
    effective: applyUpgradeModifiers(
      instance.template,
      (instance.upgradeModifiersJson as Partial<Record<UpgradeKind, number>> | null) ?? {},
      instance.statAllocation, instance.socketsJson,
    ),
  }
}
