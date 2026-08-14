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
  PRODUCTION_OBJECTS, OBJECT_PROFESSIONS, RESOURCE_CODES,
  PRIVATE_SHOP_RESOURCES, REPAIR_RESOURCES, UPGRADE_RESOURCES,
} from '../backend/prisma/economy-data'
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
const producedResources = new Set(objects
  .filter(object => open.has(object.professionCode) && object.producesResourceCode)
  .map(object => object.producesResourceCode as string))
const purchasable = new Set(PRIVATE_SHOP_RESOURCES.map(row => row.resourceCode))
const obtainable = new Set([...producedResources, ...purchasable])

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
    produced: [...producedResources].sort(),
    purchasable: [...purchasable].sort(),
    neededByRepairOrUpgrade: neededResources.sort(),
    neededButUnobtainable: missingNeeded.sort(),
    declaredButUnobtainable: orphanResources.sort(),
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
  `Ресурсы, добываемые трудом: ${report.resources.produced.join(', ') || '—'}`,
  `Ресурсы, продаваемые в лавках: ${report.resources.purchasable.join(', ') || '—'}`,
  `Нужны ремонту и улучшениям: ${report.resources.neededByRepairOrUpgrade.join(', ')}`,
  `Из них взять негде: ${report.resources.neededButUnobtainable.join(', ') || 'нет таких'}`,
  `Заведены в сиде, но недоступны: ${report.resources.declaredButUnobtainable.join(', ') || 'нет таких'}`,
  `Профессии без единого объекта: ${report.professionsWithoutObject.join(', ') || 'нет таких'}`,
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
