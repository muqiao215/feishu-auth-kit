# feishu-auth-kit

Reusable Python kit for Feishu/Lark app onboarding, scope inspection, owner
policy checks, official app scan-to-create registration, OAuth device authorization, token persistence, generic
interactive continuation payloads, and messenger-agnostic auth orchestration
primitives.

This repository stays standalone. It is designed to be consumed by Claude Code,
OpenClaw integrations, shell scripts, or future ControlMesh work, but it is not
coupled to any one runtime.

## Positioning

This project exists to cover the gap between:

- Feishu/Lark Open Platform setup, including the official `accounts`
  registration flow for scan-to-create bot/app onboarding.
- Downstream runtimes that need reusable auth/onboarding primitives without
  hardcoding Feishu behavior into their own codebase.

The implementation was conceptually inspired by auth/onboarding behavior in
`larksuite/openclaw-lark`, especially scope inspection, permission links, OAuth
device flow, and staged authorization. It is independently implemented in
Python and does not vendor TypeScript source from that project.

## What This Is

- A small Python library for Feishu/Lark auth and onboarding primitives.
- A CLI for setup guidance, diagnostics, token persistence, owner checks, device
  login, batch authorization, official app registration, generic interactive card payloads, auth
  orchestration planning, synthetic retry artifacts, and a tiny Claude-facing
  wrapper.
- A reusable boundary for Claude/OpenClaw/scripts today, and a possible shared
  dependency for other systems later.

## Non-Goals

- No ControlMesh integration in this repository or task.
- No bypass of tenant admin approval, app publishing, or platform review.
- No runtime-specific UI framework baked into the library.
- No messenger-specific callback ingress, card patch transport, or session retry
  runtime baked into the library.

The new scan-to-create support still uses the official Feishu/Lark registration
surface. It can help bootstrap a bot/app from zero, but it does not replace
Open Platform involvement, approval, publishing, or policy review. Manual
Open Platform fallback remains available.

## Install For Development

```bash
cd /root/.ductor/workspace/feishu-auth-kit
uv sync --extra dev
uv run pytest -q
uv run ruff check .
```

Run the CLI directly:

```bash
uv run feishu-auth-kit setup
```

## Official App Registration

`feishu-auth-kit` now supports the same official scan-to-create Feishu/Lark
registration surface that OpenClaw consumes, implemented independently in
Python.

Covered flow:

- `action=init` checks whether `client_secret` registration is supported.
- `action=begin` starts a `PersonalAgent` registration session and emits a QR
  URL decorated with `from=oc_onboard` and `tp=ob_cli_app`.
- `action=poll` tracks the device code with `tp=ob_app`, handles
  `authorization_pending`, `slow_down`, `access_denied`, `expired_token`, and
  switches to Lark automatically if `tenant_brand=lark`.
- Successful completion returns `app_id`, `app_secret`, resolved domain, and
  the granting user's `open_id` when present.

This is still the official Feishu/Lark `accounts` registration flow. It does
not bypass authorization or create apps through undocumented backdoors.

Examples:

```bash
feishu-auth-kit register init --json

feishu-auth-kit register begin --json

feishu-auth-kit register scan-create --no-poll --json

feishu-auth-kit register poll \
  --device-code dev_xxx \
  --interval 5 \
  --expires-in 600 \
  --poll-timeout 120 \
  --json
```

One-shot flow:

```bash
feishu-auth-kit register scan-create \
  --poll-timeout 180 \
  --write-env-file ./.feishu-auth.env \
  --json
```

The optional `--write-env-file` writes a local env-style file containing
`FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `FEISHU_BRAND`, and
`FEISHU_OWNER_OPEN_ID` when available. It never mutates your global shell
environment.

## Credentials

Most auth commands accept explicit flags:

```bash
feishu-auth-kit doctor \
  --app-id cli_xxx \
  --app-secret yyy \
  --brand feishu
```

Or environment variables:

```bash
export FEISHU_APP_ID=cli_xxx
export FEISHU_APP_SECRET=yyy
export FEISHU_BRAND=feishu
```

For global Lark tenants, use `--brand lark`.

## Token Persistence

`feishu-auth-kit` now ships a file-backed token store keyed by
`app_id + user_open_id`.

Default path resolution:

- `FEISHU_AUTH_KIT_TOKEN_STORE` if set
- otherwise `XDG_DATA_HOME/feishu-auth-kit/user_tokens.json`
- otherwise `~/.local/share/feishu-auth-kit/user_tokens.json`

CLI examples:

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

feishu-auth-kit tokens show \
  --app-id cli_xxx \
  --user-open-id ou_user

feishu-auth-kit tokens remove \
  --app-id cli_xxx \
  --user-open-id ou_user
```

