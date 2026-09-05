// =============================================================
// СМЕНА ПАРОЛЯ АДМИНИСТРАТОРА
//
// Сид заводит `admin` с паролем, записанным в открытом виде прямо в
// prisma/seed.ts, и печатает «change password!». Сменить его было нечем:
// в admin-auth есть только вход и выход, ручки смены пароля нет — то есть
// единственным способом оставался ручной UPDATE с bcrypt-хэшем по живой
// базе. Этот скрипт закрывает дыру между «пароль надо сменить» и «сменить
// его нечем».
//
// Пароль нигде не печатается и не принимается аргументом командной
// строки: аргументы видны в списке процессов и оседают в истории шелла.
//
// Запуск:
//   npm run admin:password                 — спросит пароль скрытым вводом
//   npm run admin:password -- --user petya — другой администратор
//   npm run admin:password -- --create     — завести, если такого ещё нет
//
// На проде (пароль вводится в том же окне, в контейнер не передаётся):
//   docker compose -f docker-compose.prod.yml -f docker-compose.vps.yml \
//     run --rm backend npx tsx scripts/set-admin-password.ts
//
// Для автоматизации пароль можно передать в ADMIN_NEW_PASSWORD или на
// stdin — тогда вопросов не задаётся.
// =============================================================
import type { AdminRole } from '@prisma/client'
import { prisma } from '../src/shared/db/prisma'
import { hashPassword } from '../src/shared/security/password'

/** Тот самый пароль из сида: с ним пускать дальше нельзя. */
const SEEDED_PASSWORD = 'admin_change_me_now'

/** Столько же, сколько требует регистрация игрока (auth.schemas). */
const MIN_LENGTH = 6

// Коды управляющих клавиш. Названиями, а не символами в кавычках:
// сами байты в исходнике невидимы и теряются при копировании файла.
const CTRL_C = 3
const CTRL_D = 4
const BACKSPACE = 8
const LF = 10
const CR = 13
const DEL = 127

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`)

/**
 * Скрытый ввод строки. Терминал переводится в посимвольный режим, эхо
 * гасится: пароль не остаётся на экране и не попадает в скроллбек.
 */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = process.stdin
    process.stdout.write(question)
    input.setRawMode(true)
    input.resume()
    input.setEncoding('utf8')

    let value = ''
    const finish = (done: () => void) => {
      input.setRawMode(false)
      input.pause()
      input.off('data', onData)
      process.stdout.write('\n')
      done()
    }
    const onData = (chunk: string) => {
      for (const char of chunk) {
        const code = char.charCodeAt(0)
        if (code === LF || code === CR || code === CTRL_D) {
          return finish(() => resolve(value))
        }
        if (code === CTRL_C) {
          // Ctrl+C — уходим молча, ничего не меняя.
          return finish(() => reject(new Error('Отменено')))
        }
        if (code === BACKSPACE || code === DEL) {
          value = value.slice(0, -1)
          continue
        }
        // Управляющие последовательности (стрелки и прочее) в пароль не
        // пишем: иначе он молча окажется не тем, что набрали.
        if (code >= 32) value += char
      }
    }
    input.on('data', onData)
  })
}

/** Пароль из ADMIN_NEW_PASSWORD или со stdin — для неинтерактивных запусков. */
async function readNonInteractive(): Promise<string | null> {
  const fromEnv = process.env.ADMIN_NEW_PASSWORD
  if (fromEnv) return fromEnv
  if (process.stdin.isTTY) return null

  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  const piped = Buffer.concat(chunks).toString('utf8').trim()
  return piped.length > 0 ? piped : null
}

async function main() {
  const username = arg('user') ?? 'admin'
  const role = (arg('role') ?? 'SUPER_ADMIN') as AdminRole

  const existing = await prisma.adminUser.findUnique({
    where: { username },
    select: { role: true, isActive: true },
  })
  if (!existing && !hasFlag('create')) {
    console.error(`Администратора «${username}» нет. Завести — тот же запуск с --create.`)
    process.exitCode = 1
    return
  }

  let password = await readNonInteractive()
  if (password === null) {
    password = await askHidden(`Новый пароль для «${username}»: `)
    const again = await askHidden('Повторите: ')
    if (password !== again) {
      console.error('Пароли не совпали, ничего не изменено.')
      process.exitCode = 1
      return
    }
  }

  if (password.length < MIN_LENGTH) {
    console.error(`Слишком короткий пароль: нужно хотя бы ${MIN_LENGTH} знаков.`)
    process.exitCode = 1
    return
  }
  // Смысл скрипта — уйти от пароля из сида, а не переписать его им же.
  if (password === SEEDED_PASSWORD) {
    console.error('Это пароль из сида, он лежит в открытом виде в репозитории. Возьмите другой.')
    process.exitCode = 1
    return
  }

  const passwordHash = await hashPassword(password)
  if (existing) {
    await prisma.adminUser.update({ where: { username }, data: { passwordHash } })
    console.log(`Пароль администратора «${username}» изменён (роль ${existing.role}).`)
    if (!existing.isActive) {
      console.log('Учётная запись отключена — вход по ней всё равно не пустит.')
    }
  } else {
    await prisma.adminUser.create({ data: { username, passwordHash, role } })
    console.log(`Администратор «${username}» заведён с ролью ${role}.`)
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => void prisma.$disconnect())
