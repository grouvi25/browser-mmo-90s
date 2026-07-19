import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { shopApi } from '../../shared/api/shop.api'
import {
  WEAPON_TYPE_LABELS, ARMOR_SLOT_LABELS, QUALITY_LABELS, type ShopItem
} from '../../shared/types/api.types'
import { ApiError } from '../../shared/api/client'

function ItemPrice({ item }: { item: ShopItem }) {
  const price = item.overridePrice ?? item.template.priceBase
  return <span className="money">{price.toLocaleString('ru')}</span>
}

function ItemStats({ item }: { item: ShopItem }) {
  const t = item.template
  const parts: string[] = []
  if (t.minDamage != null) parts.push(`Урон: ${t.minDamage}–${t.maxDamage}`)
  if (t.armor != null && t.armor > 0) parts.push(`Броня: ${t.armor}`)
  if (t.weight) parts.push(`Вес: ${t.weight}`)
  return <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{parts.join(' | ')}</span>
}

export function GovernmentShopPage() {
  const qc = useQueryClient()
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [filter, setFilter] = useState<'ALL' | 'WEAPON' | 'ARMOR' | 'CONSUMABLE'>('ALL')

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
    if (filter === 'ALL') return true
    return item.template.type === filter
  })

  if (isLoading) return <div className="loading"><span className="spinner" />Загрузка магазина...</div>

  return (
    <div>
      {message && <div className={`alert alert-${message.type} mb8`}>{message.text}</div>}

      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">🏪 ГОСУДАРСТВЕННЫЙ МАГАЗИН</span>
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            Базовое снаряжение по фиксированным ценам
          </span>
        </div>
        <div className="panel-body">
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            {(['ALL', 'WEAPON', 'ARMOR', 'CONSUMABLE'] as const).map(f => (
              <button
                key={f}
                className={`btn btn-sm${filter === f ? ' btn-primary' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f === 'ALL' ? 'Все' : f === 'WEAPON' ? '⚔️ Оружие' : f === 'ARMOR' ? '🛡️ Броня' : '💊 Расходники'}
              </button>
            ))}
          </div>

          <table className="data-table shop-item-row">
            <thead>
              <tr>
                <th>Предмет</th>
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
