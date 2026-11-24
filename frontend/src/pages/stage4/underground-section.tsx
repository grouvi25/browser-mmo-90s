// Подпольная лавка Чёрного рынка — травмы v8, раздел 12. Бинокль ложится
// в карманы не активированным; засада — значком 🔭 у ника в списке «онлайн»,
// если игрок стоит там же, где вы.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ambushApi } from '../../shared/api/ambush.api'
import { useBinoculars } from '../../widgets/ambush/ambush-button'
import { fmt } from '../stage3/stage3-ui'

export function UndergroundSection() {
  const qc = useQueryClient()
  const pockets = useBinoculars()
  const buy = useMutation({
    mutationFn: ambushApi.buyBinoculars,
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: ['ambush'] }),
      qc.invalidateQueries({ queryKey: ['character'] }),
    ]),
  })
  const data = pockets.data
  const full = !!data && data.binoculars >= data.max
  return (
    <section className="underground">
      <p className="s4-lead">Бинокль — для засады. Лежит в карманах, пока не пустите в дело. Цель должна стоять там же, где вы.</p>
      {pockets.isError && <p className="alert alert-error" role="alert">{pockets.error.message}</p>}
      {data && <>
        <p>В карманах: <b>{data.binoculars} из {data.max}</b></p>
        <button type="button" className="btn btn-primary" disabled={buy.isPending || full} onClick={() => buy.mutate()}>
          {buy.isPending ? 'Покупаю…' : full ? 'Карманы полны' : `Бинокль за ${fmt(data.price)} ₽`}
        </button>
      </>}
      {buy.error && <p className="alert alert-error" role="alert">{buy.error.message}</p>}
    </section>
  )
}
