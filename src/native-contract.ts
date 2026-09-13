import {
  AuthContinuation,
  SyntheticRetryArtifact,
  buildSyntheticRetryArtifact,
  loadAuthContinuation,
} from './orchestration.js';
import { ContinuationState, FileContinuationStore } from './runtime-cards.js';

export const NATIVE_CONTINUATION_KIND = 'native_agent_continuation';

export class NativeCardAction {
  readonly operationId: string;
  readonly action: string;
  readonly actorOpenId: string | null;
  readonly messageId: string | null;
  readonly payload: Record<string, any>;

  constructor(options: {
    operationId: string;
    action: string;
    actorOpenId?: string | null;
    messageId?: string | null;
    payload?: Record<string, any>;
  }) {
    this.operationId = options.operationId;
    this.action = options.action;
    this.actorOpenId = options.actorOpenId ?? null;
    this.messageId = options.messageId ?? null;
    this.payload = options.payload ? { ...options.payload } : {};
  }

  toDict(): Record<string, any> {
    return {
      schema: 'feishu-auth-kit.native-card-action.v1',
      operation_id: this.operationId,
      action: this.action,
      actor_open_id: this.actorOpenId,
      message_id: this.messageId,
      payload: this.payload,
    };
  }
}

export class NativeContinuationRecord {
  readonly operationId: string;
  readonly appId: string;
  readonly continuationKind: string;
  readonly retryText: string;
  readonly flowKey: string | null;
  readonly userOpenId: string | null;
  readonly requiredScopes: string[];
  readonly status: string;
  readonly metadata: Record<string, any>;

  constructor(options: {
    operationId: string;
    appId: string;
    continuationKind: string;
    retryText: string;
    flowKey?: string | null;
    userOpenId?: string | null;
    requiredScopes?: string[];
    status?: string;
    metadata?: Record<string, any>;
  }) {
    this.operationId = options.operationId;
    this.appId = options.appId;
    this.continuationKind = options.continuationKind;
    this.retryText = options.retryText;
    this.flowKey = options.flowKey ?? null;
    this.userOpenId = options.userOpenId ?? null;
    this.requiredScopes = options.requiredScopes ? [...options.requiredScopes] : [];
    this.status = options.status ?? 'waiting';
    this.metadata = options.metadata ? { ...options.metadata } : {};
  }

  static fromAuthContinuation(
    continuation: AuthContinuation,
    options: {
      retryText: string;
      status?: string;
      metadata?: Record<string, any>;
    },
  ): NativeContinuationRecord {
    return new NativeContinuationRecord({
      operationId: continuation.operationId,
      appId: continuation.appId,
      continuationKind: continuation.decision,
      retryText: options.retryText,
      flowKey: continuation.flowKey,
      userOpenId: continuation.userOpenId,
      requiredScopes: [...continuation.requiredScopes],
      status: options.status ?? 'waiting',
      metadata: { ...continuation.metadata, ...(options.metadata || {}) },
    });
  }

  toState(): ContinuationState {
    const payload = {
      flow_key: this.flowKey,
      user_open_id: this.userOpenId,
      required_scopes: this.requiredScopes,
      retry_text: this.retryText,
      continuation_kind: this.continuationKind,
      metadata: this.metadata,
    };
    return {
      operationId: this.operationId,
      appId: this.appId,
      kind: NATIVE_CONTINUATION_KIND,
      status: this.status,
      payload,
    };
  }

  static fromState(state: ContinuationState): NativeContinuationRecord {
    const payload = state.payload;
    return new NativeContinuationRecord({
      operationId: state.operationId,
      appId: state.appId,
      continuationKind: String(payload.continuation_kind),
      retryText: String(payload.retry_text),
      flowKey: payload.flow_key ?? null,
      userOpenId: payload.user_open_id ?? null,
      requiredScopes: Array.isArray(payload.required_scopes) ? payload.required_scopes : [],
      status: state.status,
      metadata: payload.metadata || {},
    });
  }

  toDict(): Record<string, any> {
    return {
      schema: 'feishu-auth-kit.native-continuation.v1',
      operation_id: this.operationId,
      app_id: this.appId,
      continuation_kind: this.continuationKind,
      retry_text: this.retryText,
      flow_key: this.flowKey,
      user_open_id: this.userOpenId,
      required_scopes: this.requiredScopes,
      status: this.status,
      metadata: this.metadata,
    };
  }
}

export class NativeRetryRequest {
  readonly operationId: string;
  readonly appId: string;
  readonly continuationKind: string;
  readonly action: string;
  readonly text: string;
  readonly actorOpenId: string | null;
  readonly userOpenId: string | null;
  readonly metadata: Record<string, any>;

