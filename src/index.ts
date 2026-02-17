/* eslint-disable n/prefer-global/process */
import * as Lark from '@larksuiteoapi/node-sdk'
import { handleIncomingText } from './bot-handler'
import { createCodexThread, runCodexTurn } from './codex-app-server'
import { buildReplyForMessageEvent } from './relay-bot'
import {
  clearSession,
  getSession,
  setSession,
  withSessionLock,
} from './session-store'

const baseConfig = {
  appId: process.env.APP_ID!,
  appSecret: process.env.APP_SECRET!,
  domain: process.env.BASE_DOMAIN!,
} as const

const codexBin = process.env.CODEX_BIN ?? 'codex'
const codexTimeoutMs = parseTimeoutMs(process.env.CODEX_TIMEOUT_MS)
const botOpenId = process.env.BOT_OPEN_ID
const workspaceCwd = process.cwd()

const client = new Lark.Client(baseConfig)
const wsClient = new Lark.WSClient(baseConfig)

const eventDispatcher = new Lark.EventDispatcher({}).register({
  'im.message.receive_v1': async (data) => {
    try {
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
              }),
            runTurn: (params) =>
              runCodexTurn({
                ...params,
                cwd: workspaceCwd,
                codexBin,
                timeoutMs: codexTimeoutMs,
              }),
            getSession,
            setSession,
            clearSession,
            withSessionLock,
          }),
      })

      if (reply === null) {
        return
      }

      await sendReply(client, data, reply)
    } catch (error) {
      console.error('failed to handle Feishu message', error)
      await sendReply(client, data, '处理消息失败，请稍后重试。')
    }
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
