import { afterEach, describe, expect, it } from 'vitest'
import {
  getSessionKey,
  resetSessionStore,
  withSessionLock,
} from '../src/session-store'

describe('session-store', () => {
  afterEach(() => {
    resetSessionStore()
  })

  it('builds key for p2p chat', () => {
    const key = getSessionKey({
      chatType: 'p2p',
      chatId: 'oc_123',
      userId: 'u_1',
    })

    expect(key).toBe('p2p:oc_123')
  })

  it('builds key for group chat by chat + user', () => {
    const key = getSessionKey({
      chatType: 'group',
      chatId: 'oc_group',
      userId: 'u_1',
    })

    expect(key).toBe('group:oc_group:u_1')
  })

  it('runs tasks in order for the same session key', async () => {
    const order: number[] = []
    const sessionKey = 'group:chat:user'

    const first = withSessionLock(sessionKey, async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 20))
      order.push(1)
      return 1
    })

    const second = withSessionLock(sessionKey, async () => {
      order.push(2)
      return 2
    })

    await Promise.all([first, second])
    expect(order).toEqual([1, 2])
  })
})
