import { describe, expect, it } from 'vitest'
import {
  applyTurnNotification,
  createTurnAccumulator,
  extractAgentMessage,
  formatRpcError,
  parseRpcLine,
  resolveTurnMessage,
} from '../src/codex/app-server'

describe('codex-app-server helpers', () => {
  it('parses rpc response and notification lines', () => {
    const response = parseRpcLine('{"id":1,"result":{"ok":true}}')
    const notification = parseRpcLine('{"method":"turn/completed","params":{}}')
    const serverRequest = parseRpcLine(
      '{"id":"req-1","method":"item/commandExecution/requestApproval","params":{"foo":"bar"}}',
    )

    expect(response).toEqual({
      id: 1,
      result: { ok: true },
    })
    expect(notification).toEqual({
      method: 'turn/completed',
      params: {},
    })
    expect(serverRequest).toEqual({
      id: 'req-1',
      method: 'item/commandExecution/requestApproval',
      params: { foo: 'bar' },
    })
  })

  it('parses rpc response lines with string id', () => {
    const response = parseRpcLine('{"id":"req-2","result":{"ok":true}}')

    expect(response).toEqual({
      id: 'req-2',
      result: { ok: true },
    })
  })

  it('returns null for invalid json lines', () => {
    expect(parseRpcLine('not-json')).toBeNull()
  })

  it('collects final turn message from notifications', () => {
    const acc = createTurnAccumulator()

    applyTurnNotification(acc, {
      method: 'item/completed',
      params: {
        item: {
          type: 'agentMessage',
          text: 'item-message',
        },
      },
    })

    applyTurnNotification(acc, {
      method: 'codex/event/task_complete',
      params: {
        msg: {
          last_agent_message: 'task-message',
        },
      },
    })

    applyTurnNotification(acc, {
      method: 'turn/completed',
      params: {
        turn: {
          status: 'completed',
          error: null,
        },
      },
    })

    expect(acc.turnCompleted).toBe(true)
    expect(resolveTurnMessage(acc)).toBe('task-message')
  })

  it('extracts agent messages from progress notifications', () => {
    expect(
      extractAgentMessage({
        method: 'item/completed',
        params: {
          item: {
            type: 'agentMessage',
            text: 'item-progress',
          },
        },
      }),
    ).toBe('item-progress')

    expect(
      extractAgentMessage({
        method: 'codex/event/task_complete',
        params: {
          msg: {
            last_agent_message: 'task-progress',
          },
        },
      }),
    ).toBe('task-progress')
  })

  it('captures turn errors', () => {
    const acc = createTurnAccumulator()

    applyTurnNotification(acc, {
      method: 'turn/completed',
      params: {
        turn: {
          status: 'failed',
          error: {
            message: 'boom',
          },
        },
      },
    })

    expect(acc.turnCompleted).toBe(true)
    expect(acc.turnError).toBe('boom')
  })

  it('marks turn complete for error notifications', () => {
    const acc = createTurnAccumulator()

    applyTurnNotification(acc, {
      method: 'error',
      params: {
        message: 'rpc exploded',
      },
    })

    expect(acc.turnCompleted).toBe(true)
    expect(acc.turnError).toBe('rpc exploded')
  })

  it('formats rpc errors', () => {
    expect(formatRpcError({ code: -32603, message: 'bad request' })).toBe(
      'Codex RPC error (-32603): bad request',
    )
  })
})
