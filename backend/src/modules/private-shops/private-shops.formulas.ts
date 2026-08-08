export function privateShopTotal(price: number, quantity: number): number { return Math.max(0, Math.trunc(price)) * Math.max(0, Math.trunc(quantity)) }
