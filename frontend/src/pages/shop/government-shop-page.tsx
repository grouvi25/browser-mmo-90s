import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Swords, Shield, Pill, Store } from 'lucide-react'
import { shopApi } from '../../shared/api/shop.api'
import {
  WEAPON_TYPE_LABELS, ARMOR_SLOT_LABELS, QUALITY_LABELS, type ShopItem
} from '../../shared/types/api.types'
import { ApiError } from '../../shared/api/client'
import { SHOP_IMAGES } from '../../shared/assets/shop/shop-images'

function itemImage(item: ShopItem) { return SHOP_IMAGES[item.template.code] ?? SHOP_IMAGES.weapon_fists }

function ItemPrice({ item }: { item: ShopItem }) {
  const price = item.overridePrice ?? item.template.priceBase
  return <span className="money">{price.toLocaleString('ru')}</span>
}

function ItemStats({ item }: { item: ShopItem }) {
  const t = item.template
  const parts: string[] = []
  if (t.type === 'CONSUMABLE') {
    if (t.hpBonus && t.hpBonus > 0) parts.push(`+${t.hpBonus} HP`)
    else parts.push('Расходник')
  } else {
    if (t.minDamage != null) parts.push(`Урон: ${t.minDamage}–${t.maxDamage}`)
    if (t.weaponAccuracy) parts.push(`Точность: ${Math.round(t.weaponAccuracy * 100)}%`)
    if (t.critBonus && t.critBonus > 0) parts.push(`Крит: +${Math.round(t.critBonus * 100)}%`)
    if (t.armor != null && t.armor > 0) parts.push(`Броня: ${t.armor}`)
    if (t.dodgeBonus && t.dodgeBonus > 0) parts.push(`Уворот: +${Math.round(t.dodgeBonus * 100)}%`)
    if (t.antiCrit && t.antiCrit > 0) parts.push(`Антикрит: +${Math.round(t.antiCrit * 100)}%`)
    if (t.weight) parts.push(`Вес: ${t.weight}`)
  }
  const reqs: string[] = []
  if (t.strReq > 0) reqs.push(`СИЛ≥${t.strReq}`)
  if (t.skillReq > 0) reqs.push(`Навык≥${t.skillReq}`)
  const sellPrice = Math.floor(t.priceBase * 0.3)
  return (
    <div>
      <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{parts.join(' | ')}</span>
      {reqs.length > 0 && <span style={{ fontSize: 10, color: 'var(--warning)', marginLeft: 6 }}>({reqs.join(', ')})</span>}
      <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 6, opacity: 0.7 }}>
        продажа: <span className="money" style={{ fontSize: 10 }}>{sellPrice}</span>
      </span>
    </div>
  )
}

export function GovernmentShopPage() {
  const qc = useQueryClient()
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [filterType, setFilterType] = useState<'ALL' | 'WEAPON' | 'ARMOR' | 'CONSUMABLE'>('ALL')
  const [filterLevel, setFilterLevel] = useState<number | 'ALL'>('ALL') // 0 = любой

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['shop', 'government'],
    queryFn: () => shopApi.listItems(),
  })

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 4000)
  }

  const buyMut = useMutation({
    mutationFn: (templateId: string) => shopApi.buy(templateId),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['inventory'] })
      qc.invalidateQueries({ queryKey: ['character'] })
      showMsg('success', `Куплено! Остаток: ₽ ${data.newBalance.toLocaleString('ru')}`)
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        if (err.status === 400 && err.code === 'SHOP_001')
          showMsg('error', 'Не хватает денег')
        else
          showMsg('error', err.message)
      }
    },
  })

  const filtered = items.filter(item => {
    if (filterType !== 'ALL' && item.template.type !== filterType) return false
    if (filterLevel !== 'ALL' && item.template.levelReq !== filterLevel) return false
    return true
  })

  if (isLoading) return <div className="loading"><span className="spinner" />Загрузка магазина...</div>

  return (
    <div>
      {message && <div className={`alert alert-${message.type} mb8`}>{message.text}</div>}

      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">
            <Store size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            ГОСУДАРСТВЕННЫЙ МАГАЗИН
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            Базовое снаряжение по фиксированным ценам
          </span>
        </div>
        <div className="panel-body">
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            {(['ALL', 'WEAPON', 'ARMOR', 'CONSUMABLE'] as const).map(f => (
              <button
                key={f}
                className={`btn btn-sm${filterType === f ? ' btn-primary' : ''}`}
                onClick={() => setFilterType(f)}
              >
                {f === 'ALL' ? (
                  'Все'
                ) : f === 'WEAPON' ? (
                  <><Swords size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />Оружие</>
                ) : f === 'ARMOR' ? (
                  <><Shield size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />Броня</>
                ) : (
                  <><Pill size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />Расходники</>
                )}
              </button>
            ))}
            <div style={{ marginLeft: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Макс. ур.:</span>
              {(['ALL', 0, 1, 2, 3, 4] as const).map(lv => (
                <button
                  key={lv}
                  className={`btn btn-sm${filterLevel === lv ? ' btn-primary' : ''}`}
                  onClick={() => setFilterLevel(lv)}
                  style={{ minWidth: 28 }}
                >
                  {lv === 'ALL' ? 'Все' : `Ур. ${lv}`}
                </button>
              ))}
            </div>
          </div>

          <table className="data-table shop-item-row">
            <thead>
              <tr>
                <th>Вид</th><th>Предмет</th>
                <th>Тип</th>
                <th>Качество</th>
                <th>Характеристики</th>
                <th>Прочность</th>
                <th className="num">Цена</th>
                <th>Уровень</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => {
                const t = item.template
                const typeLabel = t.weaponType
                  ? WEAPON_TYPE_LABELS[t.weaponType]
                  : t.armorSlot ? ARMOR_SLOT_LABELS[t.armorSlot] : t.type

                return (
                  <tr key={item.id}>
                    <td><img src={itemImage(item)} alt="" width={58} height={42} style={{objectFit:'contain'}} /></td>
                    <td>
                      <span className={`q-${t.qualityBase}`} style={{ fontWeight: 'bold' }}>
                        {t.name}
                      </span>
                    </td>
                    <td style={{ fontSize: 11 }}>
                      {t.type === 'WEAPON' && <span className="tag tag-weapon">ОРУЖИЕ</span>}
                      {t.type === 'ARMOR' && <span className="tag tag-armor">БРОНЯ</span>}
                      {' '}{typeLabel}
                    </td>
                    <td><span className={`q-${t.qualityBase}`}>{QUALITY_LABELS[t.qualityBase]}</span></td>
                    <td><ItemStats item={item} /></td>
                    <td className="num text-mono">{t.durabilityMax}</td>
                    <td className="num"><ItemPrice item={item} /></td>
                    <td className="num text-dim">{t.levelReq > 0 ? `≥${t.levelReq}` : '—'}</td>
                    <td>
                      <button
                        className="btn btn-sm btn-success"
                        disabled={buyMut.isPending}
                        onClick={() => buyMut.mutate(t.id)}
                      >
                        Купить
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {filtered.length === 0 && (
            <div className="text-dim" style={{ textAlign: 'center', padding: 16 }}>
              Нет доступных товаров
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
