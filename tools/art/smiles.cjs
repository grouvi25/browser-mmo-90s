// =============================================================
// Тематические смайлы чата (правка заказчика 21.10: «свой набор эмодзи
// в стиле игры»). Рисунок — тушь и плоская заливка, как у иллюстраций
// сцен; поле 32×32, прозрачный фон.
//
// Запуск: node tools/art/smiles.cjs
// Пишет frontend/src/shared/assets/smiles/<код>.svg. Список кодов и подписей
// — в frontend/src/shared/ui/smiles.ts; новый смайл добавляется в оба места.
// =============================================================
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, '../../frontend/src/shared/assets/smiles')
const INK = '#241b14'
const W = 1.5
// Обводка у всего рисунка одна: тушь, скруглённые стыки.
const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="${INK}" stroke-width="${W}" stroke-linejoin="round" stroke-linecap="round">${body}</svg>\n`

const SKIN = '#e9b48a'
const YELLOW = '#f0c548'
const GOLD = '#d9a520'
const STEEL = '#b4bbbf'

// Лицо-смайл: круг и блик акварели.
const face = (fill, inner) => `<circle cx="16" cy="16" r="13" fill="${fill}"/><path d="M8 11 Q11 6.5 16 6" stroke="#fff" stroke-opacity=".55" stroke-width="2"/>${inner}`

const SMILES = {
  // Мобила-«кирпич» с антенной.
  mobila: `<rect x="18" y="1.5" width="2.6" height="7" rx="1" fill="#3b3632"/><rect x="10" y="7" width="12" height="23" rx="2.2" fill="#3b3632"/>
<rect x="12.3" y="9.5" width="7.4" height="5.2" fill="#a9c08a"/>
<g fill="#d9d2c6" stroke-width="1"><rect x="12.3" y="17.3" width="2" height="1.6"/><rect x="15" y="17.3" width="2" height="1.6"/><rect x="17.7" y="17.3" width="2" height="1.6"/>
<rect x="12.3" y="20.5" width="2" height="1.6"/><rect x="15" y="20.5" width="2" height="1.6"/><rect x="17.7" y="20.5" width="2" height="1.6"/>
<rect x="12.3" y="23.7" width="2" height="1.6"/><rect x="15" y="23.7" width="2" height="1.6"/><rect x="17.7" y="23.7" width="2" height="1.6"/></g>`,

  // Пейджер с зелёным экраном.
  pager: `<rect x="10" y="6" width="9" height="4" rx="1" fill="#2e2e33"/><rect x="3.5" y="9" width="25" height="15" rx="3" fill="#2e2e33"/>
<rect x="6.5" y="12" width="14.5" height="7" fill="#9fbf8a"/><path d="M8.5 14.5 H18.5 M8.5 17 H15" stroke-width="1.1"/>
<circle cx="24.6" cy="15.5" r="1.8" fill="#c8352f"/>`,

  // Аудиокассета.
  kasseta: `<rect x="2.5" y="7" width="27" height="19" rx="2" fill="#2b2b2b"/><rect x="5" y="9.3" width="22" height="9" fill="#e8d7b0"/>
<path d="M5 12 H27" stroke="#c8352f" stroke-width="1.2"/><rect x="10" y="13.4" width="12" height="4" rx="2" fill="#6b4a2a" stroke-width="1"/>
<circle cx="12.2" cy="15.4" r="1.6" fill="#f2efe8" stroke-width="1"/><circle cx="19.8" cy="15.4" r="1.6" fill="#f2efe8" stroke-width="1"/>
<path d="M8.5 26 L10.5 21.5 H21.5 L23.5 26" fill="#444"/>`,

  // Пачка денег под резинкой.
  bablo: `<rect x="3.5" y="13" width="25" height="12" rx="1" fill="#5f8a4a"/><path d="M3.5 20.5 H28.5 M3.5 23 H28.5" stroke-width="1"/>
