# feishu-auth-kit

Reusable Python kit for Feishu/Lark app permission validation, permission-link
generation, OAuth device authorization, and batched onboarding flows.

This repository is a standalone extraction target for Feishu/Lark auth and
onboarding behavior. ControlMesh, Claude scripts, OpenClaw plugins, and other
automation can consume it later through either the `feishu-auth-kit` CLI or the
importable Python library.

The implementation was conceptually inspired by the auth/onboarding flows in
`larksuite/openclaw-lark`, especially around app scope inspection, permission
links, OAuth device flow, and safe batch authorization. It is independently
implemented in Python and does not vendor TypeScript source from that project.

## What This Is

- A small Python library for Feishu/Lark Open Platform auth primitives.
- A CLI for setup guidance, diagnostics, scope listing, device login, and batch
  user-scope authorization.
- A future shared dependency for ControlMesh, Claude/Codex scripts, OpenClaw
  plugins, or any service that needs Feishu/Lark app onboarding.
- A validation and permission-guidance layer after app credentials already
  exist.

## What This Is Not

- It is not ControlMesh integration. This repo deliberately does not modify
  `/root/.ductor/workspace/ControlMesh`.
- It cannot magically create a Feishu/Lark app without the Feishu Open Platform
  or Lark Developer Console.
- It cannot bypass tenant admin approval, app publishing, or platform permission
  review.
- It is not a token vault. The CLI prints obtained token metadata but does not
  persist user tokens yet.

## Install For Development

```bash
cd /root/.ductor/workspace/feishu-auth-kit
uv sync --extra dev
uv run pytest -q
uv run ruff check .
```

You can also run the CLI directly:

```bash
uv run feishu-auth-kit setup
```

## Credentials

Most commands accept explicit flags:

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

For Lark global tenant apps, use `--brand lark` or `LARK_BRAND=lark`.

## CLI Commands

### `setup`

Prints a zero-start app creation guide.

Example:

```bash
feishu-auth-kit setup
```

Output excerpt:

```text
Feishu / Lark app setup guide
This kit cannot create the app for you or bypass Feishu Open Platform approval.
...
4. Add core tenant permissions, especially application:application:self_manage.
5. Add offline_access for OAuth refresh tokens.
```

### `doctor`

Validates credentials, tenant token issuance, app info/scopes access, missing
core tenant permissions, and OAuth prerequisites. It prints direct permission
grant links when something is missing.

```bash
feishu-auth-kit doctor --app-id cli_xxx --app-secret yyy
```

Possible output shape:

```text
App ID: cli_xxx
Brand: feishu
Tenant token: OK, expires_in=7200
App info: OK, scopes=18
Missing core tenant permissions: 2
- application:application:self_manage
- cardkit:card:read
Tenant permission link: https://open.feishu.cn/app/cli_xxx/auth?q=...
Missing OAuth prerequisite: offline_access
User permission link: https://open.feishu.cn/app/cli_xxx/auth?q=offline_access...
```

### `scopes`

Lists app granted scopes. `--token-type user` and `--token-type tenant` filter
scopes according to `token_types` returned by the Open Platform app info API.

```bash
feishu-auth-kit scopes --app-id cli_xxx --app-secret yyy --token-type user
```

### `login`

Starts OAuth device authorization for explicit scopes or all app user scopes.
`offline_access` is automatically included in the OAuth request body.

```bash
feishu-auth-kit login \
  --app-id cli_xxx \
  --app-secret yyy \
  --scope im:message:readonly \
  --no-poll
```

Example output:

```text
Requested scopes: 1
Verification URL: https://...
User code: ABCD-EFGH
Expires in: 600s
Poll interval: 5s
```

To request all app user scopes:

```bash
feishu-auth-kit login --app-id cli_xxx --app-secret yyy --all-app-user-scopes
```

### `batch-auth`

Queries all app user scopes, removes high-risk scopes from automatic batch
authorization, splits the remaining scopes into batches, and starts one device
flow per batch.

```bash
feishu-auth-kit batch-auth \
  --app-id cli_xxx \
  --app-secret yyy \
  --batch-size 100 \
  --no-poll
```

Example output:

```text
App user scopes: 74
Sensitive scopes skipped: 4
- im:message.send_as_user
- space:document:delete
Batch 1: 70 scopes

Starting batch 1/1 (70 scopes)
Verification URL: https://...
User code: ABCD-EFGH
```

## Python API

```python
from feishu_auth_kit import FeishuAuthClient
from feishu_auth_kit.device_flow import DeviceFlowClient
from feishu_auth_kit.scopes import filter_sensitive_scopes, batch_scopes

client = FeishuAuthClient("cli_xxx", "secret", brand="feishu")
app_info = client.get_app_info()
user_scopes = client.get_granted_scopes(token_type="user")
safe_batches = batch_scopes(filter_sensitive_scopes(user_scopes), batch_size=100)

device = DeviceFlowClient("cli_xxx", "secret")
authorization = device.request_authorization(safe_batches[0])
print(authorization.verification_uri_complete, authorization.user_code)
```

## Consumer Integration

ControlMesh can consume the kit without embedding Feishu-specific onboarding
logic directly:

```bash
feishu-auth-kit doctor --app-id "$FEISHU_APP_ID" --app-secret "$FEISHU_APP_SECRET"
feishu-auth-kit batch-auth --app-id "$FEISHU_APP_ID" --app-secret "$FEISHU_APP_SECRET"
```

Claude/Codex/OpenClaw scripts can call the same CLI from automation, or import
the Python classes directly when they need structured results instead of text
output.

Recommended integration boundary:

- Keep platform-specific Feishu/Lark auth here.
- Let ControlMesh store only consumer configuration and call this kit.
- Add a token persistence adapter later instead of hardcoding a storage backend
  in the MVP.

## Current Gaps

- No persistent user-token store yet.
- No ControlMesh wrapper or UI integration yet.
- No owner-policy enforcement helper yet; this MVP exposes app owner metadata
  but does not gate commands by user Open ID.
- No automatic Feishu Open Platform app creation, because that requires normal
  platform/admin involvement.
