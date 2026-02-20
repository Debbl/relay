# relay

[English](./README.md) | [简体中文](./README.zh.md)

一个将飞书聊天消息转发给 Codex，并将结果回传到聊天中的机器人。

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

- 必填字段（放在 `env` 内）：`BASE_DOMAIN`、`APP_ID`、`APP_SECRET`。
- 可选字段：
  - `BOT_OPEN_ID`（为空或缺失表示禁用）。
  - `CODEX_BIN`（默认：`codex`）。
  - `CODEX_TIMEOUT_MS`（默认：不超时；如果设置，必须为正整数）。
  - `LOCALE`（支持：`en`、`zh`；默认：`en`；如果值不支持会告警并回退到 `en`）。

## 运行

```bash
pnpm install
pnpm dev
```

## 在飞书中使用

### 消息流程

1. 给机器人发送一条文本消息。
2. 机器人会先立即回复处理中回显：
   - `已收到，正在处理任务: <task preview>`
3. Codex 处理完成后，机器人发送最终结果。
4. 执行 `/new` 后，首条普通提示词会额外触发一次模型调用，用于自动生成会话标题。

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

- 会话映射仅保存在内存中；重启进程后会重置。
- Codex 运行时仍会把自己的线程存到 `~/.codex/sessions`。
- Relay 将工作区根目录固定为进程启动目录（`process.cwd()`）。
- 请确保进程用户对 `~/.codex/sessions` 有读写权限。
- 运行时不再使用 `.env.local`。

## 质量检查

```bash
pnpm i18n:extract
pnpm i18n:compile
pnpm lint
pnpm typecheck
pnpm test
```
