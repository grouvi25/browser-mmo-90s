// =============================================================
// Письма игры в её стиле: бумага, машинописный шрифт, красный штамп
// «КООПЕРАТИВ». Вёрстка таблицами и стилями в строке — так её одинаково
// показывают Gmail, Яндекс и Mail.ru; внешних картинок и шрифтов нет.
// =============================================================

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const PAPER = '#f3e8d6'
const INK = '#2a211a'
const RED = '#9b1c1c'
const DIM = '#6b5b4a'
const TYPE = "'Courier New', Courier, monospace"

/** Письмо с кодом из 6 цифр: вход сотрудника и другие подтверждения. */
export function codeEmail(input: {
  /** Кому: ник. */
  who: string
  /** Зачем код — одной строкой, например «вход в панель управления». */
  purpose: string
  code: string
  minutes: number
}): { subject: string; text: string; html: string } {
  const subject = `Код ${input.code} — ${input.purpose}`
  const text = [
    `${input.who}, здравствуйте!`,
    '',
    `Ваш код: ${input.code}`,
    `Назначение: ${input.purpose}. Код действует ${input.minutes} минут.`,
    '',
    'Если вы ничего не запрашивали — просто удалите письмо: без кода войти нельзя.',
    '',
    'Кооператив — kooperativ.space',
  ].join('\n')

  const digits = input.code.split('').map(d =>
    `<td style="width:42px;height:54px;border:2px solid ${INK};background:#fffaf0;font:bold 30px/54px ${TYPE};color:${INK};text-align:center;">${escape(d)}</td>`,
  ).join('<td style="width:6px;"></td>')

  const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head>
<body style="margin:0;padding:0;background:#d9c9ae;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#d9c9ae;padding:24px 8px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:${PAPER};border:1px solid #b9a382;box-shadow:0 6px 18px rgba(0,0,0,.18);">
    <tr><td style="padding:22px 26px 6px;border-bottom:3px double ${INK};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font:bold 24px/1 ${TYPE};letter-spacing:4px;color:${INK};">КООПЕРАТИВ</td>
        <td align="right"><span style="display:inline-block;padding:4px 9px;border:2px solid ${RED};color:${RED};font:bold 12px/1 ${TYPE};letter-spacing:2px;transform:rotate(-6deg);">СЕКРЕТНО</span></td>
      </tr></table>
      <p style="margin:8px 0 12px;font:13px/1.4 ${TYPE};color:${DIM};">Телеграмма от администрации · kooperativ.space</p>
    </td></tr>
    <tr><td style="padding:22px 26px 8px;font:15px/1.55 ${TYPE};color:${INK};">
      <p style="margin:0 0 12px;">${escape(input.who)}, здравствуйте!</p>
      <p style="margin:0 0 18px;">Ваш код — ${escape(input.purpose)}. ТЧК. Никому его не сообщайте. ТЧК.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 18px;"><tr>${digits}</tr></table>
      <p style="margin:0 0 6px;font-size:13px;color:${DIM};">Код действует ${input.minutes} минут.</p>
      <p style="margin:0 0 6px;font-size:13px;color:${DIM};">Если вы ничего не запрашивали — просто удалите письмо: без кода войти нельзя.</p>
    </td></tr>
    <tr><td style="padding:14px 26px 20px;border-top:1px dashed #b9a382;font:12px/1.4 ${TYPE};color:${DIM};">
      Письмо отправлено автоматически, отвечать на него не нужно.
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`
  return { subject, text, html }
}
