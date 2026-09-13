import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveDomains } from './domains.js';
import { DeviceAuthorization } from './models.js';
import {
  ContinuationState,
  FileContinuationStore,
  RuntimeCard,
  buildDeviceFlowCard,
  buildPermissionMissingCard,
} from './runtime-cards.js';
import { batchScopes, filterSensitiveScopes } from './scopes.js';

export type AuthErrorKind = 'app_scope_missing' | 'user_auth_required' | 'user_scope_insufficient';
export type AuthDecision = 'permission_card' | 'device_flow' | 'authorized';
export type ScopeNeedType = 'one' | 'all';
export type TokenType = 'tenant' | 'user';

function dedupePreserveOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const normalized = item.trim();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

export function defaultPendingFlowStorePath(): string {
  const configured = process.env.FEISHU_AUTH_KIT_PENDING_FLOW_STORE;
  if (configured) {
    return path.resolve(configured);
  }
  const stateHome = process.env.XDG_STATE_HOME;
  const base = stateHome ? path.resolve(stateHome) : path.join(os.homedir(), '.local', 'state');
  return path.join(base, 'feishu-auth-kit', 'pending_flows.json');
}

export interface PendingAuthFlowOptions {
  flowKey: string;
  operationId: string;
  appId: string;
  userOpenId?: string | null;
  decision: AuthDecision;
  requiredScopes?: string[];
  tokenType?: TokenType;
  scopeNeedType?: ScopeNeedType;
  status?: string;
  metadata?: Record<string, any>;
}

export class PendingAuthFlow {
  readonly flowKey: string;
  readonly operationId: string;
  readonly appId: string;
  readonly userOpenId: string | null;
  readonly decision: AuthDecision;
  readonly requiredScopes: string[];
  readonly tokenType: TokenType;
  readonly scopeNeedType: ScopeNeedType;
  readonly status: string;
  readonly metadata: Record<string, any>;

  constructor(options: PendingAuthFlowOptions) {
    this.flowKey = options.flowKey;
    this.operationId = options.operationId;
    this.appId = options.appId;
    this.userOpenId = options.userOpenId ?? null;
    this.decision = options.decision;
    this.requiredScopes = options.requiredScopes ? [...options.requiredScopes] : [];
    this.tokenType = options.tokenType ?? 'user';
    this.scopeNeedType = options.scopeNeedType ?? 'all';
    this.status = options.status ?? 'pending';
    this.metadata = options.metadata ? { ...options.metadata } : {};
  }

  toDict(): Record<string, any> {
    return {
      flow_key: this.flowKey,
      operation_id: this.operationId,
      app_id: this.appId,
      user_open_id: this.userOpenId,
      decision: this.decision,
      required_scopes: this.requiredScopes,
      token_type: this.tokenType,
      scope_need_type: this.scopeNeedType,
      status: this.status,
      metadata: this.metadata,
    };
  }
}

export interface PendingFlowUpsertResult {
  flow: PendingAuthFlow;
  reused: boolean;
  mergedScopes: string[];
}

export class FilePendingFlowRegistry {
  readonly path: string;

  constructor(filePath?: string | null) {
    this.path = filePath ? path.resolve(filePath) : defaultPendingFlowStorePath();
  }

  private _readAll(): Record<string, any> {
    if (!fs.existsSync(this.path)) {
      return {};
    }
    try {
      const text = fs.readFileSync(this.path, 'utf-8');
      const payload = JSON.parse(text);
      if (!payload || typeof payload !== 'object') {
        return {};
      }
      const items = payload.pending_flows || payload;
      if (!items || typeof items !== 'object') {
        return {};
      }
      const result: Record<string, any> = {};
      for (const [key, value] of Object.entries(items)) {
        if (value && typeof value === 'object') {
          result[key] = value;
        }
      }
      return result;
    } catch {
      return {};
    }
  }

  private _writeAll(items: Record<string, any>): void {
    const dir = path.dirname(this.path);
    fs.mkdirSync(dir, { recursive: true });
    const tempPath = `${this.path}.tmp.${Date.now()}`;
    fs.writeFileSync(
      tempPath,
      JSON.stringify({ pending_flows: items }, null, 2) + '\n',
      'utf-8',
    );
    fs.renameSync(tempPath, this.path);
  }

