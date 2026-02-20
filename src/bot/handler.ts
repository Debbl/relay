import { getSessionKey } from '../session/store'
import { HELP_TEXT, parseCommand } from './commands'
import type {
  BotSession,
  ChatMode,
  CodexTurnResult,
  HandleIncomingTextInput,
  OpenProjectsResult,
} from '../core/types'

const DEFAULT_SESSION_TITLE = '新会话'
const MAX_SESSION_TITLE_LENGTH = 24

const TITLE_GENERATION_SYSTEM_PROMPT = [
  '你是一个会话标题生成器。',
  '请根据用户消息生成一个简短中文标题。',
  '严格要求：',
  '1. 仅输出标题文本，不要解释。',
  '2. 单行输出，不要换行。',
  '3. 不要使用引号或书名号。',
  '4. 标题长度不超过 24 个字符。',
].join('\n')

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
      return HELP_TEXT
    }

    if (parsed.type === 'status') {
      if (!currentSession) {
        return '当前没有会话。发送普通消息或使用 /new 创建会话。'
      }

      const title = normalizeSessionTitle(currentSession.title)
      return [
        '当前会话状态:',
        `thread: ${currentSession.threadId}`,
        `title: ${title ?? DEFAULT_SESSION_TITLE}`,
        `mode: ${currentSession.mode}`,
        `model: ${currentSession.model}`,
      ].join('\n')
    }

    if (parsed.type === 'projects') {
      try {
        const result = await deps.listOpenProjects()
        if (result.roots.length === 0) {
          return '当前没有工作目录。'
        }

        const lines = result.roots.map((root, index) => `${index + 1}. ${root}`)
        return ['当前工作目录:', ...lines].join('\n')
      } catch (error) {
        return formatProjectsError(error)
      }
    }

    if (parsed.type === 'reset') {
      deps.clearSession(sessionKey)
      return '已清空当前会话。'
    }

    if (parsed.type === 'mode') {
      if (!currentSession) {
        return '当前没有会话，先发送普通消息或使用 /new 创建会话。'
      }

      deps.setSession(sessionKey, {
        ...currentSession,
        mode: parsed.mode,
      })
      return `已切换为 ${parsed.mode} 模式。`
    }

    if (parsed.type === 'new') {
      try {
        const created = await deps.createThread(parsed.mode)
        deps.setSession(sessionKey, created)
        return [
          '已创建新会话。',
          `thread: ${created.threadId}`,
          `cwd: ${created.cwd}`,
          `mode: ${created.mode}`,
          `model: ${created.model}`,
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
    return `Codex 执行失败: ${error.message}`
  }

  return 'Codex 执行失败，请稍后重试。'
}

function formatProjectsError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return `读取打开项目失败: ${error.message}`
  }

  return '读取打开项目失败，请稍后重试。'
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
    return DEFAULT_SESSION_TITLE
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
  return [
    TITLE_GENERATION_SYSTEM_PROMPT,
    '',
    `用户消息: ${normalizePrompt(prompt)}`,
  ].join('\n')
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
