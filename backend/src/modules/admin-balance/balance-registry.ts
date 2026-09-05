// =============================================================
// РЕЕСТР ФОРМУЛ И КОЭФФИЦИЕНТОВ
//
// Что игра считает, по какой формуле и на что это влияет. Раньше это знание
// жило только в девятнадцати файлах *.formulas.ts и в голове того, кто их
// писал: администратор видел последствия (деньги, бои, жалобы), но не мог
// посмотреть причину.
//
// Здесь НЕТ копий чисел. Значения берутся из BalanceConfig в момент запроса,
// поэтому реестр физически не может разойтись с игрой: правится конфиг —
// меняется и то, что показано в админке.
//
// Формулы записаны словами, а не кодом, и указывают на файл-источник:
// панель объясняет механику, а не заменяет чтение кода.
// =============================================================
import { BalanceConfig as B } from '../../config/balance.config'

/** Один коэффициент: путь в BalanceConfig, значение и зачем он такой. */
export interface BalanceParam {
  path: string
  value: unknown
  note: string
}

/** Одна формула игры. */
export interface BalanceFormula {
  id: string
  title: string
  /** Сама формула, словами. */
  formula: string
  /** Что она вычисляет. */
  what: string
  /** На что влияет результат — почему это важно. */
  affects: string
  /** Что подаётся на вход. */
  inputs: string[]
  /** Коэффициенты, которыми она управляется. */
  params: BalanceParam[]
  /** Файл, где формула живёт. */
  source: string
}

export interface BalanceGroup {
  id: string
  title: string
  /** Зачем эта группа существует и как связана с остальными. */
  intro: string
  formulas: BalanceFormula[]
}

const p = (path: string, value: unknown, note: string): BalanceParam => ({ path, value, note })