<rect x="3.5" y="8.5" width="25" height="12" rx="1" fill="#86b06a"/><ellipse cx="16" cy="14.5" rx="4.2" ry="3.6" fill="#a9cd8c"/>
<path d="M17.4 12.6 Q16 11.6 14.8 12.6 Q14 13.8 16 14.5 Q18 15.2 17.2 16.4 Q16 17.4 14.6 16.4 M16 11 V18" stroke-width="1.1"/>
<rect x="21.5" y="7.5" width="3" height="18.5" fill="#c9473b" stroke-width="1.1"/>`,

  // Ваучер.
  vaucher: `<rect x="2.5" y="7.5" width="27" height="17" fill="#e9dcc0"/><rect x="5" y="10" width="22" height="12" fill="none" stroke="#7a5a3a" stroke-width="1"/>
<path d="M7.5 13 H18 M7.5 16 H16 M7.5 19 H14" stroke="#7a5a3a" stroke-width="1.2"/>
<circle cx="22.5" cy="17.5" r="3.2" fill="#d9c7a0" stroke="#a3262a" stroke-width="1.2"/><path d="M21 17.5 H24" stroke="#a3262a" stroke-width="1.1"/>`,

  // Голда: толстая цепь с медальоном.
  golda: `<path d="M4 4 Q5 21 16 22 Q27 21 28 4" stroke="${GOLD}" stroke-width="4.5"/><path d="M4 4 Q5 21 16 22 Q27 21 28 4" stroke="${INK}" stroke-width="1.1" stroke-dasharray="2.4 2.2"/>
<circle cx="16" cy="25.5" r="4.3" fill="${GOLD}"/><circle cx="16" cy="25.5" r="2.2" fill="#f3d36b" stroke-width="1"/>`,

  // Малиновый пиджак.
  pidzhak: `<path d="M5.5 30 L7.5 12 L13 6.5 L16 13 L19 6.5 L24.5 12 L26.5 30 Z" fill="#b3203f"/>
<path d="M13 6.5 L16 13 L19 6.5 Z" fill="#f3efe6"/><path d="M15 8.5 L16 13 L17 8.5" fill="#241b14" stroke-width="1"/>
<path d="M13 6.5 L11.6 16.5 L16 13 Z M19 6.5 L20.4 16.5 L16 13 Z" fill="#8e1530"/>
<circle cx="16" cy="20" r="1" fill="${GOLD}" stroke-width="1"/><circle cx="16" cy="24.5" r="1" fill="${GOLD}" stroke-width="1"/>
<path d="M9.5 21.5 H13" stroke-width="1.2"/>`,

  // «Девятка» цвета вишни.
  devyatka: `<path d="M2.5 22 L4 16.5 L10.5 15 L14.5 10 L23 10 L27 15 L29.5 16.3 L29.5 22 Z" fill="#7a1f2b"/>
<path d="M15.8 11.5 L22.4 11.5 L25.3 15 L13 15 Z" fill="#bcd3df" stroke-width="1.1"/><path d="M19 11.5 V15" stroke-width="1.1"/>
<path d="M4 18.5 H7" stroke="#f3e2a0" stroke-width="1.6"/>
<circle cx="9" cy="22" r="3.4" fill="#222"/><circle cx="9" cy="22" r="1.3" fill="#9a9a9a" stroke-width="1"/>
<circle cx="23" cy="22" r="3.4" fill="#222"/><circle cx="23" cy="22" r="1.3" fill="#9a9a9a" stroke-width="1"/>`,

  // Кулёк семечек из газеты.
  semki: `<path d="M7 9 L25 9 L16 30 Z" fill="#e8dcc4"/><path d="M10 13 H22 M11.5 16.5 H20.5 M13 20 H19" stroke="#8a7a6a" stroke-width="1"/>
