import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleIncomingText } from '../src/bot-handler'
import { buildReplyForMessageEvent } from '../src/relay-bot'
import {
  clearSession,
  getSession,
  getSessionKey,
  resetSessionStore,
  setSession,
  withSessionLock,
} from '../src/session-store'
import type { BotSession } from '../src/types'

describe('message routing', () => {
  beforeEach(() => {
    resetSessionStore()
  })

  it('ignores group message without @ mention', async () => {
    const createThread = vi.fn()
    const runTurn = vi.fn()

    const reply = await buildReplyForMessageEvent(
      createEvent({
        chatType: 'group',
        text: '/status',
        mentions: [],
      }),
      {
        botOpenId: 'bot_open_id',
        handleIncomingText: (input) =>
          handleIncomingText(input, {
            createThread,
            runTurn,
            getSession,
            setSession,
            clearSession,
            withSessionLock,
          }),
      },
    )

    expect(reply).toBeNull()
    expect(createThread).not.toHaveBeenCalled()
    expect(runTurn).not.toHaveBeenCalled()
  })

  it('creates a new plan thread for /new plan and stores mode', async () => {
    const createdSession: BotSession = {
      threadId: 'thread_plan_1',
      mode: 'plan',
      model: 'gpt-5.3-codex',
    }

    const createThread = vi.fn().mockResolvedValue(createdSession)
    const runTurn = vi.fn()

    const reply = await buildReplyForMessageEvent(
      createEvent({
        chatType: 'group',
        text: '<at user_id="bot">bot</at> /new plan',
        mentions: [{ id: { open_id: 'bot_open_id' } }],
      }),
      {
        botOpenId: 'bot_open_id',
        handleIncomingText: (input) =>
          handleIncomingText(input, {
            createThread,
            runTurn,
            getSession,
            setSession,
            clearSession,
            withSessionLock,
          }),
      },
    )

    const key = getSessionKey({
      chatType: 'group',
      chatId: 'chat_1',
      userId: 'user_1',
    })

    expect(createThread).toHaveBeenCalledWith('plan')
    expect(runTurn).not.toHaveBeenCalled()
    expect(reply).toContain('thread_plan_1')
    expect(getSession(key)?.mode).toBe('plan')
  })

  it('continues existing thread for normal prompt', async () => {
    const key = getSessionKey({
      chatType: 'group',
      chatId: 'chat_1',
      userId: 'user_1',
    })

    setSession(key, {
      threadId: 'existing_thread',
      mode: 'default',
      model: 'gpt-5.3-codex',
    })

    const createThread = vi.fn()
    const runTurn = vi.fn().mockResolvedValue({
      threadId: 'existing_thread',
      model: 'gpt-5.3-codex',
      mode: 'default',
      message: 'reply-from-codex',
    })

    const reply = await buildReplyForMessageEvent(
      createEvent({
        chatType: 'group',
        text: '<at user_id="bot">bot</at> hello',
        mentions: [{ id: { open_id: 'bot_open_id' } }],
      }),
      {
        botOpenId: 'bot_open_id',
        handleIncomingText: (input) =>
          handleIncomingText(input, {
            createThread,
            runTurn,
            getSession,
            setSession,
            clearSession,
            withSessionLock,
          }),
      },
    )

    expect(createThread).not.toHaveBeenCalled()
    expect(runTurn).toHaveBeenCalledWith({
      prompt: 'hello',
      mode: 'default',
      session: {
        threadId: 'existing_thread',
        mode: 'default',
        model: 'gpt-5.3-codex',
      },
    })
    expect(reply).toBe('reply-from-codex')
  })
})

function createEvent(input: {
  chatType: string
  text: string
  mentions?: Array<{ id?: { open_id?: string } }>
}) {
  return {
    sender: {
      sender_id: {
        open_id: 'user_1',
      },
    },
    message: {
      chat_id: 'chat_1',
      chat_type: input.chatType,
      message_type: 'text',
      content: JSON.stringify({
        text: input.text,
      }),
      mentions: input.mentions,
    },
  }
}
