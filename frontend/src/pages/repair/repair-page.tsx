import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { repairApi } from '../../shared/api/repair.api'
import { QUALITY_LABELS, WEAPON_TYPE_LABELS, ARMOR_SLOT_LABELS, type RepairItem } from '../../shared/types/api.types'
import { ApiError } from '../../shared/api/client'

export function RepairPage() {
  const qc = useQueryClient()
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [previewItem, setPreviewItem] = useState<string | null>(null)

  const { data: items = [], isLoading, refetch } = useQuery({
    queryKey: ['repair', 'items'],
    queryFn: () => repairApi.listItems(),
  })

  const { data: preview, isLoading: previewLoading } = useQuery({
    queryKey: ['repair', 'preview', previewItem],
    queryFn: () => repairApi.preview(previewItem!),
    enabled: !!previewItem,
  })

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  const repairMut = useMutation({
    mutationFn: (itemId: string) => repairApi.commit(itemId),
    onSuccess: (data) => {
      showMsg('success', `Отремонтировано! Остаток: ₽ ${data.newBalance.toLocaleString('ru')}`)
      setPreviewItem(null)
      qc.invalidateQueries({ queryKey: ['repair'] })
      qc.invalidateQueries({ queryKey: ['inventory'] })
      qc.invalidateQueries({ queryKey: ['character'] })
      refetch()
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        if (err.status === 400) showMsg('error', 'Не хватает денег на ремонт')
        else showMsg('error', err.message)
      }
    },
  })

  if (isLoading) return <div className="loading"><span className="spinner" />Загрузка...</div>

  return (
    <div>
      {message && <div className={`alert alert-${message.type} mb8`}>{message.text}</div>}

      <div className="row">
        <div className="col">
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">🔧 МАСТЕРСКАЯ — РЕМОНТ</span>
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                Стоимость: базовая цена / 120 × потеря прочности
              </span>
            </div>
            <div className="panel-body">
              {items.length === 0 ? (
                <div className="alert alert-info">
                  Нет предметов, требующих ремонта. Все предметы в хорошем состоянии!
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Предмет</th>
                      <th>Тип</th>
                      <th>Качество</th>
                      <th>Прочность</th>
                      <th className="num">Стоимость ремонта</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(item => {
                      const t = item.template
                      const typeLabel = t.weaponType
                        ? WEAPON_TYPE_LABELS[t.weaponType]
                        : t.armorSlot ? ARMOR_SLOT_LABELS[t.armorSlot] : t.type
                      const durPct = (item.durabilityCurrent / item.durabilityMax) * 100
                      const durColor = durPct > 60 ? 'var(--success)' : durPct > 25 ? 'var(--warning)' : 'var(--danger)'

                      return (
                        <tr key={item.id}
                          style={{
                            cursor: 'pointer',
                            background: previewItem === item.id ? 'var(--bg-hover)' : undefined,
                          }}
                          onClick={() => setPreviewItem(item.id === previewItem ? null : item.id)}
                        >
                          <td>
                            <span className={`q-${item.quality}`} style={{ fontWeight: 'bold' }}>
                              {t.name}
                            </span>
                            {item.status === 'BROKEN' && (
                              <span style={{ color: 'var(--danger)', fontSize: 10, marginLeft: 4 }}>СЛОМАН</span>
                            )}
                          </td>
                          <td style={{ fontSize: 11 }}>{typeLabel}</td>
                          <td><span className={`q-${item.quality}`}>{QUALITY_LABELS[item.quality]}</span></td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <div style={{ flex: 1, height: 6, background: 'var(--border)' }}>
                                <div style={{ width: `${durPct}%`, height: '100%', background: durColor }} />
                              </div>
                              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
                                {item.durabilityCurrent}/{item.durabilityMax}
                              </span>
                            </div>
                          </td>
                          <td className="num repair-cost">₽ {item.repairCost.toLocaleString('ru')}</td>
                          <td>
                            <button
                              className="btn btn-sm btn-success"
                              onClick={(e) => {
                                e.stopPropagation()
                                repairMut.mutate(item.id)
                              }}
                              disabled={repairMut.isPending}
                            >
                              Починить
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
        </div>

        {/* Preview panel */}
        {previewItem && (
          <div style={{ width: 260, flexShrink: 0 }}>
            <div className="panel">
              <div className="panel-header">
                <span className="panel-title">📋 ДЕТАЛИ РЕМОНТА</span>
              </div>
              <div className="panel-body">
                {previewLoading ? (
                  <div className="loading"><span className="spinner" />Расчёт...</div>
                ) : preview ? (
                  <>
                    <table className="data-table mb8">
                      <tbody>
                        <tr>
                          <td>Прочность</td>
                          <td className="text-mono">
                            {preview.durabilityCurrent} → <strong style={{ color: 'var(--success)' }}>
                              {preview.durabilityMax}
                            </strong>
                          </td>
                        </tr>
                        <tr>
                          <td>Потеря</td>
                          <td className="text-mono text-danger">{preview.lostDurability}</td>
                        </tr>
                        <tr>
                          <td>Стоимость</td>
                          <td className="repair-cost">₽ {preview.repairCost.toLocaleString('ru')}</td>
                        </tr>
                        <tr>
                          <td>У вас денег</td>
                          <td className={preview.canAfford ? 'money' : 'text-danger'}>
                            ₽ {preview.characterMoney.toLocaleString('ru')}
                          </td>
                        </tr>
                        <tr>
                          <td>Хватит?</td>
                          <td style={{ color: preview.canAfford ? 'var(--success)' : 'var(--danger)' }}>
                            {preview.canAfford ? '✅ Да' : '❌ Нет'}
                          </td>
                        </tr>
                      </tbody>
                    </table>

                    <button
                      className="btn btn-success btn-block"
                      disabled={!preview.canAfford || repairMut.isPending}
                      onClick={() => repairMut.mutate(previewItem)}
                    >
                      {repairMut.isPending
                        ? <><span className="spinner" />Ремонт...</>
                        : '🔧 Починить'}
                    </button>

                    {!preview.canAfford && (
                      <div className="alert alert-error mt8" style={{ fontSize: 11 }}>
                        Не хватает ₽ {(preview.repairCost - preview.characterMoney).toLocaleString('ru')}
                      </div>
                    )}
                  </>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
