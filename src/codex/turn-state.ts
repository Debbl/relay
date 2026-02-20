import { isPlainObject } from 'es-toolkit/predicate'
import type {
  RpcItemCompletedParams,
  RpcNotification,
  RpcTaskCompleteParams,
  RpcTurnCompletedParams,
  TurnAccumulator,
} from '../core/types'

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
      isPlainObject(notification.params) &&
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
