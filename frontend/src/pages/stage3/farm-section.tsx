// =============================================================
// Ферма: поле из участков-квадратиков и действие выбранной вкладки.
//
// Правка заказчика: «В фермах постройки — не оч понятно, как строятся…
// картинка ферм, выбираем квадратик… а внизу кнопки Посадить, Полить,
// Построить». Действие выбирается вкладкой внизу (?tab=water|build),
// участок — кликом по квадратику, а панель над полем говорит, что
// именно произойдёт и сколько стоит.
// =============================================================
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Droplets, Scissors, Hammer, Sprout, Plus, Wheat, Warehouse, Umbrella, Dog, Cylinder } from 'lucide-react'
import { farmApi, type FarmBuilding, type FarmPlot } from '../../shared/api/farm.api'
import { fmt, remaining, Skeleton, Fault, Note } from './stage3-ui'

type Mode = 'plant' | 'water' | 'build'

/** Что делает постройка — раньше игрок видел только название и цену. */
const BUILDING_INFO: Record<FarmBuilding, { hint: string; icon: typeof Hammer }> = {
  BARREL: { hint: 'Соседние грядки при посадке сразу политы один раз.', icon: Cylinder },
  CANOPY: { hint: 'Соседние грядки растут быстрее — как от лишнего полива.', icon: Umbrella },
  CELLAR: { hint: '+10% к каждому собранному урожаю. Строится во дворе.', icon: Warehouse },
  // В механике сторожа пока нет: постройка продаётся, но ничего не даёт.
  DOG: { hint: 'Строится во дворе. Охрана огорода пока не действует.', icon: Dog },
}

const MODE_TITLE: Record<Mode, string> = { plant: 'Посадить', water: 'Полить', build: 'Построить' }

