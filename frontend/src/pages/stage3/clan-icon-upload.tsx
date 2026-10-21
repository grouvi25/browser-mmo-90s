// =============================================================
// Иконка бригады (правка заказчика 21.10): «иконки загружает глава,
// когда создаёт бригаду», видна в списке игроков онлайн. Картинка
// ужимается в браузере до 64×64 и уходит на сервер.
// =============================================================
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { clansApi } from '../../shared/api/clans.api'
import { ApiError } from '../../shared/api/client'
import { squareImage } from '../../shared/lib/image-resize'

/** Выбор картинки: отдаёт готовый dataURL родителю (для формы регистрации). */
export function ClanIconPicker({ value, onChange }: { value: string | null; onChange: (dataUrl: string | null) => void }) {
  const [error, setError] = useState('')
  return (
    <div className="clan-icon-picker">
      {value && <img src={value} alt="Иконка бригады" width={48} height={48} className="clan-icon" />}
      <label className="btn btn-sm">
        {value ? 'Сменить иконку' : 'Выбрать иконку'}
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={async e => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          try { setError(''); onChange(await squareImage(file)) } catch (err) { setError(err instanceof Error ? err.message : 'Не вышло') }
        }} />
      </label>
      {value && <button type="button" className="btn btn-sm" onClick={() => onChange(null)}>Без иконки</button>}
      {error && <span role="alert" className="alert-error">{error}</span>}
    </div>
  )
}

/**
 * Иконка уже созданной бригады (главарь, право EDIT). Ставится один раз
 * (правка заказчика 22.10): у бригады с иконкой выбора больше нет, только
 * картинка; бригада, созданная без иконки, ставит её один раз здесь.
 */
export function ClanIconEditor({ clanId, iconVersion }: { clanId: string; iconVersion: number }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: (dataUrl: string) => clansApi.setIcon(dataUrl),
    onSuccess: () => {
      setDraft(null)
      void qc.invalidateQueries({ queryKey: ['clan'] }); void qc.invalidateQueries({ queryKey: ['clans'] })
      void qc.invalidateQueries({ queryKey: ['chat', 'online'] })
    },
  })
  return (
    <section className="clan-icon-editor" aria-label="Иконка бригады">
      <h3>Иконка бригады</h3>
      <div className="clan-icon-editor__row">
        {iconVersion > 0
          ? <img src={clansApi.iconUrl(clanId, iconVersion)} alt="Иконка бригады" width={48} height={48} className="clan-icon" />
          : <ClanIconPicker value={draft} onChange={setDraft} />}
        {draft && iconVersion === 0 && <button type="button" className="btn btn-primary btn-sm" disabled={save.isPending} onClick={() => { if (window.confirm('Иконку ставят один раз — потом её не поменять. Сохранить?')) save.mutate(draft) }}>Сохранить иконку</button>}
      </div>
      <small className="muted">{iconVersion > 0 ? 'Иконка ставится один раз, поменять её нельзя.' : 'Иконку ставят один раз — потом её не поменять.'}</small>
      {save.error && <p role="alert" className="alert alert-error">{save.error instanceof ApiError ? save.error.message : 'Не сохранилось'}</p>}
      {save.isSuccess && <p role="status" className="alert alert-success">Иконка сохранена</p>}
    </section>
  )
}
