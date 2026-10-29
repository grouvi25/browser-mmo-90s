// Товары для собак плитками, как в обычном магазине (правка заказчика 28.10:
// «Зоомагазин — формат как обычный магазин; в гос лавке вкладка „Для собак“,
// в ЦУМе так же»). Один список на три места: Зоомагазин показывает всё,
// госмагазин — то, что за рубли, ЦУМ — то, что за доллары.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Dog, Bone, Shield } from 'lucide-react'
import { cityApi } from '../../shared/api/city.api'
import { charactersApi } from '../../shared/api/characters.api'
import { ApiError } from '../../shared/api/client'
import { SPRITES } from '../../shared/ui/sprite'
import { dogBonusText } from '../../shared/lib/dog'

export type DogGoodsKind = 'dogs' | 'food' | 'gear'

interface Good {
  key: string
  kind: DogGoodsKind
  name: string
  lines: string[]
  price: number
  currency: 'RUB' | 'USD'
  /** Почему купить нельзя — словами, а не серой кнопкой без объяснений. */
  blocked?: string
  buy: () => Promise<unknown>
}

const ICON = { dogs: Dog, food: Bone, gear: Shield } as const
const STAT_NAMES: Record<string, string> = { str: 'Сила', agi: 'Ловкость', rea: 'Реакция', acc: 'Меткость', end: 'Выносливость', luck: 'Фарт' }

export function DogGoods({ currency, kinds = ['dogs', 'food', 'gear'] }: {
  currency?: 'RUB' | 'USD'
  kinds?: DogGoodsKind[]
}) {
  const qc = useQueryClient()
  const pets = useQuery({ queryKey: ['city', 'pets'], queryFn: cityApi.pets })
  const me = useQuery({ queryKey: ['character', 'me'], queryFn: charactersApi.getMe })
  const buy = useMutation({
    mutationFn: (good: Good) => good.buy(),
    onSuccess: () => {
      for (const key of ['city', 'character', 'dollars']) void qc.invalidateQueries({ queryKey: [key] })
    },
  })

  if (pets.isLoading) return <p role="status">Загрузка…</p>
  if (pets.isError || !pets.data) return <p role="alert">Витрина не загрузилась. <button className="btn" onClick={() => void pets.refetch()}>Повторить</button></p>

  const data = pets.data
  const dog = data.dog
  const legacy = !dog && data.owned.some(p => p.code === 'cat' || p.code === 'dog')
  const money = me.data?.money ?? 0
  const dollars = me.data?.dollars ?? 0
  const afford = (price: number, cur: 'RUB' | 'USD') => (cur === 'USD' ? dollars : money) >= price
  const noDog = 'Сначала купите собаку'

  const goods: Good[] = [
    ...data.catalog.map((b): Good => ({
      key: `dog-${b.code}`, kind: 'dogs', name: b.name,
      lines: [b.role, b.freeAllocation ? `Очков на старте: ${b.points}` : `+${b.points} ${(STAT_NAMES[b.mainStat ?? ''] ?? '').toLowerCase()}, растёт с уровнем`, 'В бою — фигура на поле: вызывается кнопкой'],
      price: b.priceDollars ?? b.price, currency: b.priceDollars ? 'USD' : 'RUB',
      blocked: dog ? (dog.code === b.code ? 'Это ваша собака' : 'Собака у вас уже есть') : legacy ? 'Старого питомца меняют бесплатно — ниже' : undefined,
      buy: () => cityApi.buyPet(b.code),
    })),
    ...data.packs.map((p): Good => ({
      key: `food-${p.code}`, kind: 'food', name: p.name,
      lines: ['Прибавляет срок сытости к уже купленному', 'Сытая собака даёт бонус и выходит в бой'],
      price: p.price, currency: p.currency,
      blocked: dog ? undefined : noDog,
      buy: () => cityApi.food(dog!.id, p.code),
    })),
    ...data.gear.map((g): Good => ({
      key: `gear-${g.code}`, kind: 'gear', name: g.name,
      lines: [data.gearSlots[g.slot] ?? g.slot, dogBonusText(g.bonus)],
      price: g.price, currency: 'RUB',
      blocked: !dog ? noDog : dog.gear[g.slot]?.code === g.code ? 'Уже надето' : undefined,
      buy: () => cityApi.dogGear(dog!.id, g.code),
    })),
  ].filter(g => kinds.includes(g.kind) && (!currency || g.currency === currency))

  return <>
    {buy.isError && <p role="alert" className="city-notice">{buy.error instanceof ApiError ? buy.error.message : 'Не получилось'}</p>}
    {buy.isSuccess && <p role="status" className="city-notice">Куплено.</p>}
    {goods.length === 0 ? <p className="gshop-empty">В этой категории пока пусто.</p> : (
      <section className="gshop-grid">{goods.map(good => {
        const Icon = ICON[good.kind]
        const poor = !afford(good.price, good.currency)
        const reason = good.blocked ?? (poor ? (good.currency === 'USD' ? 'Не хватает долларов' : 'Не хватает денег') : undefined)
        return <article className="gshop-card" key={good.key}>
          <span className="dog-goods__icon" aria-hidden="true"><Icon size={34} /></span>
          <div className="gshop-card-body">
            <div className="gshop-card-head"><h3>{good.name}</h3></div>
            <p className="gshop-card-meta">
              <span>Цена: {good.price.toLocaleString('ru')} {good.currency === 'USD' ? '$' : 'руб.'}</span>
            </p>
            <div className="gshop-card-lower">
              <ul className="gshop-bonuses">{good.lines.filter(Boolean).map(line => <li key={line}>{line}</li>)}</ul>
              <div className="gshop-card-actions">
                <button className="gshop-btn" disabled={buy.isPending || !!reason} title={reason} onClick={() => buy.mutate(good)}>
                  <img className="gshop-frame" src={SPRITES['shop-btn-frame']} alt="" draggable={false} />
                  <span>Купить</span>
                </button>
                {reason && <small className="dog-goods__why">{reason}</small>}
              </div>
            </div>
          </div>
        </article>
      })}</section>
    )}
  </>
}
