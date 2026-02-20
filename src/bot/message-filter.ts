import type { FeishuMention } from '../core/types'

interface EventSenderId {
  open_id?: string
  user_id?: string
  union_id?: string
}

interface MessageFilterEvent {
  sender: {
    sender_type?: string
    sender_id?: EventSenderId
  }
  message: {
    chat_type: string
    mentions?: FeishuMention[]
  }
}

export function shouldProcessMessage(
  event: MessageFilterEvent,
  botOpenId?: string,
): boolean {
  if (isMessageFromBot(event, botOpenId)) {
    return false
  }

  if (event.message.chat_type === 'p2p') {
    return true
  }

  return shouldHandleGroupMessage(event.message.mentions, botOpenId)
}

export function shouldHandleGroupMessage(
  mentions: FeishuMention[] | undefined,
  botOpenId?: string,
): boolean {
  if (!mentions || mentions.length === 0) {
    return false
  }

  if (!botOpenId) {
    return true
  }

  return mentions.some((mention) => mention.id?.open_id === botOpenId)
}

export function resolveSenderId(
  senderId: EventSenderId | undefined,
): string | null {
  if (!senderId) {
    return null
  }

  return senderId.open_id ?? senderId.user_id ?? senderId.union_id ?? null
}

export function isMessageFromBot(
  event: MessageFilterEvent,
  botOpenId?: string,
): boolean {
  const senderType = event.sender.sender_type?.toLowerCase()
  if (senderType === 'app') {
    return true
  }

  if (!botOpenId) {
    return false
  }

  const senderId = resolveSenderId(event.sender.sender_id)
  return senderId === botOpenId
}
