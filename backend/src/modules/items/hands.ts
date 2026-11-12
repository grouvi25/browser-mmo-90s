// =============================================================
// Двуручное оружие (Дима 11.11): «автомат можно в руку брать один, он
// занимает две руки; пистолетов два». Автомат, винтовка, снайперка и
// пулемёт держат обеими руками: вторая рука пустая, щит и второе оружие
// снимаются. Пистолеты, ножи, дубинки, обрез — по одному в каждую руку.
// =============================================================

export const TWO_HANDED_WEAPON_TYPES: ReadonlySet<string> = new Set(['RIFLE', 'SNIPER', 'HEAVY'])

export function isTwoHanded(template: { type?: string | null; weaponType?: string | null } | null | undefined): boolean {
  return !!template && template.type === 'WEAPON' && !!template.weaponType && TWO_HANDED_WEAPON_TYPES.has(template.weaponType)
}

export const HANDS = ['LEFT_HAND', 'RIGHT_HAND'] as const
export type Hand = typeof HANDS[number]
export const otherHand = (hand: Hand): Hand => (hand === 'LEFT_HAND' ? 'RIGHT_HAND' : 'LEFT_HAND')