  load(flowKey: string): PendingAuthFlow | null {
    const item = this._readAll()[flowKey];
    if (!item) {
      return null;
    }
    return new PendingAuthFlow({
      flowKey: String(item.flow_key),
      operationId: String(item.operation_id),
      appId: String(item.app_id),
      userOpenId: item.user_open_id ?? null,
      decision: item.decision,
      requiredScopes: Array.isArray(item.required_scopes) ? item.required_scopes : [],
      tokenType: item.token_type ?? 'user',
      scopeNeedType: item.scope_need_type ?? 'all',
      status: String(item.status ?? 'pending'),
      metadata: item.metadata || {},
    });
  }

  remove(flowKey: string): boolean {
    const items = this._readAll();
    if (!(flowKey in items)) {
      return false;
    }
    delete items[flowKey];
    this._writeAll(items);
    return true;
  }

  upsert(flow: PendingAuthFlow): PendingFlowUpsertResult {
    const items = this._readAll();
    const existing = this.load(flow.flowKey);
    if (!existing) {
      items[flow.flowKey] = flow.toDict();
      this._writeAll(items);
      return {
        flow,
        reused: false,
        mergedScopes: [...flow.requiredScopes],
      };
    }

    const mergedScopes = dedupePreserveOrder([
      ...existing.requiredScopes,
      ...flow.requiredScopes,
    ]);
    const mergedFlow = new PendingAuthFlow({
      flowKey: existing.flowKey,
      operationId: existing.operationId,
      appId: existing.appId,
      userOpenId: flow.userOpenId || existing.userOpenId,
      decision: flow.decision,
      requiredScopes: mergedScopes,
      tokenType: flow.tokenType,
      scopeNeedType: flow.scopeNeedType,
      status: flow.status,
      metadata: { ...existing.metadata, ...flow.metadata },
    });
    items[flow.flowKey] = mergedFlow.toDict();
    this._writeAll(items);
    return {
      flow: mergedFlow,
      reused: true,
      mergedScopes,
    };
  }
}

export interface ScopeAuthorizationPlan {
  requestedScopes: string[];
  appGrantedScopes: string[];
  userGrantedScopes: string[];
  alreadyGrantedScopes: string[];
  missingUserScopes: string[];
  unavailableScopes: string[];
  batches: string[][];
}

export function planScopeAuthorization(options: {
  requestedScopes: string[];
  appGrantedScopes: string[];
  userGrantedScopes: string[];
  batchSize?: number;
  filterSensitive?: boolean;
}): ScopeAuthorizationPlan {
  const batchSize = options.batchSize ?? 100;
  const filterSensitive = options.filterSensitive ?? true;

  let requested = dedupePreserveOrder(options.requestedScopes);
  let appGranted = dedupePreserveOrder(options.appGrantedScopes);
  let userGranted = dedupePreserveOrder(options.userGrantedScopes);

  if (filterSensitive) {
    requested = filterSensitiveScopes(requested);
    appGranted = filterSensitiveScopes(appGranted);
    userGranted = filterSensitiveScopes(userGranted);
  }

  const appGrantedSet = new Set(appGranted);
  const userGrantedSet = new Set(userGranted);

  const unavailable = requested.filter((s) => !appGrantedSet.has(s));
  const available = requested.filter((s) => appGrantedSet.has(s));
  const already = available.filter((s) => userGrantedSet.has(s));
  const missing = available.filter((s) => !userGrantedSet.has(s));

  return {
    requestedScopes: requested,
    appGrantedScopes: appGranted,
    userGrantedScopes: userGranted,
    alreadyGrantedScopes: already,
    missingUserScopes: missing,
    unavailableScopes: unavailable,
    batches: batchScopes(missing, batchSize),
  };
}

export class AuthRequirement {
  readonly errorKind: AuthErrorKind;
  readonly requiredScopes: string[];
  readonly tokenType: TokenType;
  readonly scopeNeedType: ScopeNeedType;
  readonly userOpenId: string | null;
  readonly flowKey: string | null;
  readonly operationId: string | null;
  readonly metadata: Record<string, any>;

