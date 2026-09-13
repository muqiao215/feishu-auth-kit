import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { DeviceToken } from "./models.js";

export function defaultTokenStorePath(): string {
  const configured = process.env.FEISHU_AUTH_KIT_TOKEN_STORE;
  if (configured) {
    return path.resolve(configured.replace(/^~(?=$|\/|\\)/, os.homedir()));
  }
  const dataHome = process.env.XDG_DATA_HOME;
  const base = dataHome
    ? path.resolve(dataHome.replace(/^~(?=$|\/|\\)/, os.homedir()))
    : path.join(os.homedir(), ".local", "share");
  return path.join(base, "feishu-auth-kit", "user_tokens.json");
}

export interface StoredUserToken {
  app_id: string;
  user_open_id: string;
  access_token: string;
  refresh_token?: string | null;
  expires_at?: number | null;
  refresh_expires_at?: number | null;
  scope?: string | null;
}

export interface TokenStatus {
  app_id: string;
  user_open_id: string;
  exists: boolean;
  storage_path: string;
  scope?: string | null;
  expires_at?: number | null;
  refresh_expires_at?: number | null;
}

export class FileTokenStore {
  readonly path: string;

  constructor(customPath?: string) {
    if (customPath) {
      this.path = path.resolve(customPath.replace(/^~(?=$|\/|\\)/, os.homedir()));
    } else {
      this.path = defaultTokenStorePath();
    }
  }

  static storageKey(app_id: string, user_open_id: string): string {
    return `${app_id}:${user_open_id}`;
  }

  private readAll(): Record<string, StoredUserToken> {
    if (!fs.existsSync(this.path)) {
      return {};
    }
    try {
      const raw = fs.readFileSync(this.path, "utf-8");
      const payload = JSON.parse(raw);
      if (typeof payload !== "object" || payload === null) {
        return {};
      }
      const tokens = (payload as any).tokens ?? payload;
      if (typeof tokens !== "object" || tokens === null) {
        return {};
      }
      const result: Record<string, StoredUserToken> = {};
      for (const [key, value] of Object.entries(tokens)) {
        if (typeof value === "object" && value !== null) {
          result[key] = value as StoredUserToken;
        }
      }
      return result;
    } catch {
      return {};
    }
  }

  private writeAll(tokens: Record<string, StoredUserToken>): void {
    fs.mkdirSync(path.dirname(this.path), { recursive: true });
    const payload = { tokens };
    const tempPath = `${this.path}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2) + "\n", "utf-8");
    fs.renameSync(tempPath, this.path);
  }

  load(app_id: string, user_open_id: string): StoredUserToken | null {
    const key = FileTokenStore.storageKey(app_id, user_open_id);
    const item = this.readAll()[key];
    if (!item) {
      return null;
    }
    return {
      app_id: String(item.app_id),
      user_open_id: String(item.user_open_id),
      access_token: String(item.access_token),
      refresh_token: item.refresh_token ?? null,
      expires_at: item.expires_at ?? null,
      refresh_expires_at: item.refresh_expires_at ?? null,
      scope: item.scope ?? null,
    };
  }

  save(token: StoredUserToken): StoredUserToken {
    const tokens = this.readAll();
    const key = FileTokenStore.storageKey(token.app_id, token.user_open_id);
    tokens[key] = { ...token };
    this.writeAll(tokens);
    return token;
  }

  saveDeviceToken(
    app_id: string,
    user_open_id: string,
    token: DeviceToken,
    nowOrOptions?: number | { now?: number }
  ): StoredUserToken {
    let current: number;
    if (typeof nowOrOptions === "number") {
      current = nowOrOptions;
    } else {
      current = nowOrOptions?.now ?? Math.floor(Date.now() / 1000);
    }
    const stored: StoredUserToken = {
      app_id,
      user_open_id,
      access_token: token.access_token,
      refresh_token: token.refresh_token ?? null,
      expires_at: token.expires_in ? current + token.expires_in : null,
      refresh_expires_at: token.refresh_expires_in ? current + token.refresh_expires_in : null,
      scope: token.scope ?? null,
    };
    return this.save(stored);
  }

  remove(app_id: string, user_open_id: string): boolean {
    const tokens = this.readAll();
    const key = FileTokenStore.storageKey(app_id, user_open_id);
    if (!(key in tokens)) {
      return false;
    }
    delete tokens[key];
    this.writeAll(tokens);
    return true;
  }

  status(app_id: string, user_open_id: string): TokenStatus {
    const current = this.load(app_id, user_open_id);
    if (!current) {
      return {
        app_id,
        user_open_id,
        exists: false,
        storage_path: this.path,
      };
    }
    return {
      app_id,
      user_open_id,
      exists: true,
      storage_path: this.path,
      scope: current.scope ?? null,
      expires_at: current.expires_at ?? null,
      refresh_expires_at: current.refresh_expires_at ?? null,
    };
  }
}