You can also save directly from a successful login:

```bash
feishu-auth-kit login \
  --app-id cli_xxx \
  --app-secret yyy \
  --scope im:message:readonly \
  --save-user-open-id ou_user
```

## Owner Policy Enforcement

`owner-check` reuses the normal app info query path. There is no duplicate HTTP
logic for owner lookup.

Modes:

- `strict_owner`: current user must match the effective app owner.
- `permissive_if_unknown`: allow continuation only when owner metadata is
  missing; known mismatches still fail.

Example:

```bash
feishu-auth-kit owner-check \
  --app-id cli_xxx \
  --app-secret yyy \
  --current-user-open-id ou_user \
  --mode strict_owner \
  --json
```

## AI Agent Probe

After scan-to-create or manual credential setup, you can validate the app and
trigger official AI-agent registration support through the Feishu/Lark
OpenClaw bot ping endpoint:

```bash
feishu-auth-kit register probe \
  --app-id cli_xxx \
  --app-secret yyy \
  --json
```

This uses `/open-apis/bot/v1/openclaw_bot/ping` and is kept as a small helper
surface rather than a runtime integration.

## Generic Interactive Runtime

The repository now includes a messenger-agnostic interactive continuation layer.
It uses plain JSON payloads plus a file-backed continuation store.

Default continuation state path:

- `FEISHU_AUTH_KIT_CONTINUATION_STORE` if set
- otherwise `XDG_STATE_HOME/feishu-auth-kit/continuations.json`
- otherwise `~/.local/state/feishu-auth-kit/continuations.json`

It supports:

- building a permission-missing card payload
- building a device-flow authorization card payload
- carrying opaque `operation_id` payloads
- processing a user-confirmed action and resuming the saved state

### Permission-Missing Card

```bash
feishu-auth-kit runtime permission-card \
  --app-id cli_xxx \
  --scope offline_access \
  --permission-url "https://open.feishu.cn/app/cli_xxx/auth?q=offline_access" \
  --operation-id op_123
```

Example output shape:

```json
{
  "schema": "feishu-auth-kit.card.v1",
  "type": "permission_missing",
  "operation_id": "op_123",
  "actions": [
    {
      "action": "permissions_granted_continue",
      "payload": {
        "operation_id": "op_123"
      }
    }
  ]
}
```

### Device-Flow Authorization Card

```bash
feishu-auth-kit runtime device-card \
  --app-id cli_xxx \
  --operation-id op_456 \
  --device-code dev_123 \
  --user-code ABCD-EFGH \
  --verification-uri https://example.test/verify \
  --verification-uri-complete https://example.test/verify?code=ABCD-EFGH \
  --expires-in 600
```

### Continue After User Confirmation

```bash
feishu-auth-kit runtime continue \
  --operation-id op_123 \
  --action permissions_granted_continue \
  --actor-open-id ou_user
```

That command updates the saved continuation state to `confirmed` and returns the
updated JSON. A consumer can then continue the next auth step however it wants.

## Minimal Claude Integration

This repo includes a tiny Claude-facing surface, not a ControlMesh adapter.

### CLI Wrapper

```bash
feishu-auth-kit claude permission-card \
  --app-id cli_xxx \
  --scope offline_access \
  --permission-url "https://open.feishu.cn/app/cli_xxx/auth?q=offline_access" \
  --operation-id op_123
```

Output shape:

```json
{
  "runtime": "claude",
  "schema": "feishu-auth-kit.card.v1",
  "card": { "...generic card payload..." },
  "instructions": "Render or relay this JSON payload to the user...",
  "next_step": {
    "action": "permissions_granted_continue",
    "operation_id": "op_123"
  }
}
```

### Python Helper

```python
from feishu_auth_kit.claude_adapter import build_claude_permission_payload

payload = build_claude_permission_payload(
    app_id="cli_xxx",
    operation_id="op_123",
    missing_scopes=["offline_access"],
    permission_url="https://open.feishu.cn/app/cli_xxx/auth?q=offline_access",
)
```

Suggested Claude agent pattern:

1. Create a generic runtime card or Claude wrapper.
2. Relay the JSON payload to the user.
3. When the user says they completed the step, call
   `feishu-auth-kit runtime continue ...`.
