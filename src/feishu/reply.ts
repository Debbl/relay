import { resolveSenderId } from '../bot/message-filter'
import { getSession, getSessionKey } from '../session/store'
import type * as Lark from '@larksuiteoapi/node-sdk'
import type { ReceiveMessageEvent } from '../bot/relay'

const FALLBACK_REPLY_TAG = 'no-thread'

export interface SendReplyOptions {
  includeThreadTag?: boolean
}

export interface FeishuReceiveMessageEvent extends ReceiveMessageEvent {
  event_id?: string
  message: ReceiveMessageEvent['message'] & {
    message_id: string
  }
}

export async function sendReply(
  larkClient: Lark.Client,
  data: FeishuReceiveMessageEvent,
  text: string,
  options?: SendReplyOptions,
): Promise<void> {
  const content = JSON.stringify({
    text: formatReplyTextWithThreadId(data, text, options),
  })

  if (data.message.chat_type === 'p2p') {
    await larkClient.im.v1.message.create({
      params: {
        receive_id_type: 'chat_id',
      },
      data: {
        receive_id: data.message.chat_id,
        msg_type: 'text',
        content,
      },
    })
    return
  }

  await larkClient.im.v1.message.reply({
    path: {
      message_id: data.message.message_id,
    },
    data: {
      msg_type: 'text',
      content,
    },
  })
}

function formatReplyTextWithThreadId(
  data: FeishuReceiveMessageEvent,
  text: string,
  options?: SendReplyOptions,
): string {
  if (!options?.includeThreadTag) {
    return text.trim()
  }

  const replyTag = resolveReplyTag(data)
  const normalizedText = text.trim()
  if (normalizedText.length === 0) {
    return `${replyTag}\n`
  }

  return `${replyTag}\n\n${normalizedText}`
}

function resolveReplyTag(data: FeishuReceiveMessageEvent): string {
  const senderId = resolveSenderId(data.sender.sender_id)
  if (!senderId) {
    return FALLBACK_REPLY_TAG
  }

  const sessionKey = getSessionKey({
    chatType: data.message.chat_type,
    chatId: data.message.chat_id,
    userId: senderId,
  })
  const session = getSession(sessionKey)
  if (!session || session.threadId.trim().length === 0) {
    return FALLBACK_REPLY_TAG
  }

  return session.threadId
}
