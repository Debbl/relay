# relay

[English](./README.md) | [简体中文](./README.zh.md)

一个将飞书聊天消息转发给 Codex，并将结果回传到聊天中的机器人。

## 安装

```bash
npm i @debbl/relay@latest -g
```

## 前置条件

1. Node.js 20+ 和 `pnpm`。
2. 已安装并登录 `codex` CLI（`codex login`）。
3. 已创建并启用机器人能力的飞书应用 [创建机器人](https://open.feishu.cn/document/develop-an-echo-bot/introduction)。
4. 已开启飞书事件订阅 `im.message.receive_v1`。
5. 飞书机器人权限：
   - 与机器人单聊（P2P）消息。
   - 群聊中 `@` 机器人消息（或按需放开为全部群消息）。

## 配置

Relay 仅从 `~/.relay/config.json` 读取配置。

先运行一次 `pnpm dev` 自动生成模板文件（生成后进程会退出），然后编辑：

```bash
~/.relay/config.json
```

配置字段：

```json
{
  "locale": "en",
  "enableProgressReplies": false,
  "env": {
    "BASE_DOMAIN": "https://open.feishu.cn",
    "APP_ID": "your_app_id",
    "APP_SECRET": "your_app_secret",
    "BOT_OPEN_ID": "ou_xxx",
    "CODEX_BIN": "codex",
    "CODEX_TIMEOUT_MS": null
  }
}
```

- 必填字段（放在 `env` 内）：`BASE_DOMAIN`、`APP_ID`、`APP_SECRET`。
- 可选字段：
  - `locale`（放在根级，支持：`en`、`zh`；默认：`en`；如果值不支持会告警并回退到 `en`）。
  - `enableProgressReplies`（放在根级，默认：`false`；开启后，长任务期间会把中间 `agent_message` 实时回复到会话）。
  - `BOT_OPEN_ID`（为空或缺失表示禁用）。
  - `CODEX_BIN`（默认：`codex`）。
  - `CODEX_TIMEOUT_MS`（默认：不超时；如果设置，必须为正整数）。

## 运行

```bash
pnpm install
pnpm dev
```

## 在飞书中使用

### 消息流程

1. 给机器人发送一条文本消息。
2. 机器人会以飞书互动卡片回复（`msg_type: interactive`）。
3. 对普通提示词与进度消息，卡片头部会显示 thread 标识（`Relay · t-<short-id>`），并基于 thread id 使用稳定颜色。
4. 命令与错误消息同样使用卡片，但不显示 thread 标识。
5. 若启用 `enableProgressReplies`，中间进度会持续以卡片发送。
6. 执行 `/new` 后，首条普通提示词会直接作为会话标题（会做空白归一化和截断）。

### 单聊（P2P）

- 任意文本消息都会被处理。

### 群聊

- 机器人只处理 `@` 机器人的消息。
- 会话按 `群 + 发送者` 隔离（同一群内不同用户不会共享上下文）。

### 命令

- `/help` 显示帮助。
- `/new [default|plan]` 新建会话（省略参数时为 default 模式）。
- `/mode <default|plan>` 切换当前会话模式。
- `/status` 显示当前线程信息。
- `/projects` 显示当前固定工作区根目录。
- `/reset` 清空当前会话。

## 说明

- Relay 会把会话索引保存到 `~/.relay/sessions.json`，重启后可恢复活跃会话。
- 索引仅保存 thread id 和基础元数据；完整会话内容仍在 `~/.codex/sessions`。
- Relay 将工作区根目录固定为进程启动目录（`process.cwd()`）。
- 请确保进程用户对 `~/.codex/sessions` 有读写权限。
- 请确保进程用户对 `~/.relay/sessions.json` 有读写权限。
- 运行时不再使用 `.env.local`。

## 质量检查

```bash
pnpm i18n:extract
pnpm i18n:compile
pnpm lint
pnpm typecheck
pnpm test
```
