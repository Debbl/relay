import { HELP_TEXT, parseCommand } from './commands'
import { getSessionKey } from './session-store'
import type {
  BotSession,
  ChatMode,
  CodexTurnResult,
  HandleIncomingTextInput,
} from './types'

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

      return [
        '当前会话状态:',
        `thread: ${currentSession.threadId}`,
        `mode: ${currentSession.mode}`,
        `model: ${currentSession.model}`,
      ].join('\n')
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
      deps.setSession(sessionKey, {
        threadId: result.threadId,
        model: result.model,
        mode: result.mode,
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
