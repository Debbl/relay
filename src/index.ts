import process from 'node:process'
import * as Lark from '@larksuiteoapi/node-sdk'
import { t } from '@lingui/core/macro'
import { handleIncomingText } from './bot/handler'
import { shouldProcessMessage } from './bot/message-filter'
import { buildReplyForMessageEvent } from './bot/relay'
import { createCodexThread, runCodexTurn } from './codex/app-server'
import { listOpenProjects } from './codex/state'
import { loadConfigOrExit } from './core/startup'
import { sendReply } from './feishu/reply'
import { initializeI18n } from './i18n/runtime'
import {
  clearSession,
  getSession,
  initializeSessionStore,
  setSession,
  withSessionLock,
} from './session/store'
import type { FeishuReceiveMessageEvent } from './feishu/reply'

const relayConfig = loadConfigOrExit()
initializeI18n(relayConfig.locale)

try {
  initializeSessionStore({
    homeDir: relayConfig.homeDir,
    workspaceCwd: relayConfig.workspaceCwd,
  })
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(t`Failed to start relay: ${message}`)
  process.exit(1)
}

const BUSY_MESSAGE = t`Currently busy. Please try again later.`

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
      await sendReply(
        client,
        data,
        t`Failed to process message. Please try again later.`,
      )
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
