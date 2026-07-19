import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { inventoryApi } from '../../shared/api/inventory.api'
import {
  WEAPON_TYPE_LABELS, ARMOR_SLOT_LABELS, QUALITY_LABELS, type ItemInstance
} from '../../shared/types/api.types'
import { useState } from 'react'
import { ApiError } from '../../shared/api/client'

function ItemDetail({ item }: { item: ItemInstance }) {
  const { template: t } = item
  return (
    <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
      {t.minDamage != null && (
        <span>Урон: <strong style={{ color: 'var(--danger)' }}>{t.minDamage}–{t.maxDamage}</strong> | </span>
      )}
      {t.armor != null && t.armor > 0 && (
        <span>Броня: <strong style={{ color: 'var(--accent)' }}>{t.armor}</strong> | </span>
      )}
      <span>Вес: {t.weight} | </span>
      <span>Цена: <span className="money" style={{ fontSize: 11 }}>{t.priceBase}</span></span>
    </div>
  )
}

export function InventoryPage() {
  const qc = useQueryClient()
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['inventory'],
    queryFn: () => inventoryApi.getItems(),
  })

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 3000)
  }

  const equipMut = useMutation({
    mutationFn: (id: string) => inventoryApi.equip(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory'] })
      qc.invalidateQueries({ queryKey: ['character'] })
      showMsg('success', 'Предмет надет')
    },
    onError: (err) => {
      showMsg('error', err instanceof ApiError ? err.message : 'Ошибка')
    },
  })

  const unequipMut = useMutation({
    mutationFn: (id: string) => inventoryApi.unequip(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory'] })
      qc.invalidateQueries({ queryKey: ['character'] })
      showMsg('success', 'Предмет снят')
    },
    onError: (err) => {
      showMsg('error', err instanceof ApiError ? err.message : 'Ошибка')
    },
  })

  if (isLoading) return <div className="loading"><span className="spinner" />Загрузка инвентаря...</div>

  const equipped  = items.filter(i => i.isEquipped)
  const inventory = items.filter(i => !i.isEquipped && i.status !== 'DELETED')

  const renderItem = (item: ItemInstance) => {
    const t = item.template
    const typeLabel = t.weaponType
      ? WEAPON_TYPE_LABELS[t.weaponType]
      : t.armorSlot ? ARMOR_SLOT_LABELS[t.armorSlot] : t.type
    const durPct = (item.durabilityCurrent / item.durabilityMax) * 100
    const durColor = durPct > 60 ? 'var(--success)' : durPct > 25 ? 'var(--warning)' : 'var(--danger)'

    return (
      <tr key={item.id} style={item.status === 'BROKEN' ? { opacity: 0.6 } : {}}>
        <td>
          <div className={`q-${item.quality}`} style={{ fontWeight: item.isEquipped ? 'bold' : 'normal' }}>
            {t.name}
            {item.isEquipped && <span style={{ color: 'var(--success)', marginLeft: 4 }}>▲ Надето</span>}
            {item.status === 'BROKEN' && <span style={{ color: 'var(--danger)', marginLeft: 4 }}>⚠ Сломан</span>}
          </div>
          <ItemDetail item={item} />
        </td>
        <td style={{ fontSize: 11, color: 'var(--text-dim)' }}>{typeLabel}</td>
        <td style={{ fontSize: 11 }}><span className={`q-${item.quality}`}>{QUALITY_LABELS[item.quality]}</span></td>
        <td>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ flex: 1, height: 6, background: 'var(--border)' }}>
              <div style={{ width: `${durPct}%`, height: '100%', background: durColor }} />
            </div>
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
              {item.durabilityCurrent}/{item.durabilityMax}
            </span>
          </div>
        </td>
        <td>
          {item.isEquipped ? (
            <button className="btn btn-sm" onClick={() => unequipMut.mutate(item.id)}
              disabled={unequipMut.isPending}>Снять</button>
          ) : (
            <button className="btn btn-sm btn-primary"
              disabled={item.status === 'BROKEN' || equipMut.isPending}
              onClick={() => equipMut.mutate(item.id)}>
              Надеть
            </button>
          )}
        </td>
      </tr>
    )
  }

  return (
    <div>
      {message && (
        <div className={`alert alert-${message.type} mb8`}>{message.text}</div>
      )}

      {equipped.length > 0 && (
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">🛡️ НАДЕТО ({equipped.length})</span>
          </div>
          <div className="panel-body">
            <table className="data-table">
              <thead>
                <tr><th>Предмет</th><th>Тип</th><th>Качество</th><th>Прочность</th><th></th></tr>
              </thead>
              <tbody>{equipped.map(renderItem)}</tbody>
            </table>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">🎒 ИНВЕНТАРЬ ({inventory.length} предм.)</span>
        </div>
        <div className="panel-body">
          {inventory.length === 0 ? (
            <div className="text-dim" style={{ textAlign: 'center', padding: 16 }}>
              Инвентарь пуст. Сходи в <a href="/shop">магазин</a>.
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr><th>Предмет</th><th>Тип</th><th>Качество</th><th>Прочность</th><th>Действие</th></tr>
              </thead>
              <tbody>{inventory.map(renderItem)}</tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
