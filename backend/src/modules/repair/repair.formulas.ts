export function needsRepairParts(itemTier: number, upgradeLevel: number): boolean {
  return itemTier >= 2 || upgradeLevel >= 1
}
export function calcRequiredRepairParts(lostDurability: number, durabilityMax: number, itemTier: number, upgradeLevel: number): number {
  if (!needsRepairParts(itemTier, upgradeLevel) || lostDurability <= 0 || durabilityMax <= 0) return 0
  const lossRatio = Math.min(1, lostDurability / durabilityMax)
  const tierCoeff = itemTier >= 2 ? 2 : 1
  const upgradeCoeff = 1 + Math.max(0, upgradeLevel) * 0.5
  return Math.ceil(lossRatio * tierCoeff * upgradeCoeff)
}
export function repairPartsCode(repairResourceCode: string | null | undefined): string {
  return repairResourceCode ?? 'comp_repair_kit'
}
