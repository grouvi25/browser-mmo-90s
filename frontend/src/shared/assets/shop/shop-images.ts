import amulet from './amulet.svg';import fists from'./weapon_fists.webp';import knife from'./weapon_knife_basic.webp';import pipe from'./weapon_pipe_basic.webp';import pm from'./weapon_pistol_pm.webp';import shotgun from'./weapon_shotgun_basic.webp';import jacket from'./armor_jacket_basic.webp';import cap from'./armor_cap_basic.webp';import jeans from'./armor_jeans_basic.webp';import boots from'./armor_boots_basic.webp';import vest from'./armor_vest_basic.webp';import bandage from'./consumable_bandage.webp';import aid from'./consumable_first_aid_kit.webp';import energy from'./consumable_energy_drink.webp';
// Иконки брони и одежды от дизайнера (06.11): файл называется кодом вещи и подключается сам.
const DESIGN = import.meta.glob('./{armor,tb_item}_*.webp', { eager: true, import: 'default' }) as Record<string, string>
const BY_CODE: Record<string, string> = Object.fromEntries(Object.entries(DESIGN).map(([path, url]) => [path.slice(2, -'.webp'.length), url]))

export const SHOP_IMAGES:Record<string,string>={...BY_CODE,berezka_experience_amulet:amulet,weapon_fists:fists,weapon_knife_basic:knife,weapon_pipe_basic:pipe,weapon_pistol_pm:pm,weapon_shotgun_basic:shotgun,armor_jacket_basic:jacket,armor_cap_basic:cap,armor_jeans_basic:jeans,armor_boots_basic:boots,armor_vest_basic:vest,consumable_bandage:bandage,consumable_first_aid_kit:aid,consumable_energy_drink:energy}
/** Картинки вещей, загруженные в админке (Дима 09.11): код → версия. Важнее зашитых. */
const API_BASE=(import.meta as ImportMeta&{env:Record<string,string>}).env.VITE_API_BASE_URL||''
const TEMPLATE_IMAGES:Record<string,number>={}
export function setTemplateImage(code:string,version:number|null){if(version)TEMPLATE_IMAGES[code]=version;else delete TEMPLATE_IMAGES[code]}
export function templateImageUrl(code:string):string|undefined{const v=TEMPLATE_IMAGES[code];return v?`${API_BASE}/api/inventory/template-images/${encodeURIComponent(code)}?v=${v}`:undefined}
/** Один запрос при запуске игры: не дождались за 1,5 с — играем с прежними картинками. */
export async function loadTemplateImages():Promise<void>{try{const res=await fetch(`${API_BASE}/api/inventory/template-images`,{signal:AbortSignal.timeout(1500)});if(!res.ok)return;const map=await res.json() as Record<string,number>;for(const [code,v] of Object.entries(map))setTemplateImage(code,v)}catch{/* без своих картинок */}}
export function itemImage(code:string,weaponType?:string|null,itemType?:string|null):string|undefined{return templateImageUrl(code)??SHOP_IMAGES[code]??(weaponType==='SHOTGUN'?shotgun:weaponType==='PISTOL'?pm:['MELEE','KNIFE','CLUB'].includes(weaponType??'')?weaponType==='KNIFE'?knife:weaponType==='CLUB'?pipe:fists:itemType==='ARMOR'||itemType==='SHIELD'?jacket:itemType==='CONSUMABLE'?aid:undefined)}
