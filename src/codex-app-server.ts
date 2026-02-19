import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Interface } from 'node:readline'
import type {
  BotSession,
  ChatMode,
  CodexTurnResult,
  CollaborationModeListResponse,
  CollaborationModeMask,
  RpcErrorObject,
  RpcErrorResponse,
  RpcIncomingLine,
  RpcItemCompletedParams,
  RpcNotification,
  RpcRequestId,
  RpcServerRequest,
  RpcSuccessResponse,
  RpcTaskCompleteParams,
  RpcTurnCompletedParams,
  ThreadResult,
  TurnAccumulator,
} from './types'

const DEFAULT_CODEX_BIN = 'codex'
const DEFAULT_TIMEOUT_MS = 180_000

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
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

export function parseRpcLine(line: string): RpcIncomingLine | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }

  if (!isRecord(parsed)) {
    return null
  }

  if (typeof parsed.method === 'string') {
    if (isRpcRequestId(parsed.id)) {
      return {
        id: parsed.id,
        method: parsed.method,
        params: parsed.params,
      }
    }

    return {
      method: parsed.method,
      params: parsed.params,
    }
  }

  if (!isRpcRequestId(parsed.id)) {
    return null
  }

  if ('error' in parsed && isRpcErrorObject(parsed.error)) {
    return {
      id: parsed.id,
      error: parsed.error,
    }
  }

  if ('result' in parsed) {
    return {
      id: parsed.id,
      result: parsed.result,
    }
  }

  return null
}

export function formatRpcError(error: RpcErrorObject): string {
  return `Codex RPC error (${error.code}): ${error.message}`
}