4. Continue your own auth workflow using the confirmed continuation state.

For zero-to-app onboarding, a Claude-driven agent can also:

1. Call `feishu-auth-kit register scan-create --no-poll --json`.
2. Render or relay the returned `qr_url`, `user_code`, and `device_code`.
3. Call `feishu-auth-kit register poll ... --json` after the user scans.
4. Store or forward the returned `app_id` / `app_secret` without coupling this
   repository to Claude runtime internals.

This keeps the runtime contract small and avoids coupling the repo to a
particular bot framework.

## Auth Orchestration Primitives

`feishu-auth-kit` now includes a reusable orchestration layer for the gap
between:

- app/user scope comparison
- permission-missing vs user-auth-required routing
- duplicate suppression and scope merge for pending flows
- continuation state persistence
- post-auth synthetic retry artifacts for the host runtime

The repository still does not own messenger glue. A host is expected to render
cards, receive user callbacks, and inject retry events into its own session
pipeline.

### Plan Scope Authorization

```bash
feishu-auth-kit orchestration plan \
  --requested-scope offline_access,im:message:readonly \
  --app-scope offline_access,im:message:readonly \
  --user-scope offline_access
```

This reports:

- already granted user scopes
- missing user scopes
- unavailable scopes that the app has not enabled
- batch splits for incremental authorization

### Route An Auth Requirement

```bash
feishu-auth-kit orchestration route \
  --app-id cli_xxx \
  --error-kind app_scope_missing \
  --required-scope offline_access \
  --user-open-id ou_user \
  --flow-key flow-1 \
  --permission-url "https://open.feishu.cn/app/cli_xxx/auth?q=offline_access"
```

This produces:

- a reusable pending-flow record
- continuation state with `required_scopes`, `token_type`,
  `scope_need_type`, `flow_key`, and metadata
- a generic permission or device-flow card payload

Repeated calls with the same `flow-key` reuse the existing `operation_id` and
merge scopes instead of creating duplicate flows.

### Build A Synthetic Retry Artifact

```bash
feishu-auth-kit orchestration retry \
  --operation-id op_123 \
  --text "Please continue the previous operation."
```

The output is a messenger-agnostic retry artifact. A host runtime can consume
it and decide how to re-inject the continuation into its own message/session
pipeline.

### Verify Device-Flow Identity

```bash
feishu-auth-kit orchestration verify-identity \
  --brand feishu \
  --access-token token \
  --expected-open-id ou_user
```

This checks `/open-apis/authen/v1/user_info` and confirms whether the completed
OAuth flow belongs to the expected user.

### Host Integration Pattern

Minimal host loop:

1. Host detects a permission or auth error in its own runtime.
2. Host calls `feishu-auth-kit orchestration route ...`.
3. Host renders the returned card JSON to the user.
4. User confirms completion in the host UI.
5. Host loads the saved continuation and, after the auth step succeeds, calls
   `feishu-auth-kit orchestration retry ...`.
6. Host consumes the retry artifact and re-injects the original operation in
   its own session/orchestrator.

This repository intentionally stops at the reusable boundary above. It does not
implement the final messenger runtime glue.

## Existing Auth Commands

### `register`

Runs the official Feishu/Lark app registration flow.

```bash
feishu-auth-kit register scan-create --no-poll --json
```

### `setup`

Print a zero-start guide covering official scan-to-create plus manual fallback.

```bash
feishu-auth-kit setup
```

### `doctor`

Validates credentials, tenant token issuance, app info/scopes access, core
scope gaps, and prints permission links when something is missing.

```bash
feishu-auth-kit doctor --app-id cli_xxx --app-secret yyy
```

### `scopes`

Lists granted scopes, optionally filtered by token type.

```bash
feishu-auth-kit scopes --app-id cli_xxx --app-secret yyy --token-type user
```

### `login`

Starts OAuth device authorization for explicit scopes or all app user scopes.
`offline_access` is automatically included.

```bash
feishu-auth-kit login \
  --app-id cli_xxx \
  --app-secret yyy \
  --scope im:message:readonly \
  --no-poll
```

### `batch-auth`

Queries all app user scopes, removes sensitive scopes from automatic batching,
then runs device flow one batch at a time.

```bash
feishu-auth-kit batch-auth \
  --app-id cli_xxx \
  --app-secret yyy \
  --batch-size 100 \
  --no-poll
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

## Validation

Current repo validation command set:

```bash
uv run ruff check .
uv run pytest -q
```
