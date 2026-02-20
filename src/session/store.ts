import type { BotSession, SessionKeyInput } from '../core/types'

const sessionStore = new Map<string, BotSession>()
const sessionQueue = new Map<string, Promise<void>>()

export function getSessionKey(input: SessionKeyInput): string {
  if (input.chatType === 'p2p') {
    return `p2p:${input.chatId}`
  }

  return `group:${input.chatId}:${input.userId}`
}

export function getSession(sessionKey: string): BotSession | undefined {
  return sessionStore.get(sessionKey)
}

export function setSession(sessionKey: string, session: BotSession): void {
  sessionStore.set(sessionKey, session)
}

export function clearSession(sessionKey: string): void {
  sessionStore.delete(sessionKey)
}

export async function withSessionLock<T>(
  sessionKey: string,
  run: () => Promise<T>,
): Promise<T> {
  const previous = sessionQueue.get(sessionKey) ?? Promise.resolve()
  const running = previous.then(
    () => run(),
    () => run(),
  )
  const queueItem = running.then(
    () => undefined,
    () => undefined,
  )

  sessionQueue.set(sessionKey, queueItem)

  try {
    return await running
  } finally {
    if (sessionQueue.get(sessionKey) === queueItem) {
      sessionQueue.delete(sessionKey)
    }
  }
}

export function resetSessionStore(): void {
  sessionStore.clear()
  sessionQueue.clear()
}