<g fill="#2a2420" stroke="#f0e6d6" stroke-width=".7"><ellipse cx="10.5" cy="7.5" rx="1.3" ry="2" transform="rotate(-25 10.5 7.5)"/><ellipse cx="14" cy="6.5" rx="1.3" ry="2" transform="rotate(15 14 6.5)"/>
<ellipse cx="17.5" cy="7" rx="1.3" ry="2" transform="rotate(-10 17.5 7)"/><ellipse cx="21" cy="7.6" rx="1.3" ry="2" transform="rotate(30 21 7.6)"/><ellipse cx="15.8" cy="4.2" rx="1.3" ry="2" transform="rotate(70 15.8 4.2)"/></g>`,

  // Бутылка пива.
  pivo: `<rect x="13.6" y="1.8" width="4.8" height="2.4" rx=".6" fill="${GOLD}"/><path d="M14.2 4.2 H17.8 V10 Q20 11.2 20 13.5 V28 Q20 29.6 18.4 29.6 H13.6 Q12 29.6 12 28 V13.5 Q12 11.2 14.2 10 Z" fill="#7a4a1c"/>
<rect x="12" y="16.5" width="8" height="7" fill="#e9d9a8"/><path d="M13.8 19 H18.2 M14.5 21.2 H17.5" stroke="#a3262a" stroke-width="1"/>
<path d="M14 13 V27" stroke="#fff" stroke-opacity=".45" stroke-width="1.2"/>`,

  // Кастет.
  kastet: `<path fill-rule="evenodd" fill="${STEEL}" d="M8 9.5 H24 A4.5 4.5 0 0 1 28.5 14 V15 A4.5 4.5 0 0 1 24 19.5 H8 A4.5 4.5 0 0 1 3.5 15 V14 A4.5 4.5 0 0 1 8 9.5 Z
M8.5 12.2 a2.3 2.3 0 1 0 .01 0 Z M13.5 12.2 a2.3 2.3 0 1 0 .01 0 Z M18.5 12.2 a2.3 2.3 0 1 0 .01 0 Z M23.5 12.2 a2.3 2.3 0 1 0 .01 0 Z"/>
<path d="M9 19.5 Q16 29 23 19.5" fill="#9aa1a5"/>`,

  // Нож-бабочка.
  babochka: `<path d="M3.5 28.5 L16.5 15.5 Q20.5 11.5 25 11 Q23.6 14.6 19.8 18.6 L6.5 30 Z" fill="#d4dade"/><path d="M7 27.5 L18 16.5" stroke="#fff" stroke-opacity=".7" stroke-width="1"/>
<path d="M20.2 12.4 L26.4 3.2 L28.3 4.6 L22.4 14.2 Z" fill="#3a3a3a"/><path d="M22.6 14.4 L29.4 6.6 L30.6 8.4 L24.2 16 Z" fill="#5a5a5a"/><circle cx="21.6" cy="14.6" r="1" fill="#b4bbbf" stroke-width="1"/>`,

  // Респект: кулак.
  respekt: `<rect x="9" y="25" width="12" height="6" fill="#23408a"/><path d="M11.5 25 V31 M18.5 25 V31" stroke="#f3efe6" stroke-width="1.2"/>
<rect x="7.5" y="9" width="17" height="16" rx="4.5" fill="${SKIN}"/><path d="M11.8 9.4 V15.5 M16 9 V15.5 M20.2 9.4 V15.5" stroke-width="1.2"/>
<path d="M7.6 17 Q8 14.2 12 15 L17.5 15.8 Q19 17.8 16.8 19.4 L9.8 19.4" fill="${SKIN}"/>`,

  // Крутой: тёмные очки и спичка в зубах.
  krutoy: face(YELLOW, `<path d="M6 13 H26 L25 17.5 Q23.5 19.5 20.5 18.8 Q18 18.2 17.3 15 H14.7 Q14 18.2 11.5 18.8 Q8.5 19.5 7 17.5 Z" fill="#1d1d1d"/>
