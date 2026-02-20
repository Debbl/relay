import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadRelayConfig } from '../src/config'

const tempHomes: string[] = []

describe('loadRelayConfig', () => {
  afterEach(() => {
    for (const home of tempHomes) {
      fs.rmSync(home, { recursive: true, force: true })
    }
    tempHomes.length = 0
  })

  it('creates template config and fails fast when config is missing', () => {
    const homeDir = createTempHome()
    const configPath = path.join(homeDir, '.relay', 'config.json')

    expect(() =>
      loadRelayConfig({
        homeDir,
        workspaceCwd: '/workspace/relay',
      }),
    ).toThrowError(`Template created at ${configPath}`)

    expect(fs.existsSync(configPath)).toBe(true)

    const content = fs.readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(content) as Record<string, unknown>
    expect(parsed).toMatchObject({
      BASE_DOMAIN: 'https://open.feishu.cn',
      APP_ID: 'your_app_id',
      APP_SECRET: 'your_app_secret',
      BOT_OPEN_ID: 'ou_xxx',
      CODEX_BIN: 'codex',
      CODEX_TIMEOUT_MS: 180000,
    })
  })

  it('loads minimal required config and applies defaults', () => {
    const homeDir = createTempHome()
    writeConfig(homeDir, {
      BASE_DOMAIN: 'https://open.feishu.cn',
      APP_ID: 'app_123',
      APP_SECRET: 'secret_123',
    })

    const config = loadRelayConfig({
      homeDir,
      workspaceCwd: '/workspace/relay',
    })

    expect(config).toEqual({
      baseConfig: {
        appId: 'app_123',
        appSecret: 'secret_123',
        domain: 'https://open.feishu.cn',
      },
      botOpenId: undefined,
      codexBin: 'codex',
      codexTimeoutMs: 180000,
      workspaceCwd: '/workspace/relay',
    })
  })

  it('loads optional config fields', () => {
    const homeDir = createTempHome()
    writeConfig(homeDir, {
      BASE_DOMAIN: 'https://open.feishu.cn',
      APP_ID: 'app_456',
      APP_SECRET: 'secret_456',
      BOT_OPEN_ID: 'ou_bot_123',
      CODEX_BIN: '/usr/local/bin/codex',
      CODEX_TIMEOUT_MS: 240000,
    })

    const config = loadRelayConfig({
      homeDir,
      workspaceCwd: '/workspace/relay',
    })

    expect(config).toEqual({
      baseConfig: {
        appId: 'app_456',
        appSecret: 'secret_456',
        domain: 'https://open.feishu.cn',
      },
      botOpenId: 'ou_bot_123',
      codexBin: '/usr/local/bin/codex',
      codexTimeoutMs: 240000,
      workspaceCwd: '/workspace/relay',
    })
  })

  it.each([-1, 0, 'abc'])(
    'throws for invalid CODEX_TIMEOUT_MS: %s',
    (timeoutValue) => {
      const homeDir = createTempHome()
      writeConfig(homeDir, {
        BASE_DOMAIN: 'https://open.feishu.cn',
        APP_ID: 'app_789',
        APP_SECRET: 'secret_789',
        CODEX_TIMEOUT_MS: timeoutValue,
      })

      expect(() =>
        loadRelayConfig({
          homeDir,
          workspaceCwd: '/workspace/relay',
        }),
      ).toThrowError('CODEX_TIMEOUT_MS')
    },
  )

  it('throws for invalid JSON', () => {
    const homeDir = createTempHome()
    const relayDir = path.join(homeDir, '.relay')
    const configPath = path.join(relayDir, 'config.json')
    fs.mkdirSync(relayDir, { recursive: true })
    fs.writeFileSync(configPath, '{not-json}', 'utf-8')

    expect(() =>
      loadRelayConfig({
        homeDir,
        workspaceCwd: '/workspace/relay',
      }),
    ).toThrowError('Invalid JSON')
  })

  it('throws for missing required field', () => {
    const homeDir = createTempHome()
    writeConfig(homeDir, {
      BASE_DOMAIN: 'https://open.feishu.cn',
      APP_ID: 'app_111',
    })

    expect(() =>
      loadRelayConfig({
        homeDir,
        workspaceCwd: '/workspace/relay',
      }),
    ).toThrowError('APP_SECRET')
  })
})

function createTempHome(): string {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-config-test-'))
  tempHomes.push(homeDir)
  return homeDir
}

function writeConfig(homeDir: string, config: Record<string, unknown>): void {
  const relayDir = path.join(homeDir, '.relay')
  fs.mkdirSync(relayDir, { recursive: true })
  fs.writeFileSync(
    path.join(relayDir, 'config.json'),
    `${JSON.stringify(config, null, 2)}\n`,
    'utf-8',
  )
}
