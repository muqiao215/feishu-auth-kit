import { resolveDomains } from "./domains.js";
import type { FetchLike } from "./client.js";

export const REGISTRATION_PATH = "/oauth/v1/app/registration";
export const DEFAULT_REGISTRATION_ARCHETYPE = "PersonalAgent";
export const DEFAULT_REGISTRATION_AUTH_METHOD = "client_secret";
export const DEFAULT_REGISTRATION_USER_INFO = "open_id";
export const DEFAULT_QR_FROM = "oc_onboard";
export const DEFAULT_QR_TP = "ob_cli_app";
export const DEFAULT_POLL_TP = "ob_app";

export class AppRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppRegistrationError";
  }
}

export interface AppRegistrationInitResult {
  nonce: string | null;
  supported_auth_methods: string[];
}

export interface AppRegistrationBeginResult {
  device_code: string;
  qr_url: string;
  user_code: string;
  interval: number;
  expires_in: number;
  verification_uri: string;
  verification_uri_complete: string;
}

export interface AppRegistrationResult {
  app_id: string;
  app_secret: string;
  domain: string;
  open_id: string | null;
}

export interface AppRegistrationPollResult {
  status: "success" | "access_denied" | "expired" | "timeout" | "error";
  result?: AppRegistrationResult | null;
  message?: string | null;
}

function withQueryParams(urlStr: string, params: Record<string, string>): string {
  const url = new URL(urlStr);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function raiseRegistrationPayloadError(payload: Record<string, any>): void {
  if (payload && payload.error) {
    const description = payload.error_description || payload.error;
    throw new AppRegistrationError(String(description));
  }
}

export class AppRegistrationClient {
  brand: string;
  readonly fetchFn: FetchLike;
  readonly timeoutMs: number;
  readonly sleeper: (ms: number) => Promise<void>;

  constructor(options?: {
    brand?: string;
    fetchFn?: FetchLike;
    timeoutMs?: number;
    sleeper?: (ms: number) => Promise<void>;
  }) {
    this.brand = options?.brand ?? "feishu";
    this.fetchFn = options?.fetchFn ?? globalThis.fetch;
    this.timeoutMs = options?.timeoutMs ?? 10000;
    this.sleeper = options?.sleeper ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  }

  private accountsBase(brand?: string): string {
    return resolveDomains(brand || this.brand).accountsBase;
  }

  private async postRegistration(
    body: Record<string, string>,
    options?: { brand?: string }
  ): Promise<Record<string, any>> {
    const url = `${this.accountsBase(options?.brand)}${REGISTRATION_PATH}`;
    const params = new URLSearchParams(body);

    const response = await this.fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: params.toString(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    try {
      const payload = await response.json();
      if (!payload || typeof payload !== "object") {
        throw new AppRegistrationError("Invalid registration response payload");
      }
      return payload;
    } catch (exc: any) {
      if (exc instanceof AppRegistrationError) {
        throw exc;
      }
      throw new AppRegistrationError(`Invalid registration response: ${exc?.message || exc}`);
    }
  }

  async init(): Promise<AppRegistrationInitResult> {
    const payload = await this.postRegistration({ action: "init" });
    raiseRegistrationPayloadError(payload);

    const supported = Array.isArray(payload.supported_auth_methods)
      ? payload.supported_auth_methods.map(String)
      : [];

    if (!supported.includes(DEFAULT_REGISTRATION_AUTH_METHOD)) {
      throw new AppRegistrationError(
        "Current environment does not support client_secret app registration"
      );
    }

    return {
      nonce: payload.nonce ?? null,
      supported_auth_methods: supported,
    };
  }

  async begin(): Promise<AppRegistrationBeginResult> {
    const payload = await this.postRegistration({
      action: "begin",
      archetype: DEFAULT_REGISTRATION_ARCHETYPE,
      auth_method: DEFAULT_REGISTRATION_AUTH_METHOD,
      request_user_info: DEFAULT_REGISTRATION_USER_INFO,
    });
    raiseRegistrationPayloadError(payload);

    const verificationUriComplete = String(
      payload.verification_uri_complete || payload.verification_uri || ""
    );
    if (!verificationUriComplete) {
      throw new AppRegistrationError("Registration begin response did not include a QR URL");
    }

    const qrUrl = withQueryParams(verificationUriComplete, {
      from: DEFAULT_QR_FROM,
      tp: DEFAULT_QR_TP,
    });

    return {
      device_code: String(payload.device_code),
      qr_url: qrUrl,
      user_code: String(payload.user_code),
      interval: Number(payload.interval || 5),
      expires_in: Number(payload.expire_in || payload.expires_in || 600),
      verification_uri: String(payload.verification_uri || verificationUriComplete),
      verification_uri_complete: verificationUriComplete,
    };
  }

  async poll(
    deviceCode: string,
    options?: {
      interval?: number;
      expiresIn?: number;
      tp?: string;
      pollTimeout?: number;
      sleeper?: (ms: number) => Promise<void>;
    }
  ): Promise<AppRegistrationPollResult> {
    const sleeper = options?.sleeper ?? this.sleeper;
    const intervalSec = Number(options?.interval !== undefined ? options.interval : 5);
    const expiresInSec = options?.expiresIn ?? 600;
    const maxWaitSec = options?.pollTimeout !== undefined
      ? Math.min(expiresInSec, options.pollTimeout)
      : expiresInSec;
    const deadline = Date.now() + Math.max(maxWaitSec, 0) * 1000;
    const tp = options?.tp ?? DEFAULT_POLL_TP;

    let domain = this.brand;
    let domainSwitched = false;

    while (Date.now() <= deadline) {
      const payload = await this.postRegistration(
        {
          action: "poll",
          device_code: deviceCode,
          tp,
        },
        { brand: domain }
      );

      const userInfo = payload?.user_info && typeof payload.user_info === "object" ? payload.user_info : {};
      const tenantBrand = userInfo?.tenant_brand;
      if (tenantBrand === "lark" && domain !== "lark" && !domainSwitched) {
        domain = "lark";
        domainSwitched = true;
        continue;
      }

      const appId = payload?.client_id;
      const appSecret = payload?.client_secret;
      if (appId && appSecret) {
        return {
          status: "success",
          result: {
            app_id: String(appId),
            app_secret: String(appSecret),
            domain: tenantBrand === "lark" ? "lark" : domain,
            open_id: userInfo?.open_id ? String(userInfo.open_id) : null,
          },
        };
      }

      const error = payload?.error;
      if (error === "authorization_pending" || !error) {
        await sleeper(intervalSec * 1000);
        continue;
      }
      if (error === "slow_down") {
        await sleeper((intervalSec + 5) * 1000);
        continue;
      }
      if (error === "access_denied") {
        return { status: "access_denied" };
      }
      if (error === "expired_token") {
        return { status: "expired" };
      }

      const description = payload?.error_description || "unknown";
      return { status: "error", message: `${error}: ${description}` };
    }

    return { status: "timeout" };
  }
}