<path d="M11 23 Q16 25 21 22" /><path d="M20 23 L26.5 26" stroke="#e8d5a0" stroke-width="1.4"/><circle cx="26.8" cy="26.2" r="1" fill="#c8352f" stroke="none"/>`),

  // Браток: бритый, щетина, хмурый.
  bratok: `<ellipse cx="5.6" cy="17" rx="2.2" ry="3" fill="${SKIN}"/><ellipse cx="26.4" cy="17" rx="2.2" ry="3" fill="${SKIN}"/>
<path d="M16 3.5 Q26 3.5 26 15 Q26 28.5 16 28.5 Q6 28.5 6 15 Q6 3.5 16 3.5 Z" fill="${SKIN}"/>
<path d="M7.2 19 Q8 28 16 28.2 Q24 28 24.8 19 Q20 22.5 16 22.5 Q12 22.5 7.2 19 Z" fill="#7a6a5a" fill-opacity=".35" stroke="none"/>
<path d="M9.5 12.5 L13.5 13.5 M22.5 12.5 L18.5 13.5" stroke-width="1.8"/><circle cx="12" cy="16" r="1.1" fill="${INK}"/><circle cx="20" cy="16" r="1.1" fill="${INK}"/>
<path d="M12.5 23 H19.5"/>`,

  // Ржака: глаза щёлочками, рот нараспашку, слёзы.
  rzhaka: face(YELLOW, `<path d="M8.5 13.5 Q11 10.5 13.5 13.5 M18.5 13.5 Q21 10.5 23.5 13.5"/><path d="M8.5 18 H23.5 Q23 26 16 26 Q9 26 8.5 18 Z" fill="#7a1f2b"/>
<path d="M10.5 18 H21.5 V19.6 H10.5 Z" fill="#fff" stroke-width="1"/><path d="M5.5 15 Q4 18 5.8 19.5 Q7.5 18 5.5 15 Z M26.5 15 Q28 18 26.2 19.5 Q24.5 18 26.5 15 Z" fill="#7fb6e0" stroke-width="1"/>`),

  // Злой.
  zloy: face('#e0703a', `<path d="M8.5 11 L13.5 13.5 M23.5 11 L18.5 13.5" stroke-width="2"/><circle cx="12" cy="16.3" r="1.4" fill="${INK}"/><circle cx="20" cy="16.3" r="1.4" fill="${INK}"/>
<path d="M10.5 24 Q16 19.5 21.5 24"/>`),

  // Фуражка милиции.
  furazhka: `<path d="M3 13 Q16 3 29 13 Q29 16 16 16.5 Q3 16 3 13 Z" fill="#3d4f6b"/><path d="M6 15.5 H26 V20 H6 Z" fill="#b22a2a"/>
<path d="M5.5 20 Q16 18.5 26.5 20 Q25 25.5 16 25.5 Q7 25.5 5.5 20 Z" fill="#1d1d1d"/><circle cx="16" cy="12.6" r="2.3" fill="${GOLD}" stroke-width="1"/>`,

  // Браслеты (наручники).
  braslety: `<circle cx="9" cy="19" r="6" fill="none" stroke="${STEEL}" stroke-width="3.6"/><circle cx="9" cy="19" r="6"/>
<circle cx="23" cy="19" r="6" fill="none" stroke="${STEEL}" stroke-width="3.6"/><circle cx="23" cy="19" r="6"/>
<path d="M13.5 13 Q16 9.5 18.5 13" stroke-width="1.3" stroke-dasharray="1.6 1.2"/><rect x="11.4" y="10.6" width="3" height="3.4" rx=".8" fill="${STEEL}" stroke-width="1"/><rect x="17.6" y="10.6" width="3" height="3.4" rx=".8" fill="${STEEL}" stroke-width="1"/>`,

  // Качалка: гантеля.
  kachalka: `<rect x="9" y="14.6" width="14" height="2.8" fill="#9aa1a5"/><rect x="5" y="9" width="4.5" height="14" rx="1" fill="#3a3a3a"/><rect x="22.5" y="9" width="4.5" height="14" rx="1" fill="#3a3a3a"/>
