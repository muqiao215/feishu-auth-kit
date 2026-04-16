# feishu-auth-kit

Reusable Python kit for Feishu/Lark app onboarding, scope inspection, owner
policy checks, OAuth device authorization, token persistence, and generic
interactive continuation payloads.

This repository stays standalone. It is designed to be consumed by Claude Code,
OpenClaw integrations, shell scripts, or future ControlMesh work, but it is not
coupled to any one runtime.

## Positioning

This project exists to cover the gap between:

- Feishu/Lark Open Platform setup, where a human still has to create and
  publish the app.
- Downstream runtimes that need reusable auth/onboarding primitives without
  hardcoding Feishu behavior into their own codebase.

The implementation was conceptually inspired by auth/onboarding behavior in
`larksuite/openclaw-lark`, especially scope inspection, permission links, OAuth
device flow, and staged authorization. It is independently implemented in
Python and does not vendor TypeScript source from that project.

## What This Is

- A small Python library for Feishu/Lark auth and onboarding primitives.
- A CLI for setup guidance, diagnostics, token persistence, owner checks, device
  login, batch authorization, generic interactive card payloads, and a tiny
  Claude-facing wrapper.
- A reusable boundary for Claude/OpenClaw/scripts today, and a possible shared
  dependency for other systems later.

## Non-Goals

- No ControlMesh integration in this repository or task.
- No direct app creation inside Feishu/Lark Open Platform.
- No bypass of tenant admin approval, app publishing, or platform review.
- No runtime-specific UI framework baked into the library.

If you do not already have a self-built app plus `app_id` and `app_secret`, you
still need Feishu/Lark Open Platform involvement first. This kit automates
around that boundary; it does not replace it.

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

This keeps the runtime contract small and avoids coupling the repo to a
particular bot framework.

## Existing Auth Commands

### `setup`

Print a zero-start guide for the human Open Platform step.

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
