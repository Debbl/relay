/* eslint-disable n/prefer-global/process */
import * as Lark from '@larksuiteoapi/node-sdk'
import { handleIncomingText } from './bot-handler'
import { createCodexThread, runCodexTurn } from './codex-app-server'
import { listOpenProjects } from './codex-state'
import {
  buildReplyForMessageEvent,
  shouldHandleGroupMessage,
} from './relay-bot'
import {
  clearSession,
  getSession,
  setSession,
  withSessionLock,
} from './session-store'
import type { ReceiveMessageEvent } from './relay-bot'

const baseConfig = {
  appId: process.env.APP_ID!,
  appSecret: process.env.APP_SECRET!,
  domain: process.env.BASE_DOMAIN!,
} as const

const codexBin = process.env.CODEX_BIN ?? 'codex'
const codexTimeoutMs = parseTimeoutMs(process.env.CODEX_TIMEOUT_MS)
const botOpenId = process.env.BOT_OPEN_ID
const workspaceCwd = process.cwd()
const BUSY_MESSAGE = '当前正忙，请稍后再试。'

const client = new Lark.Client(baseConfig)
const wsClient = new Lark.WSClient(baseConfig)
let isTaskRunning = false

interface FeishuReceiveMessageEvent extends ReceiveMessageEvent {
  event_id?: string
  message: ReceiveMessageEvent['message'] & {
    message_id: string
  }
}

const eventDispatcher = new Lark.EventDispatcher({}).register({
  'im.message.receive_v1': async (data: FeishuReceiveMessageEvent) => {
    // eslint-disable-next-line no-console
    console.info('feishu message received', JSON.stringify(data))

    if (!shouldProcessMessage(data)) {
      return
    }

    if (isTaskRunning) {
      console.warn(
        'skip incoming message: task is running',
        JSON.stringify(data),
      )
      void sendReply(client, data, BUSY_MESSAGE)
      return
    }

    isTaskRunning = true
    void processIncomingEvent(data).finally(() => {
      isTaskRunning = false
    })
  },
})

wsClient.start({ eventDispatcher })

function parseTimeoutMs(raw: string | undefined): number {
  if (!raw) {
    return 180_000
  }

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 180_000
  }

  return parsed
}

async function processIncomingEvent(
  data: FeishuReceiveMessageEvent,
): Promise<void> {
  try {
    await sendReply(client, data, '收到消息，正在处理...')

    const reply = await buildReplyForMessageEvent(data, {
      botOpenId,
      handleIncomingText: (input) =>
        handleIncomingText(input, {
          createThread: (mode) =>
            createCodexThread({
              mode,
              cwd: workspaceCwd,
              codexBin,
              timeoutMs: codexTimeoutMs,
              onCommandExecution: (message) =>
                sendCommandExecutionEcho(client, data, message),
            }),
          runTurn: (params) =>
            runCodexTurn({
              ...params,
              cwd: workspaceCwd,
              codexBin,
              timeoutMs: codexTimeoutMs,
              onCommandExecution: (message) =>
                sendCommandExecutionEcho(client, data, message),
            }),
          getSession,
          setSession,
          clearSession,
          withSessionLock,
          listOpenProjects,
        }),
    })

    if (reply === null) {
      return
    }

    await sendReply(client, data, reply)
  } catch (error) {
    console.error('failed to handle Feishu message', error)
    try {
      await sendReply(client, data, '处理消息失败，请稍后重试。')
    } catch (replyError) {
      console.error('failed to send failure message', replyError)
    }
  }
}

function shouldProcessMessage(data: FeishuReceiveMessageEvent): boolean {
  if (isMessageFromBot(data)) {
    return false
  }

  if (data.message.chat_type === 'p2p') {
    return true
  }

  return shouldHandleGroupMessage(data.message.mentions, botOpenId)
}

function isMessageFromBot(data: FeishuReceiveMessageEvent): boolean {
  const senderType = data.sender.sender_type?.toLowerCase()
  if (senderType === 'app') {
    return true
  }

  if (!botOpenId) {
    return false
  }

  const senderId = resolveSenderId(data.sender.sender_id)
  return senderId === botOpenId
}

function resolveSenderId(
  sender:
    | {
        open_id?: string
        user_id?: string
        union_id?: string
      }
    | undefined,
): string | null {
  if (!sender) {
    return null
  }

  return sender.open_id ?? sender.user_id ?? sender.union_id ?? null
}

async function sendCommandExecutionEcho(
  larkClient: Lark.Client,
  data: {
    message: {
      chat_id: string
      chat_type: string
      message_id: string
    }
  },
  message: string,
): Promise<void> {
  try {
    await sendReply(larkClient, data, message)
  } catch (error) {
    console.error('failed to send command execution echo', error)
  }
}

async function sendReply(
  larkClient: Lark.Client,
  data: {
    message: {
      chat_id: string
      chat_type: string
      message_id: string
    }
  },
  text: string,
): Promise<void> {
  const content = JSON.stringify({ text })

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