  constructor(options: {
    operationId: string;
    appId: string;
    continuationKind: string;
    action: string;
    text: string;
    actorOpenId?: string | null;
    userOpenId?: string | null;
    metadata?: Record<string, any>;
  }) {
    this.operationId = options.operationId;
    this.appId = options.appId;
    this.continuationKind = options.continuationKind;
    this.action = options.action;
    this.text = options.text;
    this.actorOpenId = options.actorOpenId ?? null;
    this.userOpenId = options.userOpenId ?? null;
    this.metadata = options.metadata ? { ...options.metadata } : {};
  }

  toDict(): Record<string, any> {
    return {
      schema: 'feishu-auth-kit.native-retry-request.v1',
      operation_id: this.operationId,
      app_id: this.appId,
      continuation_kind: this.continuationKind,
      action: this.action,
      text: this.text,
      actor_open_id: this.actorOpenId,
      user_open_id: this.userOpenId,
      metadata: this.metadata,
    };
  }
}

export class ResolvedNativeAction {
  readonly action: NativeCardAction;
  readonly continuation: NativeContinuationRecord;
  readonly retryRequest: NativeRetryRequest;

  constructor(options: {
    action: NativeCardAction;
    continuation: NativeContinuationRecord;
    retryRequest: NativeRetryRequest;
  }) {
    this.action = options.action;
    this.continuation = options.continuation;
    this.retryRequest = options.retryRequest;
  }

  toDict(): Record<string, any> {
    return {
      schema: 'feishu-auth-kit.native-action-resolution.v1',
      action: this.action.toDict(),
      continuation: this.continuation.toDict(),
      retry_request: this.retryRequest.toDict(),
    };
  }
}

export function saveNativeContinuation(
  store: FileContinuationStore,
  continuation: NativeContinuationRecord,
): ContinuationState {
  const state = continuation.toState();
  store.save(state);
  return state;
}

export function loadNativeContinuation(
  store: FileContinuationStore,
  operationId: string,
): NativeContinuationRecord | null {
  const state = store.load(operationId);
  if (!state || state.kind !== NATIVE_CONTINUATION_KIND) {
    return null;
  }
  return NativeContinuationRecord.fromState(state);
}

export function bindAuthContinuationToNative(
  store: FileContinuationStore,
  options: {
    operationId: string;
    retryText: string;
    metadata?: Record<string, any>;
  },
): NativeContinuationRecord {
  const current = loadNativeContinuation(store, options.operationId);
  if (current) {
    const updated = new NativeContinuationRecord({
      operationId: current.operationId,
      appId: current.appId,
      continuationKind: current.continuationKind,
      retryText: options.retryText,
      flowKey: current.flowKey,
      userOpenId: current.userOpenId,
      requiredScopes: current.requiredScopes,
      status: current.status,
      metadata: { ...current.metadata, ...(options.metadata || {}) },
    });
    saveNativeContinuation(store, updated);
    return updated;
  }

  const continuation = loadAuthContinuation(store, options.operationId);
  if (!continuation) {
    throw new Error(`unknown continuation operation_id: ${options.operationId}`);
  }
  const native = NativeContinuationRecord.fromAuthContinuation(continuation, {
    retryText: options.retryText,
    metadata: options.metadata,
  });
  saveNativeContinuation(store, native);
  return native;
}

export function resolveCardActionToRetry(
  action: NativeCardAction,
  store: FileContinuationStore,
): ResolvedNativeAction {
  const continuation = loadNativeContinuation(store, action.operationId);
  if (!continuation) {
    throw new Error(`unknown native continuation operation_id: ${action.operationId}`);
  }
  const confirmed = new NativeContinuationRecord({
    operationId: continuation.operationId,
    appId: continuation.appId,
    continuationKind: continuation.continuationKind,
    retryText: continuation.retryText,
    flowKey: continuation.flowKey,
    userOpenId: continuation.userOpenId,
    requiredScopes: continuation.requiredScopes,
    status: 'confirmed',
    metadata: {
      ...continuation.metadata,
      last_action: action.action,
      actor_open_id: action.actorOpenId,
      action_payload: action.payload,
      message_id: action.messageId,
    },
  });
  saveNativeContinuation(store, confirmed);

  const retryRequest = new NativeRetryRequest({
    operationId: confirmed.operationId,
    appId: confirmed.appId,
    continuationKind: confirmed.continuationKind,
    action: action.action,
    text: confirmed.retryText,
    actorOpenId: action.actorOpenId,
    userOpenId: confirmed.userOpenId,
    metadata: confirmed.metadata,
  });

  return new ResolvedNativeAction({
    action,
    continuation: confirmed,
    retryRequest,
  });
}

export function buildRetryArtifactFromRequest(
  request: NativeRetryRequest,
): SyntheticRetryArtifact {
  return buildSyntheticRetryArtifact({
    operationId: request.operationId,
    appId: request.appId,
    userOpenId: request.userOpenId,
    text: request.text,
    reason: request.action,
    metadata: { actor_open_id: request.actorOpenId, ...request.metadata },
  });
}
