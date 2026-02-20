import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import {
  formatRpcError,
  getServerRequestResult,
  isRpcErrorResponse,
  isRpcServerRequest,
  isRpcSuccessResponse,
  parseRpcLine,
} from './rpc'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Interface } from 'node:readline'
import type {
  RpcNotification,
  RpcRequestId,
  RpcServerRequest,
} from '../core/types'

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}

export class CodexAppServerClient {
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