<rect x="2.4" y="11.5" width="2.8" height="9" rx=".8" fill="#3a3a3a"/><rect x="26.8" y="11.5" width="2.8" height="9" rx=".8" fill="#3a3a3a"/>`,

  // Джойстик приставки.
  dendy: `<path d="M4 12 Q4 9 7 9 H25 Q28 9 28 12 V20 Q28 23.5 24.5 23.5 H7.5 Q4 23.5 4 20 Z" fill="#d8d4cc"/>
<path d="M8 13.5 H10.5 V11 H12.5 V13.5 H15 V15.5 H12.5 V18 H10.5 V15.5 H8 Z" fill="#2a2a2a" stroke-width="1"/>
<circle cx="21" cy="16.8" r="1.8" fill="#c8352f" stroke-width="1"/><circle cx="25" cy="14.4" r="1.8" fill="#c8352f" stroke-width="1"/>
<path d="M15.5 20 H17.5 M18.5 20 H20.5" stroke-width="1.4"/><path d="M16 9 Q16 5 21 4.5" stroke-width="1.2"/>`,

  // Тетрис: падающая фигура и стакан.
  tetris: `<g stroke-width="1.1"><rect x="10" y="3" width="5" height="5" fill="#c8352f"/><rect x="15" y="3" width="5" height="5" fill="#c8352f"/><rect x="20" y="3" width="5" height="5" fill="#c8352f"/><rect x="15" y="8" width="5" height="5" fill="#c8352f"/>
<rect x="5" y="23" width="5" height="5" fill="#2f6bb0"/><rect x="10" y="23" width="5" height="5" fill="#2f6bb0"/><rect x="10" y="18" width="5" height="5" fill="#2f6bb0"/>
<rect x="20" y="23" width="5" height="5" fill="#4b9a3e"/><rect x="25" y="23" width="5" height="5" fill="#4b9a3e"/><rect x="25" y="18" width="5" height="5" fill="#4b9a3e"/><rect x="15" y="23" width="5" height="5" fill="${GOLD}"/></g>`,

  // Жвачка с вкладышем.
  zhvachka: `<rect x="3" y="9" width="26" height="14" rx="1.5" fill="#f08fb3"/><path d="M3 12 H29 M3 20 H29" stroke="#fff" stroke-width="1.6"/>
<path d="M11 13.5 L14 16 L11 18.5 M15 13.5 L18 16 L15 18.5 M19 13.5 L22 16 L19 18.5" stroke="#b3203f" stroke-width="1.6"/>`,

  // Телик с рогами антенны.
  telik: `<path d="M12 8 L7 2.5 M20 8 L25 2.5" stroke-width="1.3"/><rect x="2.5" y="8" width="27" height="20" rx="2" fill="#8a5a32"/>
<rect x="5" y="10.5" width="17" height="15" rx="3" fill="#8fa9b8"/><path d="M7.5 13.5 Q10 12 13 12.6" stroke="#fff" stroke-opacity=".6" stroke-width="1.4"/>
<circle cx="25.8" cy="14" r="1.7" fill="#d9c7a0" stroke-width="1"/><circle cx="25.8" cy="19.5" r="1.7" fill="#d9c7a0" stroke-width="1"/>
<path d="M6 28 V30.5 M26 28 V30.5"/>`,
}

fs.mkdirSync(OUT, { recursive: true })
for (const [code, body] of Object.entries(SMILES)) fs.writeFileSync(path.join(OUT, `${code}.svg`), svg(body))
console.log(`smiles: ${Object.keys(SMILES).length} → ${path.relative(process.cwd(), OUT)}`)
