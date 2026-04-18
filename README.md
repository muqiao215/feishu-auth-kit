# feishu-auth-kit

中文 | [English Summary](#english-summary)

`feishu-auth-kit` 是一个飞书原生智能体元能力仓库，负责认证、入站消息上下文、
runner seam、CardKit 单卡快照，以及 card action -> continuation -> retry
contract。

它最初偏 auth/onboarding，现在已经升级为更完整的 Feishu native agent kit。
当前最小验证目标很明确：在树莓派这类已有 Codex CLI 的机器上，先证明它能把飞书
消息归一化、交给本地 runner、再产出单卡运行快照，而不依赖 ControlMesh 主体。

和 ControlMesh 的关系也要说清楚：

- `feishu-auth-kit` 是上游、可复用的飞书元能力仓库。
- `ControlMesh` 必须包含这套能力作为内置 Feishu native plugin。
- 其他宿主也可以单独消费它，而不必复制飞书 auth/runtime 核心逻辑。

## 为什么存在

飞书原生智能体通常会把很多东西缠在一起：

- 从零创建 app / bot
- app scope 检查与授权链接
- 用户 OAuth device flow
- owner policy
- token 持久化
- 飞书入站消息归一化
- 面向 Codex 这类本地 CLI agent 的 runner seam
- CardKit 风格的单卡进度快照
- 批量权限规划
- 缺权限卡片与 continuation
- 授权完成后的 synthetic retry artifact

这个仓库的作用，就是把这些元能力从宿主 runtime 里抽出来，做成一个独立 Python
库和 CLI。宿主比如 ControlMesh、Claude Code、OpenClaw，或者自定义脚本，都
可以复用它，而不是各自重写一套飞书 auth/native runtime seam。

## 当前能力

| Area | Capability |
|---|---|
| 应用注册 | 官方 Feishu/Lark scan-to-create 新 bot / app 流程 |
| 诊断 | tenant token、app info、已授予 scopes、核心缺失权限 |
| 权限链接 | 构造 app 权限授权链接 |
| 用户认证 | OAuth device authorization 与 poll |
| Token 存储 | 基于文件的 user token 持久化，key 为 `app_id + open_id` |
| Owner policy | 严格 owner-only 或 permissive-if-unknown 校验 |
| Native inbound | 把飞书 IM event 归一化为稳定的消息上下文 envelope |
| Runner seam | `EchoRunner` 与 `CodexCliRunner`，可解析 `codex exec --json` 的最小 lifecycle/tool-step 事件 |
| CardKit | 生命周期、tool call/result、warning、final text 的单卡快照模型 |
| Native contract | 独立于宿主 runtime 的 card action -> continuation -> retry request/artifact contract |
| Runtime cards | 通用的缺权限卡、device-flow 卡片 payload |
| Orchestration | pending flow registry、scope merge、batch planning、synthetic retry |
| Claude surface | 面向 Claude / tool caller 的轻量 JSON wrapper |

## 它不是什么

- 它不是 ControlMesh 本体。
- 它不是完整的飞书 bot framework。
- 它不是飞书 sender。
- 它不是 callback server。
- 它不是 session router 或 conversation store。
- 它不会绕过 Feishu/Lark 平台策略、租户审批、应用审核或发布要求。
- 它不会假装官方飞书流程不存在。
- 它不是要把 `openclaw-lark` 整体克隆进来。

scan-to-create 走的仍然是官方 Feishu/Lark 注册面。它能把 bot/app 从零启动，
但不是任何“非官方后门”。

## 仓库边界

`feishu-auth-kit` 应该负责：

- 从零创建飞书 app 的注册与 auth primitives
- scope inspection、owner policy、token store、continuation、retry artifact
- 飞书 native 入站消息归一化
- 把归一化 turn 交给 Codex 或其他本地 agent 的 runner seam
- native card action -> continuation -> retry contract
- 保留 tool-step 结构的单卡 runtime 快照

下游宿主应该负责：

- long polling、webhook ingress server、事件订阅 plumbing
- 真正的消息/卡片发送
- callback endpoint 与卡片点击接入
- 长时 session memory 与 routing policy
- transport-specific retry 与生产部署问题

## 开发安装

```bash
cd /root/.ductor/workspace/feishu-auth-kit
uv sync --extra dev
uv run pytest -q
uv run ruff check .
```

运行 CLI：

```bash
uv run feishu-auth-kit setup
```

## 从零创建应用

这是 OpenClaw 风格的 first mile：用户扫码官方 Feishu/Lark QR 流程，kit 返回
宿主 runtime 可以保存的 app credentials。

```bash
feishu-auth-kit register scan-create --no-poll --json
```

输出包含：

- `qr_url`
- `device_code`
- `user_code`
- `interval`
- `expires_in`

After the user scans:

```bash
feishu-auth-kit register poll \
  --device-code dev_xxx \
  --interval 5 \
  --expires-in 600 \
  --poll-timeout 120 \
  --json
```

轮询成功时返回：

- `app_id`
- `app_secret`
- `domain`
- `open_id` when available

一条命令跑完的形式：

```bash
feishu-auth-kit register scan-create \
  --poll-timeout 180 \
  --write-env-file ./.feishu-auth.env \
  --json
```

`--write-env-file` writes local env-style values such as `FEISHU_APP_ID` and
`FEISHU_APP_SECRET`. It does not mutate your shell globally.

## 已有应用诊断

如果宿主已经有 `app_id` 和 `app_secret`，kit 可以围绕这个 app 做校验和规划。

```bash
feishu-auth-kit doctor \
  --app-id cli_xxx \
  --app-secret yyy \
  --brand feishu
```

也支持环境变量：

```bash
export FEISHU_APP_ID=cli_xxx
export FEISHU_APP_SECRET=yyy
export FEISHU_BRAND=feishu
```

For global Lark tenants, use `--brand lark`.

## Token 持久化

用户 token 通过文件存储，key 为 `app_id + user_open_id`。

默认路径解析：

- `FEISHU_AUTH_KIT_TOKEN_STORE`
- `XDG_DATA_HOME/feishu-auth-kit/user_tokens.json`
- `~/.local/share/feishu-auth-kit/user_tokens.json`

示例：

```bash
feishu-auth-kit tokens save \
  --app-id cli_xxx \
  --user-open-id ou_user \
  --access-token token \
  --refresh-token refresh \
  --scope offline_access

feishu-auth-kit tokens status \
  --app-id cli_xxx \
  --user-open-id ou_user \
  --json

feishu-auth-kit tokens remove \
  --app-id cli_xxx \
  --user-open-id ou_user
```

也可以在登录后直接保存：

```bash
feishu-auth-kit login \
  --app-id cli_xxx \
  --app-secret yyy \
  --scope im:message:readonly \
  --save-user-open-id ou_user
```

## Owner Policy

Owner 检查复用常规的 app-info 查询路径。

```bash
feishu-auth-kit owner-check \
  --app-id cli_xxx \
  --app-secret yyy \
  --current-user-open-id ou_user \
  --mode strict_owner \
  --json
```

模式：

- `strict_owner`: the current user must match the effective app owner.
- `permissive_if_unknown`: continue only when owner metadata is unavailable;
  known mismatches still fail.

## Runtime 卡片与 Continuation

这个 kit 只构造与 messenger 无关的 JSON payload，不自己发卡片。

```bash
feishu-auth-kit runtime permission-card \
  --app-id cli_xxx \
  --scope offline_access \
  --permission-url "https://open.feishu.cn/app/cli_xxx/auth?q=offline_access" \
  --operation-id op_123
```

Then, after a user clicks or says they completed the step:

```bash
feishu-auth-kit runtime continue \
  --operation-id op_123 \
  --action permissions_granted_continue \
  --actor-open-id ou_user
```

Default continuation store:

- `FEISHU_AUTH_KIT_CONTINUATION_STORE`
- `XDG_STATE_HOME/feishu-auth-kit/continuations.json`
- `~/.local/state/feishu-auth-kit/continuations.json`

## 最小 Native Runtime 与 Codex 验证

第一阶段的 native-runtime 目标刻意收得很窄：先证明这个仓库在接入
ControlMesh 之前，就已经能独立作为 Feishu native agent substrate 存在。

1. 把飞书入站消息归一化成稳定 context envelope。
2. 把这个 envelope 交给 runner seam。
3. 产出包含最终文本和可选 tool steps 的单卡快照。

Normalize an inbound Feishu event:

```bash
feishu-auth-kit agent parse-inbound --event-file ./examples/feishu-event.json
```

不用外部 agent 的最小本地 demo：

```bash
feishu-auth-kit agent run \
  --event-file ./examples/feishu-event.json \
  --runner echo \
  --echo-prefix "Codex stub"
```

机器上已安装 Codex CLI 时，可跑最小 Codex-facing demo：

```bash
feishu-auth-kit agent run \
  --event-file ./examples/feishu-event.json \
  --runner codex \
  --model gpt-5.4 \
  --codex-cd .
```

输出是一个 JSON，包含：

- 归一化后的 Feishu message context
- runner request payload
- runner result
- 一个 `feishu-auth-kit.cardkit.single_card.v1` 快照，可供未来的 Feishu card sender 直接消费

如果你想拿到 JSONL 事件流，而不是单个聚合 payload：

```bash
feishu-auth-kit agent run \
  --event-file ./examples/feishu-event.json \
  --runner codex \
  --codex-cd . \
  --emit-events
```

当前最小 Codex 事件语义：

- 生命周期：`start`、`running`、`completed`、`error`
- tool-step seam：`tool_call`、`tool_result`
- 用户可见输出：`assistant_message`
- 非致命日志：`stderr_warning`

这套语义是故意保持最小的。它还没有覆盖 Codex 的所有内部 item type、token 级
stream，也还没有建模多消息多轮 transcript。

## Native Card Action Contract

`feishu-auth-kit` 现在定义了一套独立于 ControlMesh 的 native contract：

- `NativeCardAction`
- `NativeContinuationRecord`
- `NativeRetryRequest`

目标流程是：

1. auth/orchestration 先创建 continuation
2. `agent bind-continuation` 把它升级成 native retry contract
3. 未来的 Feishu sender/callback runtime 把按钮点击转成 `NativeCardAction`
4. `agent action-to-retry` 把这个 action 还原成 retry request 和 synthetic retry artifact

示例：

```bash
feishu-auth-kit agent bind-continuation \
  --operation-id op_123 \
  --text "Please continue the previous operation."

feishu-auth-kit agent action-to-retry \
  --operation-id op_123 \
  --action permissions_granted_continue \
  --actor-open-id ou_user
```

第二条命令会输出：

- 归一化后的 card action
- 已确认的 native continuation record
- 一个 `feishu-auth-kit.native-retry-request.v1`
- 一个 `feishu-auth-kit.synthetic-retry.v1`

这个仓库仍然不包含真正的 Feishu sender 或 callback server。像 ControlMesh 这类
宿主 runtime 可以在后面消费这些 contract。

## Auth Orchestration

orchestration 层负责把缺权限和认证失败转换成可复用的宿主动作。

规划一组 scope 请求：

```bash
feishu-auth-kit orchestration plan \
  --requested-scope offline_access,im:message:readonly \
  --app-scope offline_access,im:message:readonly \
  --user-scope offline_access
```

路由一个缺权限事件：

```bash
feishu-auth-kit orchestration route \
  --app-id cli_xxx \
  --error-kind app_scope_missing \
  --required-scope offline_access \
  --user-open-id ou_user \
  --flow-key flow-1 \
  --permission-url "https://open.feishu.cn/app/cli_xxx/auth?q=offline_access"
```

认证完成后构造 retry artifact：

```bash
feishu-auth-kit orchestration retry \
  --operation-id op_123 \
  --text "Please continue the previous operation."
```

校验 device-flow identity：

```bash
feishu-auth-kit orchestration verify-identity \
  --brand feishu \
  --access-token token \
  --expected-open-id ou_user
```

## 最小 Claude Surface

Claude 或其他 tool caller 可以向这个 kit 请求结构化 JSON，再自行渲染或转发。

```bash
feishu-auth-kit claude permission-card \
  --app-id cli_xxx \
  --scope offline_access \
  --permission-url "https://open.feishu.cn/app/cli_xxx/auth?q=offline_access" \
  --operation-id op_123
```

For zero-start onboarding:

```bash
feishu-auth-kit register scan-create --no-poll --json
feishu-auth-kit register poll --device-code dev_xxx --json
```

## Python API

```python
from feishu_auth_kit import (
    AppRegistrationClient,
    ContinuationState,
    DeviceFlowClient,
    FeishuAuthClient,
    FileContinuationStore,
    FileTokenStore,
    build_device_flow_card,
    check_owner_policy,
)
from feishu_auth_kit.scopes import batch_scopes, filter_sensitive_scopes

client = FeishuAuthClient("cli_xxx", "secret", brand="feishu")
app_info = client.get_app_info()
owner = check_owner_policy(app_info, current_user_open_id="ou_owner")
user_scopes = client.get_granted_scopes(token_type="user")
safe_batches = batch_scopes(filter_sensitive_scopes(user_scopes), batch_size=100)

registration = AppRegistrationClient()
begin = registration.begin()
poll = registration.poll(
    begin.device_code,
    interval=begin.interval,
    expires_in=begin.expires_in,
)

device = DeviceFlowClient("cli_xxx", "secret")
authorization = device.request_authorization(safe_batches[0])
card = build_device_flow_card(
    app_id=client.app_id,
    operation_id="op_123",
    authorization=authorization,
)

FileContinuationStore().save(
    ContinuationState(
        operation_id="op_123",
        app_id=client.app_id,
        kind="device_flow_authorization",
        status="waiting",
        payload=card.to_dict()["fields"],
    )
)
FileTokenStore().status(client.app_id, "ou_owner")
```

## 宿主集成契约

宿主 runtime 应该负责：

- message send 或 card render
- webhook 或 long-poll ingress
- callback ingress
- chat / session binding
- 把 retry 注回自己的 orchestrator

`feishu-auth-kit` 应该负责：

- app registration
- app/scope inspection
- owner policy
- user OAuth primitives
- token 与 continuation state
- 入站消息上下文归一化
- 本地 runner seams
- native card action -> continuation -> retry contract
- 单卡 step model
- 权限与认证规划
- synthetic retry artifact

这样的拆分可以保证这个仓库可复用，也能让下游 runtime 对自己的职责边界保持清醒。

## 验证

```bash
uv run ruff check .
uv run pytest -q
```

## English Summary

`feishu-auth-kit` is the upstream reusable Feishu native agent capability kit.
It owns auth/onboarding primitives, inbound message normalization, runner
seams, single-card snapshots, and the native card action -> continuation ->
retry contract.

`ControlMesh` should include it as a bundled Feishu native plugin, while other
hosts may also consume it standalone.
