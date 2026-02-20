import { t } from '@lingui/core/macro'
import { getSessionKey } from '../session/store'
import { getHelpText, parseCommand } from './commands'
import type {
  BotSession,
  ChatMode,
  CodexTurnResult,
  HandleIncomingTextInput,
  OpenProjectsResult,
} from '../core/types'

const MAX_SESSION_TITLE_LENGTH = 24

export interface HandleIncomingTextDeps {
  createThread: (mode: ChatMode) => Promise<BotSession>
  runTurn: (params: {
    prompt: string
    mode: ChatMode
    session: BotSession | null
  }) => Promise<CodexTurnResult>
  getSession: (sessionKey: string) => BotSession | undefined
  setSession: (sessionKey: string, session: BotSession) => void
  clearSession: (sessionKey: string) => void
  withSessionLock: <T>(sessionKey: string, run: () => Promise<T>) => Promise<T>
  listOpenProjects: () => Promise<OpenProjectsResult>
}

export async function handleIncomingText(
  input: HandleIncomingTextInput,
  deps: HandleIncomingTextDeps,
): Promise<string> {
  const sessionKey = getSessionKey({
    chatType: input.chatType,
    chatId: input.chatId,
    userId: input.senderId,
  })

  return deps.withSessionLock(sessionKey, async () => {
    const parsed = parseCommand(input.text)
    const currentSession = deps.getSession(sessionKey)

    if (parsed.type === 'invalid') {
      return parsed.message
    }

    if (parsed.type === 'help') {
      return getHelpText()
    }

    if (parsed.type === 'status') {
      if (!currentSession) {
        return t`No active session. Send a normal message or use /new to create one.`
      }

      const title =
        normalizeSessionTitle(currentSession.title) ?? t`New Session`

      return [
        t`Current session status:`,
        t`thread: ${currentSession.threadId}`,
        t`title: ${title}`,
        t`mode: ${currentSession.mode}`,
        t`model: ${currentSession.model}`,
      ].join('\n')
    }

    if (parsed.type === 'projects') {
      try {
        const result = await deps.listOpenProjects()
        if (result.roots.length === 0) {
          return t`No working directories are currently open.`
        }

        const lines = result.roots.map(
          (root, index) => t`${index + 1}. ${root}`,
        )
        return [t`Current working directories:`, ...lines].join('\n')
      } catch (error) {
        return formatProjectsError(error)
      }
    }

    if (parsed.type === 'reset') {
      deps.clearSession(sessionKey)
      return t`Current session has been cleared.`
    }

    if (parsed.type === 'mode') {
      if (!currentSession) {
        return t`No active session. Send a normal message or use /new to create one first.`
      }

      deps.setSession(sessionKey, {
        ...currentSession,
        mode: parsed.mode,
      })

      return t`Switched to ${parsed.mode} mode.`
    }

    if (parsed.type === 'new') {
      try {
        const created = await deps.createThread(parsed.mode)
        deps.setSession(sessionKey, created)
        return [
          t`Created a new session.`,
          t`thread: ${created.threadId}`,
          t`cwd: ${created.cwd}`,
          t`mode: ${created.mode}`,
          t`model: ${created.model}`,
        ].join('\n')
      } catch (error) {
        return formatCodexError(error)
      }
    }

    try {
      const mode = currentSession?.mode ?? 'default'
      const result = await deps.runTurn({
        prompt: parsed.prompt,
        mode,
        session: currentSession ?? null,
      })

      const title = await resolveSessionTitle({
        currentSession,
        prompt: parsed.prompt,
      })

      deps.setSession(sessionKey, {
        threadId: result.threadId,
        model: result.model,
        mode: result.mode,
        cwd: result.cwd,
        title,
      })
      return result.message
    } catch (error) {
      return formatCodexError(error)
    }
  })
}

function formatCodexError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return t`Codex execution failed: ${error.message}`
  }

  return t`Codex execution failed. Please try again later.`
}

function formatProjectsError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return t`Failed to read open projects: ${error.message}`
  }

  return t`Failed to read open projects. Please try again later.`
}

async function resolveSessionTitle(input: {
  currentSession: BotSession | undefined
  prompt: string
}): Promise<string | undefined> {
  const currentTitle = normalizeSessionTitle(input.currentSession?.title)
  if (currentTitle) {
    return currentTitle
  }

  if (!input.currentSession) {
    return undefined
  }

  return buildFallbackSessionTitle(input.prompt)
}

function buildFallbackSessionTitle(prompt: string): string {
  const normalizedPrompt = normalizePrompt(prompt)
  if (normalizedPrompt.length === 0) {
    return t`New Session`
  }

  return truncateTitle(normalizedPrompt)
}

function normalizeSessionTitle(title: string | undefined): string | null {
  if (!title) {
    return null
  }

  const normalized = title.trim()
  if (normalized.length === 0) {
    return null
  }

  return normalized
}

function truncateTitle(input: string): string {
  const chars = Array.from(input)
  if (chars.length <= MAX_SESSION_TITLE_LENGTH) {
    return input
  }

  if (MAX_SESSION_TITLE_LENGTH <= 3) {
    return chars.slice(0, MAX_SESSION_TITLE_LENGTH).join('')
  }

  return `${chars.slice(0, MAX_SESSION_TITLE_LENGTH - 3).join('')}...`
}

function normalizePrompt(input: string): string {
  return input.replace(/\s+/g, ' ').trim()
}
