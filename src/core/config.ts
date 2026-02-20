import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { MESSAGES } from '../i18n/messages'
import {
  getDefaultLocale,
  initializeI18n,
  isSupportedLocale,
  translate,
} from '../i18n/runtime'
import type { AppLocale } from '../i18n/runtime'

const DEFAULT_CODEX_BIN = 'codex'

const TEMPLATE_ENV_CONFIG: Required<RelayConfigEnv> = {
  BASE_DOMAIN: 'https://open.feishu.cn',
  APP_ID: 'your_app_id',
  APP_SECRET: 'your_app_secret',
  BOT_OPEN_ID: 'ou_xxx',
  CODEX_BIN: DEFAULT_CODEX_BIN,
  CODEX_TIMEOUT_MS: null,
  LOCALE: getDefaultLocale(),
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
  LOCALE?: string
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
  workspaceCwd: string
  locale: AppLocale
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
      translate(MESSAGES.configErrorMissing, {
        configPath,
      }),
    )
  }

  const parsed = parseConfigFile(configPath)
  const locale = readLocale(parsed.LOCALE)
  initializeI18n(locale)

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
    workspaceCwd,
    locale,
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
      translate(MESSAGES.configErrorReadFailed, {
        configPath,
        error: formatError(error),
      }),
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(
      translate(MESSAGES.configErrorInvalidJson, {
        configPath,
        error: formatError(error),
      }),
    )
  }

  if (!isObject(parsed)) {
    throw new Error(
      translate(MESSAGES.configErrorRootNotObject, {
        configPath,
      }),
    )
  }

  const configObject = parsed as RelayConfigFile
  if (configObject.env === undefined) {
    return configObject
  }

  if (!isObject(configObject.env)) {
    throw new Error(
      translate(MESSAGES.configErrorEnvNotObject, {
        configPath,
      }),
    )
  }

  return configObject.env
}

function readRequiredString(value: unknown, field: string): string {
  const normalized = readOptionalString(value, field)
  if (!normalized) {
    throw new Error(
      translate(MESSAGES.configErrorRequiredString, {
        field,
      }),
    )
  }

  return normalized
}

function readOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new TypeError(
      translate(MESSAGES.configErrorFieldMustString, {
        field,
      }),
    )
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
    throw new Error(translate(MESSAGES.configErrorTimeoutPositiveInteger))
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      return undefined
    }
    if (!/^[1-9]\d*$/.test(trimmed)) {
      throw new Error(translate(MESSAGES.configErrorTimeoutPositiveInteger))
    }

    return Number.parseInt(trimmed, 10)
  }

  throw new Error(translate(MESSAGES.configErrorTimeoutPositiveInteger))
}

function readLocale(value: unknown): AppLocale {
  const defaultLocale = getDefaultLocale()

  if (value === undefined || value === null) {
    return defaultLocale
  }

  if (typeof value !== 'string') {
    console.warn(
      translate(MESSAGES.configWarnInvalidLocale, {
        locale: formatInvalidLocale(value),
      }),
    )
    return defaultLocale
  }

  const normalized = value.trim()
  if (normalized.length === 0) {
    return defaultLocale
  }

  if (isSupportedLocale(normalized)) {
    return normalized
  }

  console.warn(
    translate(MESSAGES.configWarnInvalidLocale, {
      locale: normalized,
    }),
  )

  return defaultLocale
}

function formatInvalidLocale(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
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
