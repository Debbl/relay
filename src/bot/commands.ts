import { MESSAGES } from '../i18n/messages'
import { translate } from '../i18n/runtime'
import type { ChatMode, ParsedCommand } from '../core/types'

const COMMAND_HELP = '/help'
const COMMAND_NEW = '/new'
const COMMAND_MODE = '/mode'
const COMMAND_STATUS = '/status'
const COMMAND_PROJECTS = '/projects'
const COMMAND_RESET = '/reset'

export function getHelpText(): string {
  return [
    translate(MESSAGES.commandsHelpAvailable),
    translate(MESSAGES.commandsHelpLineHelp),
    translate(MESSAGES.commandsHelpLineNew),
    translate(MESSAGES.commandsHelpLineMode),
    translate(MESSAGES.commandsHelpLineStatus),
    translate(MESSAGES.commandsHelpLineProjects),
    translate(MESSAGES.commandsHelpLineReset),
  ].join('\n')
}

export function parseCommand(input: string): ParsedCommand {
  const normalized = input.trim()
  const helpText = getHelpText()

  if (normalized.length === 0) {
    return {
      type: 'invalid',
      message: translate(MESSAGES.commandsErrorEmpty, { helpText }),
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
        message: translate(MESSAGES.commandsErrorHelpNoArgs, { helpText }),
      }
    }

    return { type: 'help' }
  }

  if (command === COMMAND_NEW) {
    if (parts.length > 2) {
      return {
        type: 'invalid',
        message: translate(MESSAGES.commandsErrorNewArgCount, { helpText }),
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
        message: translate(MESSAGES.commandsErrorInvalidMode, {
          modeToken,
          helpText,
        }),
      }
    }

    return { type: 'new', mode }
  }

  if (command === COMMAND_MODE) {
    const modeToken = parts[1]
    if (!modeToken || parts.length > 2) {
      return {
        type: 'invalid',
        message: translate(MESSAGES.commandsErrorModeNeedsArg, { helpText }),
      }
    }

    const mode = parseMode(modeToken)
    if (!mode) {
      return {
        type: 'invalid',
        message: translate(MESSAGES.commandsErrorInvalidMode, {
          modeToken,
          helpText,
        }),
      }
    }

    return { type: 'mode', mode }
  }

  if (command === COMMAND_STATUS) {
    if (parts.length > 1) {
      return {
        type: 'invalid',
        message: translate(MESSAGES.commandsErrorStatusNoArgs, { helpText }),
      }
    }

    return { type: 'status' }
  }

  if (command === COMMAND_PROJECTS) {
    if (parts.length > 1) {
      return {
        type: 'invalid',
        message: translate(MESSAGES.commandsErrorProjectsNoArgs, { helpText }),
      }
    }

    return { type: 'projects' }
  }

  if (command === COMMAND_RESET) {
    if (parts.length > 1) {
      return {
        type: 'invalid',
        message: translate(MESSAGES.commandsErrorResetNoArgs, { helpText }),
      }
    }

    return { type: 'reset' }
  }

  return {
    type: 'invalid',
    message: translate(MESSAGES.commandsErrorUnknownCommand, {
      command: command ?? normalized,
      helpText,
    }),
  }
}

function parseMode(input: string): ChatMode | null {
  const normalized = input.toLowerCase()
  if (normalized === 'default' || normalized === 'plan') {
    return normalized
  }

  return null
}
