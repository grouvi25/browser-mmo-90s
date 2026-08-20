/**
 * Проверка проходимости экономики по сид-таблицам.
 *
 * Симуляторы прогрессии считают, за сколько дней качается профессия, но не
 * спрашивают, можно ли вообще встать на объект и где взять ресурс. Именно там
 * и завёлся тупик: объект второго передела требовал уровень той профессии,
 * опыт которой начисляется только на нём самом.
 *
 * Скрипт не ходит в базу: он читает те же таблицы, что и сид, и отвечает на
 * три вопроса — какие объекты достижимы, какие ресурсы добываемы, что из
 * нужного игроку взять негде.
 */
import { writeFileSync } from 'node:fs'
import {
  PRODUCTION_OBJECTS, OBJECT_PROFESSIONS, RESOURCE_CODES, PRODUCTION_RECIPES,
  PRIVATE_SHOP_RESOURCES, REPAIR_RESOURCES, UPGRADE_RESOURCES,
} from '../backend/prisma/economy-data'
import { BAR_RECIPES } from '../backend/prisma/bar-data'
import { PROFESSION_CHAINS, PROFESSION_NAMES, previousProfession, type ProfessionCode } from '../backend/src/modules/professions/professions'

function arg(name: string, fallback: string) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const objects = PRODUCTION_OBJECTS.map(object => ({
  ...object,
  professionCode: OBJECT_PROFESSIONS[object.code] as ProfessionCode,
  requiredLevel: Math.min(object.requiredProductionLevel, 3),
}))

/** Профессия, уровень которой открывает объект: см. admissionRequirement. */
function gateOf(object: { professionCode: ProfessionCode; requiredLevel: number }) {
  if (object.requiredLevel === 0) return null
  return previousProfession(object.professionCode) ?? object.professionCode
}

/**
 * Профессии, до которых можно добраться с нуля.
 *
 * Профессия открыта, если есть её объект без требований, либо объект,
 * чей замок стоит на уже открытой профессии. Замок на самой себе не в счёт:
 * опыт этой профессии начисляется только на её объектах, и если все они
 * заперты — открыть нечем.
 */
function reachableProfessions() {
  const open = new Set<ProfessionCode>()
  let grew = true
  while (grew) {
    grew = false
    for (const object of objects) {
      if (open.has(object.professionCode)) continue
      const gate = gateOf(object)
      const passable = gate === null || (gate !== object.professionCode && open.has(gate))
      if (passable) { open.add(object.professionCode); grew = true }
    }
  }
  return open
}

const open = reachableProfessions()
const unreachableObjects = objects.filter(object => !open.has(object.professionCode))
// obj_bar_station создаётся в seed.ts напрямую, а не через PRODUCTION_OBJECTS
// (требование — Заготовитель ур. 0, то есть без требований), поэтому его нет
// в общем списке объектов, но его рецепты — часть цепочки и должны считаться достижимыми.
const reachableObjectCodes = new Set([
  ...objects.filter(object => open.has(object.professionCode)).map(object => object.code),
  'obj_bar_station',
])
const producedResources = new Set(objects
  .filter(object => open.has(object.professionCode) && object.producesResourceCode)
  .map(object => object.producesResourceCode as string))
const purchasable = new Set(PRIVATE_SHOP_RESOURCES.map(row => row.resourceCode))

/**
 * Рецепты Этапа 3 (заводы + бар), приведённые к единому виду: выход-ресурс
 * (предметы в цепочку ресурсов не входят, они терминальны) и список входов.
 * Без этого шага проверка не видит новых цепочек переделов и репортит
 * «заведён, но недоступен» для всего, что производится циклом, а не сменой.
 */
type UnifiedRecipe = { code: string; productionObjectCode: string; output: string | null; inputs: string[] }
const allRecipes: UnifiedRecipe[] = [
  ...PRODUCTION_RECIPES.map(recipe => ({
    code: recipe.code,
    productionObjectCode: recipe.productionObjectCode,
    output: recipe.outputResourceCode,
    inputs: recipe.inputs.map(input => input.resourceCode),
  })),
  ...BAR_RECIPES.map(recipe => ({
    code: recipe.code,
    productionObjectCode: 'obj_bar_station',
    output: recipe.output,
    inputs: recipe.inputs.map(input => input.resourceCode),
  })),
]

/** Достижимость ресурсов через рецепты — расширяется до неподвижной точки: вход должен стать достижим раньше выхода. */
const obtainable = new Set<string>([...producedResources, ...purchasable])
const producingRecipe = new Map<string, string>()
let grewRecipes = true
while (grewRecipes) {
  grewRecipes = false
  for (const recipe of allRecipes) {
    if (!recipe.output || obtainable.has(recipe.output)) continue
    if (!reachableObjectCodes.has(recipe.productionObjectCode)) continue
    if (!recipe.inputs.every(code => obtainable.has(code))) continue
    obtainable.add(recipe.output)
    producingRecipe.set(recipe.output, recipe.code)
    grewRecipes = true
  }
}
const producedByRecipe = [...obtainable].filter(code => !producedResources.has(code) && !purchasable.has(code))
const unreachableRecipes = allRecipes.filter(recipe =>
  !reachableObjectCodes.has(recipe.productionObjectCode) || !recipe.inputs.every(code => obtainable.has(code)))

