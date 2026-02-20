import { CodexAppServerClient } from './codex-app-server-client'
import { isRecord } from './codex-rpc'
import type {
  BotSession,
  ChatMode,
  CodexTurnResult,
  CollaborationModeListResponse,
  CollaborationModeMask,
  RpcItemCompletedParams,
  RpcNotification,
  RpcTaskCompleteParams,
  RpcTurnCompletedParams,
  ThreadResult,
  TurnAccumulator,
} from './types'

export { formatRpcError, parseRpcLine } from './codex-rpc'

const DEFAULT_CODEX_BIN = 'codex'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

interface OpenThreadResult {
  threadId: string
  cwd: string
  model: string
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

interface CollaborationModePayload {
  mode: ChatMode
  settings: {
    model: string
    reasoning_effort: string | null
    developer_instructions: string | null
  }
}

export function createTurnAccumulator(): TurnAccumulator {
  return {
    turnCompleted: false,
    turnError: null,
    lastAgentMessageByItem: null,
    lastAgentMessageByTask: null,
  }
}

export function applyTurnNotification(
  accumulator: TurnAccumulator,
  notification: RpcNotification<unknown>,
): void {
  if (notification.method === 'error') {
    if (
      isRecord(notification.params) &&
      typeof notification.params.message === 'string'
    ) {
      accumulator.turnError = notification.params.message
    } else {
      accumulator.turnError = 'Codex returned an unknown error event'
    }
    accumulator.turnCompleted = true
    return
  }

  if (notification.method === 'item/completed') {
    const params = notification.params as RpcItemCompletedParams
    const item = params.item
    if (item?.type === 'agentMessage' && typeof item.text === 'string') {
      accumulator.lastAgentMessageByItem = item.text
    }
    return
  }

  if (notification.method === 'codex/event/task_complete') {
    const params = notification.params as RpcTaskCompleteParams
    const message = params.msg?.last_agent_message
    if (typeof message === 'string') {
      accumulator.lastAgentMessageByTask = message
    }
    return
  }

  if (notification.method === 'turn/completed') {
    const params = notification.params as RpcTurnCompletedParams
    accumulator.turnCompleted = true
    if (params.turn?.error?.message) {
      accumulator.turnError = params.turn.error.message
      return
    }

    if (params.turn?.status === 'failed') {
      accumulator.turnError = 'Codex turn failed'
    }
  }
}

export function resolveTurnMessage(
  accumulator: TurnAccumulator,
): string | null {
  return (
    accumulator.lastAgentMessageByTask ?? accumulator.lastAgentMessageByItem
  )
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

async function initializeClient(client: CodexAppServerClient): Promise<void> {
  await client.request('initialize', {
    clientInfo: {
      name: 'relay-bot',
      title: 'Relay Bot',
      version: '0.0.0',
    },
    capabilities: {
      experimentalApi: true,
    },
  })
}

async function getCollaborationModes(
  client: CodexAppServerClient,
): Promise<CollaborationModeMask[]> {
  const raw = await client.request('collaborationMode/list', {})
  if (!isCollaborationModeListResponse(raw)) {
    throw new Error('Invalid collaboration mode response from Codex')
  }

  return raw.data
}

async function openThread(
  client: CodexAppServerClient,
  session: BotSession | null,
  cwd: string,
): Promise<OpenThreadResult> {
  if (!session) {
    return startThread(client, cwd)
  }

  if (session.cwd !== cwd) {
    return startThread(client, cwd)
  }

  try {
    const resumed = await resumeThread(client, session.threadId)
    if (resumed.cwd !== cwd) {
      return startThread(client, cwd)
    }

    return resumed
  } catch (error) {
    if (isThreadMissingError(error)) {
      return startThread(client, cwd)
    }
    throw error
  }
}

async function startThread(
  client: CodexAppServerClient,
  cwd: string,
): Promise<OpenThreadResult> {
  const raw = await client.request('thread/start', {
    cwd,
    approvalPolicy: 'on-request',
    sandbox: 'workspace-write',
    experimentalRawEvents: false,
  })

  return parseThreadResult(raw)
}

async function resumeThread(
  client: CodexAppServerClient,
  threadId: string,
): Promise<OpenThreadResult> {
  const raw = await client.request('thread/resume', {
    threadId,
  })

  return parseThreadResult(raw)
}

function parseThreadResult(raw: unknown): OpenThreadResult {
  if (!isThreadResult(raw)) {
    throw new Error('Invalid thread response from Codex')
  }

  return {
    threadId: raw.thread.id,
    model: raw.model,
    cwd: raw.cwd,
  }
}

function selectCollaborationModePayload(
  masks: CollaborationModeMask[],
  mode: ChatMode,
  model: string,
): CollaborationModePayload {
  const selected = masks.find((mask) => {
    if (mask.mode === mode) {
      return true
    }

    return mask.name.toLowerCase() === mode
  })

  if (!selected) {
    throw new Error(`Collaboration mode "${mode}" is unavailable`)
  }

  return {
    mode,
    settings: {
      model,
      reasoning_effort: selected.reasoning_effort,
      developer_instructions: selected.developer_instructions,
    },
  }
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

function isThreadMissingError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  return error.message.includes('thread not found')
}

function isCollaborationModeMask(
  value: unknown,
): value is CollaborationModeMask {
  if (!isRecord(value)) {
    return false
  }

  const modeIsValid =
    value.mode === null || value.mode === 'default' || value.mode === 'plan'

  return (
    typeof value.name === 'string' &&
    modeIsValid &&
    (typeof value.model === 'string' || value.model === null) &&
    (typeof value.reasoning_effort === 'string' ||
      value.reasoning_effort === null) &&
    (typeof value.developer_instructions === 'string' ||
      value.developer_instructions === null)
  )
}

function isCollaborationModeListResponse(
  value: unknown,
): value is CollaborationModeListResponse {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    return false
  }

  return value.data.every(isCollaborationModeMask)
}

function isThreadResult(value: unknown): value is ThreadResult {
  if (!isRecord(value) || !isRecord(value.thread)) {
    return false
  }

  return typeof value.thread.id === 'string' && typeof value.model === 'string'
}
