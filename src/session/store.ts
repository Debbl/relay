import fs from 'node:fs'
import path from 'node:path'
import type { BotSession, ChatMode, SessionKeyInput } from '../core/types'

const sessionStore = new Map<string, BotSession>()
const sessionQueue = new Map<string, Promise<void>>()
const SESSION_FILE_NAME = 'sessions.json'
const SESSION_FILE_VERSION = 1 as const

interface PersistedSessionSnapshot {
  mode: ChatMode
  model: string
  title?: string
  savedAt: string
}

interface PersistedActiveSession extends PersistedSessionSnapshot {
  sessionKey: string
  threadId: string
}

interface PersistedWorkspaceSessions {
  activeBySessionKey: PersistedActiveSession | null
  historyBySessionKey: Record<string, PersistedSessionSnapshot[]>
}

interface PersistedSessionsFile {
  version: typeof SESSION_FILE_VERSION
  updatedAt: string
  workspaces: Record<string, PersistedWorkspaceSessions>
}

interface SessionStorePersistenceState {
  filePath: string
  workspaceCwd: string
  data: PersistedSessionsFile
}

let persistenceState: SessionStorePersistenceState | null = null

export function initializeSessionStore(input: {
  homeDir: string
  workspaceCwd: string
}): void {
  const relayDir = path.join(input.homeDir, '.relay')
  const filePath = path.join(relayDir, SESSION_FILE_NAME)

  fs.mkdirSync(relayDir, { recursive: true })
  ensureSessionFileExists(filePath)

  const persisted = readPersistedSessionsFile(filePath)
  const workspaceSessions = persisted.workspaces[input.workspaceCwd]

  sessionStore.clear()
  sessionQueue.clear()

  if (workspaceSessions) {
    if (workspaceSessions.activeBySessionKey) {
      const sessionRef = workspaceSessions.activeBySessionKey
      sessionStore.set(
        sessionRef.sessionKey,
        hydrateSession(sessionRef, input.workspaceCwd),
      )
    }
  }

  persistenceState = {
    filePath,
    workspaceCwd: input.workspaceCwd,
    data: persisted,
  }
}

export function getSessionKey(input: SessionKeyInput): string {
  if (input.chatType === 'p2p') {
    return `p2p:${input.chatId}`
  }

  return `group:${input.chatId}:${input.userId}`
}

export function getSession(sessionKey: string): BotSession | undefined {
  return sessionStore.get(sessionKey)
}

export function setSession(sessionKey: string, session: BotSession): void {
  sessionStore.set(sessionKey, session)
  persistSetSession(sessionKey, session)
}

export function clearSession(sessionKey: string): void {
  sessionStore.delete(sessionKey)
  persistClearSession(sessionKey)
}

export async function withSessionLock<T>(
  sessionKey: string,
  run: () => Promise<T>,
): Promise<T> {
  const previous = sessionQueue.get(sessionKey) ?? Promise.resolve()
  const running = previous.then(
    () => run(),
    () => run(),
  )
  const queueItem = running.then(
    () => undefined,
    () => undefined,
  )

  sessionQueue.set(sessionKey, queueItem)

  try {
    return await running
  } finally {
    if (sessionQueue.get(sessionKey) === queueItem) {
      sessionQueue.delete(sessionKey)
    }
  }
}

export function resetSessionStore(): void {
  sessionStore.clear()
  sessionQueue.clear()
  persistenceState = null
}

function persistSetSession(sessionKey: string, session: BotSession): void {
  const state = persistenceState
  if (!state) {
    return
  }

  const savedAt = new Date().toISOString()
  const activeSession = toPersistedActiveSession(sessionKey, session, savedAt)
  const historySession = toPersistedSessionSnapshot(session, savedAt)
  const workspaceSessions = getOrCreateWorkspaceSessions(
    state.data,
    state.workspaceCwd,
  )

  workspaceSessions.activeBySessionKey = activeSession
  const history = workspaceSessions.historyBySessionKey[session.threadId] ?? []
  history.push(historySession)
  workspaceSessions.historyBySessionKey[session.threadId] = history

  state.data.updatedAt = savedAt
  writePersistedSessionsFile(state.filePath, state.data)
}

