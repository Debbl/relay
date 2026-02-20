import { CodexAppServerClient } from './app-server-client'
import {
  getCollaborationModes,
  initializeClient,
  openThread,
  selectCollaborationModePayload,
  startThread,
} from './thread'
import {
  applyTurnNotification,
  createTurnAccumulator,
  resolveTurnMessage,
} from './turn-state'
import type { BotSession, ChatMode, CodexTurnResult } from '../core/types'

export { formatRpcError, parseRpcLine } from './rpc'
export {
  applyTurnNotification,
  createTurnAccumulator,
  resolveTurnMessage,
} from './turn-state'

const DEFAULT_CODEX_BIN = 'codex'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

export interface RunCodexTurnInput {
  prompt: string
  mode: ChatMode
  session: BotSession | null
  cwd: string
  codexBin?: string
  timeoutMs?: number
}

export interface CreateCodexThreadInput {
  mode: ChatMode
  cwd: string
  codexBin?: string
  timeoutMs?: number
}

export async function createCodexThread(
  input: CreateCodexThreadInput,
): Promise<BotSession> {
  const client = new CodexAppServerClient({
    cwd: input.cwd,
    codexBin: input.codexBin ?? DEFAULT_CODEX_BIN,
  })

  try {
    return await runWithOptionalTimeout(
      async () => {
        await initializeClient(client)
        const opened = await startThread(client, input.cwd)
        return {
          threadId: opened.threadId,
          model: opened.model,
          mode: input.mode,
          cwd: opened.cwd,
        }
      },
      input.timeoutMs,
      () => client.dispose(),
    )
  } finally {
    client.dispose()
  }
}

export async function runCodexTurn(
  input: RunCodexTurnInput,
): Promise<CodexTurnResult> {
  const client = new CodexAppServerClient({
    cwd: input.cwd,
    codexBin: input.codexBin ?? DEFAULT_CODEX_BIN,
  })

  const accumulator = createTurnAccumulator()
  const turnDone = createDeferred<void>()
  let turnDoneResolved = false

  client.setNotificationHandler((notification) => {
    applyTurnNotification(accumulator, notification)
    if (accumulator.turnCompleted && !turnDoneResolved) {
      turnDoneResolved = true
      turnDone.resolve()
    }
  })

  try {
    return await runWithOptionalTimeout(
      async () => {
        await initializeClient(client)
        const modeMasks = await getCollaborationModes(client)
        const opened = await openThread(client, input.session, input.cwd)
        const collaborationMode = selectCollaborationModePayload(
          modeMasks,
          input.mode,
          opened.model,
        )

        await client.request('turn/start', {
          threadId: opened.threadId,
          input: [
            {
              type: 'text',
              text: input.prompt,
              text_elements: [],
            },
          ],
          collaborationMode,
        })

        await turnDone.promise

        if (accumulator.turnError) {
          throw new Error(accumulator.turnError)
        }

        const message = resolveTurnMessage(accumulator)
        if (!message || message.trim().length === 0) {
          throw new Error('Codex did not return a message')
        }

        return {
          threadId: opened.threadId,
          model: opened.model,
          mode: input.mode,
          message,
          cwd: opened.cwd,
        }
      },
      input.timeoutMs,
      () => {
        if (!turnDoneResolved) {
          turnDoneResolved = true
          turnDone.reject(new Error('Codex execution timed out'))
        }
        client.dispose()
      },
    )
  } finally {
    client.dispose()
  }
}

async function runWithOptionalTimeout<T>(
  run: () => Promise<T>,
  timeoutMs: number | undefined,
  onTimeout: () => void,
): Promise<T> {
  if (typeof timeoutMs !== 'number' || timeoutMs <= 0) {
    return run()
  }

  return withTimeout(run, timeoutMs, onTimeout)
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })

  return { promise, resolve, reject }
}

async function withTimeout<T>(
  run: () => Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      onTimeout()
      reject(new Error(`Codex request timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })

  try {
    return await Promise.race([run(), timeoutPromise])
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }
  }
}
