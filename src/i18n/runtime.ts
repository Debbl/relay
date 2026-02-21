import { i18n } from '@lingui/core'
import { messages as enMessages } from '../locales/en/messages.po'
import { messages as zhMessages } from '../locales/zh/messages.po'
import type { Messages } from '@lingui/core'

export type AppLocale = 'en' | 'zh'

const DEFAULT_LOCALE: AppLocale = detectDefaultLocale()

const CATALOGS: Record<AppLocale, Messages> = {
  en: enMessages as Messages,
  zh: zhMessages as Messages,
}

let activeLocale: AppLocale | null = null

// Activate a default locale eagerly so top-level `t` calls in imported modules
// never run before Lingui has an active locale.
initializeI18n(DEFAULT_LOCALE)

export function initializeI18n(locale?: string): AppLocale {
  const resolved = resolveLocale(locale)
  i18n.loadAndActivate({
    locale: resolved,
    messages: CATALOGS[resolved],
  })
  activeLocale = resolved
  return resolved
}

export function getCurrentLocale(): AppLocale {
  ensureI18nInitialized()
  return activeLocale ?? DEFAULT_LOCALE
}

export function isSupportedLocale(locale: string): locale is AppLocale {
  return locale === 'en' || locale === 'zh'
}

export function getDefaultLocale(): AppLocale {
  return DEFAULT_LOCALE
}

function resolveLocale(locale?: string): AppLocale {
  if (!locale) {
    return DEFAULT_LOCALE
  }

  const mappedLocale = mapToAppLocale(locale)
  if (mappedLocale) {
    return mappedLocale
  }

  return DEFAULT_LOCALE
}

function ensureI18nInitialized(): void {
  if (!activeLocale) {
    initializeI18n(DEFAULT_LOCALE)
  }
}

function detectDefaultLocale(): AppLocale {
  const systemLocale = readSystemLocale()
  if (!systemLocale) {
    return 'en'
  }

  return mapToAppLocale(systemLocale) ?? 'en'
}

function readSystemLocale(): string | undefined {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale
  if (typeof locale !== 'string') {
    return undefined
  }

  const normalized = locale.trim()
  if (normalized.length === 0) {
    return undefined
  }

  return normalized
}

function mapToAppLocale(locale: string): AppLocale | null {
  const normalized = locale.trim().toLowerCase().replaceAll('_', '-')

  if (normalized === 'zh' || normalized.startsWith('zh-')) {
    return 'zh'
  }

  if (normalized === 'en' || normalized.startsWith('en-')) {
    return 'en'
  }

  return null
}