/** Цикл в цепочке: вход рецепта, который прямо или через посредников производится из своего же выхода. */
function findRecipeCycle(): string[] | null {
  const edges = new Map<string, Set<string>>()
  for (const recipe of allRecipes) {
    if (!recipe.output) continue
    for (const input of recipe.inputs) {
      if (!edges.has(input)) edges.set(input, new Set())
      edges.get(input)!.add(recipe.output)
    }
  }
  const color = new Map<string, 1 | 2>()
  const stack: string[] = []
  function dfs(node: string): string[] | null {
    color.set(node, 1)
    stack.push(node)
    for (const next of edges.get(node) ?? []) {
      const state = color.get(next)
      if (state === 1) return [...stack.slice(stack.indexOf(next)), next]
      if (state !== 2) {
        const found = dfs(next)
        if (found) return found
      }
    }
    stack.pop()
    color.set(node, 2)
    return null
  }
  for (const node of edges.keys()) {
    if (!color.has(node)) {
      const found = dfs(node)
      if (found) return found
    }
  }
  return null
}
const recipeCycle = findRecipeCycle()

const neededResources = [...new Set([...REPAIR_RESOURCES, ...UPGRADE_RESOURCES])]
const missingNeeded = neededResources.filter(code => !obtainable.has(code))
const orphanResources = RESOURCE_CODES.filter(code => !obtainable.has(code))
const professionsWithoutObject = Object.values(PROFESSION_CHAINS).flat()
  .filter(code => !objects.some(object => object.professionCode === code))

const report = {
  meta: { generatedAt: new Date().toISOString(), model: 'economy-reachability-v1' },
  objects: objects.map(object => ({
    code: object.code,
    profession: object.professionCode,
    admission: object.requiredLevel > 0
      ? { profession: gateOf(object), level: object.requiredLevel }
      : null,
    reachable: open.has(object.professionCode),
  })),
  resources: {
    producedByLabor: [...producedResources].sort(),
    producedByRecipe: producedByRecipe.sort(),
    purchasable: [...purchasable].sort(),
    neededByRepairOrUpgrade: neededResources.sort(),
    neededButUnobtainable: missingNeeded.sort(),
    declaredButUnobtainable: orphanResources.sort(),
  },
  recipes: {
    total: allRecipes.length,
    unreachable: unreachableRecipes.map(recipe => recipe.code).sort(),
    cycle: recipeCycle,
  },
  professionsWithoutObject,
  acceptance: {
    everyObjectReachable: unreachableObjects.length === 0,
    everyNeededResourceObtainable: missingNeeded.length === 0,
    noDeadEndChainStart: Object.values(PROFESSION_CHAINS)
      .every(chain => objects.some(object => object.professionCode === chain[0] && object.requiredLevel === 0)),
    // объект, запертый уровнем собственной профессии, нужен только рядом
    // со входной площадкой того же ремесла — иначе он не откроется никогда
    noObjectLockedByItself: objects.every(object => gateOf(object) !== object.professionCode
      || objects.some(other => other.professionCode === object.professionCode && other.requiredLevel === 0)),
    // «заведён, но недоступен» — ошибка, а не предупреждение (STAGE3_SEED_CONTENT.md, раздел 8, п.2)
    noOrphanResources: orphanResources.length === 0,
    everyRecipeReachable: unreachableRecipes.length === 0,
    noRecipeCycle: recipeCycle === null,
  },
}

const passed = Object.values(report.acceptance).every(Boolean)
const lines = [
  'ПРОХОДИМОСТЬ ЭКОНОМИКИ',
  '',
  'Объекты:',
  ...report.objects.map(object => `  ${object.reachable ? 'открыт  ' : 'ЗАПЕРТ  '} ${object.code} (${PROFESSION_NAMES[object.profession as ProfessionCode]})`
    + (object.admission ? ` — нужен ${PROFESSION_NAMES[object.admission.profession as ProfessionCode]} ур. ${object.admission.level}` : ' — без требований')),
  '',
  `Ресурсы, добываемые трудом: ${report.resources.producedByLabor.join(', ') || '—'}`,
  `Ресурсы, добываемые по рецепту: ${report.resources.producedByRecipe.join(', ') || '—'}`,
  `Ресурсы, продаваемые в лавках: ${report.resources.purchasable.join(', ') || '—'}`,
  `Нужны ремонту и улучшениям: ${report.resources.neededByRepairOrUpgrade.join(', ')}`,
  `Из них взять негде: ${report.resources.neededButUnobtainable.join(', ') || 'нет таких'}`,
  `Заведены в сиде, но недоступны: ${report.resources.declaredButUnobtainable.join(', ') || 'нет таких'}`,
  `Профессии без единого объекта: ${report.professionsWithoutObject.join(', ') || 'нет таких'}`,
  '',
  `Рецептов всего: ${report.recipes.total}`,
  `Недостижимые рецепты: ${report.recipes.unreachable.join(', ') || 'нет таких'}`,
  `Цикл в цепочке: ${report.recipes.cycle ? report.recipes.cycle.join(' → ') : 'нет'}`,
  '',
  `ACCEPTANCE: ${passed ? 'PASS' : 'FAIL'}`,
]
const text = `${lines.join('\n')}\n`
console.log(text)
const jsonPath = arg('json', '')
const textPath = arg('text', '')
if (jsonPath) writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
if (textPath) writeFileSync(textPath, text, 'utf8')
if (!passed) process.exit(1)
