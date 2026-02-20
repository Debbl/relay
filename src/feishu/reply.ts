import { Buffer } from 'node:buffer'
import { resolveSenderId } from '../bot/message-filter'
import { getSession, getSessionKey } from '../session/store'
import type * as Lark from '@larksuiteoapi/node-sdk'
import type { ReceiveMessageEvent } from '../bot/relay'

const FALLBACK_REPLY_TAG = 'no-thread'
const CARD_SCHEMA = '2.0'
const CARD_TITLE = 'Relay'
const CARD_TRUNCATION_SUFFIX =
  '\n\n---\n`[content truncated due to card size limit]`'
const MAX_CARD_PAYLOAD_BYTES = 30 * 1024

type CardTemplate =
  | 'blue'
  | 'wathet'
  | 'turquoise'
  | 'green'
  | 'yellow'
  | 'orange'
  | 'red'
  | 'carmine'
  | 'violet'
  | 'purple'
  | 'indigo'
  | 'grey'

const THREAD_CARD_TEMPLATES: readonly CardTemplate[] = [
  'blue',
  'wathet',
  'turquoise',
  'green',
  'yellow',
  'orange',
  'red',
  'carmine',
  'violet',
  'purple',
  'indigo',
  'grey',
]

const DEFAULT_CARD_TEMPLATE: CardTemplate = 'blue'

export interface SendReplyOptions {
  includeThreadTag?: boolean
}

export interface FeishuReceiveMessageEvent extends ReceiveMessageEvent {
  event_id?: string
  message: ReceiveMessageEvent['message'] & {
    message_id: string
  }
}

interface ReplyCardStyle {
  template: CardTemplate
  title: string
}

interface ReplyCard {
  schema: typeof CARD_SCHEMA
  config: {
    wide_screen_mode: true
  }
  header: {
    template: CardTemplate
    title: {
      tag: 'plain_text'
      content: string
    }
  }
  body: {
    elements: Array<{
      tag: 'markdown'
      content: string
    }>
  }
}

export async function sendReply(
  larkClient: Lark.Client,
  data: FeishuReceiveMessageEvent,
  text: string,
  options?: SendReplyOptions,
): Promise<void> {
  const content = createCardContent(data, text, options)

  if (data.message.chat_type === 'p2p') {
    await larkClient.im.v1.message.create({
      params: {
        receive_id_type: 'chat_id',
      },
      data: {
        receive_id: data.message.chat_id,
        msg_type: 'interactive',
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
      msg_type: 'interactive',
      content,
    },
  })
}

function createCardContent(
  data: FeishuReceiveMessageEvent,
  text: string,
  options?: SendReplyOptions,
): string {
  const style = resolveReplyCardStyle(data, options)
  const card: ReplyCard = {
    schema: CARD_SCHEMA,
    config: {
      wide_screen_mode: true,
    },
    header: {
      template: style.template,
      title: {
        tag: 'plain_text',
        content: style.title,
      },
    },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: normalizeReplyBody(text),
        },
      ],
    },
  }

  return stringifyCardWithinLimit(card)
}

function resolveReplyCardStyle(
  data: FeishuReceiveMessageEvent,
  options?: SendReplyOptions,
): ReplyCardStyle {
  if (!options?.includeThreadTag) {
    return {
      template: DEFAULT_CARD_TEMPLATE,
      title: CARD_TITLE,
    }
  }

  const replyTag = resolveReplyTag(data)
  return {
    template: resolveThreadTemplate(replyTag),
    title: `${CARD_TITLE} · t-${toShortThreadId(replyTag)}`,
  }
}

function normalizeReplyBody(text: string): string {
  const normalized = text.trim()
  if (normalized.length > 0) {
    return normalized
  }

  return '`(empty response)`'
}

function stringifyCardWithinLimit(card: ReplyCard): string {
  const content = JSON.stringify(card)
  if (byteLength(content) <= MAX_CARD_PAYLOAD_BYTES) {
    return content
  }

  const truncatedMarkdown = truncateMarkdownToFitLimit(card)
  return JSON.stringify(withCardMarkdown(card, truncatedMarkdown))
}

function truncateMarkdownToFitLimit(card: ReplyCard): string {
  const originalMarkdown = card.body.elements[0]?.content ?? ''
  const chars = Array.from(originalMarkdown)
  let low = 0
  let high = chars.length
  let best: string | null = null

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const candidate = `${chars.slice(0, middle).join('')}${CARD_TRUNCATION_SUFFIX}`
    if (isCardWithinLimit(card, candidate)) {
      best = candidate
      low = middle + 1
      continue
    }

    high = middle - 1
  }

  if (best) {
    return best
  }

  if (isCardWithinLimit(card, CARD_TRUNCATION_SUFFIX)) {
    return CARD_TRUNCATION_SUFFIX
  }

  return shrinkToFit(card, CARD_TRUNCATION_SUFFIX)
}

function shrinkToFit(card: ReplyCard, text: string): string {
  const chars = Array.from(text)
  let low = 0
  let high = chars.length
  let best = ''

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const candidate = chars.slice(0, middle).join('')
    if (isCardWithinLimit(card, candidate)) {
      best = candidate
      low = middle + 1
      continue
    }

    high = middle - 1
  }

  return best
}

function isCardWithinLimit(card: ReplyCard, markdown: string): boolean {
  const candidateContent = JSON.stringify(withCardMarkdown(card, markdown))
  return byteLength(candidateContent) <= MAX_CARD_PAYLOAD_BYTES
}

function withCardMarkdown(card: ReplyCard, markdown: string): ReplyCard {
  const firstElement = card.body.elements[0]
  return {
    ...card,
    body: {
      ...card.body,
      elements: firstElement
        ? [{ ...firstElement, content: markdown }]
        : [{ tag: 'markdown', content: markdown }],
    },
  }
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf-8')
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

function resolveThreadTemplate(threadId: string): CardTemplate {
  const hash = stableHash(threadId)
  const index = hash % THREAD_CARD_TEMPLATES.length
  return THREAD_CARD_TEMPLATES[index] ?? DEFAULT_CARD_TEMPLATE
}

function toShortThreadId(threadId: string): string {
  return stableHash(threadId).toString(36).padStart(8, '0').slice(-8)
}

function stableHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}
