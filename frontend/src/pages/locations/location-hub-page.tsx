const LOCATIONS = {
  industrial: {
    title: 'Промзона',
    note: 'Работа, запчасти, производство и склад находятся в нижней полосе района.',
  },
  agriculture: {
    title: 'Фермы и колхозы',
    note: 'Фермы, колхозы, растения, продукты и склад урожая находятся в нижней полосе района.',
  },
} as const

export function LocationHubPage({ kind }: { kind: keyof typeof LOCATIONS }) {
  const location = LOCATIONS[kind]
  return (
    <div className="location-overview">
      <h1>{location.title}</h1>
      <p>{location.note}</p>
    </div>
  )
}
