// =============================================================
// Премиум-витрина.
//
// Правило, которое экран обязан доносить без справки: подписка продаёт
// ВРЕМЯ, а не силу. Поэтому список «чего подписка не даёт» стоит прямо
// на экране, а не в описании товара: игрок должен видеть границу до
// покупки, а не догадываться о ней после.
//
// Оплата в первой версии идёт вне игры, оформляет администратор, — и это
// сказано честно, вместо неработающей кнопки «Купить».
// =============================================================
import { useQuery } from '@tanstack/react-query'
import { Clock, Sparkles, Package, BadgeCheck } from 'lucide-react'
import { premiumApi, type PremiumProduct } from '../../shared/api/strategy.api'
import { fmt, Skeleton, Fault, Empty } from '../stage3/stage3-ui'

const KIND: Record<PremiumProduct['kind'], { title: string; icon: typeof Clock; hint: string }> = {
  TIME: {
    title: 'Время', icon: Clock,
    hint: 'Ускоряет то, чего можно дождаться и так. Ничего, что нельзя получить ожиданием.',
  },
  CONVENIENCE: {
    title: 'Удобство', icon: Package,
    hint: 'Мелочи под руку. На бой не влияет.',
  },
  COSMETIC: {
    title: 'Косметика', icon: Sparkles,
    hint: 'Только внешний вид. На механику не влияет вообще.',
  },
}

const ORDER: PremiumProduct['kind'][] = ['TIME', 'CONVENIENCE', 'COSMETIC']

export function PremiumShopSection() {
  const state = useQuery({ queryKey: ['premium', 'me'], queryFn: premiumApi.me })
  const shop = useQuery({ queryKey: ['premium', 'shop'], queryFn: premiumApi.shop })
  const purchases = useQuery({ queryKey: ['premium', 'purchases'], queryFn: premiumApi.purchases })

  if (shop.isLoading || state.isLoading) return <Skeleton rows={5} />
  if (shop.isError) return <Fault retry={() => shop.refetch()} />

  const items = shop.data?.items ?? []
  const me = state.data

  return (
    <>
      <div className="s4-summary">
        <div className={`s4-stat ${me?.isPremium ? 's4-stat--good' : ''}`}>
          <span className="s4-stat__label"><BadgeCheck size={13} /> Подписка</span>
          <b>{me?.isPremium ? 'активна' : 'нет'}</b>
        </div>
        {me?.expiresAt && (
          <div className="s4-stat">
            <span className="s4-stat__label">Действует до</span>
            <b>{new Date(me.expiresAt).toLocaleDateString('ru-RU')}</b>
          </div>
        )}
        <div className="s4-stat">
          <span className="s4-stat__label">Опыт оружия</span>
          <b>×{me?.benefits.skillMultiplier ?? 1}</b>
        </div>
        <div className="s4-stat">
          <span className="s4-stat__label">Смен в сутки</span>
          <b>{me?.benefits.dailyShiftCap ?? 12}</b>
        </div>
        <div className="s4-stat">
          <span className="s4-stat__label">Помощников</span>
          <b>{me?.benefits.helperSlots ?? 0}</b>
        </div>
      </div>

      {/* Граница показана до покупки, а не после. */}
      <p className="s4-lead">
        Подписка продаёт <b>время</b>, а не силу. Она <b>не даёт</b>
        {' '}характеристик, урона, брони, шанса улучшения, скидок на рынке,
        доступа к рецептам и не влияет на бой никаким способом. Потолок
        оружейного навыка у подписчика тот же — он доходит до него быстрее.
      </p>

      {items.length === 0
        ? <Empty title="Витрина пуста" />
        : ORDER.map(kind => {
          const group = items.filter(item => item.kind === kind)
          if (group.length === 0) return null
          const meta = KIND[kind]
          const Icon = meta.icon
          return (
            <section key={kind} className="s4-shop-group">
              <h4><Icon size={13} /> {meta.title}</h4>
              <p className="s4-muted s4-shop-group__hint">{meta.hint}</p>
              <ul className="s4-shop">
                {group.map(item => (
                  <li key={item.code} className="s4-goods">
                    <div className="s4-goods__body">
                      <b>{item.name}</b>
                      <span className="s4-muted">{item.description}</span>
                    </div>
                    <span className="s4-goods__price">{fmt(item.priceRub)} ₽</span>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}

      <p className="s4-note-box">
        Оплата в первой версии проходит вне игры: напишите администратору, и
        подписку оформят вручную. Кнопки покупки здесь нет намеренно — она
        не работала бы.
      </p>
      <p className="s4-note-box">
        В первой версии витрина состоит из одной подписки. Косметика, места в
        инвентаре, ускорение цикла и полив грядки отложены до следующей: пока
        нет оплаты, продавать их нечем, а показывать как товар — обман.
      </p>

      {purchases.data && purchases.data.items.length > 0 && (
        <>
          <h4>Мои покупки</h4>
          <ul className="s4-list s4-list--log">
            {purchases.data.items.map((row, index) => (
              <li key={index}>
                <span className="s4-muted">{new Date(row.at).toLocaleDateString('ru-RU')}</span>
                <span>{row.name}</span>
                <span>{fmt(row.priceRub)} ₽</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
