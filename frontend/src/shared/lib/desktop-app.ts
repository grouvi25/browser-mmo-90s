// Программа для ПК (18.11): установщик лежит на сервере рядом с сайтом, nginx /download/.
// Предлагаем её только на Windows в обычном браузере: внутри самой программы и на
// телефоне пункт не нужен.
export const DESKTOP_INSTALLER = '/download/Kooperativ-Setup.exe'

export const offerDesktop = typeof navigator !== 'undefined'
  && /Windows/.test(navigator.userAgent) && !/KooperativDesktop|Mobile/.test(navigator.userAgent)

export function downloadDesktop() {
  window.location.assign(DESKTOP_INSTALLER)
}