export function balanceRegistry(): BalanceGroup[] {
  return [
    {
      id: 'character',
      title: 'Персонаж',
      intro: 'С чего начинается игрок: стартовые деньги, здоровье, переносимый вес и восемь характеристик. Отсюда растут и бой, и работа — все прочие системы читают эти же числа.',
      formulas: [
        {
          id: 'character.hp',
          title: 'Максимум здоровья',
          formula: 'HP = 60 + END × 6 + боевой_уровень × 2',
          what: 'Запас здоровья персонажа.',
          affects: 'Сколько ударов держит боец. END поэтому ценнее для выживания, чем брони: броня режет урон, а END добавляет запас и вдобавок снижает урон отдельной формулой.',
          inputs: ['END', 'боевой уровень'],
          params: [
            p('character.baseHp', B.character.baseHp, 'база, одинаковая у всех архетипов'),
            p('character.hpPerEnd', B.character.hpPerEnd, 'вклад одной единицы выносливости'),
            p('character.hpPerBattleLevel', B.character.hpPerBattleLevel, 'прибавка за боевой уровень'),
          ],
          source: 'config/balance.config.ts → character',
        },
        {
          id: 'character.carry',
          title: 'Переносимый вес',
          formula: 'вес = 20 + STR × 6',
          what: 'Сколько килограммов персонаж уносит на себе.',
          affects: 'Потолок на снаряжение и добычу. Перегруз бьёт по инициативе и уворотам — тяжёлая броня замедляет.',
          inputs: ['STR'],
          params: [
            p('character.baseCarryWeight', B.character.baseCarryWeight, 'без единой единицы силы'),
            p('character.carryWeightPerStr', B.character.carryWeightPerStr, 'за каждую единицу силы'),
          ],
          source: 'config/balance.config.ts → character',
        },
        {
          id: 'character.start',
          title: 'Старт и архетипы',
          formula: 'база 3/3/2/3/3/1/1/1 + бонус архетипа + распределяемые очки',
          what: 'С какими характеристиками и деньгами персонаж входит в игру.',
          affects: 'Первые часы игры целиком. Студент — единственный без бонуса к характеристикам, зато с двумя свободными очками: это выбор «сейчас или потом», а не слабый архетип.',
          inputs: ['архетип'],
          params: [
            p('character.startMoney', B.character.startMoney, 'стартовый капитал'),
            p('character.baseStats', B.character.baseStats, 'одинаковая база до бонусов'),
            p('character.archetypeBonuses', B.character.archetypeBonuses, 'кому что добавляется'),
            p('character.startingPoints', B.character.startingPoints, 'свободные очки на старте'),
            p('battleExp.maxStatValue', B.battleExp.maxStatValue, 'потолок одной характеристики'),
          ],
          source: 'config/balance.config.ts → character',
        },
      ],
    },

    {
      id: 'battle',
      title: 'Бой',
      intro: 'Порядок разрешения удара: инициатива → попадание → уворот → блок → крит → урон → броня → выносливость. Каждый шаг может оборвать цепочку, поэтому большие числа урона на деле упираются в шансы, а не в силу.',
      formulas: [
        {
          id: 'battle.initiative',
          title: 'Инициатива',
          formula: 'REA × 1.2 + AGI × 0.6 + WSK × 0.3 − вес_снаряжения × 0.25 + случайно(−5…+5), минимум 1',
          what: 'Кто ходит первым.',
          affects: 'Первый ход в размене часто и решает бой. Единственное место, где вес снаряжения бьёт напрямую: тяжёлый боец бьёт вторым.',
          inputs: ['REA', 'AGI', 'уровень владения оружием', 'вес снаряжения'],
          params: [
            p('initiative.reaMultiplier', B.initiative.reaMultiplier, 'реакция — главный вклад'),
            p('initiative.agiMultiplier', B.initiative.agiMultiplier, 'ловкость вдвое слабее реакции'),
            p('initiative.wskMultiplier', B.initiative.wskMultiplier, 'владение оружием'),
            p('initiative.weightPenalty', B.initiative.weightPenalty, 'штраф за каждый килограмм'),
            p('initiative.randomRange', B.initiative.randomRange, 'разброс: слабый иногда ходит первым'),
          ],
          source: 'modules/battles/battle.formulas.ts:76',
        },
        {
          id: 'battle.hit',
          title: 'Шанс попадания',
          formula: 'ограничить(точность_оружия × ln(ACC+1)/ln(16) + WSK × 0.005 + LUCK × 0.005 + антиуворот − (AGI_защитника × 0.003 + уворот_защитника), 0.05…0.95)',
          what: 'Дойдёт ли удар до защитника вообще.',
          affects: 'Первый отсев в цепочке: не попал — ни крита, ни урона. Точность растёт логарифмом, поэтому вкладывать ACC сверх среднего почти бесполезно.',
          inputs: ['ACC', 'точность оружия', 'уровень владения', 'LUCK', 'AGI защитника'],
          params: [
            p('hitChance.min', B.hitChance.min, 'нижний предел: безнадёжный удар всё же попадает'),
            p('hitChance.max', B.hitChance.max, 'верхний предел: промах возможен всегда'),
            p('hitChance.agiDodgePressure', B.hitChance.agiDodgePressure, 'сколько отнимает ловкость защитника'),
            p('hitChance.wskBonus', B.hitChance.wskBonus, 'за уровень владения оружием'),
            p('hitChance.luckEvasionPressure', B.hitChance.luckEvasionPressure, 'вклад удачи'),
          ],
          source: 'modules/battles/battle.formulas.ts:95',
        },
        {
          id: 'battle.dodge',
          title: 'Шанс уворота',
          formula: 'ограничить(0.05 + AGI_защ/(ACC_атак+AGI_атак) × 0.35 + бонус_уворота − антиуворот − вес_брони × 0.003, 0…0.75)',
          what: 'Увернётся ли защитник от прошедшего удара.',
          affects: 'Второй отсев. Считается отношением ловкости к точности атакующего, то есть уворот работает против конкретного противника, а не «вообще».',
          inputs: ['AGI защитника', 'ACC и AGI атакующего', 'вес брони'],
          params: [
            p('dodgeChance.base', B.dodgeChance.base, 'базовый уворот без вложений'),
            p('dodgeChance.agilityRatioMult', B.dodgeChance.agilityRatioMult, 'вес отношения ловкостей'),
            p('dodgeChance.armorWeightPenalty', B.dodgeChance.armorWeightPenalty, 'за килограмм брони'),
            p('dodgeChance.max', B.dodgeChance.max, 'потолок: увернуться всегда нельзя'),
          ],
          source: 'modules/battles/battle.formulas.ts:111',
        },
        {
          id: 'battle.block',
          title: 'Шанс блока и его сила',
          formula: 'шанс = ограничить(0.10 + REA_защ/(REA_атак+REA_защ) × 0.40, …, 0.80); успешный блок пропускает 35% урона',
          what: 'Примет ли защитник удар на блок и сколько урона просочится.',
          affects: 'Блок не отменяет удар, а срезает его. Отсюда ценность REA: она даёт и первый ход, и блок, и ответку.',
          inputs: ['REA обеих сторон', 'LUCK атакующего (пробитие)'],
          params: [
            p('blockChance.base', B.blockChance.base, 'базовый шанс блока'),
            p('blockChance.reactionRatioMult', B.blockChance.reactionRatioMult, 'вес отношения реакций'),
            p('blockChance.blockReduction', B.blockChance.blockReduction, 'какая доля урона проходит сквозь блок'),
            p('blockChance.max', B.blockChance.max, 'потолок'),
            p('blockChance.luckPierceMult', B.blockChance.luckPierceMult, 'удача атакующего пробивает блок'),
          ],
          source: 'modules/battles/battle.formulas.ts:160',
        },
        {
          id: 'battle.crit',
          title: 'Критический удар',
          formula: 'шанс = ограничить(0.03 + AGR × 0.004 + WSK × 0.003 − END_защ × 0.002, 0.01…0.50); множитель 1.5, крит игнорирует половину брони',
          what: 'Шанс и сила критического удара.',
          affects: 'Единственная механика, где помогает агрессия. Игнорирование половины брони делает крит опасным именно для тяжёлых целей.',
          inputs: ['AGR', 'уровень владения', 'END защитника'],
          params: [
            p('crit.base', B.crit.base, 'база'),
            p('crit.agressMult', B.crit.agressMult, 'вклад агрессии'),
            p('crit.wskMult', B.crit.wskMult, 'вклад владения оружием'),
            p('crit.endResist', B.crit.endResist, 'выносливость защитника сопротивляется криту'),
            p('crit.multiplierBase', B.crit.multiplierBase, 'во сколько раз крит больнее'),
            p('crit.armorIgnore', B.crit.armorIgnore, 'доля брони, которую крит не замечает'),
          ],
          source: 'modules/battles/battle.formulas.ts:174',
        },
        {
          id: 'battle.damage',
          title: 'Сырой урон',
          formula: 'урон = (бросок_оружия × множитель_владения + STR × 0.5 + плоский_бонус) × исходящий_множитель',
          what: 'Урон до брони и выносливости.',
          affects: 'Здесь STR превращается в урон, а владение оружием даёт до +50%. Новичок с навыком 1 бьёт на 100% урона оружия — мастерство это бонус сверху, а не штраф новичку.',
          inputs: ['разброс урона оружия', 'эффективное владение', 'STR'],
          params: [
            p('damage.wskBase', B.damage.wskBase, 'множитель без навыка — ровно 100%'),
            p('damage.wskPerLevel', B.damage.wskPerLevel, 'прибавка за уровень до 20-го'),
            p('damage.wskPerLevelOver20', B.damage.wskPerLevelOver20, 'после 20-го растёт втрое медленнее'),
            p('damage.wskCap', B.damage.wskCap, 'потолок множителя владения'),
            p('damage.strCoeff', B.damage.strCoeff, 'вклад силы'),
          ],
          source: 'modules/battles/battle.formulas.ts:214',
        },
        {
          id: 'battle.armor',
          title: 'Броня и выносливость',
          formula: 'после_брони = (урон − броня × 0.4) × (1 − броня/(броня+50)); затем × 1/(1 + ln(END+1) × 0.12)',
          what: 'Во что превращается сырой урон на защите.',
          affects: 'Модель гибридная: сначала плоское снижение, потом процентное. Из-за знаменателя броня+50 первые 10–20 единиц брони дают наибольший прирост, дальше отдача падает.',
          inputs: ['сырой урон', 'броня', 'END защитника'],
          params: [
            p('damage.armorFlatCoeff', B.damage.armorFlatCoeff, 'плоское снижение за единицу брони'),
            p('damage.armorK', B.damage.armorK, 'точка насыщения процентной части'),
            p('damage.enduranceK', B.damage.enduranceK, 'насколько выносливость гасит урон'),
            p('damage.minFinalDamage', B.damage.minFinalDamage, 'меньше этого удар не бывает'),
          ],
          source: 'modules/battles/battle.formulas.ts:232',
        },
        {
          id: 'battle.antimastery',
          title: 'Антимастерство',
          formula: 'эффективный_навык = навык_атакующего − антинавык_защитника × 0.5, не ниже 0',
          what: 'Насколько контр-навык защитника обесценивает владение оружием атакующего.',
          affects: 'Единственное место, где применяется антимастерство. Второй слой (отдельная скидка на урон тем же числом) был удалён 04.09.2026: из-за него специалист проигрывал 91% дуэлей вместо ≤60%.',
          inputs: ['уровень владения атакующего', 'антинавык защитника'],
          params: [
            p('weaponSkill.antiSkillReductionPerLevel', B.weaponSkill.antiSkillReductionPerLevel, 'уровень антинавыка съедает пол-уровня владения'),
          ],
          source: 'modules/battles/battle.formulas.ts:64',
        },
      ],
    },

    {
      id: 'exp',
      title: 'Опыт и уровни',
      intro: 'Три независимые ветки: боевая, экономическая и владение оружием. Ни одна не заменяет другую — вкладываться приходится отдельно.',
      formulas: [
        {
          id: 'exp.battle',
          title: 'Опыт за бой',
          formula: 'опыт × коэффициент_результата × коэффициент_разницы_уровней × антифарм_ботов',
          what: 'Сколько боевого опыта даёт схватка.',
          affects: 'Победа в PvP даёт полный опыт, поражение — пятую часть, PvE вдвое меньше победы. Разница уровней от 15 обнуляет опыт совсем: бить слабых бессмысленно.',
          inputs: ['результат боя', 'разница уровней', 'сколько раз этого бота уже били сегодня'],
          params: [
            p('battleExp.resultCoeff', B.battleExp.resultCoeff, 'цена победы, поражения и ничьей'),
            p('battleExp.levelDiffCoeff', B.battleExp.levelDiffCoeff, 'таблица «разница уровней → доля опыта»'),
            p('battleExp.pveDailyPenaltyPerKill', B.battleExp.pveDailyPenaltyPerKill, 'каждое повторное убийство бота дешевле'),
            p('battleExp.pveDailyMin', B.battleExp.pveDailyMin, 'ниже этой доли не падает'),
            p('antiAbuse.repeatBattleShare', B.antiAbuse.repeatBattleShare, 'повторный бой той же пары за сутки'),
          ],
          source: 'config/balance.config.ts → battleExp',
        },
        {
          id: 'exp.levels',
          title: 'Пороги уровней',
          formula: 'таблица порогов: боевой 0, 5, 15, 37, 76… до 30 000; экономический 0, 1250, 3864… до 8.5 млн',
          what: 'Сколько опыта нужно на следующий уровень.',
          affects: 'Задаёт темп всей игры. Боевой уровень открывает бригаду (с 5-го) и заявки на районы (с 3-го), экономический — торговлю и производство.',
          inputs: ['накопленный опыт'],
          params: [
            p('battleExp.levelThresholds', B.battleExp.levelThresholds, 'боевые уровни'),
            p('economicExp.levelThresholds', B.economicExp.levelThresholds, 'экономические уровни'),
            p('weaponSkill.expThresholds', B.weaponSkill.expThresholds, 'владение оружием'),
            p('battleExp.statPointsPerLevel', B.battleExp.statPointsPerLevel, 'очки характеристик за уровень'),
          ],
          source: 'config/balance.config.ts → battleExp / economicExp / weaponSkill',
        },
        {
          id: 'exp.economic',
          title: 'Экономический опыт',
          formula: 'продажа нового = цена × 0.047; сломанного = цена × 0.067; на рынке продавец получает цена × 0.03',
          what: 'Опыт за торговые операции.',
          affects: 'Растёт от оборота, а не от прибыли: возить дёшево и много выгоднее для уровня, чем продать одну дорогую вещь.',
          inputs: ['цена сделки'],
          params: [
            p('economicExp.sellNewRate', B.economicExp.sellNewRate, 'за продажу нового предмета'),
            p('economicExp.sellBrokenRate', B.economicExp.sellBrokenRate, 'за сломанный — больше'),
            p('economy.market.sellerEcoExpRate', B.economy.market.sellerEcoExpRate, 'за сделку на рынке'),
            p('economy.resources.governmentEcoExpRate', B.economy.resources.governmentEcoExpRate, 'за сдачу сырья государству'),
          ],
          source: 'modules/market/market.formulas.ts',
        },
      ],
    },

    {
      id: 'work',
      title: 'Работа и зарплата',
      intro: 'Главный законный источник денег в игре. Здесь же стоит основной ограничитель фарма — усталость и суточный бюджет смен.',
      formulas: [
        {
          id: 'work.salary',
          title: 'Зарплата за смену',
          formula: 'оклад × уровень_объекта × эффективность_рабочего × случайно(0.9…1.1) × усталость, но не больше оклад × 3',
          what: 'Сколько платят за одну отработанную смену.',
          affects: 'Основной кран денег в экономике. Потолок в три оклада не даёт связке «высокий объект + высокая профессия» разогнать выплату бесконечно.',
          inputs: ['базовый оклад объекта', 'уровень объекта', 'уровень профессии', 'номер смены за сутки'],
          params: [
            p('economy.work.objectLevelStep', B.economy.work.objectLevelStep, 'прибавка за каждый уровень объекта'),
            p('economy.work.efficiencyPerProfessionLevel', B.economy.work.efficiencyPerProfessionLevel, 'за уровень профессии'),
            p('economy.work.salaryRandomMin', B.economy.work.salaryRandomMin, 'нижняя граница разброса'),
            p('economy.work.salaryRandomMax', B.economy.work.salaryRandomMax, 'верхняя граница разброса'),
            p('economy.work.salaryCapMultiplier', B.economy.work.salaryCapMultiplier, 'жёсткий потолок в окладах'),
          ],
          source: 'modules/work/work.formulas.ts:31',
        },
        {
          id: 'work.fatigue',
          title: 'Усталость за сутки',
          formula: 'коэффициент = максимум(0.20, 1 − (номер_смены − 1) × 0.20)',
          what: 'Насколько дешевеет каждая следующая смена за сутки.',
          affects: 'Вторая смена даёт 80% ставки, третья 60%, пятая и дальше — 20%. Осознанное отклонение от ТЗ: без него восемь смен подряд превращают работу в ровный кран денег.',
          inputs: ['номер смены за сутки'],
          params: [
            p('economy.work.salaryFatigueStep', B.economy.work.salaryFatigueStep, 'на сколько дешевеет каждая следующая'),
            p('economy.work.salaryFatigueFloor', B.economy.work.salaryFatigueFloor, 'ниже этой доли не падает'),
          ],
          source: 'modules/work/work.formulas.ts:26',
        },
        {
          id: 'work.budget',
          title: 'Суточный бюджет смен',
          formula: 'пускать, пока смен_сегодня < 12 И минут_сегодня + смена ≤ 360',
          what: 'Сколько всего можно отработать за UTC-сутки.',
          affects: 'Потолок двойной намеренно: только по числу смен нельзя — на объекте с полуторачасовой сменой выходило бы вдвое больше времени, чем на получасовом.',
          inputs: ['смены за сегодня', 'минуты за сегодня', 'длительность следующей'],
          params: [
            p('economy.work.dailyShiftLimit', B.economy.work.dailyShiftLimit, 'смен в сутки'),
            p('economy.work.dailyShiftMinutes', B.economy.work.dailyShiftMinutes, 'минут в сутки'),
            p('strategy.premium.dailyShiftCap', B.strategy.premium.dailyShiftCap, 'потолок для подписчика'),
            p('strategy.helper.dailyShiftCap', B.strategy.helper.dailyShiftCap, 'сколько смен закрывает помощник'),
          ],
          source: 'modules/work/work.formulas.ts:77',
        },
      ],
    },

    {
      id: 'production',
      title: 'Производство',
      intro: 'Цепочка переделов: сбор → переработка → сборка. Труд со смен закрывает циклы, циклы дают продукцию по рецепту.',
      formulas: [
        {
          id: 'production.cycle',
          title: 'Труд и циклы',
          formula: 'труд = минуты_смены × эффективность; цикл закрывается, когда труда набралось на рецепт',
          what: 'Как отработанное время превращается в продукцию.',
          affects: 'Связывает работу с производством: объект не производит сам по себе, за него работают люди. Инструмент высшего разряда ускоряет цикл на 15%.',
          inputs: ['минуты смены', 'уровень профессии', 'разряд инструмента'],
          params: [
            p('economy.production.cycleTickSeconds', B.economy.production.cycleTickSeconds, 'как часто воркер двигает циклы'),
            p('economy.production.equipmentTierSpeedBonus', B.economy.production.equipmentTierSpeedBonus, 'ускорение от разряда оснастки'),
            p('economy.production.equipmentWearPerCycle', B.economy.production.equipmentWearPerCycle, 'износ оснастки за цикл'),
            p('economy.production.laborTimeoutHours', B.economy.production.laborTimeoutHours, 'через сколько сгорает незакрытый труд'),
          ],
          source: 'modules/production/cycle.formulas.ts',
        },
        {
          id: 'production.owner',
          title: 'Владение объектом',
          formula: 'вывод прибыли облагается 5%; перепродажа возвращает половину цены',
          what: 'Правила владения производственным объектом.',
          affects: 'Объектов на персонажа не больше двух — иначе один игрок скупает передел целиком. Смена профиля объекта стоит денег и трёх часов простоя, чтобы под каждый заказ не переключались туда-сюда.',
          inputs: ['баланс объекта', 'цена объекта'],
          params: [
            p('economy.production.maxObjectsPerCharacter', B.economy.production.maxObjectsPerCharacter, 'объектов в одни руки'),
            p('economy.production.objectWithdrawTaxRate', B.economy.production.objectWithdrawTaxRate, 'налог на вывод прибыли'),
            p('economy.production.objectResaleRate', B.economy.production.objectResaleRate, 'сколько вернут при продаже'),
            p('economy.production.profileSwitchCost', B.economy.production.profileSwitchCost, 'смена профиля объекта'),
            p('economy.production.profileSwitchMinutes', B.economy.production.profileSwitchMinutes, 'простой при смене профиля'),
            p('strategy.clanObjects.base', B.strategy.clanObjects.base, 'объектов у бригады без районов'),
            p('strategy.clanObjects.perTerritory', B.strategy.clanObjects.perTerritory, 'плюс за каждый район'),
          ],
          source: 'modules/production/ownership.formulas.ts',
        },
      ],
    },

    {
      id: 'money',
      title: 'Рынок, ремонт, улучшения',
      intro: 'Стоки денежной массы: всё, что уходит из экономики. Их доля от эмиссии — главный показатель здоровья: цель не ниже 40%.',
      formulas: [
        {
          id: 'money.market',
          title: 'Рынок игроков',
          formula: 'выставление = максимум(5, цена × 2%); при продаже налог 5%, продавец получает 95%',
          what: 'Комиссии барахолки.',
          affects: 'Двойной сток: комиссия сгорает даже при отмене, налог — при сделке. Плата за выставление не даёт забивать рынок мусорными лотами.',
          inputs: ['цена лота'],
          params: [
            p('economy.market.listingFeeRate', B.economy.market.listingFeeRate, 'комиссия за выставление'),
            p('economy.market.listingFeeMin', B.economy.market.listingFeeMin, 'минимальная комиссия'),
            p('economy.market.saleTaxRate', B.economy.market.saleTaxRate, 'налог с продажи'),
            p('economy.market.listingDurationHours', B.economy.market.listingDurationHours, 'сколько живёт лот'),
            p('economy.market.maxActiveListings', B.economy.market.maxActiveListings, 'активных лотов на игрока'),
          ],
          source: 'modules/market/market.formulas.ts',
        },
        {
          id: 'money.repair',
          title: 'Ремонт',
          formula: 'стоимость = базовая_цена / 120 за единицу прочности × коэффициент_качества',
          what: 'Во сколько обходится починка вещи.',
          affects: 'Постоянный сток у всех, кто воюет. Дорогие и редкие вещи чинить дороже вдвое — качество умножает цену ремонта.',
          inputs: ['базовая цена предмета', 'качество', 'потерянная прочность'],
          params: [
            p('repair.baseCostDivider', B.repair.baseCostDivider, 'делитель цены за единицу прочности'),
            p('repair.qualityCoeff', B.repair.qualityCoeff, 'надбавка по качеству'),
            p('economy.production.repairDurabilityPerKit', B.economy.production.repairDurabilityPerKit, 'прочности за один ремкомплект'),
            p('durability.weaponLossPerBattle', B.durability.weaponLossPerBattle, 'износ оружия за атаку'),
            p('durability.armorLossPerHit', B.durability.armorLossPerHit, 'износ брони за попадание'),
          ],
          source: 'modules/repair/repair.formulas.ts',
        },
        {
          id: 'money.upgrades',
          title: 'Улучшения вещей',
          formula: 'цена = базовая × 0.15 × уровень^1.4 × качество; шанс = 0.90 − уровень × 0.12 + профессия × 0.01, в пределах 0.15…0.95',
          what: 'Сколько стоит и с какой вероятностью удаётся улучшение.',
          affects: 'Главный добровольный сток: цена растёт степенью, а шанс падает линейно. Профессия немного страхует. Пятый уровень — это уже 42% успеха при цене в семь раз выше первой.',
          inputs: ['базовая цена вещи', 'текущий уровень улучшений', 'уровень профессии'],
          params: [
            p('economy.upgrades.costRate', B.economy.upgrades.costRate, 'доля цены за первый уровень'),
            p('economy.upgrades.costPower', B.economy.upgrades.costPower, 'степень роста цены'),
            p('economy.upgrades.baseChance', B.economy.upgrades.baseChance, 'шанс на первом уровне'),
            p('economy.upgrades.chanceLossPerLevel', B.economy.upgrades.chanceLossPerLevel, 'сколько отнимает каждый уровень'),
            p('economy.upgrades.professionBonusPerLevel', B.economy.upgrades.professionBonusPerLevel, 'страховка от профессии'),
            p('economy.upgrades.minChance', B.economy.upgrades.minChance, 'ниже не опускается'),
          ],
          source: 'modules/upgrades/upgrades.formulas.ts',
        },
        {
          id: 'money.government',
          title: 'Государство',
          formula: 'скупка сырья по 25% базовой цены; выкуп вещей по 30%',
          what: 'Цены государственной торговли.',
          affects: 'Пол цены для всей экономики: ниже государственной ставки продавать бессмысленно, поэтому рынок игроков держится выше. Госскупка — безлимитный кран денег, её ставка задаёт нижнюю границу инфляции.',
          inputs: ['базовая цена ресурса или вещи'],
          params: [
            p('economy.resources.governmentPayoutRate', B.economy.resources.governmentPayoutRate, 'доля цены при сдаче сырья'),
            p('shop.sellBackMultiplier', B.shop.sellBackMultiplier, 'доля цены при продаже вещи государству'),
            p('economy.tools.tiers', B.economy.tools.tiers, 'цены и ресурс оснастки по разрядам'),
          ],
          source: 'config/balance.config.ts → economy.resources / shop',
        },
      ],
    },

    {
      id: 'strategy',
      title: 'Бригады и районы',
      intro: 'Этап 4: клан как владелец районов. Содержание районов — крупнейший организованный сток денег, а авторитет не даёт брать город одними победами.',
      formulas: [
        {
          id: 'strategy.upkeep',
          title: 'Содержание районов',
          formula: 'первый район 2000 ₽/сутки, второй 5000 ₽/сутки; долг 10 000 гасит бонус, 25 000 отдаёт район',
          what: 'Во что бригаде обходится владение городом.',
          affects: 'Второй район дороже первого в 2.5 раза — расширение упирается в содержание, а не в силу. Бонус гаснет раньше, чем район теряется: у клана есть окно, чтобы увидеть проблему.',
          inputs: ['число районов', 'накопленный долг'],
          params: [
            p('strategy.territory.limit', B.strategy.territory.limit, 'районов на бригаду'),
            p('strategy.territory.upkeepTier1', B.strategy.territory.upkeepTier1, 'первый район'),
            p('strategy.territory.upkeepTier2', B.strategy.territory.upkeepTier2, 'второй район'),
            p('strategy.territory.upkeepDebtBonusOff', B.strategy.territory.upkeepDebtBonusOff, 'долг, при котором гаснет бонус'),
            p('strategy.territory.upkeepDebtRelease', B.strategy.territory.upkeepDebtRelease, 'долг, при котором район уходит'),
          ],
          source: 'modules/territories/territories.formulas.ts:46',
        },
        {
          id: 'strategy.claim',
          title: 'Заявка на район',
          formula: 'взнос 10 000 ₽ безвозвратно + 20 авторитета; состав от 5 бойцов не ниже 3-го боевого уровня',
          what: 'Что нужно, чтобы напасть на район.',
          affects: 'Взнос не возвращается намеренно: иначе заявка была бы бесплатной разведкой чужой обороны. Захват даёт 15 авторитета, а стоит 20 — одними победами город не удержать, нужна ещё и работа.',
          inputs: ['казна бригады', 'авторитет', 'состав'],
          params: [
            p('strategy.territory.claimFee', B.strategy.territory.claimFee, 'взнос за заявку'),
            p('strategy.authority.claimCost', B.strategy.authority.claimCost, 'авторитета за заявку'),
            p('strategy.authority.territoryWon', B.strategy.authority.territoryWon, 'за победу'),
            p('strategy.authority.territoryDefended', B.strategy.authority.territoryDefended, 'за оборону — больше: время выбирал не он'),
            p('strategy.territory.claimMinRoster', B.strategy.territory.claimMinRoster, 'минимум бойцов'),
            p('strategy.territory.protectionHours', B.strategy.territory.protectionHours, 'защита после захвата'),
            p('strategy.territory.claimClanCooldownHours', B.strategy.territory.claimClanCooldownHours, 'пауза между заявками бригады'),
          ],
          source: 'modules/territories/claims.service.ts',
        },
        {
          id: 'strategy.raid',
          title: 'Налёт на объект',
          formula: 'диверсия снимает 40 прочности; грабёж берёт 20% баланса, но не больше 8000 ₽; повтор не чаще раза в 72 часа',
          what: 'Что можно сделать с чужим производством.',
          affects: 'Потолок грабежа и пауза в трое суток не дают превратить чужой объект в постоянную кормушку. Объект игрока вне бригады не атакуется вовсе.',
          inputs: ['баланс объекта', 'прочность'],
          params: [
            p('strategy.objectAttack.sabotageDurabilityLoss', B.strategy.objectAttack.sabotageDurabilityLoss, 'урон прочности от диверсии'),
            p('strategy.objectAttack.robberyShare', B.strategy.objectAttack.robberyShare, 'доля баланса при грабеже'),
            p('strategy.objectAttack.robberyCap', B.strategy.objectAttack.robberyCap, 'потолок добычи'),
            p('strategy.objectAttack.cooldownHours', B.strategy.objectAttack.cooldownHours, 'пауза между налётами'),
            p('strategy.authority.robberyCost', B.strategy.authority.robberyCost, 'авторитета за грабёж'),
          ],
          source: 'modules/territories/object-attacks.service.ts',
        },
        {
          id: 'strategy.premium',
          title: 'Премиум и помощники',
          formula: 'подписка: ×1.5 к росту навыков, 16 смен вместо 12, 2 помощника; помощник работает с эффективностью 0.6',
          what: 'Что даёт платная подписка.',
          affects: 'Проверяется приёмкой: подписчик с двумя помощниками не должен превышать 130% дохода активного игрока — фактически 118%. Помощник работает только на объектах владельца и его бригады.',
          inputs: ['наличие подписки', 'число помощников'],
          params: [
            p('strategy.premium.skillMultiplier', B.strategy.premium.skillMultiplier, 'ускорение роста навыков'),
            p('strategy.premium.helperSlots', B.strategy.premium.helperSlots, 'слотов под помощников'),
            p('strategy.helper.efficiency', B.strategy.helper.efficiency, 'эффективность помощника'),
            p('strategy.helper.skillCap', B.strategy.helper.skillCap, 'потолок навыка помощника'),
            p('strategy.helper.dailyShiftCap', B.strategy.helper.dailyShiftCap, 'суточная норма помощника'),
          ],
          source: 'modules/premium/helpers.service.ts',
        },
      ],
    },

    {
      id: 'health',
      title: 'Пороги здоровья экономики',
      intro: 'Не механика игры, а её датчики. По этим числам ежедневный воркер решает, поднимать ли тревогу — они же показаны на дашборде.',
      formulas: [
        {
          id: 'health.alerts',
          title: 'Когда бить тревогу',
          formula: 'доля стоков < 40%, или рост M2 > 5% в сутки, или Джини > 0.75, или успех улучшений вне 45…85%',
          what: 'Условия, при которых экономика считается больной.',
          affects: 'Считается ежедневно в 03:00 UTC и складывается в снимок. Доля стоков ниже 40% означает, что денег печатается больше, чем сгорает, — это инфляция.',
          inputs: ['снимок метрик за сутки'],
          params: [
            p('economy.alerts.minSinkShare', B.economy.alerts.minSinkShare, 'минимальная доля стоков'),
            p('economy.alerts.maxDailyM2Growth', B.economy.alerts.maxDailyM2Growth, 'предел роста денежной массы'),
            p('economy.alerts.maxGini', B.economy.alerts.maxGini, 'предел расслоения игроков'),
            p('economy.alerts.minUpgradeSuccessRate', B.economy.alerts.minUpgradeSuccessRate, 'нижняя граница успеха улучшений'),
            p('economy.alerts.maxUpgradeSuccessRate', B.economy.alerts.maxUpgradeSuccessRate, 'верхняя граница'),
          ],
          source: 'workers/economy-metrics-daily.worker.ts',
        },
        {
          id: 'health.abuse',
          title: 'Жёсткие лимиты антиабуза',
          formula: 'между парой аккаунтов не больше 50 000 ₽ и 5 предметов в сутки; повторный бой той же пары — четверть опыта',
          what: 'Правила, которые работают молча и всегда.',
          affects: 'Это не наказание, а правила игры: они описаны игроку в ограничениях версии. Прямых передач денег в игре нет, единственный канал — рынок, поэтому лимит стоит там.',
          inputs: ['пара аккаунтов', 'сутки'],
          params: [
            p('antiAbuse.pairMoneyDailyCap', B.antiAbuse.pairMoneyDailyCap, 'денег между парой за сутки'),
            p('antiAbuse.pairItemsDailyCap', B.antiAbuse.pairItemsDailyCap, 'предметов между парой за сутки'),
            p('antiAbuse.repeatBattleShare', B.antiAbuse.repeatBattleShare, 'доля опыта за повторный бой'),
            p('economy.suspicious.priceRatioMin', B.economy.suspicious.priceRatioMin, 'подозрительно низкая цена лота'),
            p('economy.suspicious.priceRatioMax', B.economy.suspicious.priceRatioMax, 'подозрительно высокая'),
          ],
          source: 'modules/antiabuse/',
        },
      ],
    },
  ]
}
