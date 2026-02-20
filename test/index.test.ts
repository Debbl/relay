import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleIncomingText } from '../src/bot/handler'
import { buildReplyForMessageEvent } from '../src/bot/relay'
import { initializeI18n } from '../src/i18n/runtime'
import {
  clearSession,
  getSession,
  getSessionKey,
  resetSessionStore,
  setSession,
  withSessionLock,
} from '../src/session/store'
import type { BotSession } from '../src/core/types'

describe('message routing', () => {
  beforeEach(() => {
    initializeI18n('en')
    resetSessionStore()
  })

  it('ignores group message without @ mention', async () => {
    const createThread = vi.fn()
    const runTurn = vi.fn()
    const listOpenProjects = vi.fn()

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
            listOpenProjects,
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
      cwd: '/Users/home/workspace/relay',
    }

    const createThread = vi.fn().mockResolvedValue(createdSession)
    const runTurn = vi.fn()
    const listOpenProjects = vi.fn()

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
            listOpenProjects,
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
      cwd: '/Users/home/workspace/relay',
      title: 'Existing title',
    })

    const createThread = vi.fn()
    const listOpenProjects = vi.fn()
    const runTurn = vi.fn().mockResolvedValue({
      threadId: 'existing_thread',
      model: 'gpt-5.3-codex',
      mode: 'default',
      message: 'reply-from-codex',
      cwd: '/Users/home/workspace/relay',
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
            listOpenProjects,
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
        cwd: '/Users/home/workspace/relay',
        title: 'Existing title',
      },
    })
    expect(runTurn).toHaveBeenCalledTimes(1)
    expect(reply).toBe('reply-from-codex')
  })

  it('generates session title via model for first prompt after /new', async () => {
    const key = getSessionKey({
      chatType: 'group',
      chatId: 'chat_1',
      userId: 'user_1',
    })

    setSession(key, {
      threadId: 'existing_thread',
      mode: 'default',
      model: 'gpt-5.3-codex',
      cwd: '/Users/home/workspace/relay',
    })

    const createThread = vi.fn()
    const listOpenProjects = vi.fn()
    const runTurn = vi.fn().mockResolvedValue({
      threadId: 'existing_thread',
      model: 'gpt-5.3-codex',
      mode: 'default',
      message: 'reply-from-codex',
      cwd: '/Users/home/workspace/relay',
    })
    runTurn
      .mockResolvedValueOnce({
        threadId: 'existing_thread',
        model: 'gpt-5.3-codex',
        mode: 'default',
        message: 'reply-from-codex',
        cwd: '/Users/home/workspace/relay',
      })
      .mockResolvedValueOnce({
        threadId: 'title_thread',
        model: 'gpt-5.3-codex',
        mode: 'default',
        message: '"Fix login flow"\nnotes',
        cwd: '/Users/home/workspace/relay',
      })

    await buildReplyForMessageEvent(
      createEvent({
        chatType: 'group',
        text: '<at user_id="bot">bot</at> fix login bug',
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
            listOpenProjects,
          }),
      },
    )

    expect(runTurn).toHaveBeenCalledTimes(2)
    expect(runTurn).toHaveBeenNthCalledWith(1, {
      prompt: 'fix login bug',
      mode: 'default',
      session: {
        threadId: 'existing_thread',
        mode: 'default',
        model: 'gpt-5.3-codex',
        cwd: '/Users/home/workspace/relay',
      },
    })
    expect(runTurn).toHaveBeenNthCalledWith(2, {
      prompt: expect.stringContaining('User message: fix login bug'),
      mode: 'default',
      session: null,
    })
    expect(getSession(key)?.title).toBe('Fix login flow')
  })

  it('falls back to prompt truncation when title generation fails', async () => {
    const key = getSessionKey({
      chatType: 'group',
      chatId: 'chat_1',
      userId: 'user_1',
    })

    setSession(key, {
      threadId: 'existing_thread',
      mode: 'default',
      model: 'gpt-5.3-codex',
      cwd: '/Users/home/workspace/relay',
    })

    const createThread = vi.fn()
    const listOpenProjects = vi.fn()
    const runTurn = vi
      .fn()
      .mockResolvedValueOnce({
        threadId: 'existing_thread',
        model: 'gpt-5.3-codex',
        mode: 'default',
        message: 'reply-from-codex',
        cwd: '/Users/home/workspace/relay',
      })
      .mockRejectedValueOnce(new Error('timeout'))

    await buildReplyForMessageEvent(
      createEvent({
        chatType: 'group',
        text: '<at user_id="bot">bot</at> fix login bug in production env',
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
            listOpenProjects,
          }),
      },
    )

    expect(runTurn).toHaveBeenCalledTimes(2)
    expect(getSession(key)?.title).toBe('fix login bug in prod...')
  })

  it('falls back when model title is blank', async () => {
    const key = getSessionKey({
      chatType: 'group',
      chatId: 'chat_1',
      userId: 'user_1',
    })

    setSession(key, {
      threadId: 'existing_thread',
      mode: 'default',
      model: 'gpt-5.3-codex',
      cwd: '/Users/home/workspace/relay',
    })

    const createThread = vi.fn()
    const listOpenProjects = vi.fn()
    const runTurn = vi
      .fn()
      .mockResolvedValueOnce({
        threadId: 'existing_thread',
        model: 'gpt-5.3-codex',
        mode: 'default',
        message: 'reply-from-codex',
        cwd: '/Users/home/workspace/relay',
      })
      .mockResolvedValueOnce({
        threadId: 'title_thread',
        model: 'gpt-5.3-codex',
        mode: 'default',
        message: ' \n ',
        cwd: '/Users/home/workspace/relay',
      })

    await buildReplyForMessageEvent(
      createEvent({
        chatType: 'group',
        text: '<at user_id="bot">bot</at>   investigate payment timeout   ',
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
            listOpenProjects,
          }),
      },
    )

    expect(runTurn).toHaveBeenCalledTimes(2)
    expect(getSession(key)?.title).toBe('investigate payment t...')
  })

  it('includes title in /status output', async () => {
    setSession(
      getSessionKey({
        chatType: 'group',
        chatId: 'chat_1',
        userId: 'user_1',
      }),
      {
        threadId: 'existing_thread',
        mode: 'default',
        model: 'gpt-5.3-codex',
        cwd: '/Users/home/workspace/relay',
        title: 'Fix login flow',
      },
    )

    const createThread = vi.fn()
    const runTurn = vi.fn()
    const listOpenProjects = vi.fn()

    const reply = await buildReplyForMessageEvent(
      createEvent({
        chatType: 'group',
        text: '<at user_id="bot">bot</at> /status',
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
            listOpenProjects,
          }),
      },
    )

    expect(reply).toContain('title: Fix login flow')
  })

  it('does not generate title when no session exists before prompt', async () => {
    const createThread = vi.fn()
    const listOpenProjects = vi.fn()
    const runTurn = vi.fn().mockResolvedValue({
      threadId: 'new_thread',
      model: 'gpt-5.3-codex',
      mode: 'default',
      message: 'reply-from-codex',
      cwd: '/Users/home/workspace/relay',
    })

    await buildReplyForMessageEvent(
      createEvent({
        chatType: 'group',
        text: '<at user_id="bot">bot</at> start from scratch',
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
            listOpenProjects,
          }),
      },
    )

    const key = getSessionKey({
      chatType: 'group',
      chatId: 'chat_1',
      userId: 'user_1',
    })
    expect(runTurn).toHaveBeenCalledTimes(1)
    expect(getSession(key)?.title).toBeUndefined()
  })

  it('ignores bot self messages in p2p chat', async () => {
    const createThread = vi.fn()
    const runTurn = vi.fn()
    const listOpenProjects = vi.fn()

    const reply = await buildReplyForMessageEvent(
      createEvent({
        chatType: 'p2p',
        text: 'received and processing task: hello',
        senderOpenId: 'bot_open_id',
        senderType: 'APP',
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
            listOpenProjects,
          }),
      },
    )

    expect(reply).toBeNull()
    expect(createThread).not.toHaveBeenCalled()
    expect(runTurn).not.toHaveBeenCalled()
  })

  it('returns open projects for /projects', async () => {
    const createThread = vi.fn()
    const runTurn = vi.fn()
    const listOpenProjects = vi.fn().mockResolvedValue({
      roots: ['/Users/ding/i/relay', '/Users/ding/i/realfund.news'],
    })

    const reply = await buildReplyForMessageEvent(
      createEvent({
        chatType: 'p2p',
        text: '/projects',
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
            listOpenProjects,
          }),
      },
    )

    expect(createThread).not.toHaveBeenCalled()
    expect(runTurn).not.toHaveBeenCalled()
    expect(listOpenProjects).toHaveBeenCalledOnce()
    expect(reply).toContain('Current working directories:')
    expect(reply).toContain('/Users/ding/i/relay')
  })

  it('returns localized copy when locale is zh', async () => {
    const createThread = vi.fn()
    const runTurn = vi.fn()
    const listOpenProjects = vi.fn().mockResolvedValue({
      roots: ['/Users/ding/i/relay'],
    })

    initializeI18n('en')
    const englishReply = await buildReplyForMessageEvent(
      createEvent({
        chatType: 'p2p',
        text: '/projects',
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
            listOpenProjects,
          }),
      },
    )

    initializeI18n('zh')
    const localizedReply = await buildReplyForMessageEvent(
      createEvent({
        chatType: 'p2p',
        text: '/projects',
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
            listOpenProjects,
          }),
      },
    )

    expect(englishReply).toContain('Current working directories:')
    expect(localizedReply).not.toContain('Current working directories:')
    expect(localizedReply).not.toBe(englishReply)
    expect(localizedReply).toContain('/Users/ding/i/relay')
  })
})

function createEvent(input: {
  chatType: string
  text: string
  mentions?: Array<{ id?: { open_id?: string } }>
  senderOpenId?: string
  senderType?: string
}) {
  return {
    sender: {
      sender_type: input.senderType,
      sender_id: {
        open_id: input.senderOpenId ?? 'user_1',
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
