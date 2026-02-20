import * as Lark from '@larksuiteoapi/node-sdk'
import { handleIncomingText } from './bot/handler'
import { shouldProcessMessage } from './bot/message-filter'
import { buildReplyForMessageEvent } from './bot/relay'
import { createCodexThread, runCodexTurn } from './codex/app-server'
import { listOpenProjects } from './codex/state'
import { loadConfigOrExit } from './core/startup'
import { sendReply } from './feishu/reply'
import {
  clearSession,
  getSession,
  setSession,
  withSessionLock,
} from './session/store'
import type { FeishuReceiveMessageEvent } from './feishu/reply'

const relayConfig = loadConfigOrExit()
const BUSY_MESSAGE = '当前正忙，请稍后再试。'

const client = new Lark.Client(relayConfig.baseConfig)
const wsClient = new Lark.WSClient(relayConfig.baseConfig)
let isTaskRunning = false

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

const eventDispatcher = new Lark.EventDispatcher({}).register({
  'im.message.receive_v1': async (data: FeishuReceiveMessageEvent) => {
    // eslint-disable-next-line no-console
    console.info(
      'feishu message received\n',
      JSON.stringify(data, null, 2),
      '\n',
    )

    if (!shouldProcessMessage(data, relayConfig.botOpenId)) {
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
