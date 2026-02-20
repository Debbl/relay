import { t } from '@lingui/core/macro'
import type { ChatMode, ParsedCommand } from '../core/types'

const COMMAND_HELP = '/help'
const COMMAND_NEW = '/new'
const COMMAND_MODE = '/mode'
const COMMAND_STATUS = '/status'
const COMMAND_PROJECTS = '/projects'
const COMMAND_RESET = '/reset'

export function getHelpText(): string {
  return [
    t`Available commands:`,
    t`/help - Show help`,
    t`/new [default|plan] - Create a new session`,
    t`/mode <default|plan> - Switch current session mode`,
    t`/status - Show current session status`,
    t`/projects - Show current working directories`,
    t`/reset - Clear current session`,
  ].join('\n')
}

export function parseCommand(input: string): ParsedCommand {
  const normalized = input.trim()
  const helpText = getHelpText()

  if (normalized.length === 0) {
    return {
      type: 'invalid',
      message: t`Command cannot be empty.\n\n${helpText}`,
    }
  }

  if (!normalized.startsWith('/')) {
    return { type: 'prompt', prompt: normalized }
  }

  const parts = normalized.split(/\s+/)
  const command = parts[0]?.toLowerCase()

  if (command === COMMAND_HELP) {
    if (parts.length > 1) {
      return {
        type: 'invalid',
        message: t`/help does not accept arguments.\n\n${helpText}`,
      }
    }

    return { type: 'help' }
  }

  if (command === COMMAND_NEW) {
    if (parts.length > 2) {
      return {
        type: 'invalid',
        message: t`/new accepts at most one optional argument: default or plan.\n\n${helpText}`,
      }
    }

    const modeToken = parts[1]
    if (!modeToken) {
      return { type: 'new', mode: 'default' }
    }

    const mode = parseMode(modeToken)
    if (!mode) {
      return {
        type: 'invalid',
        message: t`Invalid mode "${modeToken}", only default or plan are supported.\n\n${helpText}`,
      }
    }

    return { type: 'new', mode }
  }

  if (command === COMMAND_MODE) {
    const modeToken = parts[1]
    if (!modeToken || parts.length > 2) {
      return {
        type: 'invalid',
        message: t`/mode requires one argument: default or plan.\n\n${helpText}`,
      }
    }

    const mode = parseMode(modeToken)
    if (!mode) {
      return {
        type: 'invalid',
        message: t`Invalid mode "${modeToken}", only default or plan are supported.\n\n${helpText}`,
      }
    }

    return { type: 'mode', mode }
  }

  if (command === COMMAND_STATUS) {
    if (parts.length > 1) {
      return {
        type: 'invalid',
        message: t`/status does not accept arguments.\n\n${helpText}`,
      }
    }

    return { type: 'status' }
  }

  if (command === COMMAND_PROJECTS) {
    if (parts.length > 1) {
      return {
        type: 'invalid',
        message: t`/projects does not accept arguments.\n\n${helpText}`,
      }
    }

    return { type: 'projects' }
  }

  if (command === COMMAND_RESET) {
    if (parts.length > 1) {
      return {
        type: 'invalid',
        message: t`/reset does not accept arguments.\n\n${helpText}`,
      }
    }

    return { type: 'reset' }
  }

  return {
    type: 'invalid',
    message: t`Unknown command "${command ?? normalized}".\n\n${helpText}`,
  }
}

function parseMode(input: string): ChatMode | null {
  const normalized = input.toLowerCase()
  if (normalized === 'default' || normalized === 'plan') {
    return normalized
  }

  return null
}
