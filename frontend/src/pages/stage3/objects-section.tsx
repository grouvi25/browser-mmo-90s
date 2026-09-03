import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Factory, Wrench, PackageOpen, Play, Banknote, Repeat, Users } from 'lucide-react'
import { productionApi, type ProductionObject, type StartCycleResult } from '../../shared/api/production.api'
import { fmt, remaining, timer, Skeleton, Fault, Empty, Note } from './stage3-ui'
import { objectWarApi } from '../../shared/api/strategy.api'

/** Причина простоя — словами, а не кодом: требование к интерфейсу этапа. */
const FAILURE_TEXT: Record<string, string> = {
  INPUT_MISSING: 'не хватает сырья на складе объекта',
  OUTPUT_FULL: 'склад объекта заполнен',
  EQUIPMENT_BROKEN: 'сломано оборудование',
  NEGATIVE_BALANCE: 'на балансе объекта минус',
  OBJECT_DAMAGED: 'объект повреждён, нужен ремонт',
  PROFILE_SWITCHING: 'идёт смена профиля',
  LABOR_TIMEOUT: 'труд не набран за отведённое время',
}

const CYCLE_STATUS: Record<string, string> = {
  PENDING: 'ждёт труда',
  RUNNING: 'идёт',
  COMPLETED: 'завершён',
  FAILED: 'прерван',
}

export function ObjectsSection() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'mine' | 'market'>('mine')
  const [openId, setOpenId] = useState('')
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)

  const query = useQuery({
    queryKey: ['production', tab],
    queryFn: tab === 'mine' ? productionApi.mine : productionApi.market,
    refetchInterval: 20000,
  })

  const done = (text: string) => {
    setBad(false)
    setMsg(text)
    void qc.invalidateQueries({ queryKey: ['production'] })
    void qc.invalidateQueries({ queryKey: ['character'] })
  }
  const fail = (e: Error) => { setBad(true); setMsg(e.message) }

  const buy = useMutation({ mutationFn: productionApi.buy, onSuccess: () => done('Объект куплен'), onError: fail })
  const sell = useMutation({ mutationFn: productionApi.sell, onSuccess: () => done('Объект продан государству'), onError: fail })
  const repair = useMutation({ mutationFn: productionApi.repair, onSuccess: () => done('Объект отремонтирован'), onError: fail })
  // Этап 4: перевод объекта в бригаду. Операция НЕОБРАТИМА, поэтому
  // подтверждение показывает, что именно уедет в общак, а не спрашивает
  // «вы уверены?» в пустоту.
  const transfer = useMutation({
    mutationFn: objectWarApi.transferToClan,
    onSuccess: result => done(
      `Объект передан бригаде. В общак ушло ${fmt(result.balanceMoved)} ₽.`,
    ),
    onError: fail,
  })
  const start = useMutation({
    mutationFn: productionApi.startCycle,
    onSuccess: (result: StartCycleResult) => {
      if ('cycle' in result) return done('Цикл запущен')
      if ('alreadyRunning' in result) { setBad(true); setMsg('Цикл уже идёт'); return }
      setBad(true)
      setMsg('Цикл не стартовал: ' + (FAILURE_TEXT[result.failure] ?? result.failure))
    },
    onError: fail,
  })

  if (query.isLoading) return <Skeleton rows={3} />
  if (query.isError) return <Fault retry={() => query.refetch()} />

  const items = query.data?.items ?? []
  const busy = buy.isPending || sell.isPending || repair.isPending || start.isPending || transfer.isPending

  return (
    <>
      <div className="s3-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'mine'} className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>
          Мои объекты
        </button>
        <button role="tab" aria-selected={tab === 'market'} className={tab === 'market' ? 'active' : ''} onClick={() => setTab('market')}>
          Рынок объектов
        </button>
      </div>

      <Note text={msg} kind={bad ? 'bad' : 'ok'} />

      {items.length === 0 ? (
        <Empty
          title={tab === 'mine' ? 'У вас пока нет объектов' : 'Государство ничего не продаёт'}
          hint={tab === 'mine' ? 'Купите объект на вкладке «Рынок объектов» — не больше двух на игрока.' : undefined}
        />
      ) : (
        <section className="object-list">
          {items.map(object => (
            <ObjectCard
              key={object.id}
              object={object}
              mode={tab}
              open={openId === object.id}
              onToggle={() => setOpenId(openId === object.id ? '' : object.id)}
              busy={busy}
              onBuy={() => buy.mutate(object.id)}
              onSell={() => sell.mutate(object.id)}
              onRepair={() => repair.mutate(object.id)}
              onTransfer={() => transfer.mutate(object.id)}
              onStart={() => start.mutate(object.id)}
              onDone={done}
              onFail={fail}
            />
          ))}
        </section>
      )}
    </>
  )
}

