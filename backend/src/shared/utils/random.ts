/** Inclusive integer random in [min, max] */
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/** Random float in [min, max) */
export function randomFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min
}

/** Roll against a probability [0..1], returns true if hit */
export function rollChance(chance: number): boolean {
  return Math.random() < chance
}
