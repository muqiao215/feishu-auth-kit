#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { AgentTurnRequest, CodexCliRunner, EchoRunner } from './agent-runtime.js';
import { AppRegistrationClient, AppRegistrationPollResult } from './app-registration.js';
import { buildSingleCardRun } from './cardkit.js';
import {
  buildClaudeDeviceFlowPayload,
  buildClaudePermissionPayload,
} from './claude-adapter.js';
import { FeishuApiError, FeishuAuthClient } from './client.js';
import { DeviceFlowClient, DeviceFlowError } from './device-flow.js';
import { parseFeishuMessageContext } from './message-context.js';
import { DeviceAuthorization } from './models.js';
import {
  NativeCardAction,
  bindAuthContinuationToNative,
  buildRetryArtifactFromRequest,
  resolveCardActionToRetry,
} from './native-contract.js';
import {
  AuthRequirement,
  FilePendingFlowRegistry,
  buildSyntheticRetryArtifact,
  loadAuthContinuation,
  planScopeAuthorization,
  routeAuthRequirement,
  verifyAccessTokenIdentity,
} from './orchestration.js';
import { OwnerPolicyMode, checkOwnerPolicy } from './owner-policy.js';
import { registerAiAgent } from './probe.js';
import {
  CardAction,
  ContinuationState,
  FileContinuationStore,
  buildDeviceFlowCard,
  buildPermissionMissingCard,
  newOperationId,
  processCardAction,
} from './runtime-cards.js';
import {
  batchScopes,
  filterSensitiveScopes,
  missingCoreScopes,
  summarizeScopeBatches,
} from './scopes.js';
import { FileTokenStore, StoredUserToken } from './token-store.js';

export function formatSetupGuide(brand: string = 'feishu'): string {
  const platform = brand === 'lark' ? 'open.larksuite.com' : 'open.feishu.cn';
  return [
    'Feishu / Lark app setup guide',
    '',
    'This kit supports the official scan-to-create app registration flow.',
    'It still does not bypass Open Platform approval, review, or publishing policy.',
    '',
    'Zero-start checklist:',
    '1. Try `feishu-auth-kit register scan-create` for official QR onboarding.',
    `2. If scan-create is unavailable, open ${platform} and create an app manually.`,
    '3. Copy App ID and App Secret from the credentials page.',
    '4. Enable core permissions:',
    '   - application:application:self_manage',
    '   - offline_access',
    '5. Add the user or tenant scopes your downstream tool actually needs.',
    '6. Publish or release the app according to Feishu/Lark policy.',
    '7. Run `feishu-auth-kit doctor --app-id ... --app-secret ...`.',
    '',
    'This repository guides setup and automates validation and OAuth.',
  ].join('\n');
}

function splitCsv(items: string[] | string | undefined | null): string[] {
  if (!items) return [];
  const arr = Array.isArray(items) ? items : [items];
  const scopes: string[] = [];
  for (const item of arr) {
    for (const part of item.split(',')) {
      const trimmed = part.trim();
      if (trimmed) scopes.push(trimmed);
    }
  }
  return scopes;
}

function defaultBrand(): string {
  return process.env.FEISHU_BRAND || process.env.LARK_BRAND || 'feishu';
}

function credentialsFromArgs(opts: Record<string, any>): { appId?: string; appSecret?: string } {
  const appId =
    opts['app-id'] ||
    opts.appId ||
    process.env.FEISHU_APP_ID ||
    process.env.LARK_APP_ID;
  const appSecret =
    opts['app-secret'] ||
    opts.appSecret ||
    process.env.FEISHU_APP_SECRET ||
    process.env.LARK_APP_SECRET;
  return { appId, appSecret };
}

function requireClient(opts: Record<string, any>): FeishuAuthClient {
  const { appId, appSecret } = credentialsFromArgs(opts);
  if (!appId || !appSecret) {
    console.error('Missing app credentials. Pass --app-id/--app-secret or set env vars.');
    process.exit(2);
  }
  const brand = opts.brand || defaultBrand();
  return new FeishuAuthClient(appId, appSecret, { brand });
}

function printScopeBlock(title: string, scopes: string[]): void {
  console.log(`${title}: ${scopes.length}`);
  for (const scope of scopes) {
    console.log(`  - ${scope}`);
  }
}

