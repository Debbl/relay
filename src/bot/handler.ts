import { MESSAGES } from '../i18n/messages'
import { getCurrentLocale, translate } from '../i18n/runtime'
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

const WRAPPING_QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ["'", "'"],
  ['“', '”'],
  ['‘', '’'],
  ['「', '」'],
  ['《', '》'],
]

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
        return translate(MESSAGES.handlerStatusNoSession)
      }

      const title =
        normalizeSessionTitle(currentSession.title) ??
        translate(MESSAGES.handlerDefaultSessionTitle)

      return [
        translate(MESSAGES.handlerStatusHeader),
        translate(MESSAGES.handlerStatusThread, {
          threadId: currentSession.threadId,
        }),
        translate(MESSAGES.handlerStatusTitle, { title }),
        translate(MESSAGES.handlerStatusMode, { mode: currentSession.mode }),
        translate(MESSAGES.handlerStatusModel, {
          model: currentSession.model,
        }),
      ].join('\n')
    }

    if (parsed.type === 'projects') {
      try {
        const result = await deps.listOpenProjects()
        if (result.roots.length === 0) {
          return translate(MESSAGES.handlerProjectsNone)
        }

        const lines = result.roots.map((root, index) =>
          translate(MESSAGES.handlerProjectsItem, {
            index: index + 1,
            root,
          }),
        )

        return [translate(MESSAGES.handlerProjectsHeader), ...lines].join('\n')
      } catch (error) {
        return formatProjectsError(error)
      }
    }

    if (parsed.type === 'reset') {
      deps.clearSession(sessionKey)
      return translate(MESSAGES.handlerResetDone)
    }

    if (parsed.type === 'mode') {
      if (!currentSession) {
        return translate(MESSAGES.handlerModeNoSession)
      }

      deps.setSession(sessionKey, {
        ...currentSession,
        mode: parsed.mode,
      })

      return translate(MESSAGES.handlerModeSwitched, {
        mode: parsed.mode,
      })
    }

    if (parsed.type === 'new') {
      try {
        const created = await deps.createThread(parsed.mode)
        deps.setSession(sessionKey, created)
        return [
          translate(MESSAGES.handlerNewCreated),
          translate(MESSAGES.handlerNewThread, {
            threadId: created.threadId,
          }),
          translate(MESSAGES.handlerNewCwd, {
            cwd: created.cwd,
          }),
          translate(MESSAGES.handlerNewMode, {
            mode: created.mode,
          }),
          translate(MESSAGES.handlerNewModel, {
            model: created.model,
          }),
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
        mode,
        runTurn: deps.runTurn,
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
    return translate(MESSAGES.handlerErrorCodexDetailed, {
      message: error.message,
    })
  }

  return translate(MESSAGES.handlerErrorCodexGeneric)
}

function formatProjectsError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return translate(MESSAGES.handlerErrorProjectsDetailed, {
      message: error.message,
    })
  }

  return translate(MESSAGES.handlerErrorProjectsGeneric)
}

async function resolveSessionTitle(input: {
  currentSession: BotSession | undefined
  prompt: string
  mode: ChatMode
  runTurn: HandleIncomingTextDeps['runTurn']
}): Promise<string | undefined> {
  const currentTitle = normalizeSessionTitle(input.currentSession?.title)
  if (currentTitle) {
    return currentTitle
  }

  if (!input.currentSession) {
    return undefined
  }

  return generateSessionTitleWithFallback({
    prompt: input.prompt,
    mode: input.mode,
    runTurn: input.runTurn,
  })
}

async function generateSessionTitleWithFallback(input: {
  prompt: string
  mode: ChatMode
  runTurn: HandleIncomingTextDeps['runTurn']
}): Promise<string> {
  const fallbackTitle = buildFallbackSessionTitle(input.prompt)
  const titlePrompt = buildTitleGenerationPrompt(input.prompt)

  try {
    const generated = await input.runTurn({
      prompt: titlePrompt,
      mode: input.mode,
      session: null,
    })
    const sanitizedTitle = sanitizeGeneratedTitle(generated.message)
    if (sanitizedTitle) {
      return sanitizedTitle
    }

    logTitleGenerationFallback(
      'generated title is empty after post-processing, using fallback',
    )
  } catch (error) {
    logTitleGenerationFallback(
      `title generation request failed: ${formatErrorMessage(error)}`,
    )
  }

  return fallbackTitle
}

function buildFallbackSessionTitle(prompt: string): string {
  const normalizedPrompt = normalizePrompt(prompt)
  if (normalizedPrompt.length === 0) {
    return translate(MESSAGES.handlerDefaultSessionTitle)
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

function buildTitleGenerationPrompt(prompt: string): string {
  const locale = getCurrentLocale()
  const systemPrompt =
    locale === 'zh'
      ? translate(MESSAGES.handlerTitleSystemPromptZh)
      : translate(MESSAGES.handlerTitleSystemPromptEn)
  const userMessage =
    locale === 'zh'
      ? translate(MESSAGES.handlerTitleUserMessageZh, {
          prompt: normalizePrompt(prompt),
        })
      : translate(MESSAGES.handlerTitleUserMessageEn, {
          prompt: normalizePrompt(prompt),
        })

  return [systemPrompt, '', userMessage].join('\n')
}

function sanitizeGeneratedTitle(rawTitle: string): string | null {
  const trimmed = rawTitle.trim()
  if (trimmed.length === 0) {
    return null
  }

  const firstLine = trimmed.split(/\r?\n/)[0]?.trim() ?? ''
  if (firstLine.length === 0) {
    return null
  }

  const compacted = normalizePrompt(firstLine)
  const unquoted = stripWrappingQuotes(compacted)
  if (unquoted.length === 0) {
    return null
  }

  return truncateTitle(unquoted)
}

function stripWrappingQuotes(input: string): string {
  let value = input.trim()
  let changed = true
  while (changed && value.length > 0) {
    changed = false
    for (const [left, right] of WRAPPING_QUOTE_PAIRS) {
      if (value.startsWith(left) && value.endsWith(right)) {
        const inner = value
          .slice(left.length, value.length - right.length)
          .trim()
        if (inner !== value) {
          value = inner
          changed = true
          break
        }
      }
    }
  }

  return value
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

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return String(error)
}

function logTitleGenerationFallback(message: string): void {
  console.warn(`[relay] ${message}`)
}
