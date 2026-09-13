import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DeviceAuthorization } from './models.js';

export function defaultContinuationStorePath(): string {
  const configured = process.env.FEISHU_AUTH_KIT_CONTINUATION_STORE;
  if (configured) {
    return path.resolve(configured);
  }
  const stateHome = process.env.XDG_STATE_HOME;
  const base = stateHome ? path.resolve(stateHome) : path.join(os.homedir(), '.local', 'state');
  return path.join(base, 'feishu-auth-kit', 'continuations.json');
}

export function newOperationId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export class CardAction {
  readonly action: string;
  readonly payload: Record<string, any>;
  readonly label: string | null;

  constructor(options: {
    action: string;
    payload?: Record<string, any>;
    label?: string | null;
  }) {
    this.action = options.action;
    this.payload = options.payload ? { ...options.payload } : {};
    this.label = options.label ?? null;
  }

  toDict(): Record<string, any> {
    const body: Record<string, any> = {
      action: this.action,
      payload: this.payload,
    };
    if (this.label) {
      body.label = this.label;
    }
    return body;
  }
}

export class CardLink {
  readonly label: string;
  readonly url: string;

  constructor(label: string, url: string) {
    this.label = label;
    this.url = url;
  }

  toDict(): Record<string, string> {
    return { label: this.label, url: this.url };
  }
}

export class RuntimeCard {
  readonly type: string;
  readonly operationId: string;
  readonly title: string;
  readonly message: string;
  readonly appId: string;
  readonly actions: CardAction[];
  readonly fields: Record<string, any>;
  readonly links: CardLink[];
  readonly metadata: Record<string, any>;

  constructor(options: {
    type: string;
    operationId: string;
    title: string;
    message: string;
    appId: string;
    actions?: CardAction[];
    fields?: Record<string, any>;
    links?: CardLink[];
    metadata?: Record<string, any>;
  }) {
    this.type = options.type;
    this.operationId = options.operationId;
    this.title = options.title;
    this.message = options.message;
    this.appId = options.appId;
    this.actions = options.actions ? [...options.actions] : [];
    this.fields = options.fields ? { ...options.fields } : {};
    this.links = options.links ? [...options.links] : [];
    this.metadata = options.metadata ? { ...options.metadata } : {};
  }

  toDict(): Record<string, any> {
    return {
      schema: 'feishu-auth-kit.card.v1',
      type: this.type,
      operation_id: this.operationId,
      app_id: this.appId,
      title: this.title,
      message: this.message,
      fields: this.fields,
      actions: this.actions.map((a) => a.toDict()),
      links: this.links.map((l) => l.toDict()),
      metadata: this.metadata,
    };
  }
}

export interface ContinuationState {
  operationId: string;
  appId: string;
  kind: string;
  status: string;
  payload: Record<string, any>;
}

export class FileContinuationStore {
  readonly path: string;

  constructor(filePath?: string | null) {
    this.path = filePath ? path.resolve(filePath) : defaultContinuationStorePath();
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
      const states = payload.continuations || payload;
      if (!states || typeof states !== 'object') {
        return {};
      }
      const result: Record<string, any> = {};
      for (const [key, value] of Object.entries(states)) {
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
      JSON.stringify({ continuations: items }, null, 2) + '\n',
      'utf-8',
    );
    fs.renameSync(tempPath, this.path);
  }

  save(state: ContinuationState): ContinuationState {
    const items = this._readAll();
    items[state.operationId] = {
      operation_id: state.operationId,
      app_id: state.appId,
      kind: state.kind,
      status: state.status,
      payload: state.payload,
    };
    this._writeAll(items);
    return state;
  }

  load(operationId: string): ContinuationState | null {
    const item = this._readAll()[operationId];
    if (!item) {
      return null;
    }
    return {
      operationId: String(item.operation_id),
      appId: String(item.app_id),
      kind: String(item.kind),
      status: String(item.status),
      payload: item.payload || {},
    };
  }

  remove(operationId: string): boolean {
    const items = this._readAll();
    if (!(operationId in items)) {
      return false;
    }
    delete items[operationId];
    this._writeAll(items);
    return true;
  }
}

export function buildPermissionMissingCard(options: {
  appId: string;
  operationId: string;
  missingScopes: string[];
  permissionUrl: string;
  userOpenId?: string | null;
}): RuntimeCard {
  return new RuntimeCard({
    type: 'permission_missing',
    operationId: options.operationId,
    appId: options.appId,
    title: 'App permissions required',
    message: 'Grant the missing Feishu/Lark permissions, then continue the authorization flow.',
    fields: {
      missing_scopes: options.missingScopes,
      user_open_id: options.userOpenId ?? null,
    },
    actions: [
      new CardAction({
        action: 'permissions_granted_continue',
        label: 'I have granted permissions',
        payload: { operation_id: options.operationId },
      }),
    ],
    links: [new CardLink('Open permission page', options.permissionUrl)],
  });
}

export function buildDeviceFlowCard(options: {
  appId: string;
  operationId: string;
  authorization: DeviceAuthorization;
}): RuntimeCard {
  return new RuntimeCard({
    type: 'device_flow_authorization',
    operationId: options.operationId,
    appId: options.appId,
    title: 'User authorization required',
    message: 'Open the verification URL, complete device authorization, then continue.',
    fields: {
      device_code: options.authorization.device_code,
      user_code: options.authorization.user_code,
      verification_uri: options.authorization.verification_uri,
      verification_uri_complete: options.authorization.verification_uri_complete,
      expires_in: options.authorization.expires_in,
      interval: options.authorization.interval,
    },
    actions: [
      new CardAction({
        action: 'device_authorized_continue',
        label: 'I have completed authorization',
        payload: { operation_id: options.operationId },
      }),
    ],
    links: [
      new CardLink('Open verification URL', options.authorization.verification_uri_complete),
    ],
  });
}

export function processCardAction(
  action: CardAction,
  store: FileContinuationStore,
): ContinuationState {
  const operationId = String(action.payload?.operation_id || '').trim();
  if (!operationId) {
    throw new Error('operation_id is required in action payload');
  }
  const current = store.load(operationId);
  if (!current) {
    throw new Error(`unknown continuation operation_id: ${operationId}`);
  }
  const updated: ContinuationState = {
    operationId: current.operationId,
    appId: current.appId,
    kind: current.kind,
    status: 'confirmed',
    payload: {
      ...current.payload,
      ...action.payload,
      last_action: action.action,
    },
  };
  store.save(updated);
  return updated;
}