function jsonDump(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

function jsonLine(payload: unknown): void {
  console.log(JSON.stringify(payload));
}

function loadJsonFile(pathValue: string): Record<string, any> {
  const resolved = path.resolve(pathValue);
  return JSON.parse(fs.readFileSync(resolved, 'utf-8'));
}

function tokenStoreFromArgs(opts: Record<string, any>): FileTokenStore {
  return new FileTokenStore(opts['token-store-path'] || opts.tokenStorePath);
}

function continuationStoreFromArgs(opts: Record<string, any>): FileContinuationStore {
  return new FileContinuationStore(opts['continuation-store-path'] || opts.continuationStorePath);
}

function pendingFlowStoreFromArgs(opts: Record<string, any>): FilePendingFlowRegistry {
  return new FilePendingFlowRegistry(opts['pending-flow-store-path'] || opts.pendingFlowStorePath);
}

function registrationClientFromArgs(opts: Record<string, any>): AppRegistrationClient {
  return new AppRegistrationClient({ brand: opts.brand || defaultBrand() });
}

function printRegistrationBegin(result: any): void {
  const payload = {
    status: 'authorization_required',
    device_code: result.device_code,
    user_code: result.user_code,
    qr_url: result.qr_url,
    verification_uri: result.verification_uri,
    verification_uri_complete: result.verification_uri_complete,
    interval: result.interval,
    expires_in: result.expires_in,
  };
  jsonDump(payload);
}

function printRegistrationPollResult(outcome: AppRegistrationPollResult): number {
  if (outcome.status === 'success' && outcome.result) {
    jsonDump({
      status: outcome.status,
      app_id: outcome.result.app_id,
      app_secret: outcome.result.app_secret,
      domain: outcome.result.domain,
      open_id: outcome.result.open_id,
    });
    return 0;
  }
  const payload: Record<string, any> = { status: outcome.status };
  if (outcome.message) {
    payload.message = outcome.message;
  }
  jsonDump(payload);
  return 1;
}

function writeRegistrationEnvFile(pathValue: string, outcome: AppRegistrationPollResult): void {
  if (outcome.status !== 'success' || !outcome.result) return;
  const target = path.resolve(pathValue);
  if (fs.existsSync(target)) {
    console.error(`Refusing to overwrite existing file: ${target}`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const lines = [
    `FEISHU_APP_ID=${outcome.result.app_id}`,
    `FEISHU_APP_SECRET=${outcome.result.app_secret}`,
    `FEISHU_BRAND=${outcome.result.domain}`,
  ];
  if (outcome.result.open_id) {
    lines.push(`FEISHU_OWNER_OPEN_ID=${outcome.result.open_id}`);
  }
  fs.writeFileSync(target, lines.join('\n') + '\n', 'utf-8');
}

// Subcommand Handlers
async function cmdSetup(opts: Record<string, any>): Promise<number> {
  console.log(formatSetupGuide(opts.brand || defaultBrand()));
  return 0;
}

async function cmdRegisterInit(opts: Record<string, any>): Promise<number> {
  const result = await registrationClientFromArgs(opts).init();
  if (opts.json) {
    jsonDump({
      status: 'supported',
      nonce: result.nonce,
      supported_auth_methods: result.supported_auth_methods,
    });
  } else {
    console.log('Official app registration is supported in this environment.');
    console.log(`Supported auth methods: ${result.supported_auth_methods.join(', ')}`);
  }
  return 0;
}

async function cmdRegisterBegin(opts: Record<string, any>): Promise<number> {
  const result = await registrationClientFromArgs(opts).begin();
  if (opts.json) {
    printRegistrationBegin(result);
  } else {
    console.log('Scan-to-create authorization');
    console.log(`QR URL: ${result.qr_url}`);
    console.log(`Verification URL: ${result.verification_uri_complete}`);
    console.log(`User code: ${result.user_code}`);
    console.log(`Device code: ${result.device_code}`);
    console.log(`Poll interval: ${result.interval}s`);
    console.log(`Expires in: ${result.expires_in}s`);
  }
  return 0;
}

async function cmdRegisterPoll(opts: Record<string, any>): Promise<number> {
  const outcome = await registrationClientFromArgs(opts).poll(opts['device-code'], {
    interval: opts.interval ? Number(opts.interval) : 5,
    expiresIn: opts['expires-in'] ? Number(opts['expires-in']) : 600,
    tp: opts.tp || 'ob_app',
    pollTimeout: opts['poll-timeout'] ? Number(opts['poll-timeout']) : undefined,
  });
  if (outcome.status === 'success' && outcome.result && opts['write-env-file']) {
    writeRegistrationEnvFile(opts['write-env-file'], outcome);
  }
  if (opts.json) {
    return printRegistrationPollResult(outcome);
  }
  if (outcome.status === 'success' && outcome.result) {
    console.log('Scan-to-create completed.');
    console.log(`App ID: ${outcome.result.app_id}`);
    console.log(`App Secret: ${outcome.result.app_secret}`);
    console.log(`Domain: ${outcome.result.domain}`);
    if (outcome.result.open_id) {
      console.log(`Owner open_id: ${outcome.result.open_id}`);
    }
    if (opts['write-env-file']) {
      console.log(`Wrote env file: ${path.resolve(opts['write-env-file'])}`);
    }
    return 0;
  }
  console.log(`Registration status: ${outcome.status}`);
  if (outcome.message) {
    console.log(`Message: ${outcome.message}`);
  }
  return 1;
}

async function cmdRegisterScanCreate(opts: Record<string, any>): Promise<number> {
  const client = registrationClientFromArgs(opts);
  await client.init();
  const begin = await client.begin();
  if (opts['no-poll']) {
    if (opts.json) {
      printRegistrationBegin(begin);
    } else {
      console.log('Scan-to-create authorization');
      console.log(`QR URL: ${begin.qr_url}`);
      console.log(`User code: ${begin.user_code}`);
      console.log(`Device code: ${begin.device_code}`);
    }
    return 0;
  }
  const outcome = await client.poll(begin.device_code, {
    interval: begin.interval,
    expiresIn: begin.expires_in,
    tp: opts.tp || 'ob_app',
    pollTimeout: opts['poll-timeout'] ? Number(opts['poll-timeout']) : undefined,
  });
  if (outcome.status === 'success' && outcome.result && opts['write-env-file']) {
    writeRegistrationEnvFile(opts['write-env-file'], outcome);
  }
  if (opts.json) {
    return printRegistrationPollResult(outcome);
  }
  if (outcome.status === 'success' && outcome.result) {
    console.log('Scan-to-create completed.');
    console.log(`App ID: ${outcome.result.app_id}`);
    console.log(`App Secret: ${outcome.result.app_secret}`);
    console.log(`Domain: ${outcome.result.domain}`);
    if (outcome.result.open_id) {
      console.log(`Owner open_id: ${outcome.result.open_id}`);
    }
    if (opts['write-env-file']) {
      console.log(`Wrote env file: ${path.resolve(opts['write-env-file'])}`);
    }
    return 0;
  }
  console.log(`Registration status: ${outcome.status}`);
  if (outcome.message) {
    console.log(`Message: ${outcome.message}`);
  }
  return 1;
}

async function cmdRegisterProbe(opts: Record<string, any>): Promise<number> {
  const client = requireClient(opts);
  const result = await registerAiAgent(client);
  const payload = {
    ok: result.ok,
    app_id: result.app_id,
    bot_name: result.bot_name,
    bot_open_id: result.bot_open_id,
    error: result.error,
  };
  if (opts.json) {
    jsonDump(payload);
  } else {
    console.log(`OK: ${result.ok ? 'yes' : 'no'}`);
    console.log(`App ID: ${result.app_id}`);
    if (result.bot_name) console.log(`Bot name: ${result.bot_name}`);
    if (result.bot_open_id) console.log(`Bot open_id: ${result.bot_open_id}`);
    if (result.error) console.log(`Error: ${result.error}`);
  }
  return result.ok ? 0 : 1;
}

async function cmdDoctor(opts: Record<string, any>): Promise<number> {
  const client = requireClient(opts);
  let exitCode = 0;
  console.log('Doctor report');
  console.log(`Brand: ${opts.brand || defaultBrand()}`);
  console.log(`App ID: ${client.appId}`);

  try {
    const tenantToken = await client.getTenantAccessToken();
    console.log('Tenant token: OK');
    console.log(`Tenant token TTL: ${tenantToken.expire || 'unknown'}`);
  } catch (err) {
    console.log(`Tenant token: FAILED (${err})`);
    return 1;
  }

  let appInfo;
  try {
    appInfo = await client.getAppInfo(opts['target-app-id'] || 'me');
  } catch (err) {
    console.log(`App info: FAILED (${err})`);
    const permissionUrl = client.buildPermissionUrl(client.appId, {
      scopes: ['application:application:self_manage'],
    });
    console.log(`Grant application self-management: ${permissionUrl}`);
    return 1;
  }

  console.log(`App info: OK (${appInfo.app_id})`);
  if (appInfo.name) console.log(`App name: ${appInfo.name}`);
  if (appInfo.effective_owner_open_id) {
    console.log(`App owner open_id: ${appInfo.effective_owner_open_id}`);
  }

  const tenantScopes = await client.getGrantedScopes({ tokenType: 'tenant', appInfo });
  const userScopes = await client.getGrantedScopes({ tokenType: 'user', appInfo });
  const allScopes = await client.getGrantedScopes({ appInfo });
  printScopeBlock('Tenant scopes', tenantScopes);
  printScopeBlock('User scopes', userScopes);

  const missing = missingCoreScopes(allScopes);
  if (missing.length > 0) {
    exitCode = 1;
    console.log('Missing core permissions:');
    for (const scope of missing) {
      const tokenType = scope === 'offline_access' ? 'user' : 'tenant';
      const url = client.buildPermissionUrl(appInfo.app_id || client.appId, {
        scopes: [scope],
        tokenType,
      });
      console.log(`  - ${scope}`);
      console.log(`    ${url}`);
    }
  } else {
    console.log('Missing core permissions: none');
  }
  return exitCode;
}

async function cmdScopes(opts: Record<string, any>): Promise<number> {
  const client = requireClient(opts);
  const scopes = await client.getGrantedScopes({
    tokenType: opts['token-type'] || undefined,
  });
  console.log(`Granted scopes: ${scopes.length}`);
  for (const scope of scopes) {
    console.log(scope);
  }
  return 0;
}

async function resolveLoginScopes(
  opts: Record<string, any>,
  client: FeishuAuthClient,
): Promise<string[]> {
  const explicit = splitCsv(opts.scope);
  if (explicit.length > 0) return explicit;
  return client.getGrantedScopes({ tokenType: 'user' });
}

async function cmdLogin(opts: Record<string, any>): Promise<number> {
  const client = requireClient(opts);
  const scopes = await resolveLoginScopes(opts, client);
  if (scopes.length === 0) {
    console.log('No scopes available for device flow.');
    return 1;
  }
  const flow = new DeviceFlowClient(client.appId, client.appSecret, {
    brand: opts.brand || defaultBrand(),
  });
  const auth = await flow.requestAuthorization(scopes);
  console.log(`Verification URL: ${auth.verification_uri}`);
  console.log(`Verification URL (complete): ${auth.verification_uri_complete}`);
  console.log(`User code: ${auth.user_code}`);
  console.log(`Expires in: ${auth.expires_in}s`);
  console.log(`Poll interval: ${auth.interval}s`);
  console.log(`Requested scopes: ${scopes.join(' ')}`);

  if (opts['no-poll']) {
    return 0;
  }

  let token;
  try {
    token = await flow.pollForToken(auth.device_code, {
      interval: auth.interval,
      expiresIn: auth.expires_in,
    });
  } catch (err: any) {
    console.log(`Device flow polling failed: ${err.message || err}`);
    return 1;
  }

  console.log('Device flow completed.');
  console.log(`Access token acquired: ${token.access_token ? 'yes' : 'no'}`);
  console.log(`Granted scope: ${token.scope || '(not returned)'}`);

  const saveUserOpenId = opts['save-user-open-id'];
  if (saveUserOpenId) {
    const store = tokenStoreFromArgs(opts);
    const stored = store.saveDeviceToken(client.appId, saveUserOpenId, token);
    console.log(`Stored token for ${stored.user_open_id} at ${store.path}`);
  }
  return 0;
}

async function cmdBatchAuth(opts: Record<string, any>): Promise<number> {
  const client = requireClient(opts);
  const userScopes = await client.getGrantedScopes({ tokenType: 'user' });
  const safeScopes = filterSensitiveScopes(userScopes);
  const batchSize = opts['batch-size'] ? Number(opts['batch-size']) : 100;
  const batches = batchScopes(safeScopes, batchSize);
  if (batches.length === 0) {
    console.log('No user scopes available for batch authorization.');
    return 1;
  }
  for (const line of summarizeScopeBatches(batches)) {
    console.log(line);
  }

  const flow = new DeviceFlowClient(client.appId, client.appSecret, {
    brand: opts.brand || defaultBrand(),
  });
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`Starting batch ${i + 1}/${batches.length}`);
    console.log('Scopes:');
    for (const scope of batch) {
      console.log(`  - ${scope}`);
    }
    const auth = await flow.requestAuthorization(batch);
    console.log(`Open: ${auth.verification_uri_complete}`);
    console.log(`User code: ${auth.user_code}`);
    if (opts['no-poll']) {
      console.log('Stopping after link generation because --no-poll was used.');
      return 0;
    }
    let token;
    try {
      token = await flow.pollForToken(auth.device_code, {
        interval: auth.interval,
        expiresIn: auth.expires_in,
      });
    } catch (err: any) {
      console.log(`Batch ${i + 1} failed: ${err.message || err}`);
      return 1;
    }
    if (opts['save-user-open-id']) {
      tokenStoreFromArgs(opts).saveDeviceToken(client.appId, opts['save-user-open-id'], token);
    }
  }
  return 0;
}

async function cmdTokensStatus(opts: Record<string, any>): Promise<number> {
  const status = tokenStoreFromArgs(opts).status(opts['app-id'], opts['user-open-id']);
  if (opts.json) {
    jsonDump({
      app_id: status.app_id,
      user_open_id: status.user_open_id,
      exists: status.exists,
      scope: status.scope,
      expires_at: status.expires_at,
      refresh_expires_at: status.refresh_expires_at,
      storage_path: status.storage_path,
    });
  } else {
    console.log(`Exists: ${status.exists ? 'yes' : 'no'}`);
    console.log(`Storage path: ${status.storage_path}`);
    if (status.exists) {
      console.log(`Scope: ${status.scope || '(unknown)'}`);
      console.log(`Expires at: ${status.expires_at ?? 'unknown'}`);
    }
  }
  return 0;
}

async function cmdTokensShow(opts: Record<string, any>): Promise<number> {
  const token = tokenStoreFromArgs(opts).load(opts['app-id'], opts['user-open-id']);
  if (!token) {
    console.log('Token not found.');
    return 1;
  }
  jsonDump({
    app_id: token.app_id,
    user_open_id: token.user_open_id,
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expires_at: token.expires_at,
    refresh_expires_at: token.refresh_expires_at,
    scope: token.scope,
  });
  return 0;
}

async function cmdTokensSave(opts: Record<string, any>): Promise<number> {
  const token: StoredUserToken = {
    app_id: opts['app-id'],
    user_open_id: opts['user-open-id'],
    access_token: opts['access-token'],
    refresh_token: opts['refresh-token'] || null,
    expires_at: opts['expires-at'] ? Number(opts['expires-at']) : null,
    refresh_expires_at: opts['refresh-expires-at'] ? Number(opts['refresh-expires-at']) : null,
    scope: opts.scope || null,
  };
  const store = tokenStoreFromArgs(opts);
  store.save(token);
  console.log(`Saved token to ${store.path}`);
  return 0;
}

async function cmdTokensRemove(opts: Record<string, any>): Promise<number> {
  const removed = tokenStoreFromArgs(opts).remove(opts['app-id'], opts['user-open-id']);
  console.log(removed ? 'Removed.' : 'Token not found.');
  return removed ? 0 : 1;
}

async function cmdOwnerCheck(opts: Record<string, any>): Promise<number> {
  const client = requireClient(opts);
  const mode = (opts.mode as OwnerPolicyMode) || OwnerPolicyMode.STRICT_OWNER;
  const result = await checkOwnerPolicy(client, {
    currentUserOpenId: opts['current-user-open-id'],
    mode,
    appId: opts['target-app-id'] || 'me',
  });
  if (opts.json) {
    jsonDump({
      allowed: result.allowed,
      mode: result.mode,
      owner_open_id: result.owner_open_id,
      current_user_open_id: result.current_user_open_id,
      reason: result.reason,
      app_id: result.app_info.app_id,
    });
  } else {
    console.log(`Allowed: ${result.allowed ? 'yes' : 'no'}`);
    console.log(`Mode: ${result.mode}`);
    console.log(`Owner open_id: ${result.owner_open_id || '(unknown)'}`);
    console.log(`Reason: ${result.reason}`);
  }
  return result.allowed ? 0 : 1;
}

function saveCardState(
  opts: Record<string, any>,
  options: { operationId: string; kind: string; payload: Record<string, any> },
): void {
  continuationStoreFromArgs(opts).save({
    operationId: options.operationId,
    appId: opts['app-id'],
    kind: options.kind,
    status: 'waiting',
    payload: options.payload,
  });
}

async function cmdRuntimePermissionCard(opts: Record<string, any>): Promise<number> {
  const operationId = opts['operation-id'] || newOperationId();
  const missingScopes = splitCsv(opts.scope);
  const card = buildPermissionMissingCard({
    appId: opts['app-id'],
    operationId,
    missingScopes,
    permissionUrl: opts['permission-url'],
    userOpenId: opts['user-open-id'],
  });
  saveCardState(opts, {
    operationId,
    kind: 'permission_missing',
    payload: {
      missing_scopes: missingScopes,
      permission_url: opts['permission-url'],
      user_open_id: opts['user-open-id'],
    },
  });
  jsonDump(card.toDict());
  return 0;
}

async function cmdRuntimeDeviceCard(opts: Record<string, any>): Promise<number> {
  const operationId = opts['operation-id'] || newOperationId();
  const authorization: DeviceAuthorization = {
    device_code: opts['device-code'],
    user_code: opts['user-code'],
    verification_uri: opts['verification-uri'],
    verification_uri_complete: opts['verification-uri-complete'] || opts['verification-uri'],
    expires_in: Number(opts['expires-in']),
    interval: opts.interval ? Number(opts.interval) : 5,
  };
  const card = buildDeviceFlowCard({
    appId: opts['app-id'],
    operationId,
    authorization,
  });
  saveCardState(opts, {
    operationId,
    kind: 'device_flow_authorization',
    payload: card.toDict().fields,
  });
  jsonDump(card.toDict());
  return 0;
}

async function cmdRuntimeContinue(opts: Record<string, any>): Promise<number> {
  const result = processCardAction(
    new CardAction({
      action: opts.action,
      payload: {
        operation_id: opts['operation-id'],
        actor_open_id: opts['actor-open-id'],
      },
    }),
    continuationStoreFromArgs(opts),
  );
  jsonDump({
    operation_id: result.operationId,
    app_id: result.appId,
    kind: result.kind,
    status: result.status,
    payload: result.payload,
  });
  return 0;
}

async function cmdClaudePermissionCard(opts: Record<string, any>): Promise<number> {
  const operationId = opts['operation-id'] || newOperationId();
  const missingScopes = splitCsv(opts.scope);
  saveCardState(opts, {
    operationId,
    kind: 'permission_missing',
    payload: {
      missing_scopes: missingScopes,
      permission_url: opts['permission-url'],
      user_open_id: opts['user-open-id'],
    },
  });
  const payload = buildClaudePermissionPayload({
    appId: opts['app-id'],
    operationId,
    missingScopes,
    permissionUrl: opts['permission-url'],
    userOpenId: opts['user-open-id'],
  });
  jsonDump(payload);
  return 0;
}

async function cmdClaudeDeviceCard(opts: Record<string, any>): Promise<number> {
  const operationId = opts['operation-id'] || newOperationId();
  const authorization: DeviceAuthorization = {
    device_code: opts['device-code'],
    user_code: opts['user-code'],
    verification_uri: opts['verification-uri'],
    verification_uri_complete: opts['verification-uri-complete'] || opts['verification-uri'],
    expires_in: Number(opts['expires-in']),
    interval: opts.interval ? Number(opts.interval) : 5,
  };
  saveCardState(opts, {
    operationId,
    kind: 'device_flow_authorization',
    payload: {
      device_code: authorization.device_code,
      user_code: authorization.user_code,
      verification_uri: authorization.verification_uri,
      verification_uri_complete: authorization.verification_uri_complete,
      expires_in: authorization.expires_in,
      interval: authorization.interval,
    },
  });
  const payload = buildClaudeDeviceFlowPayload({
    appId: opts['app-id'],
    operationId,
    authorization,
  });
  jsonDump(payload);
  return 0;
}

async function cmdOrchestrationPlan(opts: Record<string, any>): Promise<number> {
  const requestedScopes = splitCsv(opts['requested-scope']);
  const plan = planScopeAuthorization({
    requestedScopes,
    appGrantedScopes: splitCsv(opts['app-scope']),
    userGrantedScopes: splitCsv(opts['user-scope']),
    batchSize: opts['batch-size'] ? Number(opts['batch-size']) : 100,
    filterSensitive: !opts['keep-sensitive'],
  });
  jsonDump({
    requested_scopes: plan.requestedScopes,
    app_granted_scopes: plan.appGrantedScopes,
    user_granted_scopes: plan.userGrantedScopes,
    already_granted_scopes: plan.alreadyGrantedScopes,
    missing_user_scopes: plan.missingUserScopes,
    unavailable_scopes: plan.unavailableScopes,
    batches: plan.batches,
  });
  return 0;
}

async function cmdOrchestrationRoute(opts: Record<string, any>): Promise<number> {
  let authorization: DeviceAuthorization | null = null;
  if (opts['error-kind'] !== 'app_scope_missing') {
    authorization = {
      device_code: opts['device-code'] || 'device-code',
      user_code: opts['user-code'] || 'user-code',
      verification_uri: opts['verification-uri'] || 'https://example.test/verify',
      verification_uri_complete:
        opts['verification-uri-complete'] || opts['verification-uri'] || 'https://example.test/verify',
      expires_in: opts['expires-in'] ? Number(opts['expires-in']) : 600,
      interval: opts.interval ? Number(opts.interval) : 5,
    };
  }
  const result = routeAuthRequirement({
    appId: opts['app-id'],
    requirement: new AuthRequirement({
      errorKind: opts['error-kind'],
      requiredScopes: splitCsv(opts['required-scope']),
      tokenType: opts['token-type'] || 'user',
      scopeNeedType: opts['scope-need-type'] || 'all',
      userOpenId: opts['user-open-id'],
      flowKey: opts['flow-key'],
      operationId: opts['operation-id'],
      metadata: opts.source ? { source: opts.source } : {},
    }),
    pendingFlows: pendingFlowStoreFromArgs(opts),
    continuationStore: continuationStoreFromArgs(opts),
    permissionUrl: opts['permission-url'],
    authorization,
  });
  jsonDump({
    decision: result.decision,
    reused_existing_flow: result.reusedExistingFlow,
    flow: {
      flow_key: result.flow.flowKey,
      operation_id: result.flow.operationId,
      required_scopes: result.flow.requiredScopes,
      token_type: result.flow.tokenType,
      scope_need_type: result.flow.scopeNeedType,
    },
    continuation: result.continuation.toState().payload,
    card: result.card ? result.card.toDict() : null,
  });
  return 0;
}

async function cmdOrchestrationRetry(opts: Record<string, any>): Promise<number> {
  const continuation = loadAuthContinuation(
    continuationStoreFromArgs(opts),
    opts['operation-id'],
  );
  if (!continuation) {
    console.log('Continuation not found.');
    return 1;
  }
  const artifact = buildSyntheticRetryArtifact({
    operationId: continuation.operationId,
    appId: continuation.appId,
    userOpenId: continuation.userOpenId,
    text: opts.text,
    reason: opts.reason || 'auth_completed',
    metadata: { flow_key: continuation.flowKey, ...continuation.metadata },
  });
  jsonDump(artifact.toDict());
  return 0;
}

async function cmdOrchestrationVerifyIdentity(opts: Record<string, any>): Promise<number> {
  const result = await verifyAccessTokenIdentity({
    accessToken: opts['access-token'],
    expectedOpenId: opts['expected-open-id'],
    brand: opts.brand || defaultBrand(),
  });
  jsonDump({
    valid: result.valid,
    expected_open_id: result.expectedOpenId,
    actual_open_id: result.actualOpenId,
  });
  return result.valid ? 0 : 1;
}

async function cmdAgentParseInbound(opts: Record<string, any>): Promise<number> {
  const context = parseFeishuMessageContext(loadJsonFile(opts['event-file']));
  jsonDump(context.toDict());
  return 0;
}

async function cmdAgentRun(opts: Record<string, any>): Promise<number> {
  const context = parseFeishuMessageContext(loadJsonFile(opts['event-file']));
  const request = AgentTurnRequest.fromMessageContext(context, {
    systemPrompt: opts['system-prompt'],
    sessionId: opts['session-id'],
  });
  let runner;
  if (opts.runner === 'codex') {
    runner = new CodexCliRunner({
      codexBin: opts['codex-bin'] || 'codex',
      model: opts.model,
      cwd: opts['codex-cd'],
      extraArgs: opts['codex-arg'] ? (Array.isArray(opts['codex-arg']) ? opts['codex-arg'] : [opts['codex-arg']]) : [],
      timeout: opts.timeout ? Number(opts.timeout) : 180,
    });
  } else {
    runner = new EchoRunner({ prefix: opts['echo-prefix'] || 'Echo' });
  }
  const result = runner.run(request);
  const card = buildSingleCardRun(context, result);
  if (opts['emit-events']) {
    result.events.forEach((event, idx) => {
      jsonLine({
        schema: 'feishu-auth-kit.agent-event.v1',
        index: idx + 1,
        runner: result.runner,
        ...event.toDict(),
      });
    });
    jsonLine({
      schema: 'feishu-auth-kit.agent-run-summary.v1',
      result: result.toDict(),
      card: card.toDict(),
    });
    return result.status === 'completed' ? 0 : 1;
  }
  jsonDump({
    schema: 'feishu-auth-kit.agent-run.v1',
    context: context.toDict(),
    request: request.toDict(),
    result: result.toDict(),
    card: card.toDict(),
  });
  return result.status === 'completed' ? 0 : 1;
}

async function cmdAgentBindContinuation(opts: Record<string, any>): Promise<number> {
  const continuation = bindAuthContinuationToNative(continuationStoreFromArgs(opts), {
    operationId: opts['operation-id'],
    retryText: opts.text,
    metadata: opts.source ? { source: opts.source } : {},
  });
  jsonDump(continuation.toDict());
  return 0;
}

async function cmdAgentActionToRetry(opts: Record<string, any>): Promise<number> {
  const payload = opts['payload-file'] ? loadJsonFile(opts['payload-file']) : {};
  const resolved = resolveCardActionToRetry(
    new NativeCardAction({
      operationId: opts['operation-id'],
      action: opts.action,
      actorOpenId: opts['actor-open-id'],
      messageId: opts['message-id'],
      payload,
    }),
    continuationStoreFromArgs(opts),
  );
  const artifact = buildRetryArtifactFromRequest(resolved.retryRequest);
  jsonDump({
    ...resolved.toDict(),
    retry_artifact: artifact.toDict(),
  });
  return 0;
}

// Command dispatcher
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    if (argv.length === 0) {
      console.error('Usage: feishu-auth-kit <command> [options]');
      return 2;
    }
    console.log('feishu-auth-kit: Standalone Feishu/Lark native agent kit');
    return 0;
  }

  // Parse command, subcommand, and flags
  const positionals: string[] = [];
  const opts: Record<string, any> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      let key: string;
      let val: any;
      if (eqIdx !== -1) {
        key = arg.slice(2, eqIdx);
        val = arg.slice(eqIdx + 1);
      } else {
        key = arg.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          val = next;
          i++;
        } else {
          val = true;
        }
      }
      if (key in opts) {
        if (!Array.isArray(opts[key])) {
          opts[key] = [opts[key]];
        }
        opts[key].push(val);
      } else {
        opts[key] = val;
      }
    } else {
      positionals.push(arg);
    }
  }

  const primary = positionals[0];
  const secondary = positionals[1];

  switch (primary) {
    case 'setup':
      return cmdSetup(opts);

    case 'doctor':
      return cmdDoctor(opts);

    case 'scopes':
      return cmdScopes(opts);

    case 'auth-url':
      return cmdLogin({ ...opts, 'no-poll': true });

    case 'login':
      return cmdLogin(opts);

    case 'batch-auth':
      return cmdBatchAuth(opts);

    case 'owner-check':
      return cmdOwnerCheck(opts);

    case 'register':
      switch (secondary) {
        case 'init':
          return cmdRegisterInit(opts);
        case 'begin':
          return cmdRegisterBegin(opts);
        case 'poll':
          return cmdRegisterPoll(opts);
        case 'scan-create':
          return cmdRegisterScanCreate(opts);
        case 'probe':
          return cmdRegisterProbe(opts);
        default:
          console.error(`Unknown register command: ${secondary}`);
          return 2;
      }

    case 'tokens':
      switch (secondary) {
        case 'status':
          return cmdTokensStatus(opts);
        case 'show':
          return cmdTokensShow(opts);
        case 'save':
          return cmdTokensSave(opts);
        case 'remove':
          return cmdTokensRemove(opts);
        default:
          console.error(`Unknown tokens command: ${secondary}`);
          return 2;
      }

    case 'runtime':
      switch (secondary) {
        case 'permission-card':
          return cmdRuntimePermissionCard(opts);
        case 'device-card':
          return cmdRuntimeDeviceCard(opts);
        case 'continue':
          return cmdRuntimeContinue(opts);
        default:
          console.error(`Unknown runtime command: ${secondary}`);
          return 2;
      }

    case 'claude':
      switch (secondary) {
        case 'permission-card':
          return cmdClaudePermissionCard(opts);
        case 'device-card':
          return cmdClaudeDeviceCard(opts);
        default:
          console.error(`Unknown claude command: ${secondary}`);
          return 2;
      }

    case 'orchestration':
      switch (secondary) {
        case 'plan':
          return cmdOrchestrationPlan(opts);
        case 'route':
          return cmdOrchestrationRoute(opts);
        case 'retry':
          return cmdOrchestrationRetry(opts);
        case 'verify-identity':
          return cmdOrchestrationVerifyIdentity(opts);
        default:
          console.error(`Unknown orchestration command: ${secondary}`);
          return 2;
      }

    case 'agent':
      switch (secondary) {
        case 'parse-inbound':
          return cmdAgentParseInbound(opts);
        case 'run':
          return cmdAgentRun(opts);
        case 'bind-continuation':
          return cmdAgentBindContinuation(opts);
        case 'action-to-retry':
          return cmdAgentActionToRetry(opts);
        default:
          console.error(`Unknown agent command: ${secondary}`);
          return 2;
      }

    default:
      console.error(`Unknown command: ${primary}`);
      return 2;
  }
}

const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith('cli.js') ||
    process.argv[1].endsWith('cli.ts') ||
    process.argv[1].endsWith('feishu-auth-kit'));

if (isMainModule) {
  main().then((code) => {
    if (code !== 0) {
      process.exit(code);
    }
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
