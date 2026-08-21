import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { productionApi } from '../../shared/api/production.api'
import { Skeleton, Fault, Empty } from './stage3-ui'

const QUALITY: Record<string, string> = { POOR: 'плохое', NORMAL: 'обычное', FINE: 'отличное' }

/** Справочник переделов: что из чего делается и на каком объекте. */
export function RecipesSection() {
  const [objectCode, setObjectCode] = useState('')

  const objects = useQuery({ queryKey: ['production', 'all'], queryFn: productionApi.all })
  const recipes = useQuery({
    queryKey: ['production', 'recipes', objectCode],
    queryFn: () => productionApi.recipes(objectCode),
    enabled: Boolean(objectCode),
  })

  if (objects.isLoading) return <Skeleton rows={3} />
  if (objects.isError) return <Fault retry={() => objects.refetch()} />

  const items = objects.data?.items ?? []

  return (
    <>
      <section className="s3-toolbar">
        <label>
          Объект
          <select value={objectCode} onChange={e => setObjectCode(e.target.value)}>
            <option value="">— выберите объект —</option>
            {items.map(object => (
              <option key={object.id} value={object.code ?? ''}>{object.name}</option>
            ))}
          </select>
        </label>
      </section>

      <p className="s3-hint">
        Из плохого сырья отличный продукт не выходит: мастер на плохом сырье вытянет только обычное качество.
        Инструмент выше требуемого тира ускоряет цикл на 15% за уровень.
      </p>

      {!objectCode ? (
        <Empty title="Выберите объект" hint="Покажем его рецепты: вход, выход, время цикла и требуемый труд." />
      ) : recipes.isLoading ? (
        <Skeleton rows={3} />
      ) : recipes.isError ? (
        <Fault retry={() => recipes.refetch()} />
      ) : (recipes.data?.items.length ?? 0) === 0 ? (
        <Empty title="У объекта нет рецептов" />
      ) : (
        <div className="s3-scroll">
          <table className="s3-table">
            <thead>
              <tr><th>Рецепт</th><th>Вход</th><th>Выход</th><th>Цикл</th><th>Труд</th><th>Профессия</th><th>Доступ</th></tr>
            </thead>
            <tbody>
              {recipes.data?.items.map(recipe => (
                <tr key={recipe.id} className={recipe.available ? '' : 'is-locked'}>
                  <td><b>{recipe.name}</b></td>
                  <td>
                    {recipe.inputs.length === 0 ? <span className="muted">добыча</span> : recipe.inputs.map(input => (
                      <div key={input.resourceCode}>
                        {input.amount} × {input.resourceCode}
                        {input.minQuality !== 'POOR' && <span className="muted"> (от {QUALITY[input.minQuality]})</span>}
                      </div>
                    ))}
                  </td>
                  <td>{recipe.outputAmount} × {recipe.outputResourceCode ?? recipe.outputItemTemplateCode}</td>
                  <td>{recipe.cycleMinutes} мин</td>
                  <td>{recipe.laborRequired}</td>
                  <td>{recipe.requiredProfessionCode} {recipe.requiredProfessionLevel}</td>
                  <td>{recipe.available ? <span className="ok">открыт</span> : <span className="muted">+{recipe.missingLevel} ур.</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