function ObjectCard({ object, mode, open, onToggle, busy, onBuy, onSell, onRepair, onTransfer, onStart, onDone, onFail }: {
  object: ProductionObject
  mode: 'mine' | 'market'
  open: boolean
  onToggle: () => void
  busy: boolean
  onBuy: () => void
  onSell: () => void
  onRepair: () => void
  onTransfer: () => void
  onStart: () => void
  onDone: (text: string) => void
  onFail: (e: Error) => void
}) {
  const cycle = object.cycles?.[0]
  const stored = object.inventory?.reduce((sum, row) => sum + row.amount, 0) ?? 0
  const switching = object.profileSwitchEndsAt && new Date(object.profileSwitchEndsAt) > new Date()

  return (
    <article className={open ? 'is-open' : ''}>
      <div className="object-title">
        <Factory />
        <div>
          <h2>{object.name}</h2>
          <span>{object.type} · {object.equipment?.name ?? 'без оборудования'}</span>
        </div>
      </div>

      <dl>
        <div><dt>Баланс</dt><dd>{fmt(object.balance)} ₽</dd></div>
        <div><dt>Износ</dt><dd>{object.durabilityCurrent}/{object.durabilityMax}</dd></div>
        <div><dt>Склад</dt><dd>{stored}/{object.storageCapacity}</dd></div>
      </dl>

      <div className="cycle">
        {switching ? (
          <div className="empty-line"><Repeat size={16} /> смена профиля · до {timer(object.profileSwitchEndsAt)}</div>
        ) : cycle ? (
          <>
            <span>{cycle.recipe.name}</span>
            <progress value={cycle.laborAccumulated} max={cycle.laborRequired} />
            <small>
              {CYCLE_STATUS[cycle.status] ?? cycle.status} · труд {cycle.laborAccumulated}/{cycle.laborRequired}
              {cycle.endsAt ? ' · осталось ' + remaining(cycle.endsAt) : ''}
              {cycle.failureReason ? ' · ' + (FAILURE_TEXT[cycle.failureReason] ?? cycle.failureReason) : ''}
            </small>
          </>
        ) : (
          <div className="empty-line"><PackageOpen size={16} /> цикл не запущен</div>
        )}
      </div>

      <div className="object-actions">
        {mode === 'market' ? (
          <button onClick={onBuy} disabled={busy}>Купить за {fmt(object.purchasePrice ?? 0)} ₽</button>
        ) : (
          <>
            <button onClick={onStart} disabled={busy}><Play size={15} /> Запустить</button>
            <button className="quiet" onClick={onToggle} aria-expanded={open}>
              {open ? 'Свернуть' : 'Управление'}
            </button>
          </>
        )}
      </div>

      {open && mode === 'mine' && (
        <ObjectControls object={object} busy={busy} onRepair={onRepair} onTransfer={onTransfer} onSell={onSell} onDone={onDone} onFail={onFail} />
      )}
    </article>
  )
}

