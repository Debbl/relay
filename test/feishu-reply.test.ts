import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sendReply } from '../src/feishu/reply'
import {
  getSessionKey,
  resetSessionStore,
  setSession,
} from '../src/session/store'
import type * as Lark from '@larksuiteoapi/node-sdk'
import type { FeishuReceiveMessageEvent } from '../src/feishu/reply'

describe('sendReply', () => {
  beforeEach(() => {
    resetSessionStore()
  })

  it('prepends plain thread id when enabled', async () => {
    const event = createEvent()
    setSession(
      getSessionKey({
        chatType: event.message.chat_type,
        chatId: event.message.chat_id,
        userId: event.sender.sender_id?.open_id ?? '',
      }),
      {
        threadId: 'thread_123',
        mode: 'default',
        model: 'gpt-5.3-codex',
        cwd: '/Users/ding/i/relay',
      },
    )

    const { client, createMock } = createMockClient()
    await sendReply(client, event, 'hello from codex', {
      includeThreadTag: true,
    })

    const createCall = createMock.mock.calls[0]?.[0]
    expect(createCall).toBeDefined()
    expect(parseReplyText(createCall?.data.content)).toBe(
      'thread_123\n\nhello from codex',
    )
  })

  it('does not prepend thread id when disabled', async () => {
    const { client, createMock } = createMockClient()
    await sendReply(client, createEvent(), 'status output', {
      includeThreadTag: false,
    })

    const createCall = createMock.mock.calls[0]?.[0]
    expect(createCall).toBeDefined()
    expect(parseReplyText(createCall?.data.content)).toBe('status output')
  })

  it('uses no-thread fallback without brackets when thread is missing', async () => {
    const { client, createMock } = createMockClient()
    await sendReply(client, createEvent(), 'hello from codex', {
      includeThreadTag: true,
    })

    const createCall = createMock.mock.calls[0]?.[0]
    expect(createCall).toBeDefined()
    expect(parseReplyText(createCall?.data.content)).toBe(
      'no-thread\n\nhello from codex',
    )
  })
})

function createMockClient(): {
  client: Lark.Client
  createMock: ReturnType<typeof vi.fn>
  replyMock: ReturnType<typeof vi.fn>
} {
  const createMock = vi.fn().mockResolvedValue(undefined)
  const replyMock = vi.fn().mockResolvedValue(undefined)
  const clientLike = {
    im: {
      v1: {
        message: {
          create: createMock,
          reply: replyMock,
        },
      },
    },
  }

  return {
    client: clientLike as unknown as Lark.Client,
    createMock,
    replyMock,
  }
}

function createEvent(): FeishuReceiveMessageEvent {
  return {
    event_id: 'event_1',
    sender: {
      sender_type: 'user',
      sender_id: {
        open_id: 'user_1',
      },
    },
    message: {
      message_id: 'message_1',
      chat_id: 'chat_1',
      chat_type: 'p2p',
      message_type: 'text',
      content: JSON.stringify({ text: 'hello' }),
    },
  }
}

function parseReplyText(content: unknown): string {
  if (typeof content !== 'string') {
    throw new TypeError('reply content must be string')
  }

  const parsed: unknown = JSON.parse(content)
  if (!isRecord(parsed) || typeof parsed.text !== 'string') {
    throw new Error('reply payload must contain text')
  }

  return parsed.text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
