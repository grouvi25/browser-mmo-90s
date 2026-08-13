import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Shield, Backpack, Swords, Pill, X, Trash2, ShoppingBag } from 'lucide-react'
import { inventoryApi } from '../../shared/api/inventory.api'
import { shopApi } from '../../shared/api/shop.api'
import {
  WEAPON_TYPE_LABELS, ARMOR_SLOT_LABELS, ITEM_TYPE_LABELS, QUALITY_LABELS, type ItemInstance, type ItemStatKey
} from '../../shared/types/api.types'
import { ApiError } from '../../shared/api/client'
import { charactersApi } from '../../shared/api/characters.api'
import { itemImage } from '../../shared/assets/shop/shop-images'

const LOADOUT_KEY = 'mmo_battle_loadout'
function getLoadout(): string[] {
  try { return JSON.parse(localStorage.getItem(LOADOUT_KEY) ?? '[]') } catch { return [] }
}

function ItemDetail({ item }: { item: ItemInstance }) {
  const { template: t } = item
  const parts: string[] = []
  if (t.type === 'CONSUMABLE') {
    if (t.hpBonus && t.hpBonus > 0) parts.push(`+${t.hpBonus} HP`)
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
  const [loadoutIds, setLoadoutIds] = useState<string[]>(() => getLoadout())

  const toggleLoadout = (id: string) => {
    setLoadoutIds(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 4 ? [...prev, id] : prev
      localStorage.setItem(LOADOUT_KEY, JSON.stringify(next))
      return next
    })
  }

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
    mutationFn: ({ id, hand }: { id: string; hand?: 'LEFT_HAND' | 'RIGHT_HAND' }) => inventoryApi.equip(id, hand),
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
    onError: (err) => { showMsg('error', err instanceof ApiError ? err.message : 'Ошибка') },
  })

  const allocateMut = useMutation({
    mutationFn: ({ id, stat }: { id: string; stat: ItemStatKey }) => inventoryApi.allocatePoints(id, stat),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory'] })
      showMsg('success', 'Очко характеристики распределено')
    },
    onError: (err) => showMsg('error', err instanceof ApiError ? err.message : 'Не удалось распределить очко'),
  })

  const sellMut = useMutation({
    mutationFn: (id: string) => shopApi.sell(id),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['inventory'] })
      qc.invalidateQueries({ queryKey: ['character'] })
      showMsg('success', `Продано за ₽${data.sellPrice.toLocaleString('ru')}`)
    },
    onError: (err) => { showMsg('error', err instanceof ApiError ? err.message : 'Ошибка') },
  })

  const discardMut = useMutation({
    mutationFn: (id: string) => shopApi.discard(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory'] })
      showMsg('success', 'Предмет выброшен')
    },
    onError: (err) => { showMsg('error', err instanceof ApiError ? err.message : 'Ошибка') },
  })

  if (isLoading) return <div className="loading"><span className="spinner" />Загрузка инвентаря...</div>

  const equipped  = items.filter(i => i.isEquipped)
  const inventory = items.filter(i => !i.isEquipped && i.status !== 'DELETED')

  const renderItem = (item: ItemInstance) => {
    const t = item.template
    const typeLabel = t.weaponType
      ? WEAPON_TYPE_LABELS[t.weaponType]
      : t.armorSlot ? ARMOR_SLOT_LABELS[t.armorSlot] : (ITEM_TYPE_LABELS[t.type] ?? t.type)
    const durPct  = (item.durabilityCurrent / item.durabilityMax) * 100
    const durColor = durPct > 60 ? 'var(--success)' : durPct > 25 ? 'var(--warning)' : 'var(--danger)'
    const isBroken  = item.status === 'BROKEN' || item.durabilityCurrent <= 0
    const tooLow    = (char?.battleLevel ?? 0) < t.levelReq

    return (
      <tr key={item.id} style={isBroken ? { opacity: 0.65 } : {}}>
        <td>
          <img src={itemImage(t.code,t.weaponType,t.type)} alt="" width={58} height={42} style={{objectFit:'contain',float:'left',marginRight:8}} />
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
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            {t.type === 'CONSUMABLE' ? (
              <button className="btn btn-sm btn-success"
                disabled={useItemMut.isPending || inBattle}
                title={inBattle ? 'Используй в бою через карманы' : `+${t.hpBonus ?? 0} HP`}
                onClick={() => useItemMut.mutate(item.id)}>
                <Pill size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                Лечиться
              </button>
            ) : item.isEquipped ? (
              <button className="btn btn-sm" disabled={unequipMut.isPending || inBattle}
                title={inBattle ? 'Нельзя снять во время боя' : ''}
                onClick={() => unequipMut.mutate(item.id)}>
                Снять
              </button>
            ) : t.type === 'WEAPON' ? (
              <>
                <button className="btn btn-sm btn-primary" disabled={isBroken || tooLow || equipMut.isPending || inBattle}
                  onClick={() => equipMut.mutate({ id: item.id, hand: 'LEFT_HAND' })}>В левую</button>
                <button className="btn btn-sm btn-primary" disabled={isBroken || tooLow || equipMut.isPending || inBattle}
                  onClick={() => equipMut.mutate({ id: item.id, hand: 'RIGHT_HAND' })}>В правую</button>
              </>
            ) : (
              <button className="btn btn-sm btn-primary"
                disabled={isBroken || tooLow || equipMut.isPending || inBattle}
                title={inBattle ? 'Нельзя надеть во время боя' : isBroken ? 'Сломан — нужен ремонт' : tooLow ? `Нужен уровень ${t.levelReq}` : ''}
                onClick={() => equipMut.mutate({ id: item.id })}>
                Надеть
              </button>
            )}
            {/* Продать / выброс — только для не надетых предметов */}
            {item.template.allocationMode === 'PLAYER' && item.freePoints > 0 && (
              <div style={{ width: '100%', fontSize: 10 }}>
                <span style={{ color: 'var(--warning)', marginRight: 4 }}>Очки: {item.freePoints}</span>
                {(item.template.type === 'WEAPON' ? ['DAMAGE','ACCURACY','CRIT','DURABILITY'] : ['ARMOR','DURABILITY','ANTI_CRIT']).map(stat => (
                  <button key={stat} className="btn btn-sm" disabled={allocateMut.isPending || inBattle} onClick={() => allocateMut.mutate({ id: item.id, stat: stat as ItemStatKey })}>+ {stat}</button>
                ))}
              </div>
            )}
            {!item.isEquipped && (
              <>
                <button
                  className="btn btn-sm btn-gold"
                  disabled={sellMut.isPending || inBattle}
                  title={`Продать за ₽${Math.floor((t.priceBase ?? 0) * 0.5).toLocaleString('ru')} (50%)`}
                  onClick={() => sellMut.mutate(item.id)}
                >
                  <ShoppingBag size={10} style={{ marginRight: 3, verticalAlign: 'middle' }} />
                  ₽{Math.floor((t.priceBase ?? 0) * 0.5).toLocaleString('ru')}
                </button>
                <button
                  className="btn btn-sm"
                  style={{ opacity: 0.5 }}
                  disabled={discardMut.isPending}
                  title="Выбросить (безвозвратно)"
                  onClick={() => {
                    if (window.confirm(`Выбросить «${t.name}»? Это безвозвратно.`)) discardMut.mutate(item.id)
                  }}
                >
                  <Trash2 size={10} />
                </button>
              </>
            )}
          </div>
        </td>
      </tr>
    )
  }

  return (
    <div>
      {inBattle && (
        <div className="alert alert-warning mb8">
          <Swords size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />
          Вы в бою — менять экипировку нельзя.{' '}
          <a href="#" onClick={e => { e.preventDefault(); const id = localStorage.getItem('mmo_current_battle'); if (id) window.location.href = '/battle/' + id }}>
            Вернуться в бой →
          </a>
        </div>
      )}

      {message && <div className={`alert alert-${message.type} mb8`}>{message.text}</div>}

      {equipped.length > 0 && (
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">
              <Shield size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />
              НАДЕТО ({equipped.length})
            </span>
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
          <span className="panel-title">
            <Backpack size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            ИНВЕНТАРЬ ({inventory.length} предм.)
          </span>
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

      {/* ═══ КАРМАНЫ — редактор ════════════════════════════════ */}
      {(() => {
        const consumables = items.filter(i => i.template.type === 'CONSUMABLE' && i.status !== 'DELETED' && i.status !== 'CONSUMED')
        return (
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">
                <Pill size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                КАРМАНЫ (взять в бой, макс. 4)
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                Наполни перед боем — расходники будут доступны прямо в схватке
              </span>
            </div>
            <div className="panel-body">
              {/* 4 слота */}
              <div className="loadout-slots" style={{ marginBottom: 10 }}>
                {[0,1,2,3].map(i => {
                  const id = loadoutIds[i]
                  const item = id ? consumables.find(x => x.id === id) : null
                  return (
                    <div key={i}
                      className={`loadout-slot ${item ? 'filled' : 'empty'}`}
                      onClick={() => item && toggleLoadout(item.id)}
                      title={item ? 'Нажми чтобы убрать' : 'Пусто'}
                    >
                      <span className="loadout-slot-num">{i+1}</span>
                      {item ? (
                        <>
                          <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.template.name}</span>
                          <span style={{ fontSize:9, color:'var(--success)', marginLeft:4 }}>+{item.template.hpBonus}HP</span>
                          <X size={9} style={{ color:'var(--danger)', flexShrink:0, marginLeft:4 }} />
                        </>
                      ) : (
                        <span>— пусто —</span>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Список расходников */}
              {consumables.length === 0 ? (
                <div style={{ fontSize:10, color:'var(--text-dim)', fontStyle:'italic' }}>
                  Нет расходников. <a href="/shop">Купи в магазине</a>.
                </div>
              ) : (
                <table className="data-table" style={{ maxWidth: 500 }}>
                  <thead>
                    <tr><th>Расходник</th><th>HP</th><th>Действие</th></tr>
                  </thead>
                  <tbody>
                    {consumables.map(c => {
                      const inL = loadoutIds.includes(c.id)
                      const full = loadoutIds.length >= 4 && !inL
                      return (
                        <tr key={c.id} style={{ opacity: full ? 0.4 : 1 }}>
                          <td>
                            <span className={`q-${c.quality}`}>{c.template.name}</span>
                          </td>
                          <td style={{ color:'var(--success)', fontFamily:'var(--font-mono)' }}>
                            +{c.template.hpBonus}
                          </td>
                          <td>
                            <button
                              className={`btn btn-sm ${inL ? '' : 'btn-success'}`}
                              disabled={full && !inL}
                              onClick={() => toggleLoadout(c.id)}
                            >
                              {inL ? 'Убрать' : 'В карман'}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )
      })()}

    </div>
  )
}