  constructor(options: {
    errorKind: AuthErrorKind;
    requiredScopes: string[];
    tokenType?: TokenType;
    scopeNeedType?: ScopeNeedType;
    userOpenId?: string | null;
    flowKey?: string | null;
    operationId?: string | null;
    metadata?: Record<string, any>;
  }) {
    this.errorKind = options.errorKind;
    this.requiredScopes = [...options.requiredScopes];
    this.tokenType = options.tokenType ?? 'user';
    this.scopeNeedType = options.scopeNeedType ?? 'all';
    this.userOpenId = options.userOpenId ?? null;
    this.flowKey = options.flowKey ?? null;
    this.operationId = options.operationId ?? null;
    this.metadata = options.metadata ? { ...options.metadata } : {};
  }
}

export class AuthContinuation {
  readonly operationId: string;
  readonly flowKey: string;
  readonly appId: string;
  readonly decision: AuthDecision;
  readonly userOpenId: string | null;
  readonly requiredScopes: string[];
  readonly tokenType: TokenType;
  readonly scopeNeedType: ScopeNeedType;
  readonly metadata: Record<string, any>;

  constructor(options: {
    operationId: string;
    flowKey: string;
    appId: string;
    decision: AuthDecision;
    userOpenId?: string | null;
    requiredScopes: string[];
    tokenType: TokenType;
    scopeNeedType: ScopeNeedType;
    metadata?: Record<string, any>;
  }) {
    this.operationId = options.operationId;
    this.flowKey = options.flowKey;
    this.appId = options.appId;
    this.decision = options.decision;
    this.userOpenId = options.userOpenId ?? null;
    this.requiredScopes = [...options.requiredScopes];
    this.tokenType = options.tokenType;
    this.scopeNeedType = options.scopeNeedType;
    this.metadata = options.metadata ? { ...options.metadata } : {};
  }

  toState(): ContinuationState {
    return {
      operationId: this.operationId,
      appId: this.appId,
      kind: this.decision,
      status: 'waiting',
      payload: {
        flow_key: this.flowKey,
        user_open_id: this.userOpenId,
        required_scopes: this.requiredScopes,
        token_type: this.tokenType,
        scope_need_type: this.scopeNeedType,
        metadata: this.metadata,
      },
    };
  }

  static fromState(state: ContinuationState): AuthContinuation {
    const payload = state.payload;
    return new AuthContinuation({
      operationId: state.operationId,
      flowKey: String(payload.flow_key),
      appId: state.appId,
      decision: state.kind as AuthDecision,
      userOpenId: payload.user_open_id ?? null,
      requiredScopes: Array.isArray(payload.required_scopes) ? payload.required_scopes : [],
      tokenType: payload.token_type ?? 'user',
      scopeNeedType: payload.scope_need_type ?? 'all',
      metadata: payload.metadata || {},
    });
  }
}

export function saveAuthContinuation(
  store: FileContinuationStore,
  continuation: AuthContinuation,
): ContinuationState {
  const state = continuation.toState();
  store.save(state);
  return state;
}

export function loadAuthContinuation(
  store: FileContinuationStore,
  operationId: string,
): AuthContinuation | null {
  const state = store.load(operationId);
  if (!state) {
    return null;
  }
  return AuthContinuation.fromState(state);
}

export interface RoutedAuthAction {
  decision: AuthDecision;
  flow: PendingAuthFlow;
  reusedExistingFlow: boolean;
  continuation: AuthContinuation;
  card: RuntimeCard | null;
  unavailableScopes: string[];
  batches: string[][];
}

