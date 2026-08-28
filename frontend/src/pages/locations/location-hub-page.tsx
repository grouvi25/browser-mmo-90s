// =============================================================
// Посадочная страница района — одна на все районы города.
//
// Правило: клик по району всегда даёт вид места, и ничего кроме.
// Раньше исходов было четыре: Центр и Гаражи показывали иллюстрацию,
// Промзона и село — абзац текста, Рынок и Спальный сразу открывали
// конкретный раздел, а Вокзал — «откроется позже». Выучить, что
// делает клик, было нельзя.
//
// Иллюстрации сейчас есть у двух районов из семи. Остальные получают
// ту же композицию на бумажной подложке: важно, чтобы правило было
// одно, а картинки доедут.
// =============================================================
import { LocationView } from '../../widgets/location-view/location-view'
import { SCENES } from '../../shared/ui/sprite'

export type DistrictKey =
  | 'market' | 'industrial' | 'agriculture' | 'station' | 'garages' | 'suburb'

interface DistrictMeta {
  /** ключ иллюстрации в SCENES; пусто — рисуем бумажную подложку */
  scene?: string
  /** подпись места в левом верхнем углу, как на иллюстрированных районах */
  place: string
  title: string
  /** что тут вообще делают — одной строкой */
  note: string
}

const DISTRICTS: Record<DistrictKey, DistrictMeta> = {
  market: {
    place: 'Рынок · Торговые ряды',
    title: 'Рынок',
    note: 'Государственный магазин, частные лавки, барахолка и бары.',
  },
  industrial: {
    place: 'Промзона · Заводской двор',
    title: 'Промзона',
    note: 'Смены на объектах, своя собственность, переделы и запчасти.',
  },
  agriculture: {
    place: 'Село · Поля и теплицы',
    title: 'Фермы и колхозы',
    note: 'Свой участок, колхозные смены и справочник культур.',
  },
  station: {
    place: 'Вокзал · Товарная станция',
    title: 'Вокзал',
    note: 'Перевозки между районами. Раздел откроется позже.',
  },
  garages: {
    scene: 'garages',
    place: 'Гаражи · Кооператив «Ракета»',
    title: 'Гаражи',
    note: 'Мастерская и улучшения снаряжения.',
  },
  suburb: {
    place: 'Спальный район · Дворы',
    title: 'Спальный район',
    note: 'Бои с ботами, стрелки один на один и командные.',
  },
}

export function LocationHubPage({ kind }: { kind: DistrictKey }) {
  const district = DISTRICTS[kind]

  // Иллюстрация есть — показываем её тем же виджетом, что и Центр.
  if (district.scene && SCENES[district.scene]) {
    return (
      <LocationView
        scene={district.scene}
        alt={district.title}
        place={district.place}
        actions={[]}
      />
    )
  }

  // Иллюстрации нет — та же композиция на бумаге. Разделы района
  // не перечисляем: они стоят в нижней полосе, и дублировать их
  // кнопками значит заводить два места для одного перехода.
  return (
    <div className="hub hub--paper">
      <div className="hub__overlay">
        <div className="hub__place">{district.place}</div>
        <p className="hub__note">{district.note}</p>
      </div>
    </div>
  )
}
