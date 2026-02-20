import type {
  RpcErrorObject,
  RpcErrorResponse,
  RpcIncomingLine,
  RpcRequestId,
  RpcServerRequest,
  RpcSuccessResponse,
} from '../core/types'

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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isRpcRequestId(value: unknown): value is RpcRequestId {
  return typeof value === 'number' || typeof value === 'string'
}

export function isRpcErrorObject(value: unknown): value is RpcErrorObject {
  if (!isRecord(value)) {
    return false
  }

  return typeof value.code === 'number' && typeof value.message === 'string'
}

export function isRpcErrorResponse(
  value: RpcIncomingLine,
): value is RpcErrorResponse {
  return 'error' in value
}

export function isRpcSuccessResponse(
  value: RpcIncomingLine,
): value is RpcSuccessResponse<unknown> {
  return 'result' in value
}

export function isRpcServerRequest(
  value: RpcIncomingLine,
): value is RpcServerRequest<unknown> {
  return 'method' in value && 'id' in value
}

export function getServerRequestResult(method: string): unknown | null {
  if (method === 'item/commandExecution/requestApproval') {
    return {
      decision: 'accept',
      acceptSettings: {
        forSession: true,
      },
    }
  }

  if (method === 'item/fileChange/requestApproval') {
    return { decision: 'accept' }
  }

  if (method.endsWith('/requestApproval')) {
    return { decision: 'accept' }
  }

  if (method === 'execCommandApproval') {
    return { decision: 'allow' }
  }

  if (method === 'applyPatchApproval') {
    return { decision: 'allow' }
  }

  if (method.endsWith('Approval')) {
    return { decision: 'allow' }
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
