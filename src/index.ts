import process from 'node:process'
import * as Lark from '@larksuiteoapi/node-sdk'
import { handleIncomingText } from './bot-handler'
import { createCodexThread, runCodexTurn } from './codex-app-server'
import { listOpenProjects } from './codex-state'
import { loadRelayConfig } from './config'
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
import type { RelayConfig } from './config'
import type { ReceiveMessageEvent } from './relay-bot'

const relayConfig = loadConfigOrExit()
const BUSY_MESSAGE = '当前正忙，请稍后再试。'

const client = new Lark.Client(relayConfig.baseConfig)
const wsClient = new Lark.WSClient(relayConfig.baseConfig)
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
    console.info(
      'feishu message received\n',
      JSON.stringify(data, null, 2),
      '\n',
    )

    if (!shouldProcessMessage(data)) {
      return
    }

    if (isTaskRunning) {
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

function loadConfigOrExit(): RelayConfig {
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

async function processIncomingEvent(
  data: FeishuReceiveMessageEvent,
): Promise<void> {
  try {
    const reply = await buildReplyForMessageEvent(data, {
      botOpenId: relayConfig.botOpenId,
      handleIncomingText: (input) =>
        handleIncomingText(input, {
          createThread: (mode) =>
            createCodexThread({
              mode,
              cwd: relayConfig.workspaceCwd,
              codexBin: relayConfig.codexBin,
              timeoutMs: relayConfig.codexTimeoutMs,
            }),
          runTurn: (params) =>
            runCodexTurn({
              ...params,
              cwd: relayConfig.workspaceCwd,
              codexBin: relayConfig.codexBin,
              timeoutMs: relayConfig.codexTimeoutMs,
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

  return shouldHandleGroupMessage(data.message.mentions, relayConfig.botOpenId)
}

function isMessageFromBot(data: FeishuReceiveMessageEvent): boolean {
  const senderType = data.sender.sender_type?.toLowerCase()
  if (senderType === 'app') {
    return true
  }

  if (!relayConfig.botOpenId) {
    return false
  }

  const senderId = resolveSenderId(data.sender.sender_id)
  return senderId === relayConfig.botOpenId
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