/** Управление объектом: деньги, ставка, ремонт, смена профиля, продажа. */
function ObjectControls({ object, busy, onRepair, onTransfer, onSell, onDone, onFail }: {
  object: ProductionObject
  busy: boolean
  onRepair: () => void
  onSell: () => void
  onTransfer: () => void
  onDone: (text: string) => void
  onFail: (e: Error) => void
}) {
  const [amount, setAmount] = useState(1000)
  const [salary, setSalary] = useState(object.salaryOverride ?? object.baseSalary ?? 0)
  const [recipeId, setRecipeId] = useState('')

  const recipes = useQuery({
    queryKey: ['production', 'recipes', object.code],
    queryFn: () => productionApi.recipes(object.code as string),
    enabled: Boolean(object.code),
  })

  const topup = useMutation({ mutationFn: () => productionApi.topup(object.id, amount), onSuccess: () => onDone('Баланс пополнен'), onError: onFail })
  const withdraw = useMutation({ mutationFn: () => productionApi.withdraw(object.id, amount), onSuccess: () => onDone('Прибыль выведена, налог 5%'), onError: onFail })
  const setPay = useMutation({ mutationFn: () => productionApi.setSalary(object.id, salary), onSuccess: () => onDone('Ставка обновлена'), onError: onFail })
  const profile = useMutation({ mutationFn: () => productionApi.switchProfile(object.id, recipeId), onSuccess: () => onDone('Профиль меняется: 1 500 ₽ и 180 минут простоя'), onError: onFail })

  const base = object.baseSalary ?? 0

  return (
    <div className="object-controls">
      <fieldset>
        <legend><Banknote size={14} /> Деньги объекта</legend>
        <input type="number" min={1} value={amount} aria-label="Сумма" onChange={e => setAmount(Number(e.target.value))} />
        <button onClick={() => topup.mutate()} disabled={busy || topup.isPending}>Пополнить</button>
        <button onClick={() => withdraw.mutate()} disabled={busy || withdraw.isPending}>Вывести</button>
      </fieldset>

      <fieldset>
        <legend>Ставка рабочим</legend>
        <input type="number" min={1} value={salary} aria-label="Ставка" onChange={e => setSalary(Number(e.target.value))} />
        <button onClick={() => setPay.mutate()} disabled={busy || setPay.isPending}>Задать</button>
        {/* Базовая ставка рядом — чтобы новичок видел, дорого ему предлагают или дёшево. */}
        <small>базовая {fmt(base)} ₽ · коридор {fmt(Math.round(base * 0.5))}–{fmt(Math.round(base * 2))} ₽</small>
      </fieldset>

      <fieldset>
        <legend><Repeat size={14} /> Производственный профиль</legend>
        <select value={recipeId} onChange={e => setRecipeId(e.target.value)} aria-label="Рецепт">
          <option value="">— выберите рецепт —</option>
          {recipes.data?.items.map(recipe => (
            <option key={recipe.id} value={recipe.id} disabled={!recipe.available}>
              {recipe.name}{recipe.available ? '' : ' · нужен уровень +' + recipe.missingLevel}
            </option>
          ))}
        </select>
        <button onClick={() => profile.mutate()} disabled={busy || !recipeId || profile.isPending}>Сменить</button>
      </fieldset>

      <fieldset>
        <legend>Объект</legend>
        <button onClick={onRepair} disabled={busy}><Wrench size={15} /> Ремонт</button>
        <button
          className="danger"
          onClick={() => { if (window.confirm('Продать объект государству за 50% цены?')) onSell() }}
          disabled={busy}
        >
          Продать за {fmt(Math.floor((object.purchasePrice ?? 0) * 0.5))} ₽
        </button>
        <TransferToClan object={object} busy={busy} onTransfer={onTransfer} />
      </fieldset>
    </div>
  )
}


/** Почему передать нельзя — словами, как и везде в стратегическом слое. */
const TRANSFER_BLOCKED: Record<string, (d: { clanObjectLimit: number }) => string> = {
  NO_CLAN: () => 'Передать объект можно только своей бригаде — вступите в неё или создайте свою.',
  NOT_OWNER: () => 'Это не ваш личный объект.',
  DAMAGED: () => 'Повреждённый объект передать нельзя — сначала восстановите.',
  NO_PERMISSION: () => 'Нужно право «Объекты» в бригаде.',
  LIMIT_REACHED: d => `У бригады предел объектов: ${d.clanObjectLimit}. Он растёт от числа районов.`,
}

/**
 * Перевод объекта в бригаду — Этап 4.
 *
 * Операция необратима, поэтому кнопка сначала спрашивает сервер, что
 * именно произойдёт, и показывает это: сколько уедет в общак и не упрётся
 * ли бригада в свой предел объектов. Диалог «вы уверены?» без цифр не
 * даёт человеку ничего, кроме страха нажать.
 */
function TransferToClan({
  object, busy, onTransfer,
}: {
  object: ProductionObject
  busy: boolean
  onTransfer: () => void
}) {
  const preview = useQuery({
    queryKey: ['object-transfer', object.id],
    queryFn: () => objectWarApi.transferPreview(object.id),
    // Спрашиваем только для своих: у чужого объекта предпросмотр вернёт 403.
    enabled: object.ownerType === 'PRIVATE',
    retry: false,
  })
  const data = preview.data
  if (!data) return null

  const confirm = () => {
    const text = [
      `Передать «${data.objectName}» бригаде?`,
      '',
      `В общак уйдёт ${fmt(data.balanceMovedToTreasury)} ₽ с баланса объекта.`,
      `У бригады станет ${data.clanObjects + 1} объектов из ${data.clanObjectLimit}.`,
      '',
      'Вернуть объект в личную собственность будет НЕЛЬЗЯ.',
    ].join(String.fromCharCode(10))
    if (window.confirm(text)) onTransfer()
  }

  return (
    <>
      <button onClick={confirm} disabled={busy || !data.canTransfer}>
        <Users size={15} /> Передать бригаде
      </button>
      {!data.canTransfer && (
        <small>
          {TRANSFER_BLOCKED[data.blockedReason ?? 'NOT_OWNER'](data)}
        </small>
      )}
    </>
  )
}
