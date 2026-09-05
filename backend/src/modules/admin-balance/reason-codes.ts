// =============================================================
// НАЗВАНИЯ ПРИЧИН ДВИЖЕНИЯ ДЕНЕГ
//
// В журнале причина хранится кодом (`MARKET_SELL_TAX`) — так и надо: код
// не зависит от языка и не ломает поиск. Но в разборе «куда движутся
// деньги» строка `PRIVATE_SHOP_BUY` требует держать таблицу кодов в
// голове, а это ровно то состояние, когда на экран смотрят и ничего с
// него не понимают.
//
// Поэтому здесь — человеческие названия и, главное, знак: кран (деньги
// пришли в игру), сток (сгорели) или перенос между игроками. Разбираясь
// с инфляцией, сначала смотрят именно на это: перенос денежную массу не
// меняет, сколько бы его ни было.
// =============================================================

/** Что причина делает с общей денежной массой. */
export type MoneyFlow = 'faucet' | 'sink' | 'transfer'

interface ReasonMeta {
  title: string
  flow: MoneyFlow
}

const REASONS: Record<string, ReasonMeta> = {
  // Краны: деньги появляются из воздуха.
  WORK_REWARD: { title: 'Оплата смен', flow: 'faucet' },
  BATTLE_REWARD: { title: 'Награда за бой', flow: 'faucet' },
  FARM_HARVEST: { title: 'Урожай с огорода', flow: 'faucet' },
  GOVERNMENT_SELL: { title: 'Сдача государству', flow: 'faucet' },
  RESOURCE_SELL: { title: 'Продажа ресурсов системе', flow: 'faucet' },
  SHOP_SELL: { title: 'Сдача вещей в магазин', flow: 'faucet' },
  OBJECT_SALE: { title: 'Продажа объекта', flow: 'faucet' },
  OBJECT_WITHDRAW: { title: 'Снятие с баланса объекта', flow: 'faucet' },
  ADMIN_GRANT: { title: 'Начисление админом', flow: 'faucet' },

  // Стоки: деньги уходят из игры насовсем.
  SHOP_PURCHASE: { title: 'Покупки в магазине', flow: 'sink' },
  BAR_PURCHASE: { title: 'Бар', flow: 'sink' },
  REPAIR_COST: { title: 'Ремонт вещей', flow: 'sink' },
  REPAIR_USE: { title: 'Ремонт (расход набора)', flow: 'sink' },
  UPGRADE_COST: { title: 'Улучшение вещей', flow: 'sink' },
  UPGRADE_USE: { title: 'Улучшение (расход набора)', flow: 'sink' },
  MARKET_SELL_TAX: { title: 'Налог с продажи на рынке', flow: 'sink' },
  MARKET_LISTING_TAX: { title: 'Плата за выставление лота', flow: 'sink' },
  CLAN_CREATE: { title: 'Регистрация бригады', flow: 'sink' },
  FARM_PLOT_PURCHASE: { title: 'Покупка грядки', flow: 'sink' },
  FARM_SEED_PURCHASE: { title: 'Покупка семян', flow: 'sink' },
  FARM_BUILDING_PURCHASE: { title: 'Постройка на огороде', flow: 'sink' },
  OBJECT_PURCHASE: { title: 'Покупка объекта', flow: 'sink' },
  OBJECT_PROFILE_SWITCH: { title: 'Смена профиля объекта', flow: 'sink' },
  ADMIN_DEDUCT: { title: 'Списание админом', flow: 'sink' },

  // Переносы: деньги меняют владельца, но из игры не уходят.
  MARKET_BUY: { title: 'Покупки на рынке', flow: 'transfer' },
  MARKET_SELL: { title: 'Выручка с рынка', flow: 'transfer' },
  PRIVATE_SHOP_BUY: { title: 'Покупки в лавках игроков', flow: 'transfer' },
  PRIVATE_SHOP_SELL: { title: 'Выручка лавок игроков', flow: 'transfer' },
  CLAN_TREASURY_DEPOSIT: { title: 'Взнос в общак', flow: 'transfer' },
  CLAN_STORAGE_DEPOSIT: { title: 'Сдано в схрон', flow: 'transfer' },
  CLAN_STORAGE_WITHDRAW: { title: 'Взято из схрона', flow: 'transfer' },
  OBJECT_BALANCE_TOP_UP: { title: 'Пополнение баланса объекта', flow: 'transfer' },
}

/**
 * Человеческое название причины.
 *
 * Незнакомый код не прячем и не заменяем прочерком: новый код появляется
 * вместе с новой механикой, и увидеть его в разборе — единственный способ
 * заметить, что словарь отстал от игры.
 */
export function reasonTitle(code: string): string {
  return REASONS[code]?.title ?? code
}

/** Кран, сток или перенос. Неизвестный код считаем переносом: это
 *  единственное предположение, которое не искажает картину эмиссии. */
export function reasonFlow(code: string): MoneyFlow {
  return REASONS[code]?.flow ?? 'transfer'
}

/** Пометка для строки разбора: «кран», «сток» или пусто у переносов. */
export function reasonFlowLabel(code: string): string {
  const flow = reasonFlow(code)
  return flow === 'faucet' ? 'кран' : flow === 'sink' ? 'сток' : ''
}
