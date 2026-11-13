// Портреты пород от дизайнера (12.11): файл называется кодом породы и подключается сам.
const FILES = import.meta.glob('./*.webp', { eager: true, import: 'default' }) as Record<string, string>
const BY_CODE: Record<string, string> = Object.fromEntries(Object.entries(FILES).map(([path, url]) => [path.slice(2, -'.webp'.length), url]))

export const dogImage = (code?: string | null): string | undefined => (code ? BY_CODE[code] : undefined)
