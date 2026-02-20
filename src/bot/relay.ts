import {
  isMessageFromBot,
  resolveSenderId,
  shouldHandleGroupMessage,
} from './message-filter'
import type { FeishuMention, HandleIncomingTextInput } from '../core/types'

export interface ReceiveMessageEvent {
  sender: {
    sender_type?: string
    sender_id?: {
      open_id?: string
      user_id?: string
      union_id?: string
    }
  }
  message: {
    chat_id: string
    chat_type: string
    message_type: string
    content: string
    mentions?: FeishuMention[]
  }
}

export interface RelayBotDeps {
  botOpenId?: string
  handleIncomingText: (input: HandleIncomingTextInput) => Promise<string>
}

export { shouldHandleGroupMessage } from './message-filter'

export async function buildReplyForMessageEvent(
  event: ReceiveMessageEvent,
  deps: RelayBotDeps,
): Promise<string | null> {
  if (isMessageFromBot(event, deps.botOpenId)) {
    return null
  }

  if (event.message.message_type !== 'text') {
    return '解析消息失败，请发送文本消息。'
  }

  const text = parseTextContent(event.message.content)
  if (!text) {
    return '解析消息失败，请发送文本消息。'
  }

  if (
    event.message.chat_type !== 'p2p' &&
    !shouldHandleGroupMessage(event.message.mentions, deps.botOpenId)
  ) {
    return null
  }

  const senderId = resolveSenderId(event.sender.sender_id)
  if (!senderId) {
    return '无法识别发送者，请稍后重试。'
  }

  const normalizedText = stripMentionTags(text).trim()
  if (normalizedText.length === 0) {
    return '请发送文本消息。'
  }

  return deps.handleIncomingText({
    chatType: event.message.chat_type,
    chatId: event.message.chat_id,
    senderId,
    text: normalizedText,
  })
}

export function stripMentionTags(text: string): string {
  return text.replace(/<at\b[^>]*>.*?<\/at>/g, '').trim()
}

function parseTextContent(content: string): string | null {
  try {
    const parsed: unknown = JSON.parse(content)
    if (!isRecord(parsed)) {
      return null
    }

    return typeof parsed.text === 'string' ? parsed.text : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