export function routeAuthRequirement(options: {
  appId: string;
  requirement: AuthRequirement;
  pendingFlows: FilePendingFlowRegistry;
  continuationStore: FileContinuationStore;
  permissionUrl?: string | null;
  authorization?: DeviceAuthorization | null;
}): RoutedAuthAction {
  const { appId, requirement, pendingFlows, continuationStore, permissionUrl, authorization } = options;

  let decision: AuthDecision;
  if (requirement.errorKind === 'app_scope_missing') {
    decision = 'permission_card';
  } else {
    decision = 'device_flow';
  }

  const flowKey =
    requirement.flowKey ||
    `${appId}:${requirement.userOpenId || 'unknown'}:${decision}`;
  const operationId = requirement.operationId || crypto.randomUUID().replace(/-/g, '');

  const upsert = pendingFlows.upsert(
    new PendingAuthFlow({
      flowKey,
      operationId,
      appId,
      userOpenId: requirement.userOpenId,
      decision,
      requiredScopes: requirement.requiredScopes,
      tokenType: requirement.tokenType,
      scopeNeedType: requirement.scopeNeedType,
      metadata: requirement.metadata,
    }),
  );

  const continuation = new AuthContinuation({
    operationId: upsert.flow.operationId,
    flowKey: upsert.flow.flowKey,
    appId,
    decision,
    userOpenId: upsert.flow.userOpenId,
    requiredScopes: upsert.mergedScopes,
    tokenType: upsert.flow.tokenType,
    scopeNeedType: upsert.flow.scopeNeedType,
    metadata: upsert.flow.metadata,
  });
  saveAuthContinuation(continuationStore, continuation);

  if (decision === 'permission_card') {
    if (!permissionUrl) {
      throw new Error('permission_url is required for app_scope_missing routing');
    }
    const card = buildPermissionMissingCard({
      appId,
      operationId: upsert.flow.operationId,
      missingScopes: upsert.mergedScopes,
      permissionUrl,
      userOpenId: upsert.flow.userOpenId,
    });
    return {
      decision,
      flow: upsert.flow,
      reusedExistingFlow: upsert.reused,
      continuation,
      card,
      unavailableScopes: [],
      batches: [],
    };
  }

  if (!authorization) {
    throw new Error('authorization is required for user auth routing');
  }
  const card = buildDeviceFlowCard({
    appId,
    operationId: upsert.flow.operationId,
    authorization,
  });
  return {
    decision,
    flow: upsert.flow,
    reusedExistingFlow: upsert.reused,
    continuation,
    card,
    unavailableScopes: [],
    batches: [],
  };
}

export class SyntheticRetryArtifact {
  readonly schema: string;
  readonly kind: string;
  readonly operationId: string;
  readonly appId: string;
  readonly userOpenId: string | null;
  readonly text: string;
  readonly reason: string;
  readonly metadata: Record<string, any>;

  constructor(options: {
    operationId: string;
    appId: string;
    userOpenId?: string | null;
    text: string;
    reason: string;
    metadata?: Record<string, any>;
  }) {
    this.schema = 'feishu-auth-kit.synthetic-retry.v1';
    this.kind = 'synthetic_retry';
    this.operationId = options.operationId;
    this.appId = options.appId;
    this.userOpenId = options.userOpenId ?? null;
    this.text = options.text;
    this.reason = options.reason;
    this.metadata = options.metadata ? { ...options.metadata } : {};
  }

  toDict(): Record<string, any> {
    return {
      schema: this.schema,
      kind: this.kind,
      operation_id: this.operationId,
      app_id: this.appId,
      user_open_id: this.userOpenId,
      text: this.text,
      reason: this.reason,
      metadata: this.metadata,
    };
  }
}

export function buildSyntheticRetryArtifact(options: {
  operationId: string;
  appId: string;
  userOpenId?: string | null;
  text: string;
  reason: string;
  metadata?: Record<string, any>;
}): SyntheticRetryArtifact {
  return new SyntheticRetryArtifact(options);
}

export interface IdentityVerificationResult {
  valid: boolean;
  expectedOpenId: string;
  actualOpenId: string | null;
}

export async function verifyAccessTokenIdentity(options: {
  accessToken: string;
  expectedOpenId: string;
  brand?: string;
  timeout?: number;
}): Promise<IdentityVerificationResult> {
  const brand = options.brand ?? 'feishu';
  const timeoutMs = (options.timeout ?? 30) * 1000;
  const domains = resolveDomains(brand);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${domains.openBase}/open-apis/authen/v1/user_info`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as Record<string, any>;
    if (payload && payload.code !== 0 && payload.code !== undefined && payload.code !== null) {
      const actual = payload.data?.open_id ?? null;
      return {
        valid: false,
        expectedOpenId: options.expectedOpenId,
        actualOpenId: actual,
      };
    }

    const data = payload?.data || payload;
    const actualOpenId = data?.open_id ?? null;
    return {
      valid: actualOpenId === options.expectedOpenId,
      expectedOpenId: options.expectedOpenId,
      actualOpenId,
    };
  } finally {
    clearTimeout(timer);
  }
}