function persistClearSession(sessionKey: string): void {
  const state = persistenceState
  if (!state) {
    return
  }

  const workspaceSessions = state.data.workspaces[state.workspaceCwd]
  if (!workspaceSessions) {
    return
  }

  if (
    !workspaceSessions.activeBySessionKey ||
    workspaceSessions.activeBySessionKey.sessionKey !== sessionKey
  ) {
    return
  }

  workspaceSessions.activeBySessionKey = null

  state.data.updatedAt = new Date().toISOString()
  writePersistedSessionsFile(state.filePath, state.data)
}

function ensureSessionFileExists(filePath: string): void {
  if (fs.existsSync(filePath)) {
    return
  }

  const initialContent = `${JSON.stringify(createEmptyPersistedSessionsFile(), null, 2)}\n`
  fs.writeFileSync(filePath, initialContent, { encoding: 'utf-8', flag: 'wx' })
}

function createEmptyPersistedSessionsFile(): PersistedSessionsFile {
  return {
    version: SESSION_FILE_VERSION,
    updatedAt: new Date().toISOString(),
    workspaces: {},
  }
}

function readPersistedSessionsFile(filePath: string): PersistedSessionsFile {
  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf-8')
  } catch (error) {
    throw new Error(
      `Failed to read relay session index at ${filePath}: ${formatError(error)}`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(
      `Invalid JSON in relay session index at ${filePath}: ${formatError(error)}`,
    )
  }

  return parsePersistedSessionsFile(parsed, filePath)
}

function parsePersistedSessionsFile(
  value: unknown,
  filePath: string,
): PersistedSessionsFile {
  if (!isObject(value)) {
    throw new Error(
      `Invalid relay session index at ${filePath}: root must be a JSON object.`,
    )
  }

  if (value.version !== SESSION_FILE_VERSION) {
    throw new Error(
      `Invalid relay session index at ${filePath}: version must be ${SESSION_FILE_VERSION}.`,
    )
  }

  if (typeof value.updatedAt !== 'string') {
    throw new TypeError(
      `Invalid relay session index at ${filePath}: updatedAt must be a string.`,
    )
  }

  if (!isObject(value.workspaces)) {
    throw new Error(
      `Invalid relay session index at ${filePath}: workspaces must be a JSON object.`,
    )
  }

  const workspaces: Record<string, PersistedWorkspaceSessions> = {}
  for (const [workspaceCwd, workspaceValue] of Object.entries(
    value.workspaces,
  )) {
    workspaces[workspaceCwd] = parseWorkspaceSessions(
      workspaceValue,
      filePath,
      workspaceCwd,
    )
  }

  return {
    version: SESSION_FILE_VERSION,
    updatedAt: value.updatedAt,
    workspaces,
  }
}

function parseWorkspaceSessions(
  value: unknown,
  filePath: string,
  workspaceCwd: string,
): PersistedWorkspaceSessions {
  if (!isObject(value)) {
    throw new Error(
      `Invalid relay session index at ${filePath}: workspace "${workspaceCwd}" must be a JSON object.`,
    )
  }

  const activeBySessionKey = parseWorkspaceActiveSession(
    value.activeBySessionKey,
    filePath,
    workspaceCwd,
  )
  const historyBySessionKey = parseWorkspaceHistorySessions(
    value.historyBySessionKey,
    filePath,
    workspaceCwd,
  )

  return {
    activeBySessionKey,
    historyBySessionKey,
  }
}

function parseWorkspaceActiveSession(
  value: unknown,
  filePath: string,
  workspaceCwd: string,
): PersistedActiveSession | null {
  if (value === null || value === undefined) {
    return null
  }

  if (!isObject(value)) {
    throw new Error(
      `Invalid relay session index at ${filePath}: activeBySessionKey for workspace "${workspaceCwd}" must be a JSON object or null.`,
    )
  }

  return parsePersistedActiveSession(
    value,
    filePath,
    `activeBySessionKey for workspace "${workspaceCwd}"`,
  )
}

function parseWorkspaceHistorySessions(
  value: unknown,
  filePath: string,
  workspaceCwd: string,
): Record<string, PersistedSessionSnapshot[]> {
  if (!isObject(value)) {
    throw new Error(
      `Invalid relay session index at ${filePath}: historyBySessionKey for workspace "${workspaceCwd}" must be a JSON object.`,
    )
  }

  const historyBySessionKey: Record<string, PersistedSessionSnapshot[]> = {}
  for (const [entryKey, historyValue] of Object.entries(value)) {
    if (entryKey.trim().length === 0) {
      throw new Error(
        `Invalid relay session index at ${filePath}: historyBySessionKey key in workspace "${workspaceCwd}" must be a non-empty threadId.`,
      )
    }

    if (!Array.isArray(historyValue)) {
      throw new TypeError(
        `Invalid relay session index at ${filePath}: historyBySessionKey.${entryKey} must be an array.`,
      )
    }

    historyBySessionKey[entryKey] = historyValue.map((item, index) =>
      parsePersistedSessionSnapshot(
        item,
        filePath,
        `historyBySessionKey.${entryKey}[${index}]`,
      ),
    )
  }

  return historyBySessionKey
}

