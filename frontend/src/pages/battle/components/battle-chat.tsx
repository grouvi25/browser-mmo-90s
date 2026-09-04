// =============================================================
// Чат боевого экрана.
//
// Макет рисует его внизу: плашка сообщений 0…633 по ширине и список
// онлайна справа, вместе 1312…1600 по высоте сцены. Транспорта под
// чат на бэкенде пока нет — он в Этапе 3, — поэтому лента та же
// демонстрационная, что и в городе. Появится сокет-канал — меняется
// только источник данных, вёрстка остаётся.
//
// Чат по умолчанию свёрнут: сцена от этого короче, а значит крупнее —
// поле, панели бойцов и журнал получают всё освободившееся место.
// Развёрнутый чат НИЧЕГО не двигает: сцена остаётся той же высоты, а
// панель всплывает от нижнего края поверх журнала, как шторка.
// =============================================================
import { DEMO_CHAT, DEMO_ONLINE } from '../../../widgets/city-feed/city-feed'

/** Высота сцены боя. Постоянная: и со свёрнутым чатом, и с развёрнутым.
 *  Раньше открытый чат растягивал сцену до 1600, и вся вёрстка ужималась
 *  под окно — контент прыгал при каждом переключении. */
export const BATTLE_SCENE_H = 1312

export function BattleChat({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <section className={`bs-chat${open ? ' is-open' : ''}`} aria-label="Чат">
      <button
        type="button"
        className="bs-chat__toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        {open ? 'Свернуть чат' : 'Чат'}
      </button>

      {open && (
        <div className="bs-chat__body">
          <div className="bs-chat__feed">
            {DEMO_CHAT.map(message => (
              <p key={message.id} className="bs-chat__row">
                <span className="bs-chat__time">[{message.time}]</span>{' '}
                <span className={`bs-chat__nick city-chat__nick--${message.tone}`}>{message.nick}:</span>{' '}
                {message.text}
              </p>
            ))}
          </div>

          <div className="bs-chat__online">
            <div className="bs-chat__online-title">Игроки онлайн: {DEMO_ONLINE.length}</div>
            <ul>
              {DEMO_ONLINE.map(player => (
                <li key={player.nick}>
                  <span>{player.nick}</span>
                  <b className={`online-lvl online-lvl--${player.tone}`}>{player.level}</b>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  )
}
