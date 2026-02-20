import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const DEFAULT_CODEX_BIN = 'codex'

const TEMPLATE_ENV_CONFIG: Required<RelayConfigEnv> = {
  BASE_DOMAIN: 'https://open.feishu.cn',
  APP_ID: 'your_app_id',
  APP_SECRET: 'your_app_secret',
  BOT_OPEN_ID: 'ou_xxx',
  CODEX_BIN: DEFAULT_CODEX_BIN,
  CODEX_TIMEOUT_MS: null,
  REPLY_PREFIX: '【Relay】',
}

const TEMPLATE_CONFIG: { env: Required<RelayConfigEnv> } = {
  env: TEMPLATE_ENV_CONFIG,
}

export interface RelayConfigEnv {
  BASE_DOMAIN?: string
  APP_ID?: string
  APP_SECRET?: string
  BOT_OPEN_ID?: string
  CODEX_BIN?: string
  CODEX_TIMEOUT_MS?: number | string | null
  REPLY_PREFIX?: string
}

interface RelayConfigFile extends RelayConfigEnv {
  env?: RelayConfigEnv
}

export interface RelayConfig {
  baseConfig: {
    appId: string
    appSecret: string
    domain: string
  }
  botOpenId?: string
  codexBin: string
  codexTimeoutMs?: number
  replyPrefix: string
  workspaceCwd: string
}

export interface LoadRelayConfigOptions {
  homeDir?: string
  workspaceCwd?: string
}

export function loadRelayConfig(
  options: LoadRelayConfigOptions = {},
): RelayConfig {
  const homeDir = options.homeDir ?? os.homedir()
  const workspaceCwd = options.workspaceCwd ?? process.cwd()
  const configDir = path.join(homeDir, '.relay')
  const configPath = path.join(configDir, 'config.json')

  if (!fs.existsSync(configPath)) {
    ensureConfigTemplate(configDir, configPath)
    throw new Error(
      `Relay config missing. Template created at ${configPath}. Please edit this file and restart.`,
    )
  }

  const parsed = parseConfigFile(configPath)
  const domain = readRequiredString(parsed.BASE_DOMAIN, 'BASE_DOMAIN')
  const appId = readRequiredString(parsed.APP_ID, 'APP_ID')
  const appSecret = readRequiredString(parsed.APP_SECRET, 'APP_SECRET')

  return {
    baseConfig: {
      appId,
      appSecret,
      domain,
    },
    botOpenId: readOptionalString(parsed.BOT_OPEN_ID, 'BOT_OPEN_ID'),
    codexBin:
      readOptionalString(parsed.CODEX_BIN, 'CODEX_BIN') ?? DEFAULT_CODEX_BIN,
    codexTimeoutMs: readTimeoutMs(parsed.CODEX_TIMEOUT_MS),
    replyPrefix:
      readOptionalString(parsed.REPLY_PREFIX, 'REPLY_PREFIX') ?? '【Relay】',
    workspaceCwd,
  }
}

function ensureConfigTemplate(configDir: string, configPath: string): void {
  fs.mkdirSync(configDir, { recursive: true })
  if (fs.existsSync(configPath)) {
    return
  }

  fs.writeFileSync(
    configPath,
    `${JSON.stringify(TEMPLATE_CONFIG, null, 2)}\n`,
    {
      encoding: 'utf-8',
      flag: 'wx',
    },
  )
}

function parseConfigFile(configPath: string): RelayConfigEnv {
  let raw: string
  try {
    raw = fs.readFileSync(configPath, 'utf-8')
  } catch (error) {
    throw new Error(
      `Failed to read relay config at ${configPath}: ${formatError(error)}`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(
      `Invalid JSON in relay config at ${configPath}: ${formatError(error)}`,
    )
  }

  if (!isObject(parsed)) {
    throw new Error(
      `Invalid relay config at ${configPath}: root must be a JSON object.`,
    )
  }

  const configObject = parsed as RelayConfigFile
  if (configObject.env === undefined) {
    return configObject
  }

  if (!isObject(configObject.env)) {
    throw new Error(
      `Invalid relay config at ${configPath}: env must be a JSON object.`,
    )
  }

  return configObject.env
}

function readRequiredString(value: unknown, field: string): string {
  const normalized = readOptionalString(value, field)
  if (!normalized) {
    throw new Error(
      `Invalid relay config: ${field} is required and must be a non-empty string.`,
    )
  }

  return normalized
}

function readOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new TypeError(`Invalid relay config: ${field} must be a string.`)
  }

  const normalized = value.trim()
  if (normalized.length === 0) {
    return undefined
  }

  return normalized
}

function readTimeoutMs(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  if (typeof value === 'number') {
    if (Number.isInteger(value) && value > 0) {
      return value
    }
    throw new Error(
      'Invalid relay config: CODEX_TIMEOUT_MS must be a positive integer.',
    )
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      return undefined
    }
    if (!/^[1-9]\d*$/.test(trimmed)) {
      throw new Error(
        'Invalid relay config: CODEX_TIMEOUT_MS must be a positive integer.',
      )
    }

    return Number.parseInt(trimmed, 10)
  }

  throw new Error(
    'Invalid relay config: CODEX_TIMEOUT_MS must be a positive integer.',
  )
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
