import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearSession,
  getSession,
  initializeSessionStore,
  resetSessionStore,
  setSession,
} from '../src/session/store'
import type { BotSession } from '../src/core/types'

const tempHomes: string[] = []

describe('session persistence', () => {
  afterEach(() => {
    resetSessionStore()
    for (const homeDir of tempHomes) {
      fs.rmSync(homeDir, { recursive: true, force: true })
    }
    tempHomes.length = 0
  })

  it('creates ~/.relay/sessions.json on first initialization', () => {
    const homeDir = createTempHome()

    initializeSessionStore({
      homeDir,
      workspaceCwd: '/workspace/relay',
    })

    const sessionsPath = path.join(homeDir, '.relay', 'sessions.json')
    expect(fs.existsSync(sessionsPath)).toBe(true)

    const parsed = readJson(sessionsPath)
    expect(parsed).toMatchObject({
      version: 1,
      workspaces: {},
    })
  })

  it('restores active session after restart', () => {
    const homeDir = createTempHome()
    const workspaceCwd = '/workspace/relay'
    const sessionKey = 'group:chat_1:user_1'
    const session = createSession({
      threadId: 'thread_1',
      mode: 'plan',
      model: 'gpt-5.3-codex',
      cwd: workspaceCwd,
      title: 'Fix login flow',
    })

    initializeSessionStore({ homeDir, workspaceCwd })
    setSession(sessionKey, session)

    resetSessionStore()
    initializeSessionStore({ homeDir, workspaceCwd })

    expect(getSession(sessionKey)).toEqual(session)
  })

  it('removes active session but keeps history on clear', () => {
    const homeDir = createTempHome()
    const workspaceCwd = '/workspace/relay'
    const sessionKey = 'group:chat_2:user_2'
    const sessionsPath = path.join(homeDir, '.relay', 'sessions.json')

    initializeSessionStore({ homeDir, workspaceCwd })
    setSession(
      sessionKey,
      createSession({
        threadId: 'thread_2',
        mode: 'default',
        model: 'gpt-5.3-codex',
        cwd: workspaceCwd,
      }),
    )

    clearSession(sessionKey)
    expect(getSession(sessionKey)).toBeUndefined()

    const parsed = readJson(sessionsPath)
    const workspaceData = getWorkspaceData(parsed, workspaceCwd)
    expect(workspaceData.activeBySessionKey.thread_2).toBeUndefined()
    expect(workspaceData.historyBySessionKey.thread_2).toHaveLength(1)

    resetSessionStore()
    initializeSessionStore({ homeDir, workspaceCwd })
    expect(getSession(sessionKey)).toBeUndefined()
  })

  it('isolates active sessions by workspace', () => {
    const homeDir = createTempHome()
    const workspaceA = '/workspace/a'
    const workspaceB = '/workspace/b'
    const sessionKey = 'group:chat_3:user_3'

    initializeSessionStore({ homeDir, workspaceCwd: workspaceA })
    setSession(
      sessionKey,
      createSession({
        threadId: 'thread_workspace_a',
        mode: 'default',
        model: 'gpt-5.3-codex',
        cwd: workspaceA,
      }),
    )

    resetSessionStore()
    initializeSessionStore({ homeDir, workspaceCwd: workspaceB })
    expect(getSession(sessionKey)).toBeUndefined()

    resetSessionStore()
    initializeSessionStore({ homeDir, workspaceCwd: workspaceA })
    expect(getSession(sessionKey)?.threadId).toBe('thread_workspace_a')
  })

  it('persists active session with threadId as key', () => {
    const homeDir = createTempHome()
    const workspaceCwd = '/workspace/relay'
    const sessionKey = 'group:chat_9:user_9'
    const session = createSession({
      threadId: 'thread_9',
      mode: 'default',
      model: 'gpt-5.3-codex',
      cwd: workspaceCwd,
      title: 'Fix login flow',
    })

    initializeSessionStore({ homeDir, workspaceCwd })
    setSession(sessionKey, session)

    const sessionsPath = path.join(homeDir, '.relay', 'sessions.json')
    const parsed = readJson(sessionsPath)
    const workspaceData = getWorkspaceData(parsed, workspaceCwd)
    const active = workspaceData.activeBySessionKey.thread_9
    expect(isObject(active)).toBe(true)
    expect(active).toMatchObject({
      sessionKey,
      threadId: 'thread_9',
      title: 'Fix login flow',
    })
  })

  it('throws when persisted file has invalid JSON', () => {
    const homeDir = createTempHome()
    const relayDir = path.join(homeDir, '.relay')
    const sessionsPath = path.join(relayDir, 'sessions.json')
    fs.mkdirSync(relayDir, { recursive: true })
    fs.writeFileSync(sessionsPath, '{bad-json}', 'utf-8')

    expect(() =>
      initializeSessionStore({
        homeDir,
        workspaceCwd: '/workspace/relay',
      }),
    ).toThrowError('Invalid JSON')
  })

  it('throws when persisted file schema is invalid', () => {
    const homeDir = createTempHome()
    const relayDir = path.join(homeDir, '.relay')
    const sessionsPath = path.join(relayDir, 'sessions.json')
    fs.mkdirSync(relayDir, { recursive: true })
    fs.writeFileSync(
      sessionsPath,
      `${JSON.stringify(
        {
          version: 2,
          updatedAt: new Date().toISOString(),
          workspaces: {},
        },
        null,
        2,
      )}\n`,
      'utf-8',
    )

    expect(() =>
      initializeSessionStore({
        homeDir,
        workspaceCwd: '/workspace/relay',
      }),
    ).toThrowError('version must be 1')
  })
})

function createTempHome(): string {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-session-test-'))
  tempHomes.push(homeDir)
  return homeDir
}

function createSession(session: BotSession): BotSession {
  return session
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<
    string,
    unknown
  >
}

function getWorkspaceData(
  root: Record<string, unknown>,
  workspaceCwd: string,
): {
  activeBySessionKey: Record<string, unknown>
  historyBySessionKey: Record<string, unknown[]>
} {
  const workspaces = root.workspaces
  if (!isObject(workspaces)) {
    throw new Error('workspaces should be an object in tests')
  }

  const workspaceData = workspaces[workspaceCwd]
  if (!isObject(workspaceData)) {
    throw new Error('workspace data should be an object in tests')
  }

  const activeBySessionKey = workspaceData.activeBySessionKey
  const historyBySessionKey = workspaceData.historyBySessionKey
  if (!isObject(activeBySessionKey) || !isObject(historyBySessionKey)) {
    throw new Error('invalid workspace data shape in tests')
  }

  const normalizedHistory: Record<string, unknown[]> = {}
  for (const [sessionKey, value] of Object.entries(historyBySessionKey)) {
    normalizedHistory[sessionKey] = Array.isArray(value) ? value : []
  }

  return {
    activeBySessionKey,
    historyBySessionKey: normalizedHistory,
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