export function FarmSection() {
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const raw = params.get('tab')
  const mode: Mode = raw === 'water' || raw === 'build' ? raw : 'plant'
  const [crop, setCrop] = useState('dill')
  const [building, setBuilding] = useState<FarmBuilding>('BARREL')
  const [picked, setPicked] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)

  const farm = useQuery({ queryKey: ['farm'], queryFn: farmApi.get, refetchInterval: 15000 })

  const action = useMutation({
    mutationFn: async ({ kind, id }: { kind: string; id?: string }) => {
      if (kind === 'buy') return farmApi.buyPlot()
      if (kind === 'plant') return farmApi.plant(id!, crop)
      if (kind === 'water') return farmApi.water(id!)
      if (kind === 'harvest') return farmApi.harvest(id!)
      if (kind === 'clear') return farmApi.clear(id!)
      if (kind === 'yard') return farmApi.buildYard(id as FarmBuilding)
      if (kind === 'worker') return farmApi.hireWorker()
      return farmApi.build(id!, building)
    },
    onSuccess: (_, v) => {
      setBad(false)
      setMsg(v.kind === 'buy' ? 'Участок куплен' : v.kind === 'plant' ? 'Посажено' : v.kind === 'water' ? 'Полито'
        : v.kind === 'harvest' ? 'Урожай собран' : v.kind === 'clear' ? 'Участок убран, можно сажать заново'
        : v.kind === 'worker' ? 'Рабочий нанят — он сам соберёт созревший урожай' : 'Постройка готова')
      void qc.invalidateQueries({ queryKey: ['farm'] })
      void qc.invalidateQueries({ queryKey: ['resources'] })
      void qc.invalidateQueries({ queryKey: ['character'] })
    },
    onError: (e: Error) => { setBad(true); setMsg(e.message) },
  })

  if (farm.isLoading) return <Skeleton rows={3} />
  if (farm.isError || !farm.data) return <Fault retry={() => farm.refetch()} />

  // Ответ разбираем с запасом на пустоту: раздел из-за отсутствующего
  // поля падать не должен, он покажет пустой огород и объяснит это.
  const data = farm.data
  const crops = data.crops ?? []
  const plots = data.plots ?? []
  const buildings = data.buildings ?? {}
  const yardTypes: FarmBuilding[] = data.yardBuildings ?? ['CELLAR', 'DOG']
  const workerActive = !!data.worker?.until && new Date(data.worker.until) > new Date()
  const cropName = (code: string | null) => crops.find(x => x.code === code)?.name ?? 'Свободная земля'
  const plot = plots.find(p => p.id === picked) ?? null
  const busy = action.isPending

  return (
    <div className="farm">
      <p className="farm-how">
        <b>{MODE_TITLE[mode]}.</b>{' '}
        {mode === 'plant' && 'Выберите культуру, затем свободный участок на поле. Созревший урожай собирается здесь же.'}
        {mode === 'water' && 'Выберите грядку, где что-то растёт. Каждый полив ускоряет рост, до трёх раз.'}
        {mode === 'build' && 'Выберите постройку, затем участок. Постройка помогает соседним грядкам слева и справа.'}
      </p>

      {mode === 'plant' && (
        <div className="farm-options" role="radiogroup" aria-label="Культура">
          {crops.map(x => (
            <button type="button" key={x.code} role="radio" aria-checked={crop === x.code} disabled={!x.available}
              className={'farm-option' + (crop === x.code ? ' is-active' : '')} onClick={() => setCrop(x.code)}
              title={x.available ? undefined : `Нужен заготовитель ${x.requiredLevel}-го уровня`}>
              <b>{x.name}</b><span>{fmt(x.seedPrice)} ₽{x.available ? '' : ` · заготовитель ${x.requiredLevel}`}</span>
            </button>
          ))}
        </div>
      )}
      {mode === 'build' && (
        <div className="farm-options" role="radiogroup" aria-label="Постройка">
          {(Object.entries(buildings) as Array<[FarmBuilding, { name: string; price: number }]>).filter(([key]) => !yardTypes.includes(key)).map(([key, x]) => {
            const Icon = BUILDING_INFO[key]?.icon ?? Hammer
            return (
              <button type="button" key={key} role="radio" aria-checked={building === key}
                className={'farm-option' + (building === key ? ' is-active' : '')} onClick={() => setBuilding(key)}>
                <b><Icon size={14} /> {x.name} · {fmt(x.price)} ₽</b><span>{BUILDING_INFO[key]?.hint}</span>
              </button>
            )
          })}
        </div>
      )}

      <section className="farm-field" aria-label="Поле">
        {plots.map(p => (
          <PlotTile key={p.id} plot={p} name={p.cropCode ? cropName(p.cropCode) : ''}
            buildingName={p.building?.type ? buildings[p.building.type]?.name : undefined}
            selected={p.id === picked} onPick={() => setPicked(p.id)} />
        ))}
        {data.nextPlotPrice != null && (
          <button type="button" className="farm-tile farm-tile--buy" disabled={busy} onClick={() => action.mutate({ kind: 'buy' })}>
            <Plus size={22} /><span>Купить участок</span><small>{data.nextPlotPrice ? `${fmt(data.nextPlotPrice)} ₽` : 'бесплатно'}</small>
          </button>
        )}
      </section>

      <div className="farm-act">
        {!plot && <span className="muted">Участок не выбран — нажмите на квадратик на поле.</span>}
        {plot && <PlotAction mode={mode} plot={plot} busy={busy}
          cropLabel={crops.find(x => x.code === crop)?.name ?? ''}
          buildingLabel={buildings[building]?.name ?? ''}
          onAct={kind => action.mutate({ kind, id: plot.id })} />}
        <Note text={msg} kind={bad ? 'bad' : 'ok'} />
      </div>

      {/* Двор фермы: погреб и будка — без участка (правка заказчика 21.10). */}
      <section className="farm-yard" aria-label="Двор фермы">
        <h3>Двор фермы</h3>
        <div className="farm-options">
          {yardTypes.map(type => {
            const info = buildings[type]
            const Icon = BUILDING_INFO[type]?.icon ?? Hammer
            const built = (data.yard ?? []).includes(type)
            return (
              <div key={type} className={'farm-option farm-yard__item' + (built ? ' is-active' : '')}>
                <b><Icon size={14} /> {info?.name}</b><span>{BUILDING_INFO[type]?.hint}</span>
                {built ? <span className="farm-yard__done">Построено</span>
                  : <button type="button" className="btn btn-sm" disabled={busy} onClick={() => action.mutate({ kind: 'yard', id: type })}>Построить · {fmt(info?.price ?? 0)} ₽</button>}
              </div>
            )
          })}
          {data.worker && (
            <div className={'farm-option farm-yard__item' + (workerActive ? ' is-active' : '')}>
              <b>Рабочий фермы</b>
              <span>Сам собирает созревший урожай, пока вас нет. Нанимается за доллары.</span>
              {workerActive && <span className="farm-yard__done">Работает до {new Date(data.worker.until!).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>}
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => action.mutate({ kind: 'worker' })}>
                {workerActive ? 'Продлить' : 'Нанять'} на {data.worker.days} дней · {data.worker.priceDollars} $
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function PlotTile({ plot, name, buildingName, selected, onPick }: {
  plot: FarmPlot; name: string; buildingName?: string; selected: boolean; onPick: () => void
}) {
  const Building = plot.building?.type ? BUILDING_INFO[plot.building.type]?.icon ?? Hammer : null
  const Icon = plot.state === 'READY' ? Wheat : plot.state === 'GROWING' ? Sprout : null
  const status = plot.state === 'GROWING' ? `растёт · ${remaining(plot.readyAt)}`
    : plot.state === 'READY' ? 'созрело'
    : plot.state === 'WITHERED' ? 'засохло'
    : 'свободно'
  return (
    <button type="button" aria-pressed={selected} onClick={onPick}
      className={`farm-tile state-${plot.state.toLowerCase()}` + (selected ? ' is-selected' : '')}
      aria-label={`Участок ${plot.slot}: ${name || 'свободная земля'}, ${status}${buildingName ? `, ${buildingName}` : ''}`}>
      <span className="farm-tile__num">{String(plot.slot).padStart(2, '0')}</span>
      {Icon && <Icon size={26} className="farm-tile__crop" />}
      <span className="farm-tile__name">{name || ' '}</span>
      <small>{status}{plot.state === 'GROWING' ? ` · полив ${plot.waterCount}/3` : ''}</small>
      {Building && <span className="farm-tile__building" title={buildingName}><Building size={14} /> {buildingName}</span>}
    </button>
  )
}

function PlotAction({ mode, plot, busy, cropLabel, buildingLabel, onAct }: {
  mode: Mode; plot: FarmPlot; busy: boolean; cropLabel: string; buildingLabel: string
  onAct: (kind: 'plant' | 'water' | 'harvest' | 'clear' | 'build') => void
}) {
  const n = String(plot.slot).padStart(2, '0')
  // Засохшее собрать нельзя — сервер отвечал отказом, и участок оставался занят
  // навсегда. Для него отдельное действие «Убрать».
  if (plot.state === 'WITHERED') {
    return <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onAct('clear')}>
      <Scissors size={15} /> Убрать засохший урожай с участка {n}
    </button>
  }
  if (plot.state === 'READY') {
    return <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onAct('harvest')}>
      <Scissors size={15} /> Собрать урожай с участка {n}
    </button>
  }
  if (mode === 'plant') {
    return plot.state === 'EMPTY'
      ? <button type="button" className="btn btn-primary" disabled={busy || !cropLabel} onClick={() => onAct('plant')}><Sprout size={15} /> Посадить {cropLabel} на участок {n}</button>
      : <span className="muted">На участке {n} уже растёт урожай. Выберите свободный.</span>
  }
  if (mode === 'water') {
    return plot.state === 'GROWING'
      ? <button type="button" className="btn btn-primary" disabled={busy || plot.waterCount >= 3} onClick={() => onAct('water')}>
          <Droplets size={15} /> {plot.waterCount >= 3 ? `Участок ${n} полит трижды` : `Полить участок ${n} (${plot.waterCount}/3)`}
        </button>
      : <span className="muted">Поливать на участке {n} нечего: сначала посадите.</span>
  }
  return plot.building
    ? <span className="muted">На участке {n} уже есть постройка.</span>
    : <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onAct('build')}><Hammer size={15} /> Построить «{buildingLabel}» на участке {n}</button>
}
