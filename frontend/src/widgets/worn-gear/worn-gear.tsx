import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { inventoryApi } from '../../shared/api/inventory.api'
import { itemImage } from '../../shared/assets/shop/shop-images'
import { ARMOR_SLOT_LABELS } from '../../shared/types/api.types'
import './worn-gear.css'

/** Что надето — крупными картинками перед боем (обещание игрокам 22.10:
    «практически не видно, что одето»). Почти сломанная вещь — красным. */
export function WornGear() {
  const { data } = useQuery({ queryKey: ['inventory'], queryFn: () => inventoryApi.getItems() })
  const items = Array.isArray(data) ? data : []
  const worn = items.filter(i => i.isEquipped && i.status !== 'DELETED' && i.template.type !== 'CONSUMABLE')
  return (
    <div className="worn-gear" aria-label="На вас надето">
      <span className="worn-gear__title">На вас:</span>
      {worn.length === 0 && <span className="worn-gear__none">ничего не надето — <Link to="/inventory">на Склад</Link></span>}
      {worn.map(item => {
        const low = item.durabilityMax > 0 && item.durabilityCurrent <= item.durabilityMax * 0.2
        const slot = item.armorSlot ? ARMOR_SLOT_LABELS[item.armorSlot] ?? item.armorSlot : ''
        return (
          <Link key={item.id} to="/inventory" className={'worn-gear__item' + (low ? ' is-low' : '')}
            title={`${item.template.name}${slot ? ` · ${slot}` : ''} · прочность ${item.durabilityCurrent}/${item.durabilityMax}`}>
            <img src={itemImage(item.template.code, item.template.weaponType, item.template.type)} alt={item.template.name} />
            <small>{item.durabilityCurrent}/{item.durabilityMax}</small>
          </Link>
        )
      })}
    </div>
  )
}
