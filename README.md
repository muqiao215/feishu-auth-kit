# feishu-auth-kit

Standalone Feishu native agent kit for auth, inbound context normalization,
runner seams, and single-card runtime snapshots.

`feishu-auth-kit` started as an auth/onboarding kit. It is now being upgraded
into a standalone Feishu native agent kit whose first verification target is
simple and strict: a Raspberry Pi with Codex CLI should be able to normalize a
Feishu message, hand it to a local runner seam, and emit a single-card runtime
snapshot without depending on ControlMesh.

## Why It Exists

Feishu native agents need several pieces that are usually tangled together:

- zero-start app or bot registration
- app scope inspection and permission links
- user OAuth device flow
- owner-only policy checks
- token persistence
- Feishu inbound message normalization
- runner seams for local agent CLIs such as Codex
- CardKit-style single-card progress snapshots
- batch permission planning
- permission-missing cards and continuations
- post-auth synthetic retry artifacts

This repo extracts those pieces into a standalone Python library and CLI. A
host such as ControlMesh, Claude Code, OpenClaw, or a custom script can consume
the kit without copying Feishu auth or native runtime seam logic into its own
runtime.

## What It Can Do

| Area | Capability |
|---|---|
| App registration | Official Feishu/Lark scan-to-create flow for a new bot/app |
| Diagnostics | Tenant token, app info, granted scopes, missing core permissions |
| Permission URLs | Build links for app permission grant flows |
| User auth | OAuth device authorization and polling |
| Token storage | File-backed user token persistence keyed by `app_id + open_id` |
| Owner policy | Strict owner-only or permissive-if-unknown checks |
| Native inbound | Normalize Feishu IM events into a stable message context envelope |
| Runner seam | Minimal `EchoRunner` and `CodexCliRunner` adapters for local agent execution |
| CardKit | Single-card step snapshot model for status, tool calls, tool results, and final text |
| Runtime cards | Generic permission-missing and device-flow card payloads |
| Orchestration | Pending flow registry, scope merge, batch planning, synthetic retry |
| Claude surface | Thin JSON wrapper for Claude/tool callers |

## What It Is Not

- It is not ControlMesh.
- It is not a full Feishu bot framework.
- It is not a Feishu message sender.
- It is not a messenger callback server.
- It is not a session router or conversation store.
- It does not bypass Feishu/Lark platform policy, tenant approval, app review,
  or publishing rules.
- It does not hide the fact that official Feishu/Lark flows are still involved.
- It is not trying to clone `openclaw-lark` or absorb another runtime whole.

The scan-to-create path uses the official Feishu/Lark registration surface. It
can bootstrap a bot/app from zero, but it does not provide an unofficial
backdoor around the platform.

## Repository Boundary

`feishu-auth-kit` should own:

- zero-start Feishu app registration and auth primitives
- scope inspection, owner policy, token storage, continuations, retry artifacts
- Feishu native inbound message context normalization
- runner seams that can hand a normalized turn to Codex or another local agent
- single-card runtime snapshots that preserve tool-step structure

Downstream hosts should own:

- long polling, webhook ingress server, or event subscription plumbing
- actual card/message sending
- callback endpoints and card action delivery
- long-lived session memory and routing policy
- transport-specific retries and production deployment concerns

## Install For Development

```bash
cd /root/.ductor/workspace/feishu-auth-kit
uv sync --extra dev
uv run pytest -q
uv run ruff check .
```

Run the CLI:

```bash
uv run feishu-auth-kit setup
```

## Zero-Start App Registration

This is the OpenClaw-style first mile: a user scans an official Feishu/Lark QR
flow, and the kit returns app credentials that a host runtime can store.

```bash
feishu-auth-kit register scan-create --no-poll --json
```

The output includes:

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

Successful polling returns:

- `app_id`
- `app_secret`
- `domain`
- `open_id` when available

One-shot form:

```bash
feishu-auth-kit register scan-create \
  --poll-timeout 180 \
  --write-env-file ./.feishu-auth.env \
  --json
```

`--write-env-file` writes local env-style values such as `FEISHU_APP_ID` and
`FEISHU_APP_SECRET`. It does not mutate your shell globally.

## Existing App Diagnostics

If a host already has `app_id` and `app_secret`, the kit can validate and plan
around that app.

