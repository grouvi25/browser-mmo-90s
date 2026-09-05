// =============================================================
// Одна точка доступа к сокет-серверу.
//
// Маршруты не должны знать про socket.io: им нужно только «объявить в
// комнату». Пока сервер не поднят — а в интеграционных тестах он не
// поднимается, — публикация молча ничего не делает, и HTTP-часть
// проверяется без реального веб-сокета.
// =============================================================
import type { Server } from 'socket.io'

let server: Server | null = null

export function setRealtimeServer(instance: Server | null): void {
  server = instance
}

export function publish(room: string, event: string, payload: unknown): void {
  server?.to(room).emit(event, payload)
}
