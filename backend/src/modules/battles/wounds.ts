// =============================================================
// Раны по зонам (правка заказчика 22.10):
//
// «Изначально части на человечке зелёные. После 1 попадания, когда
// нанесётся урон, она жёлтая, второе попадание (или если с двух рук в
// одно место наносится урон) — оранжевый, а на 3-е попадание красное, и
// снимается оружие (или броня)».
//
// Счёт ведётся в живом состоянии боя: попадание — это удар, прошедший
// уворот и блок и снявший здоровье. На третьем попадании в руку из неё
// выбивается оружие (дальше эта рука бьёт кулаком), в любую другую
// зону — сбивается броня этой зоны (дальше она её не прикрывает).
// Сами вещи у игрока остаются: всё это только до конца боя.
// =============================================================
import type { BodyZone } from '@prisma/client'
import { canonZone, type AttackHand } from './zones'

export const WOUND_STRIP_AT = 3

export type Wounds = Partial<Record<BodyZone, number>>
interface Wounded { wounds?: Wounds }

const HAND_ZONE: Record<AttackHand, BodyZone> = { LEFT_HAND: 'LEFT_ARM', RIGHT_HAND: 'RIGHT_ARM' }

/** Ноги — одна зона: раздельные из старых боёв считаем общей. */
const canon = canonZone

const ZONE_NAME: Record<BodyZone, string> = {
  HEAD: 'голове', CHEST: 'корпусе', LEFT_ARM: 'левой руке', RIGHT_ARM: 'правой руке',
  LEFT_LEG: 'левой ноге', RIGHT_LEG: 'правой ноге', LEGS: 'ногах',
}

export function woundsOf(part: Wounded, zone: BodyZone): number {
  return part.wounds?.[canon(zone)] ?? 0
}

export function isStripped(part: Wounded, zone: BodyZone): boolean {
  return woundsOf(part, zone) >= WOUND_STRIP_AT
}

export function isDisarmed(part: Wounded, hand: AttackHand): boolean {
  return isStripped(part, HAND_ZONE[hand])
}

/**
 * Попадание по зоне. Возвращает строку для журнала, когда этим ударом
 * с зоны снята вещь, иначе null.
 */
export function registerWound(part: Wounded, zone: BodyZone, damage: number): string | null {
  if (damage <= 0) return null
  const key = canon(zone)
  const before = part.wounds?.[key] ?? 0
  if (before >= WOUND_STRIP_AT) return null
  part.wounds = { ...part.wounds, [key]: before + 1 }
  if (before + 1 < WOUND_STRIP_AT) return null
  if (key === 'LEFT_ARM') return 'оружие выбито из левой руки'
  if (key === 'RIGHT_ARM') return 'оружие выбито из правой руки'
  return `броня на ${ZONE_NAME[key]} сбита`
}

/** Броня зоны с учётом ран: сбитая броня больше не прикрывает. */
export function woundedArmor(part: Wounded, armorFor: (zone: BodyZone) => number): (zone: BodyZone) => number {
  return zone => isStripped(part, zone) ? 0 : armorFor(zone)
}

/** Оружие руки с учётом ран: выбитое — как пустая рука. */
export function heldWeapon<T>(part: Wounded, hand: AttackHand, weapon: T | null): T | null {
  return isDisarmed(part, hand) ? null : weapon
}

/** Снаряжение бота с учётом ран: оружие у бота одно, в левой (основной) руке. */
export function woundedBotEquip(part: Wounded, equip: Record<string, unknown>): Record<string, unknown> {
  if (!isDisarmed(part, 'LEFT_HAND')) return equip
  const rest = { ...equip }
  delete rest.weapon
  return rest
}