```bash
feishu-auth-kit doctor \
  --app-id cli_xxx \
  --app-secret yyy \
  --brand feishu
```

Environment variables are also supported:

```bash
export FEISHU_APP_ID=cli_xxx
export FEISHU_APP_SECRET=yyy
export FEISHU_BRAND=feishu
```

For global Lark tenants, use `--brand lark`.

## Token Persistence

User tokens are stored with a file-backed store keyed by `app_id + user_open_id`.

Default path resolution:

- `FEISHU_AUTH_KIT_TOKEN_STORE`
- `XDG_DATA_HOME/feishu-auth-kit/user_tokens.json`
- `~/.local/share/feishu-auth-kit/user_tokens.json`

Examples:

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

You can also save after login:

```bash
feishu-auth-kit login \
  --app-id cli_xxx \
  --app-secret yyy \
  --scope im:message:readonly \
  --save-user-open-id ou_user
```

## Owner Policy

Owner checks reuse the normal app-info query path.

```bash
feishu-auth-kit owner-check \
  --app-id cli_xxx \
  --app-secret yyy \
  --current-user-open-id ou_user \
  --mode strict_owner \
  --json
```

Modes:

- `strict_owner`: the current user must match the effective app owner.
- `permissive_if_unknown`: continue only when owner metadata is unavailable;
  known mismatches still fail.

## Runtime Cards And Continuations

The kit builds messenger-agnostic JSON payloads. It does not send cards itself.

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

## Minimal Native Runtime And Codex Verification

The first native-runtime goal is intentionally narrow: prove that this
repository can stand on its own as a Feishu native agent substrate before any
ControlMesh integration.

1. Normalize a Feishu inbound message into a stable context envelope.
2. Feed that envelope into a runner seam.
3. Emit a single-card step snapshot with final text and optional tool steps.

Normalize an inbound Feishu event:

```bash
feishu-auth-kit agent parse-inbound --event-file ./examples/feishu-event.json
```

Minimal local demo without an external agent:

```bash
feishu-auth-kit agent run \
  --event-file ./examples/feishu-event.json \
  --runner echo \
  --echo-prefix "Codex stub"
```

Minimal Codex-facing demo on a machine that already has Codex CLI:

```bash
feishu-auth-kit agent run \
  --event-file ./examples/feishu-event.json \
  --runner codex \
  --model gpt-5.4 \
  --codex-cd .
```

The output is JSON containing:

- normalized Feishu message context
- runner request payload
- runner result
- a `feishu-auth-kit.cardkit.single_card.v1` snapshot ready for a future Feishu
  card sender

## Auth Orchestration

The orchestration layer converts permission and auth failures into reusable
host actions.

Plan a scope request:

```bash
feishu-auth-kit orchestration plan \
  --requested-scope offline_access,im:message:readonly \
  --app-scope offline_access,im:message:readonly \
  --user-scope offline_access
```

Route a missing-permission event:

```bash
feishu-auth-kit orchestration route \
  --app-id cli_xxx \
  --error-kind app_scope_missing \
  --required-scope offline_access \
  --user-open-id ou_user \
  --flow-key flow-1 \
  --permission-url "https://open.feishu.cn/app/cli_xxx/auth?q=offline_access"
```

Build a retry artifact after auth completes:

```bash
feishu-auth-kit orchestration retry \
  --operation-id op_123 \
  --text "Please continue the previous operation."
```

Verify device-flow identity:

```bash
feishu-auth-kit orchestration verify-identity \
  --brand feishu \
  --access-token token \
  --expected-open-id ou_user
```

## Minimal Claude Surface

Claude or another tool caller can ask the kit for structured JSON and render or
relay it however it wants.

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

## Host Integration Contract

A host runtime should own:

- message send or card render
- webhook or long-poll ingress
- callback ingress
- chat or session binding
- retry injection into its own orchestrator

`feishu-auth-kit` should own:

- app registration
- app/scope inspection
- owner policy
- user OAuth primitives
- token and continuation state
- inbound message context normalization
- local runner seams
- single-card step model
- permission and auth planning
- synthetic retry artifacts

That split keeps this repository reusable and keeps downstream runtimes honest
about what they are responsible for.

## Validation

```bash
uv run ruff check .
uv run pytest -q
```
