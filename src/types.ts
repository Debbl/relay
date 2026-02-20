export type ChatMode = 'default' | 'plan'

export interface BotSession {
  threadId: string
  model: string
  mode: ChatMode
  cwd: string
}

export interface SessionKeyInput {
  chatType: string
  chatId: string
  userId: string
}

export type ParsedCommand =
  | { type: 'help' }
  | { type: 'new'; mode: ChatMode }
  | { type: 'mode'; mode: ChatMode }
  | { type: 'status' }
  | { type: 'projects' }
  | { type: 'reset' }
  | { type: 'prompt'; prompt: string }
  | { type: 'invalid'; message: string }

export interface OpenProjectsResult {
  roots: string[]
}

export interface CodexTurnResult {
  threadId: string
  model: string
  mode: ChatMode
  message: string
  cwd: string
}

export interface RpcErrorObject {
  code: number
  message: string
}

export interface RpcSuccessResponse<TResult = unknown> {
  id: RpcRequestId
  result: TResult
}

export interface RpcErrorResponse {
  id: RpcRequestId
  error: RpcErrorObject
}

export type RpcRequestId = number | string

export interface RpcNotification<TParams = unknown> {
  method: string
  params: TParams
}

export interface RpcServerRequest<TParams = unknown> {
  id: RpcRequestId
  method: string
  params: TParams
}

export type RpcIncomingLine =
  | RpcSuccessResponse<unknown>
  | RpcErrorResponse
  | RpcServerRequest<unknown>
  | RpcNotification<unknown>

export interface CollaborationModeMask {
  name: string
  mode: ChatMode | null
  model: string | null
  reasoning_effort: string | null
  developer_instructions: string | null
}

export interface CollaborationModeListResponse {
  data: CollaborationModeMask[]
}

export interface ThreadResult {
  thread: {
    id: string
  }
  cwd: string
  model: string
}

export interface TurnAccumulator {
  turnCompleted: boolean
  turnError: string | null
  lastAgentMessageByItem: string | null
  lastAgentMessageByTask: string | null
}

export interface RpcItemCompletedParams {
  item?: {
    type?: string
    text?: string
  }
}

export interface RpcTaskCompleteParams {
  msg?: {
    last_agent_message?: string
  }
}

export interface RpcTurnCompletedParams {
  turn?: {
    status?: string
    error?: {
      message?: string
    } | null
  }
}

export interface FeishuMention {
  id?: {
    open_id?: string
    user_id?: string
    union_id?: string
  }
}

export interface HandleIncomingTextInput {
  chatType: string
  chatId: string
  senderId: string
  text: string
}
