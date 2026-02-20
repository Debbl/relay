import { i18n } from '@lingui/core'
import { messages as enMessages } from '../locales/en/messages.po'
import { messages as zhMessages } from '../locales/zh/messages.po'
import type { Messages } from '@lingui/core'

export type AppLocale = 'en' | 'zh'

const DEFAULT_LOCALE: AppLocale = 'en'

const CATALOGS: Record<AppLocale, Messages> = {
  en: enMessages as Messages,
  zh: zhMessages as Messages,
}

let activeLocale: AppLocale | null = null

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

  if (isSupportedLocale(locale)) {
    return locale
  }

  return DEFAULT_LOCALE
}

function ensureI18nInitialized(): void {
  if (!activeLocale) {
    initializeI18n(DEFAULT_LOCALE)
  }
}