export async function createCodexThread(
  input: CreateCodexThreadInput,
): Promise<BotSession> {
  const client = new CodexAppServerClient({
    cwd: input.cwd,
    codexBin: input.codexBin ?? DEFAULT_CODEX_BIN,
  })

  try {
    return await withTimeout(
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
      input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
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
    return await withTimeout(
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
      input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
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

  try {
    return await resumeThread(client, session.threadId)
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
    approvalPolicy: 'never',
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isRpcRequestId(value: unknown): value is RpcRequestId {
  return typeof value === 'number' || typeof value === 'string'
}

function isRpcErrorObject(value: unknown): value is RpcErrorObject {
  if (!isRecord(value)) {
    return false
  }

  return typeof value.code === 'number' && typeof value.message === 'string'
}

function isRpcErrorResponse(value: RpcIncomingLine): value is RpcErrorResponse {
  return 'error' in value
}

function isRpcSuccessResponse(
  value: RpcIncomingLine,
): value is RpcSuccessResponse<unknown> {
  return 'result' in value
}

function isRpcServerRequest(
  value: RpcIncomingLine,
): value is RpcServerRequest<unknown> {
  return 'method' in value && 'id' in value
}

function getServerRequestResult(method: string): unknown | null {
  if (method === 'item/commandExecution/requestApproval') {
    return { decision: 'decline' }
  }

  if (method === 'item/fileChange/requestApproval') {
    return { decision: 'decline' }
  }

  if (method === 'execCommandApproval') {
    return { decision: 'denied' }
  }

  if (method === 'applyPatchApproval') {
    return { decision: 'denied' }
  }

  if (method === 'item/tool/requestUserInput') {
    return { answers: {} }
  }

  if (method === 'item/tool/call') {
    return {
      success: false,
      contentItems: [
        {
          type: 'inputText',
          text: 'Dynamic tool calls are unavailable in relay-bot.',
        },
      ],
    }
  }

  return null
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

class CodexAppServerClient {
  private readonly options: {
    cwd: string
    codexBin: string
  }

  private readonly child: ChildProcessWithoutNullStreams

  private readonly pending = new Map<RpcRequestId, PendingRequest>()

  private readonly stderrBuffer: string[] = []

  private readonly lineReader: Interface

  private nextId = 1

  private notificationHandler:
    | ((notification: RpcNotification<unknown>) => void)
    | null = null

  private exited = false

  constructor(options: { cwd: string; codexBin: string }) {
    this.options = options
    const commandArgs = ['app-server']

    this.child = spawn(this.options.codexBin, commandArgs, {
      cwd: this.options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.lineReader = createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    })

    this.lineReader.on('line', (line) => {
      this.handleStdoutLine(line)
    })

    this.child.stderr.on('data', (chunk) => {
      const text = String(chunk).trim()
      if (text.length > 0) {
        this.stderrBuffer.push(text)
      }
    })

    this.child.on('exit', (code, signal) => {
      this.exited = true
      const error = new Error(this.buildExitMessage(code, signal))
      for (const pending of this.pending.values()) {
        pending.reject(error)
      }
      this.pending.clear()
    })
  }

  setNotificationHandler(
    handler: (notification: RpcNotification<unknown>) => void,
  ): void {
    this.notificationHandler = handler
  }

  async request<T>(method: string, params: unknown): Promise<T> {
    if (this.exited) {
      throw new Error(this.buildExitMessage(null, null))
    }

    const requestId = this.nextId
    this.nextId += 1

    const responsePromise = new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: (value: unknown) => resolve(value as T),
        reject,
      })
    })

    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id: requestId,
      method,
      params,
    })

    await new Promise<void>((resolve, reject) => {
      this.child.stdin.write(`${payload}\n`, (error) => {
        if (error) {
          this.pending.delete(requestId)
          reject(error)
          return
        }
        resolve()
      })
    })

    return responsePromise
  }

  dispose(): void {
    this.lineReader.close()
    if (!this.child.killed) {
      this.child.kill('SIGTERM')
    }
  }

  private handleStdoutLine(line: string): void {
    const parsed = parseRpcLine(line)
    if (!parsed) {
      return
    }

    if ('method' in parsed) {
      if (isRpcServerRequest(parsed)) {
        void this.respondToServerRequest(parsed).catch((error) => {
          this.stderrBuffer.push(
            `failed to respond to server request "${parsed.method}": ${String(
              error,
            )}`,
          )
        })
        return
      }

      this.notificationHandler?.(parsed)
      return
    }

    const pending = this.pending.get(parsed.id)
    if (!pending) {
      return
    }

    this.pending.delete(parsed.id)
    if (isRpcErrorResponse(parsed)) {
      pending.reject(new Error(formatRpcError(parsed.error)))
      return
    }

    if (isRpcSuccessResponse(parsed)) {
      pending.resolve(parsed.result)
    }
  }

  private async respondToServerRequest(
    request: RpcServerRequest<unknown>,
  ): Promise<void> {
    const result = getServerRequestResult(request.method)
    if (result !== null) {
      await this.sendRpcResult(request.id, result)
      return
    }

    await this.sendRpcError(
      request.id,
      -32601,
      `Unsupported server request method: ${request.method}`,
    )
  }

  private async sendRpcResult(
    id: RpcRequestId,
    result: unknown,
  ): Promise<void> {
    await this.writeRpcPayload({
      jsonrpc: '2.0',
      id,
      result,
    })
  }

  private async sendRpcError(
    id: RpcRequestId,
    code: number,
    message: string,
  ): Promise<void> {
    await this.writeRpcPayload({
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
      },
    })
  }

  private async writeRpcPayload(payload: {
    jsonrpc: '2.0'
    id: RpcRequestId
    result?: unknown
    error?: {
      code: number
      message: string
    }
  }): Promise<void> {
    if (this.exited) {
      return
    }

    const serialized = JSON.stringify(payload)
    await new Promise<void>((resolve, reject) => {
      this.child.stdin.write(`${serialized}\n`, (error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  }

  private buildExitMessage(
    code: number | null,
    signal: NodeJS.Signals | null,
  ): string {
    const suffix =
      this.stderrBuffer.length > 0
        ? `; stderr: ${this.stderrBuffer.at(-1)}`
        : ''
    return `Codex app-server exited (code=${code ?? 'null'}, signal=${
      signal ?? 'null'
    })${suffix}`
  }
}
