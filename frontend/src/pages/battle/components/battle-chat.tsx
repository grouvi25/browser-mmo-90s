// =============================================================
// Чат боевого экрана.
//
// Макет рисует его внизу: плашка сообщений 0…633 по ширине и список
// онлайна справа, вместе 1312…1600 по высоте сцены. Транспорта под
// чат на бэкенде пока нет — он в Этапе 3, — поэтому лента та же
// демонстрационная, что и в городе. Появится сокет-канал — меняется
// только источник данных, вёрстка остаётся.
//
// Чат сворачивается, и это не украшение: свёрнутый он укорачивает
// сцену с 1600 до 1312, а значит поднимает её масштаб. Развёрнутый
// ложится поверх журнала боя, а не раздвигает его.
// =============================================================
import { DEMO_CHAT, DEMO_ONLINE } from '../../../widgets/city-feed/city-feed'

export const CHAT_SCENE_TOP = 1312

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
