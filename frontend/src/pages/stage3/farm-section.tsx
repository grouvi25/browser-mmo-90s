import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Droplets, Scissors, Hammer, Sprout } from 'lucide-react'
import { farmApi, type FarmBuilding } from '../../shared/api/farm.api'
import { fmt, remaining, Skeleton, Fault, Note } from './stage3-ui'

export function FarmSection() {
  const qc = useQueryClient()
  const [crop, setCrop] = useState('dill')
  const [building, setBuilding] = useState<FarmBuilding>('BARREL')
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)

  const farm = useQuery({ queryKey: ['farm'], queryFn: farmApi.get, refetchInterval: 15000 })

  const action = useMutation({
    mutationFn: async ({ kind, id }: { kind: string; id?: string }) => {
      if (kind === 'buy') return farmApi.buyPlot()
      if (kind === 'plant') return farmApi.plant(id!, crop)
      if (kind === 'water') return farmApi.water(id!)
      if (kind === 'harvest') return farmApi.harvest(id!)
      return farmApi.build(id!, building)
    },
    onSuccess: () => {
      setBad(false); setMsg('Готово')
      void qc.invalidateQueries({ queryKey: ['farm'] })
      void qc.invalidateQueries({ queryKey: ['resources'] })
      void qc.invalidateQueries({ queryKey: ['character'] })
    },
    onError: (e: Error) => { setBad(true); setMsg(e.message) },
  })

  if (farm.isLoading) return <Skeleton rows={3} />
  if (farm.isError || !farm.data) return <Fault retry={() => farm.refetch()} />

  const data = farm.data
  const cropName = (code: string | null) => data.crops.find(x => x.code === code)?.name ?? 'Свободная земля'

  return (
    <>
      <section className="s3-toolbar">
        <label>
          Посадить
          <select value={crop} onChange={e => setCrop(e.target.value)}>
            {data.crops.map(x => (
              <option disabled={!x.available} key={x.code} value={x.code}>
                {x.name} · {x.seedPrice} ₽{x.available ? '' : ` · нужен заготовитель ${x.requiredLevel}`}
              </option>
            ))}
          </select>
        </label>
        <label>
          Постройка
          <select value={building} onChange={e => setBuilding(e.target.value as FarmBuilding)}>
            {Object.entries(data.buildings).map(([key, x]) => (
              <option key={key} value={key}>{x.name} · {fmt(x.price)} ₽</option>
            ))}
          </select>
        </label>
        <button
          onClick={() => action.mutate({ kind: 'buy' })}
          disabled={!data.nextPlotPrice || action.isPending}
        >
          Купить участок {data.nextPlotPrice ? `${fmt(data.nextPlotPrice)} ₽` : '· лимит 12'}
        </button>
        <Note text={msg} kind={bad ? 'bad' : 'ok'} />
      </section>

      {data.cellarSaleBonus > 0 && (
        <p className="s3-hint">Погреб на участке: +{Math.round(data.cellarSaleBonus * 100)}% к цене продажи урожая.</p>
      )}

      <section className="farm-grid">
        {data.plots.map(plot => (
          <article key={plot.id} className={`plot state-${plot.state.toLowerCase()}`}>
            <div className="plot-num">{String(plot.slot).padStart(2, '0')}</div>
            <div>
              <strong>{plot.cropCode ? cropName(plot.cropCode) : 'Свободная земля'}</strong>
              <span>
                {plot.state === 'GROWING' ? `созреет через ${remaining(plot.readyAt)}`
                  : plot.state === 'READY' ? `можно собирать · засохнет через ${remaining(plot.withersAt)}`
                  : plot.state === 'WITHERED' ? 'урожай засох, нужна перекопка'
                  : plot.building?.type ? data.buildings[plot.building.type].name
                  : 'выберите культуру в панели сверху'}
              </span>
            </div>
            <div className="plot-actions">
              {plot.state === 'EMPTY' && (
                <button onClick={() => action.mutate({ kind: 'plant', id: plot.id })} disabled={action.isPending}>
                  <Sprout size={15} /> Посадить
                </button>
              )}
              {plot.state === 'GROWING' && (
                <button onClick={() => action.mutate({ kind: 'water', id: plot.id })} disabled={action.isPending || plot.waterCount >= 3}>
                  <Droplets size={15} /> Полить {plot.waterCount}/3
                </button>
              )}
              {(plot.state === 'READY' || plot.state === 'WITHERED') && (
                <button onClick={() => action.mutate({ kind: 'harvest', id: plot.id })} disabled={action.isPending}>
                  <Scissors size={15} /> {plot.state === 'READY' ? 'Собрать' : 'Перекопать'}
                </button>
              )}
              {!plot.building && (
                <button className="quiet" onClick={() => action.mutate({ kind: 'build', id: plot.id })} disabled={action.isPending}>
                  <Hammer size={15} /> Построить
                </button>
              )}
            </div>
          </article>
        ))}
      </section>
    </>
  )
}
