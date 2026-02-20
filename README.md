# relay

[English](./README.md) | [简体中文](./README.zh.md)

A Feishu bot that forwards chat messages to Codex and returns results in chat.

## Prerequisites

1. Node.js 20+ and `pnpm`.
2. `codex` CLI installed and logged in (`codex login`).
3. Feishu app with bot capability enabled [create-bot](https://open.feishu.cn/document/develop-an-echo-bot/introduction).
4. Feishu event subscription enabled for `im.message.receive_v1`.
5. Feishu bot permissions:
   - P2P messages to bot.
   - Group messages `@` bot (or all group messages if you prefer).

## Configuration

Relay reads configuration only from `~/.relay/config.json`.

Run `pnpm dev` once to auto-generate a template file (the process exits after creation), then edit:

```bash
~/.relay/config.json
```

Config fields:

```json
{
  "env": {
    "BASE_DOMAIN": "https://open.feishu.cn",
    "APP_ID": "your_app_id",
    "APP_SECRET": "your_app_secret",
    "BOT_OPEN_ID": "ou_xxx",
    "CODEX_BIN": "codex",
    "CODEX_TIMEOUT_MS": null,
    "LOCALE": "en"
  }
}
```

- Required fields (inside `env`): `BASE_DOMAIN`, `APP_ID`, `APP_SECRET`.
- Optional fields:
  - `BOT_OPEN_ID` (empty or missing means disabled).
  - `CODEX_BIN` (default: `codex`).
  - `CODEX_TIMEOUT_MS` (default: no timeout; if set, must be a positive integer).
  - `LOCALE` (supported values: `en`, `zh`; default: `en`; unsupported value falls back to `en` with a warning).

## Run

```bash
pnpm install
pnpm dev
```

## How To Use In Feishu

### Message flow

1. Send a text message to the bot.
2. Bot replies immediately with a processing echo:
   - `已收到，正在处理任务: <task preview>`
3. Bot sends final Codex result when done.
4. After `/new`, the first normal prompt triggers one extra model call to auto-generate a session title.

### P2P chat

- Any text message is handled.

### Group chat

- Bot only handles messages that `@` the bot.
- Session is isolated by `group + sender` (different users in same group do not share context).

### Commands

- `/help` show help.
- `/new [default|plan]` create a new conversation (default mode if omitted).
- `/mode <default|plan>` switch mode for current conversation.
- `/status` show current thread info.
- `/projects` show current fixed workspace root.
- `/reset` clear current conversation.

## Notes

- Sessions are in-memory only; restarting the process resets session mapping.
- Codex runtime still stores its own threads under `~/.codex/sessions`.
- Relay fixes workspace root to the process startup directory (`process.cwd()`).
- Ensure process user can read/write `~/.codex/sessions`.
- `.env.local` is no longer used for runtime config.

## Quality checks

```bash
pnpm i18n:extract
pnpm i18n:compile
pnpm lint
pnpm typecheck
pnpm test
```
