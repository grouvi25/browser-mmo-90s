/** Clamp value between min and max inclusive */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** Clamp to [0, 1] */
export function clamp01(value: number): number {
  return clamp(value, 0, 1)
}
