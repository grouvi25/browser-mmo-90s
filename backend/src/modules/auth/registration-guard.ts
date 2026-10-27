// =============================================================
// Защита входа в игру от массовых регистраций и подбора паролей
// (просьба 28.10: «защита от абуза, массовых регистраций и автоматизаций»).
//
// Слои, от дешёвого к дорогому:
// 1. Почта: без одноразовых ящиков и псевдонимов, домен с почтовым
//    сервером (email-policy.ts).
// 2. Не больше N аккаунтов с одного IP за сутки. Мобильные операторы
//    сажают многих за один адрес, поэтому N — с запасом, а не «один».
// 3. Ловушка: скрытое поле формы, которое человек не видит и не заполняет.
// 4. Капча (Яндекс SmartCaptcha) на регистрации и восстановлении пароля —
//    ТЗ разрешает её только там. Включается ключами в окружении.
// 5. Подбор пароля: после 10 неудач за 15 минут вход в этот логин
//    закрывается на 15 минут — с любого адреса.
// 6. Волна регистраций — сигнал администрации в бот.
//
// IP и почтовый DNS проверяются только на проде: тесты и стенд заводят
// десятки аккаунтов с одного адреса и выдуманных доменов.
// =============================================================
import { getRedis } from '../../shared/db/redis'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { logger } from '../../shared/logger/logger'
import { env } from '../../config/env'
import { sendTelegram, telegramConfigured } from '../admin-balance/telegram.service'
import { checkMailDomain, isDisposableEmail, normalizeEmail } from './email-policy'

const onProd = env.NODE_ENV === 'production'
const flag = (value: string | undefined, fallback: boolean) => value === undefined ? fallback : value === 'on'

export const GuardConfig = {
  /** Аккаунтов с одного IP за сутки; 0 — без предела. */
  ipDailyLimit: env.REGISTRATION_IP_DAILY_LIMIT ?? (onProd ? 5 : 0),
  mxCheck: flag(env.EMAIL_MX_CHECK, onProd),
  loginFailLimit: 10,
  loginFailWindowSec: 15 * 60,
  spikeWindowSec: 10 * 60,
  spikeThreshold: 30,
}

const LOGIN_FAILS = (login: string) => `auth:fail:${login.toLowerCase()}`
const IP_REGS = (ip: string) => `auth:reg:ip:${ip}`

export const RegistrationGuard = {
  /** Почта годится для регистрации? Возвращает нормализованную. */
  async checkEmail(email: string): Promise<string> {
    if (isDisposableEmail(email)) {
      throw new AppError(ErrorCode.AUTH_EMAIL_REJECTED, 'Временная почта не подходит — укажите свою обычную', 422)
    }
    if (GuardConfig.mxCheck && await checkMailDomain(email) === 'no-mail-server') {
      throw new AppError(ErrorCode.AUTH_EMAIL_REJECTED, 'На этот адрес не приходит почта — проверьте, нет ли опечатки', 422)
    }
    return normalizeEmail(email)
  },

  /** Ловушка для ботов: поле, скрытое от человека, должно остаться пустым. */
  checkHoneypot(value: unknown): void {
    if (typeof value === 'string' && value.trim() !== '') {
      throw new AppError(ErrorCode.AUTH_TOO_MANY, 'Не удалось зарегистрироваться, попробуйте позже', 429)
    }
  },

  async checkIpQuota(ip: string | undefined): Promise<void> {
    if (!GuardConfig.ipDailyLimit || !ip) return
    const used = Number(await getRedis().get(IP_REGS(ip)) ?? 0)
    if (used >= GuardConfig.ipDailyLimit) {
      throw new AppError(ErrorCode.AUTH_TOO_MANY, 'С этого адреса сегодня уже зарегистрировано несколько аккаунтов. Попробуйте завтра', 429)
    }
  },

  /** После успешной регистрации: счётчик адреса и сторож волны. */
  async recordRegistration(ip: string | undefined): Promise<void> {
    const redis = getRedis()
    if (ip) {
      const key = IP_REGS(ip)
      const count = await redis.incr(key)
      if (count === 1) await redis.expire(key, 24 * 3600)
    }
    const bucket = Math.floor(Date.now() / 1000 / GuardConfig.spikeWindowSec)
    const spikeKey = `auth:reg:spike:${bucket}`
    const total = await redis.incr(spikeKey)
    if (total === 1) await redis.expire(spikeKey, GuardConfig.spikeWindowSec * 2)
    if (total === GuardConfig.spikeThreshold && telegramConfigured()) {
      // Раз в час, сколько бы волн ни прошло: бот не должен превращаться в спам.
      const first = await redis.set('auth:reg:spike:alerted', '1', 'EX', 3600, 'NX')
      if (first) {
        void sendTelegram(`<b>Волна регистраций</b>\n${total} новых аккаунтов за ${GuardConfig.spikeWindowSec / 60} минут. Если это не реклама — похоже на ботов; загляните в админку («Игроки», «Сигналы»).`)
          .catch(err => logger.warn({ err }, '[Регистрация] Сигнал о волне не ушёл'))
      }
    }
  },

  async assertLoginNotLocked(login: string): Promise<void> {
    const fails = Number(await getRedis().get(LOGIN_FAILS(login)) ?? 0)
    if (fails >= GuardConfig.loginFailLimit) {
      throw new AppError(ErrorCode.AUTH_TOO_MANY, 'Слишком много неверных паролей. Подождите 15 минут или восстановите пароль', 429)
    }
  },

  async recordLoginFailure(login: string): Promise<void> {
    const redis = getRedis()
    const key = LOGIN_FAILS(login)
    const fails = await redis.incr(key)
    if (fails === 1) await redis.expire(key, GuardConfig.loginFailWindowSec)
  },

  async clearLoginFailures(login: string): Promise<void> {
    await getRedis().del(LOGIN_FAILS(login))
  },

  /**
   * Капча. Без ключа в окружении выключена. Сбой самого сервиса капчи
   * игрока не запирает: Яндекс в документации советует считать проверку
   * пройденной, если до него не достучаться, — иначе падение капчи
   * останавливало бы регистрацию целиком.
   */
  async checkCaptcha(token: unknown, ip: string | undefined): Promise<void> {
    if (!env.SMARTCAPTCHA_SERVER_KEY) return
    if (typeof token !== 'string' || token.length < 10) {
      throw new AppError(ErrorCode.AUTH_CAPTCHA, 'Подтвердите, что вы не робот', 400)
    }
    try {
      const body = new URLSearchParams({ secret: env.SMARTCAPTCHA_SERVER_KEY, token, ...(ip ? { ip } : {}) })
      const response = await fetch('https://smartcaptcha.cloud.yandex.ru/validate', {
        method: 'POST', body, signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) {
        logger.warn({ status: response.status }, '[Капча] Сервис ответил ошибкой — пропускаем')
        return
      }
      const result = await response.json() as { status?: string }
      if (result.status !== 'ok') {
        throw new AppError(ErrorCode.AUTH_CAPTCHA, 'Проверка «не робот» не пройдена — попробуйте ещё раз', 400)
      }
    } catch (err) {
      if (err instanceof AppError) throw err
      logger.warn({ err }, '[Капча] Сервис недоступен — пропускаем')
    }
  },
}
