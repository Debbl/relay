import process from 'node:process'
import * as Lark from '@larksuiteoapi/node-sdk'
import { t } from '@lingui/core/macro'
import { parseCommand } from './bot/commands'
import { handleIncomingText } from './bot/handler'
import { shouldProcessMessage } from './bot/message-filter'
import { buildReplyForMessageEvent, stripMentionTags } from './bot/relay'
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

interface ProgressState {
  seq: number
}

async function processIncomingEvent(
  data: FeishuReceiveMessageEvent,
): Promise<void> {
  try {
    const includeThreadTag = shouldAttachThreadTag(data)
    const progressState: ProgressState = { seq: 0 }
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
              onProgressMessage: relayConfig.progressReplyEnabled
                ? async (message) => {
                    if (message.trim().length === 0) {
                      return
                    }

                    progressState.seq += 1
                    await sendReply(
                      client,
                      data,
                      formatProgressReplyMessage(message, progressState.seq),
                      {
                        includeThreadTag,
                      },
                    )
                  }
                : undefined,
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

    await sendReply(client, data, reply, {
      includeThreadTag,
    })
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

function shouldAttachThreadTag(data: FeishuReceiveMessageEvent): boolean {
  const rawText = parseEventText(data.message.content)
  if (rawText === null) {
    return false
  }

  const normalizedText = stripMentionTags(rawText).trim()
  if (normalizedText.length === 0) {
    return false
  }

  return parseCommand(normalizedText).type === 'prompt'
}

function formatProgressReplyMessage(message: string, seq: number): string {
  const stateId = `progress-${String(seq).padStart(3, '0')}`
  const statusLine = '处理中（非最终结果）'
  return `**状态ID: ${stateId}**\n${statusLine}\n\n${message.trim()}`
}

function parseEventText(content: string): string | null {
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
