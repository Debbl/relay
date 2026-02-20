import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { t } from '@lingui/core/macro'
import {
  getDefaultLocale,
  initializeI18n,
  isSupportedLocale,
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
}

const TEMPLATE_CONFIG: {
  locale: AppLocale
  enableProgressReplies: boolean
  env: Required<RelayConfigEnv>
} = {
  locale: getDefaultLocale(),
  enableProgressReplies: false,
  env: TEMPLATE_ENV_CONFIG,
}

export interface RelayConfigEnv {
  BASE_DOMAIN?: string
  APP_ID?: string
  APP_SECRET?: string
  BOT_OPEN_ID?: string
  CODEX_BIN?: string
  CODEX_TIMEOUT_MS?: number | string | null
}

interface RelayConfigFile extends RelayConfigEnv {
  locale?: string
  LOCALE?: string
  enableProgressReplies?: boolean | string | number | null
  env?: RelayConfigEnv
}

interface ParsedRelayConfig {
  env: RelayConfigEnv
  localeValue: unknown
  enableProgressRepliesValue: unknown
}

export interface RelayConfig {
  baseConfig: {
    appId: string
    appSecret: string
    domain: string
  }
  homeDir: string
  botOpenId?: string
  codexBin: string
  codexTimeoutMs?: number
  progressReplyEnabled: boolean
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
      t`Relay config is missing. Template created at ${configPath}. Please edit this file and restart.`,
    )
  }

  const parsed = parseConfigFile(configPath)
  const locale = readLocale(parsed.localeValue)
  initializeI18n(locale)

  const domain = readRequiredString(parsed.env.BASE_DOMAIN, 'BASE_DOMAIN')
  const appId = readRequiredString(parsed.env.APP_ID, 'APP_ID')
  const appSecret = readRequiredString(parsed.env.APP_SECRET, 'APP_SECRET')

  return {
    baseConfig: {
      appId,
      appSecret,
      domain,
    },
    homeDir,
    botOpenId: readOptionalString(parsed.env.BOT_OPEN_ID, 'BOT_OPEN_ID'),
    codexBin:
      readOptionalString(parsed.env.CODEX_BIN, 'CODEX_BIN') ??
      DEFAULT_CODEX_BIN,
    codexTimeoutMs: readTimeoutMs(parsed.env.CODEX_TIMEOUT_MS),
    progressReplyEnabled: readBoolean(
      parsed.enableProgressRepliesValue,
      'enableProgressReplies',
      false,
    ),
    workspaceCwd,
    locale,
  }
}

function readBoolean(
  value: unknown,
  field: string,
  fallback: boolean,
): boolean {
  if (value === undefined || value === null) {
    return fallback
  }

  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    if (value === 1) {
      return true
    }
    if (value === 0) {
      return false
    }
    throw new Error(
      t`Invalid relay config: ${field} must be a boolean or one of "true"/"false"/"1"/"0".`,
    )
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized.length === 0) {
      return fallback
    }

    if (normalized === 'true' || normalized === '1') {
      return true
    }
    if (normalized === 'false' || normalized === '0') {
      return false
    }

    throw new Error(
      t`Invalid relay config: ${field} must be a boolean or one of "true"/"false"/"1"/"0".`,
    )
  }

  throw new Error(
    t`Invalid relay config: ${field} must be a boolean or one of "true"/"false"/"1"/"0".`,
  )
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

function parseConfigFile(configPath: string): ParsedRelayConfig {
  let raw: string
  try {
    raw = fs.readFileSync(configPath, 'utf-8')
  } catch (error) {
    throw new Error(
      t`Failed to read relay config at ${configPath}: ${formatError(error)}`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(
      t`Invalid JSON in relay config at ${configPath}: ${formatError(error)}`,
    )
  }

  if (!isObject(parsed)) {
    throw new Error(
      t`Invalid relay config at ${configPath}: root must be a JSON object.`,
    )
  }

  const configObject = parsed as RelayConfigFile
  if (configObject.env === undefined) {
    return {
      env: configObject,
      localeValue: configObject.locale ?? configObject.LOCALE,
      enableProgressRepliesValue: configObject.enableProgressReplies,
    }
  }

  if (!isObject(configObject.env)) {
    throw new Error(
      t`Invalid relay config at ${configPath}: env must be a JSON object.`,
    )
  }

  return {
    env: configObject.env,
    localeValue: configObject.locale ?? configObject.LOCALE,
    enableProgressRepliesValue: configObject.enableProgressReplies,
  }
}

function readRequiredString(value: unknown, field: string): string {
  const normalized = readOptionalString(value, field)
  if (!normalized) {
    throw new Error(
      t`Invalid relay config: ${field} is required and must be a non-empty string.`,
    )
  }

  return normalized
}

function readOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new TypeError(t`Invalid relay config: ${field} must be a string.`)
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
      t`Invalid relay config: CODEX_TIMEOUT_MS must be a positive integer.`,
    )
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      return undefined
    }
    if (!/^[1-9]\d*$/.test(trimmed)) {
      throw new Error(
        t`Invalid relay config: CODEX_TIMEOUT_MS must be a positive integer.`,
      )
    }

    return Number.parseInt(trimmed, 10)
  }

  throw new Error(
    t`Invalid relay config: CODEX_TIMEOUT_MS must be a positive integer.`,
  )
}

function readLocale(value: unknown): AppLocale {
  const defaultLocale = getDefaultLocale()

  if (value === undefined || value === null) {
    return defaultLocale
  }

  if (typeof value !== 'string') {
    console.warn(
      t`Invalid relay config: locale "${formatInvalidLocale(value)}" is not supported. Falling back to en.`,
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
    t`Invalid relay config: locale "${normalized}" is not supported. Falling back to en.`,
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
