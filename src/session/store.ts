import fs from 'node:fs'
import path from 'node:path'
import type { BotSession, ChatMode, SessionKeyInput } from '../core/types'

const sessionStore = new Map<string, BotSession>()
const sessionQueue = new Map<string, Promise<void>>()
const SESSION_FILE_NAME = 'sessions.json'
const SESSION_FILE_VERSION = 1 as const

interface PersistedSessionRef {
  threadId: string
  mode: ChatMode
  model: string
  title?: string
  savedAt: string
}

interface PersistedWorkspaceSessions {
  activeBySessionKey: Record<string, PersistedSessionRef>
  historyBySessionKey: Record<string, PersistedSessionRef[]>
}

interface PersistedSessionsFileV1 {
  version: typeof SESSION_FILE_VERSION
  updatedAt: string
  workspaces: Record<string, PersistedWorkspaceSessions>
}

interface SessionStorePersistenceState {
  filePath: string
  workspaceCwd: string
  data: PersistedSessionsFileV1
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
    for (const [sessionKey, sessionRef] of Object.entries(
      workspaceSessions.activeBySessionKey,
    )) {
      sessionStore.set(
        sessionKey,
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
  const sessionRef = toPersistedSessionRef(session, savedAt)
  const workspaceSessions = getOrCreateWorkspaceSessions(
    state.data,
    state.workspaceCwd,
  )

  workspaceSessions.activeBySessionKey[sessionKey] = sessionRef

  const history = workspaceSessions.historyBySessionKey[sessionKey] ?? []
  history.push(sessionRef)
  workspaceSessions.historyBySessionKey[sessionKey] = history

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

  if (workspaceSessions.activeBySessionKey[sessionKey] === undefined) {
    return
  }

  delete workspaceSessions.activeBySessionKey[sessionKey]
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

function createEmptyPersistedSessionsFile(): PersistedSessionsFileV1 {
  return {
    version: SESSION_FILE_VERSION,
    updatedAt: new Date().toISOString(),
    workspaces: {},
  }
}

function readPersistedSessionsFile(filePath: string): PersistedSessionsFileV1 {
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
): PersistedSessionsFileV1 {
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

  if (!isObject(value.activeBySessionKey)) {
    throw new Error(
      `Invalid relay session index at ${filePath}: activeBySessionKey for workspace "${workspaceCwd}" must be a JSON object.`,
    )
  }

  if (!isObject(value.historyBySessionKey)) {
    throw new Error(
      `Invalid relay session index at ${filePath}: historyBySessionKey for workspace "${workspaceCwd}" must be a JSON object.`,
    )
  }

  const activeBySessionKey: Record<string, PersistedSessionRef> = {}
  for (const [sessionKey, sessionRefValue] of Object.entries(
    value.activeBySessionKey,
  )) {
    activeBySessionKey[sessionKey] = parsePersistedSessionRef(
      sessionRefValue,
      filePath,
      `activeBySessionKey.${sessionKey}`,
    )
  }

  const historyBySessionKey: Record<string, PersistedSessionRef[]> = {}
  for (const [sessionKey, historyValue] of Object.entries(
    value.historyBySessionKey,
  )) {
    if (!Array.isArray(historyValue)) {
      throw new TypeError(
        `Invalid relay session index at ${filePath}: historyBySessionKey.${sessionKey} must be an array.`,
      )
    }

    historyBySessionKey[sessionKey] = historyValue.map((item, index) =>
      parsePersistedSessionRef(
        item,
        filePath,
        `historyBySessionKey.${sessionKey}[${index}]`,
      ),
    )
  }

  return {
    activeBySessionKey,
    historyBySessionKey,
  }
}

function parsePersistedSessionRef(
  value: unknown,
  filePath: string,
  location: string,
): PersistedSessionRef {
  if (!isObject(value)) {
    throw new Error(
      `Invalid relay session index at ${filePath}: ${location} must be a JSON object.`,
    )
  }

  if (
    typeof value.threadId !== 'string' ||
    value.threadId.trim().length === 0
  ) {
    throw new Error(
      `Invalid relay session index at ${filePath}: ${location}.threadId must be a non-empty string.`,
    )
  }

  if (typeof value.model !== 'string' || value.model.trim().length === 0) {
    throw new Error(
      `Invalid relay session index at ${filePath}: ${location}.model must be a non-empty string.`,
    )
  }

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
    threadId: value.threadId,
    model: value.model,
    mode: value.mode,
    title,
    savedAt: value.savedAt,
  }
}

function hydrateSession(
  sessionRef: PersistedSessionRef,
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

function toPersistedSessionRef(
  session: BotSession,
  savedAt: string,
): PersistedSessionRef {
  const title = normalizeOptionalTitle(session.title)

  return {
    threadId: session.threadId,
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
  data: PersistedSessionsFileV1,
  workspaceCwd: string,
): PersistedWorkspaceSessions {
  const existing = data.workspaces[workspaceCwd]
  if (existing) {
    return existing
  }

  const created: PersistedWorkspaceSessions = {
    activeBySessionKey: {},
    historyBySessionKey: {},
  }
  data.workspaces[workspaceCwd] = created
  return created
}

function writePersistedSessionsFile(
  filePath: string,
  data: PersistedSessionsFileV1,
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