function parsePersistedActiveSession(
  value: unknown,
  filePath: string,
  location: string,
): PersistedActiveSession {
  if (!isObject(value)) {
    throw new Error(
      `Invalid relay session index at ${filePath}: ${location} must be a JSON object.`,
    )
  }

  const sessionKey = parseNonEmptyString(
    value.sessionKey,
    filePath,
    `${location}.sessionKey`,
  )
  const threadId = parseNonEmptyString(
    value.threadId,
    filePath,
    `${location}.threadId`,
  )
  const snapshot = parsePersistedSessionSnapshot(value, filePath, location)
  return {
    sessionKey,
    threadId,
    ...snapshot,
  }
}

function parsePersistedSessionSnapshot(
  value: unknown,
  filePath: string,
  location: string,
): PersistedSessionSnapshot {
  if (!isObject(value)) {
    throw new Error(
      `Invalid relay session index at ${filePath}: ${location} must be a JSON object.`,
    )
  }

  const model = parseNonEmptyString(value.model, filePath, `${location}.model`)
  if (value.mode !== 'default' && value.mode !== 'plan') {
    throw new Error(
      `Invalid relay session index at ${filePath}: ${location}.mode must be "default" or "plan".`,
    )
  }

  if (typeof value.savedAt !== 'string') {
    throw new TypeError(
      `Invalid relay session index at ${filePath}: ${location}.savedAt must be a string.`,
    )
  }

  const title = normalizeOptionalTitle(value.title)
  return {
    mode: value.mode,
    model,
    title,
    savedAt: value.savedAt,
  }
}

function parseNonEmptyString(
  value: unknown,
  filePath: string,
  location: string,
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      `Invalid relay session index at ${filePath}: ${location} must be a non-empty string.`,
    )
  }

  return value
}

function hydrateSession(
  sessionRef: PersistedActiveSession,
  cwd: string,
): BotSession {
  return {
    threadId: sessionRef.threadId,
    mode: sessionRef.mode,
    model: sessionRef.model,
    cwd,
    title: normalizeOptionalTitle(sessionRef.title),
  }
}

function toPersistedActiveSession(
  sessionKey: string,
  session: BotSession,
  savedAt: string,
): PersistedActiveSession {
  return {
    sessionKey,
    threadId: session.threadId,
    ...toPersistedSessionSnapshot(session, savedAt),
  }
}

function toPersistedSessionSnapshot(
  session: BotSession,
  savedAt: string,
): PersistedSessionSnapshot {
  const title = normalizeOptionalTitle(session.title)

  return {
    mode: session.mode,
    model: session.model,
    title,
    savedAt,
  }
}

function normalizeOptionalTitle(title: unknown): string | undefined {
  if (typeof title !== 'string') {
    return undefined
  }

  const normalized = title.trim()
  if (normalized.length === 0) {
    return undefined
  }

  return normalized
}

function getOrCreateWorkspaceSessions(
  data: PersistedSessionsFile,
  workspaceCwd: string,
): PersistedWorkspaceSessions {
  const existing = data.workspaces[workspaceCwd]
  if (existing) {
    return existing
  }

  const created: PersistedWorkspaceSessions = {
    activeBySessionKey: null,
    historyBySessionKey: {},
  }
  data.workspaces[workspaceCwd] = created
  return created
}

function writePersistedSessionsFile(
  filePath: string,
  data: PersistedSessionsFile,
): void {
  const tempPath = `${filePath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const content = `${JSON.stringify(data, null, 2)}\n`

  try {
    fs.writeFileSync(tempPath, content, 'utf-8')
    fs.renameSync(tempPath, filePath)
  } catch (error) {
    try {
      if (fs.existsSync(tempPath)) {
        fs.rmSync(tempPath, { force: true })
      }
    } catch {
      // Best-effort cleanup for temporary file.
    }

    throw new Error(
      `Failed to write relay session index at ${filePath}: ${formatError(error)}`,
    )
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
