import process from 'node:process'
import { MESSAGES } from '../i18n/messages'
import { translate } from '../i18n/runtime'
import { loadRelayConfig } from './config'
import type { RelayConfig } from './config'

export function loadConfigOrExit(): RelayConfig {
  try {
    return loadRelayConfig()
  } catch (error) {
    console.error(formatStartupError(error))
    process.exit(1)
  }
}

function formatStartupError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return translate(MESSAGES.startupErrorPrefix, { message })
}
