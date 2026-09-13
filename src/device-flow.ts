import { resolveDomains, type DomainSet } from "./domains.js";
import type { DeviceAuthorization, DeviceToken } from "./models.js";
import type { FetchLike } from "./client.js";

export class DeviceFlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeviceFlowError";
  }
}

export class DeviceFlowClient {
  readonly appId: string;
  readonly appSecret: string;
  readonly brand: string;
  readonly domains: DomainSet;
  readonly timeoutMs: number;
  readonly fetchFn: FetchLike;
  readonly sleeper: (ms: number) => Promise<void>;

  constructor(
    appId: string,
    appSecret: string,
    options?: {
      brand?: string;
      timeoutMs?: number;
      fetchFn?: FetchLike;
      sleeper?: (ms: number) => Promise<void>;
    }
  ) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.brand = options?.brand ?? "feishu";
    this.domains = resolveDomains(this.brand);
    this.timeoutMs = options?.timeoutMs ?? 30000;
    this.fetchFn = options?.fetchFn ?? globalThis.fetch;
    this.sleeper = options?.sleeper ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  }

  static scopeString(scopes: Iterable<string>): string {
    const items: string[] = [];
    const seen = new Set<string>();
    for (const scope of scopes) {
      const normalized = scope.trim();
      if (normalized && !seen.has(normalized)) {
        items.push(normalized);
        seen.add(normalized);
      }
    }
    if (!seen.has("offline_access")) {
      items.push("offline_access");
    }
    return items.join(" ");
  }

  async requestAuthorization(scopes: Iterable<string>): Promise<DeviceAuthorization> {
    const scopeStr = DeviceFlowClient.scopeString(scopes);
    const basic = Buffer.from(`${this.appId}:${this.appSecret}`).toString("base64");

    const body = new URLSearchParams({
      client_id: this.appId,
      scope: scopeStr,
    });

    const response = await this.fetchFn(this.domains.deviceAuthorizationUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new DeviceFlowError(`HTTP error ${response.status}: ${errText}`);
    }

    const payload = await response.json();
    if (payload.error) {
      const detail = payload.error_description || payload.error;
      throw new DeviceFlowError(String(detail));
    }

    return {
      device_code: String(payload.device_code),
      user_code: String(payload.user_code),
      verification_uri: String(payload.verification_uri),
      verification_uri_complete: String(payload.verification_uri_complete || payload.verification_uri),
      expires_in: Number(payload.expires_in ?? 240),
      interval: Number(payload.interval ?? 5),
    };
  }

  async pollForToken(
    deviceCode: string,
    options?: {
      interval?: number;
      expiresIn?: number;
    }
  ): Promise<DeviceToken> {
    const intervalSec = options?.interval ?? 5;
    const expiresInSec = options?.expiresIn ?? 240;
    const deadline = Date.now() + expiresInSec * 1000;
    let currentInterval = Math.max(intervalSec, 1);

    while (Date.now() < deadline) {
      await this.sleeper(currentInterval * 1000);

      const body = new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
        client_id: this.appId,
        client_secret: this.appSecret,
      });

      const response = await this.fetchFn(this.domains.oauthTokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: body.toString(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new DeviceFlowError(`HTTP error ${response.status}: ${errText}`);
      }

      const payload = await response.json();
      const error = payload.error;

      if (!error && payload.access_token) {
        return {
          access_token: String(payload.access_token),
          refresh_token: payload.refresh_token ?? null,
          expires_in: payload.expires_in ?? null,
          refresh_expires_in: payload.refresh_expires_in ?? null,
          scope: payload.scope ?? null,
        };
      }

      if (error === "authorization_pending") {
        continue;
      }
      if (error === "slow_down") {
        currentInterval += 5;
        continue;
      }

      const detail = payload.error_description || error || "Device flow failed";
      throw new DeviceFlowError(String(detail));
    }

    throw new DeviceFlowError("Device code expired before authorization completed");
  }
}
