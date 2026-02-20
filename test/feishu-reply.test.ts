import { Buffer } from 'node:buffer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sendReply } from '../src/feishu/reply'
import {
  getSessionKey,
  resetSessionStore,
  setSession,
} from '../src/session/store'
import type * as Lark from '@larksuiteoapi/node-sdk'
import type { FeishuReceiveMessageEvent } from '../src/feishu/reply'

const MAX_CARD_PAYLOAD_BYTES = 30 * 1024

describe('sendReply', () => {
  beforeEach(() => {
    resetSessionStore()
  })

  it('sends interactive card with stable thread marker when enabled', async () => {
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
    await sendReply(client, event, 'next message', {
      includeThreadTag: true,
    })

    const firstMessage = parseSentMessage(createMock.mock.calls[0]?.[0]?.data)
    const secondMessage = parseSentMessage(createMock.mock.calls[1]?.[0]?.data)
    expect(firstMessage.msg_type).toBe('interactive')
    expect(secondMessage.msg_type).toBe('interactive')

    const firstCard = parseCard(firstMessage.content)
    const secondCard = parseCard(secondMessage.content)

    expect(firstCard.schema).toBe('2.0')
    expect(firstCard.header.title.content).toMatch(/^Relay · t-[0-9a-z]{8}$/)
    expect(firstCard.body.elements[0]?.content).toBe('hello from codex')
    expect(firstCard.header.template).toBe(secondCard.header.template)
    expect(firstCard.header.title.content).toBe(secondCard.header.title.content)
  })

  it('uses fixed title without thread marker when includeThreadTag is disabled', async () => {
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
    await sendReply(client, event, 'status output', {
      includeThreadTag: false,
    })

    const message = parseSentMessage(createMock.mock.calls[0]?.[0]?.data)
    const card = parseCard(message.content)
    expect(message.msg_type).toBe('interactive')
    expect(card.header.title.content).toBe('Relay')
    expect(card.header.title.content).not.toContain('t-')
  })

  it('uses stable fallback thread marker when thread is missing', async () => {
    const event = createEvent()
    const { client, createMock } = createMockClient()
    await sendReply(client, event, 'first', {
      includeThreadTag: true,
    })
    await sendReply(client, event, 'second', {
      includeThreadTag: true,
    })

    const firstMessage = parseSentMessage(createMock.mock.calls[0]?.[0]?.data)
    const secondMessage = parseSentMessage(createMock.mock.calls[1]?.[0]?.data)
    const firstCard = parseCard(firstMessage.content)
    const secondCard = parseCard(secondMessage.content)

    expect(firstCard.header.title.content).toMatch(/^Relay · t-[0-9a-z]{8}$/)
    expect(firstCard.header.title.content).toBe(secondCard.header.title.content)
    expect(firstCard.header.template).toBe(secondCard.header.template)
  })

  it('truncates oversized content but keeps interactive card payload within limit', async () => {
    const { client, createMock } = createMockClient()
    await sendReply(client, createEvent(), 'x'.repeat(100_000), {
      includeThreadTag: false,
    })

    const message = parseSentMessage(createMock.mock.calls[0]?.[0]?.data)
    const card = parseCard(message.content)
    const markdown = card.body.elements[0]?.content ?? ''

    expect(message.msg_type).toBe('interactive')
    expect(markdown).toContain('[content truncated due to card size limit]')
    expect(Buffer.byteLength(message.content, 'utf-8')).toBeLessThanOrEqual(
      MAX_CARD_PAYLOAD_BYTES,
    )
  })

  it('uses reply endpoint for group chat', async () => {
    const event = createEvent({ chatType: 'group' })
    const { client, createMock, replyMock } = createMockClient()
    await sendReply(client, event, 'group reply', {
      includeThreadTag: false,
    })

    expect(createMock).not.toHaveBeenCalled()
    expect(replyMock).toHaveBeenCalledTimes(1)

    const message = parseSentMessage(replyMock.mock.calls[0]?.[0]?.data)
    const card = parseCard(message.content)
    expect(message.msg_type).toBe('interactive')
    expect(card.body.elements[0]?.content).toBe('group reply')
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

function createEvent(input?: {
  chatType?: 'p2p' | 'group'
  senderOpenId?: string | null
}): FeishuReceiveMessageEvent {
  const senderId =
    input?.senderOpenId === null
      ? {}
      : {
          open_id: input?.senderOpenId ?? 'user_1',
        }

  return {
    event_id: 'event_1',
    sender: {
      sender_type: 'user',
      sender_id: senderId,
    },
    message: {
      message_id: 'message_1',
      chat_id: 'chat_1',
      chat_type: input?.chatType ?? 'p2p',
      message_type: 'text',
      content: JSON.stringify({ text: 'hello' }),
    },
  }
}

interface SentMessage {
  msg_type: string
  content: string
}

interface ParsedCard {
  schema: string
  header: {
    template: string
    title: {
      content: string
    }
  }
  body: {
    elements: Array<{
      tag: string
      content: string
    }>
  }
}

function parseSentMessage(value: unknown): SentMessage {
  if (!isRecord(value)) {
    throw new TypeError('message payload must be an object')
  }

  if (typeof value.msg_type !== 'string') {
    throw new TypeError('message payload must include msg_type')
  }

  if (typeof value.content !== 'string') {
    throw new TypeError('message payload must include content')
  }

  return {
    msg_type: value.msg_type,
    content: value.content,
  }
}

function parseCard(content: string): ParsedCard {
  const parsed: unknown = JSON.parse(content)
  if (!isRecord(parsed)) {
    throw new TypeError('card payload must be an object')
  }

  if (typeof parsed.schema !== 'string') {
    throw new TypeError('card payload must include schema')
  }

  if (!isRecord(parsed.header)) {
    throw new TypeError('card payload must include header')
  }

  if (typeof parsed.header.template !== 'string') {
    throw new TypeError('card payload header must include template')
  }

  if (!isRecord(parsed.header.title)) {
    throw new TypeError('card payload header must include title')
  }

  if (typeof parsed.header.title.content !== 'string') {
    throw new TypeError('card payload title must include content')
  }

  if (!isRecord(parsed.body)) {
    throw new TypeError('card payload must include body')
  }

  if (!Array.isArray(parsed.body.elements)) {
    throw new TypeError('card payload body must include elements')
  }

  const elements = parsed.body.elements.map((element) => {
    if (!isRecord(element)) {
      throw new TypeError('card element must be an object')
    }

    if (
      typeof element.tag !== 'string' ||
      typeof element.content !== 'string'
    ) {
      throw new TypeError('card markdown element must include tag and content')
    }

    return {
      tag: element.tag,
      content: element.content,
    }
  })

  return {
    schema: parsed.schema,
    header: {
      template: parsed.header.template,
      title: {
        content: parsed.header.title.content,
      },
    },
    body: {
      elements,
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
