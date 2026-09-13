import { openPlatformDomain, resolveDomains, type DomainSet } from "./domains.js";
import type { AppInfo, ScopeGrant, TenantAccessToken } from "./models.js";

export class FeishuAuthKitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeishuAuthKitError";
  }
}

export class FeishuApiError extends FeishuAuthKitError {
  constructor(message: string) {
    super(message);
    this.name = "FeishuApiError";
  }
}

export function buildPermissionUrl(
  appId: string,
  scopesOrOptions?: Iterable<string> | {
    scopes?: Iterable<string>;
    brand?: string;
    tokenType?: string;
    opFrom?: string;
  },
  options?: {
    brand?: string;
    tokenType?: string;
    opFrom?: string;
  }
): string {
  let scopes: Iterable<string> = [];
  let opts = options;
  if (scopesOrOptions) {
    if (Array.isArray(scopesOrOptions) || (typeof (scopesOrOptions as any)[Symbol.iterator] === "function" && typeof scopesOrOptions !== "string")) {
      scopes = scopesOrOptions as Iterable<string>;
    } else if (typeof scopesOrOptions === "object") {
      const obj = scopesOrOptions as any;
      scopes = obj.scopes || [];
      opts = { ...obj, ...options };
    }
  }
  const brand = opts?.brand ?? "feishu";
  const tokenType = opts?.tokenType ?? "tenant";
  const opFrom = opts?.opFrom ?? "feishu-auth-kit";

  const scopeList = Array.from(scopes)
    .map((s) => s.trim())
    .filter(Boolean);

  const query = new URLSearchParams({
    q: scopeList.join(","),
    op_from: opFrom,
    token_type: tokenType,
  });

  return `${openPlatformDomain(brand)}/app/${appId}/auth?${query.toString()}`;
}

export interface FetchLike {
  (input: string | URL, init?: RequestInit): Promise<Response>;
}

export class FeishuAuthClient {
  readonly appId: string;
  readonly appSecret: string;
  readonly brand: string;
  readonly timeoutMs: number;
  readonly domains: DomainSet;
  readonly fetchFn: FetchLike;

  private tenantToken: TenantAccessToken | null = null;
  private appInfo: AppInfo | null = null;

  constructor(
    appId: string,
    appSecret: string,
    options?: {
      brand?: string;
      timeoutMs?: number;
      fetchFn?: FetchLike;
    }
  ) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.brand = options?.brand ?? "feishu";
    this.timeoutMs = options?.timeoutMs ?? 30000;
    this.domains = resolveDomains(this.brand);
    this.fetchFn = options?.fetchFn ?? globalThis.fetch;
  }

  // Backwards compatible getter property
  get app_id(): string {
    return this.appId;
  }

  get app_secret(): string {
    return this.appSecret;
  }

  private async requestJson(
    url: string,
    options: {
      method?: string;
      headers?: Record<string, string>;
      body?: any;
      params?: Record<string, string>;
    } = {}
  ): Promise<any> {
    let finalUrl = url;
    if (options.params) {
      const sp = new URLSearchParams(options.params);
      finalUrl += (url.includes("?") ? "&" : "?") + sp.toString();
    }

    const init: RequestInit = {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...options.headers,
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    };

    if (options.body !== undefined) {
      if (typeof options.body === "string" || options.body instanceof URLSearchParams) {
        init.body = options.body;
      } else {
        init.body = JSON.stringify(options.body);
        (init.headers as Record<string, string>)["Content-Type"] = "application/json";
      }
    }

    const response = await this.fetchFn(finalUrl, init);
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new FeishuApiError(`HTTP error ${response.status}: ${errText}`);
    }

    const payload = await response.json();
    if (payload && typeof payload === "object" && payload.code !== 0 && payload.code !== undefined && payload.code !== null) {
      const message = payload.msg || payload.message || "Unknown Feishu API error";
      throw new FeishuApiError(String(message));
    }
    return payload;
  }

  async requestWithTenantToken(
    urlOrPath: string,
    options: {
      method?: string;
      headers?: Record<string, string>;
      body?: any;
      params?: Record<string, string>;
    } = {}
  ): Promise<any> {
    const token = (await this.getTenantAccessToken()).token;
    const url = urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")
      ? urlOrPath
      : `${this.domains.openBase}${urlOrPath.startsWith("/") ? "" : "/"}${urlOrPath}`;
    return this.requestJson(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });
  }

  async getTenantAccessToken(options?: { forceRefresh?: boolean }): Promise<TenantAccessToken> {
    if (this.tenantToken && !options?.forceRefresh) {
      return this.tenantToken;
    }

    const payload = await this.requestJson(this.domains.tenantTokenUrl, {
      method: "POST",
      body: {
        app_id: this.appId,
        app_secret: this.appSecret,
      },
    });

    const token: TenantAccessToken = {
      token: String(payload.tenant_access_token),
      expire: payload.expire ?? null,
    };
    this.tenantToken = token;
    return token;
  }

  static parseAppInfo(payload: Record<string, any>): AppInfo {
    const app = payload?.data?.app || payload?.app || payload?.data || {};
    const owner = app.owner || {};
    const ownerType = owner.owner_type ?? owner.type ?? null;
    const ownerOpenId = owner.owner_id ?? null;
    const creatorId = app.creator_id ?? null;

    let effectiveOwnerOpenId: string | null = null;
    if (ownerType === 2 && ownerOpenId) {
      effectiveOwnerOpenId = ownerOpenId;
    } else {
      effectiveOwnerOpenId = creatorId || ownerOpenId || null;
    }

    const rawScopes = app.scopes || app.online_version?.scopes || [];
    const scopes: ScopeGrant[] = [];
    for (const item of rawScopes) {
      if (item && item.scope) {
        scopes.push({
          scope: String(item.scope),
          token_types: Array.isArray(item.token_types) ? item.token_types.map(String) : [],
        });
      }
    }

    return {
      app_id: String(app.app_id || app.id || app.cli_app_id || ""),
      name: app.name ?? null,
      creator_id: creatorId,
      owner_open_id: ownerOpenId,
      owner_type: ownerType,
      effective_owner_open_id: effectiveOwnerOpenId,
      scopes,
      raw_app: app,
    };
  }

  async getAppInfo(appId: string = "me", options?: { forceRefresh?: boolean }): Promise<AppInfo> {
    if (this.appInfo && !options?.forceRefresh && (appId === "me" || appId === this.appInfo.app_id)) {
      return this.appInfo;
    }

    const tenantToken = (await this.getTenantAccessToken(options)).token;
    const payload = await this.requestJson(`${this.domains.appInfoBase}/${appId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tenantToken}`,
      },
      params: {
        lang: "en_us",
      },
    });

    const info = FeishuAuthClient.parseAppInfo(payload);
    this.appInfo = info;
    return info;
  }

  async getGrantedScopes(options?: {
    tokenType?: string | null;
    appInfo?: AppInfo | null;
  }): Promise<string[]> {
    const current = options?.appInfo || (await this.getAppInfo());
    const scopes: string[] = [];
    for (const item of current.scopes) {
      if (options?.tokenType && item.token_types && item.token_types.length > 0 && !item.token_types.includes(options.tokenType)) {
        continue;
      }
      scopes.push(item.scope);
    }
    return scopes;
  }

  buildPermissionUrl(
    appId: string,
    options: {
      scopes: Iterable<string>;
      tokenType?: string;
      opFrom?: string;
    }
  ): string {
    return buildPermissionUrl(appId, options.scopes, {
      brand: this.brand,
      tokenType: options.tokenType,
      opFrom: options.opFrom,
    });
  }
}
