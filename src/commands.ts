import type { ChatMode, ParsedCommand } from './types'

const COMMAND_HELP = '/help'
const COMMAND_NEW = '/new'
const COMMAND_MODE = '/mode'
const COMMAND_STATUS = '/status'
const COMMAND_RESET = '/reset'

export const HELP_TEXT = [
  '可用命令:',
  '/help - 查看帮助',
  '/new [default|plan] - 新建会话',
  '/mode <default|plan> - 切换当前会话模式',
  '/status - 查看当前会话状态',
  '/reset - 清空当前会话',
].join('\n')

export function parseCommand(input: string): ParsedCommand {
  const normalized = input.trim()
  if (normalized.length === 0) {
    return {
      type: 'invalid',
      message: `命令不能为空。\n\n${HELP_TEXT}`,
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
        message: `/help 不接受参数。\n\n${HELP_TEXT}`,
      }
    }

    return { type: 'help' }
  }

  if (command === COMMAND_NEW) {
    if (parts.length > 2) {
      return {
        type: 'invalid',
        message: `/new 只接受一个可选参数: default 或 plan。\n\n${HELP_TEXT}`,
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
        message: `无效模式 "${modeToken}"，仅支持 default 或 plan。\n\n${HELP_TEXT}`,
      }
    }

    return { type: 'new', mode }
  }

  if (command === COMMAND_MODE) {
    const modeToken = parts[1]
    if (!modeToken || parts.length > 2) {
      return {
        type: 'invalid',
        message: `/mode 需要一个参数: default 或 plan。\n\n${HELP_TEXT}`,
      }
    }

    const mode = parseMode(modeToken)
    if (!mode) {
      return {
        type: 'invalid',
        message: `无效模式 "${modeToken}"，仅支持 default 或 plan。\n\n${HELP_TEXT}`,
      }
    }

    return { type: 'mode', mode }
  }

  if (command === COMMAND_STATUS) {
    if (parts.length > 1) {
      return {
        type: 'invalid',
        message: `/status 不接受参数。\n\n${HELP_TEXT}`,
      }
    }

    return { type: 'status' }
  }

  if (command === COMMAND_RESET) {
    if (parts.length > 1) {
      return {
        type: 'invalid',
        message: `/reset 不接受参数。\n\n${HELP_TEXT}`,
      }
    }

    return { type: 'reset' }
  }

  return {
    type: 'invalid',
    message: `未知命令 "${command ?? normalized}"。\n\n${HELP_TEXT}`,
  }
}

function parseMode(input: string): ChatMode | null {
  const normalized = input.toLowerCase()
  if (normalized === 'default' || normalized === 'plan') {
    return normalized
  }

  return null
}
