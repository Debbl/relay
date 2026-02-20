# relay

A Feishu bot that forwards chat messages to Codex and returns results in chat.

## Prerequisites

1. Node.js 20+ and `pnpm`.
2. `codex` CLI installed and logged in (`codex login`).
3. Feishu app with bot capability enabled.
4. Feishu event subscription enabled for `im.message.receive_v1`.
5. Feishu bot permissions:
   - P2P messages to bot.
   - Group messages `@` bot (or all group messages if you prefer).

## Environment

Create `.env.local`:

```bash
cp .env.example .env.local
```

Set required values:

```bash
BASE_DOMAIN=https://open.feishu.cn
APP_ID=your_app_id
APP_SECRET=your_app_secret
```

Optional values:

```bash
# Strict mention match in group chat. If set, only messages mentioning this bot open_id are handled.
BOT_OPEN_ID=ou_xxx

# Codex binary path (default: codex)
CODEX_BIN=codex

# Timeout per Codex task in milliseconds (default: 180000)
CODEX_TIMEOUT_MS=180000
```

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

## Quality checks

```bash
pnpm lint
pnpm typecheck
pnpm test
```
