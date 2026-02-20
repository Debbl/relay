import process from 'node:process'
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
  if (error instanceof Error) {
    return `Failed to start relay: ${error.message}`
  }

  return `Failed to start relay: ${String(error)}`
}
