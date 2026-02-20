import { isPlainObject } from 'es-toolkit/predicate'
import type {
  BotSession,
  ChatMode,
  CollaborationModeListResponse,
  CollaborationModeMask,
  ThreadResult,
} from '../core/types'
import type { CodexAppServerClient } from './app-server-client'

export interface OpenThreadResult {
  threadId: string
  cwd: string
  model: string
}

export interface CollaborationModePayload {
  mode: ChatMode
  settings: {
    model: string
    reasoning_effort: string | null
    developer_instructions: string | null
  }
}

export async function initializeClient(
  client: CodexAppServerClient,
): Promise<void> {
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

export async function getCollaborationModes(
  client: CodexAppServerClient,
): Promise<CollaborationModeMask[]> {
  const raw = await client.request('collaborationMode/list', {})
  if (!isCollaborationModeListResponse(raw)) {
    throw new Error('Invalid collaboration mode response from Codex')
  }

  return raw.data
}

export async function openThread(
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

export async function startThread(
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

export function selectCollaborationModePayload(
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

function isThreadMissingError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  return error.message.includes('thread not found')
}

function isCollaborationModeMask(
  value: unknown,
): value is CollaborationModeMask {
  if (!isPlainObject(value)) {
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
  if (!isPlainObject(value) || !Array.isArray(value.data)) {
    return false
  }

  return value.data.every(isCollaborationModeMask)
}

function isThreadResult(value: unknown): value is ThreadResult {
  if (!isPlainObject(value) || !isPlainObject(value.thread)) {
    return false
  }

  return typeof value.thread.id === 'string' && typeof value.model === 'string'
}
