import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { inventoryApi } from '../../shared/api/inventory.api'
import {
  WEAPON_TYPE_LABELS, ARMOR_SLOT_LABELS, QUALITY_LABELS, type ItemInstance
} from '../../shared/types/api.types'
import { ApiError } from '../../shared/api/client'
import { charactersApi } from '../../shared/api/characters.api'

function ItemDetail({ item }: { item: ItemInstance }) {
  const { template: t } = item
  const parts: string[] = []
  if (t.type === 'CONSUMABLE') {
    if (t.hpBonus && t.hpBonus > 0) parts.push(`❤️ +${t.hpBonus} HP`)
    parts.push('Одноразовый')
  } else {
    if (t.minDamage != null) parts.push(`Урон: ${t.minDamage}–${t.maxDamage}`)
    if (t.weaponAccuracy) parts.push(`Точн: ${Math.round(t.weaponAccuracy * 100)}%`)
    if (t.armor != null && t.armor > 0) parts.push(`Броня: ${t.armor}`)
    if (t.dodgeBonus && t.dodgeBonus > 0) parts.push(`Уворот: +${Math.round(t.dodgeBonus * 100)}%`)
    if (t.antiCrit && t.antiCrit > 0) parts.push(`АнтиКрит: +${Math.round(t.antiCrit * 100)}%`)
    parts.push(`Вес: ${t.weight}`)
  }
  const reqs: string[] = []
  if (t.levelReq > 0) reqs.push(`Ур.≥${t.levelReq}`)
  if (t.strReq > 0) reqs.push(`СИЛ≥${t.strReq}`)
  if (t.skillReq > 0) reqs.push(`Навык≥${t.skillReq}`)
  return (
    <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
      {parts.join(' | ')}
      {reqs.length > 0 && <span style={{ color: 'var(--warning)', marginLeft: 6 }}>[{reqs.join(', ')}]</span>}
    </div>
  )
}

export function InventoryPage() {
  const qc = useQueryClient()
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const { data: char } = useQuery({
    queryKey: ['character', 'me'],
    queryFn: () => charactersApi.getMe(),
  })

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['inventory'],
    queryFn: () => inventoryApi.getItems(),
  })

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 4000)
  }

  const inBattle = char?.status === 'IN_BATTLE'

  const equipMut = useMutation({
    mutationFn: (id: string) => inventoryApi.equip(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory'] })
      qc.invalidateQueries({ queryKey: ['character'] })
      showMsg('success', 'Предмет надет')
    },
    onError: (err) => {
      const msg = err instanceof ApiError
        ? (err.status === 400 && err.code === 'CHAR_003' ? 'Нельзя менять экипировку во время боя'
        : err.status === 400 && err.code === 'ITEM_004'  ? 'Предмет уже надет'
        : err.status === 400 && err.code === 'ITEM_003'  ? 'Предмет сломан — сначала починить'
        : err.status === 400 && err.code === 'ITEM_007'  ? 'Недостаточный уровень'
        : err.message)
        : 'Ошибка сервера'
      showMsg('error', msg)
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
      showMsg('error', err instanceof ApiError ? err.message : 'Ошибка сервера')
    },
  })

  const useItemMut = useMutation({
    mutationFn: (id: string) => inventoryApi.useItem(id),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['inventory'] })
      qc.invalidateQueries({ queryKey: ['character'] })
      showMsg('success', `${data.itemName}: +${data.hpRestored} HP (теперь ${data.newHp} HP)`)
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
    const durPct  = (item.durabilityCurrent / item.durabilityMax) * 100
    const durColor = durPct > 60 ? 'var(--success)' : durPct > 25 ? 'var(--warning)' : 'var(--danger)'
    const isBroken  = item.status === 'BROKEN' || item.durabilityCurrent <= 0
    const tooLow    = (char?.battleLevel ?? 0) < t.levelReq

    return (
      <tr key={item.id} style={isBroken ? { opacity: 0.65 } : {}}>
        <td>
          <div className={`q-${item.quality}`} style={{ fontWeight: item.isEquipped ? 'bold' : 'normal' }}>
            {t.name}
            {item.isEquipped && <span style={{ color: 'var(--success)', marginLeft: 4 }}>▲ Надето</span>}
            {isBroken   && <span style={{ color: 'var(--danger)', marginLeft: 4 }}>⚠ Сломан</span>}
            {tooLow     && <span style={{ color: 'var(--warning)', marginLeft: 4, fontSize: 10 }}>Ур.{t.levelReq}</span>}
          </div>
          <ItemDetail item={item} />
        </td>
        <td style={{ fontSize: 11, color: 'var(--text-dim)' }}>{typeLabel}</td>
        <td style={{ fontSize: 11 }}><span className={`q-${item.quality}`}>{QUALITY_LABELS[item.quality]}</span></td>
        <td>
          {t.type === 'CONSUMABLE' ? (
            <span style={{ fontSize: 10, color: 'var(--text-dim)', fontStyle: 'italic' }}>одноразовый</span>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ flex: 1, height: 6, background: 'var(--border)' }}>
                <div style={{ width: `${durPct}%`, height: '100%', background: durColor }} />
              </div>
              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                {item.durabilityCurrent}/{item.durabilityMax}
              </span>
            </div>
          )}
        </td>
        <td>
          {t.type === 'CONSUMABLE' ? (
            <button className="btn btn-sm btn-success"
              disabled={useItemMut.isPending || inBattle}
              title={inBattle ? 'Используй расходник в бою через меню действий' : `Восстановить HP (+${t.hpBonus ?? 0})`}
              onClick={() => useItemMut.mutate(item.id)}>
              💊 Лечиться
            </button>
          ) : item.isEquipped ? (
            <button className="btn btn-sm"
              disabled={unequipMut.isPending || inBattle}
              title={inBattle ? 'Нельзя снять во время боя' : ''}
              onClick={() => unequipMut.mutate(item.id)}>
              Снять
            </button>
          ) : (
            <button className="btn btn-sm btn-primary"
              disabled={isBroken || tooLow || equipMut.isPending || inBattle}
              title={
                inBattle ? 'Нельзя надеть во время боя'
                : isBroken ? 'Сломан — нужен ремонт'
                : tooLow  ? `Нужен уровень ${t.levelReq}`
                : ''
              }
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
      {inBattle && (
        <div className="alert alert-warning mb8">
          ⚔️ Вы в бою — менять экипировку нельзя.{' '}
          <a href="#" onClick={e => { e.preventDefault(); const id = localStorage.getItem('mmo_current_battle'); if (id) window.location.href = '/battle/' + id }}>
            Вернуться в бой →
          </a>
        </div>
      )}

      {message && <div className={`alert alert-${message.type} mb8`}>{message.text}</div>}

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
