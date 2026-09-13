import type { AppInfo } from "./models.js";

export enum OwnerPolicyMode {
  STRICT_OWNER = "strict_owner",
  PERMISSIVE_IF_UNKNOWN = "permissive_if_unknown",
}

export class OwnerPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnerPolicyError";
  }
}

export interface OwnerPolicyResult {
  allowed: boolean;
  mode: OwnerPolicyMode;
  owner_open_id: string | null;
  current_user_open_id: string | null;
  reason: string;
  app_info: AppInfo;
}

export interface AppInfoSource {
  get_app_info?: (appId?: string) => AppInfo | Promise<AppInfo>;
  getAppInfo?: (appId?: string) => AppInfo | Promise<AppInfo>;
}

async function resolveAppInfo(
  source: AppInfo | AppInfoSource,
  appId: string = "me"
): Promise<AppInfo> {
  const sourceObj = source as any;
  if (typeof sourceObj.get_app_info === "function") {
    return await sourceObj.get_app_info(appId);
  }
  if (typeof sourceObj.getAppInfo === "function") {
    return await sourceObj.getAppInfo(appId);
  }
  if ("app_id" in sourceObj) {
    return sourceObj as AppInfo;
  }
  throw new TypeError("source must be AppInfo or expose get_app_info(app_id)");
}

export async function checkOwnerPolicy(
  source: AppInfo | AppInfoSource,
  options: {
    currentUserOpenId: string | null;
    mode?: OwnerPolicyMode;
    appId?: string;
  }
): Promise<OwnerPolicyResult> {
  const mode = options.mode ?? OwnerPolicyMode.STRICT_OWNER;
  const appId = options.appId ?? "me";
  const currentUserOpenId = options.currentUserOpenId;

  const appInfo = await resolveAppInfo(source, appId);
  const ownerOpenId =
    appInfo.effective_owner_open_id ||
    appInfo.owner_open_id ||
    appInfo.creator_id ||
    null;

  if (!ownerOpenId) {
    const allowed = mode === OwnerPolicyMode.PERMISSIVE_IF_UNKNOWN;
    const reason = allowed
      ? "owner metadata unavailable; permissive mode allowed continuation"
      : "owner metadata unavailable; strict owner mode blocks continuation";
    return {
      allowed,
      mode,
      owner_open_id: null,
      current_user_open_id: currentUserOpenId,
      reason,
      app_info: appInfo,
    };
  }

  if (!currentUserOpenId) {
    return {
      allowed: false,
      mode,
      owner_open_id: ownerOpenId,
      current_user_open_id: null,
      reason: "current user open_id is required for owner policy enforcement",
      app_info: appInfo,
    };
  }

  if (currentUserOpenId === ownerOpenId) {
    return {
      allowed: true,
      mode,
      owner_open_id: ownerOpenId,
      current_user_open_id: currentUserOpenId,
      reason: "current user matches app owner",
      app_info: appInfo,
    };
  }

  return {
    allowed: false,
    mode,
    owner_open_id: ownerOpenId,
    current_user_open_id: currentUserOpenId,
    reason: `owner policy rejected user ${currentUserOpenId}; app owner is ${ownerOpenId}`,
    app_info: appInfo,
  };
}

export async function assertOwnerPolicy(
  source: AppInfo | AppInfoSource,
  options: {
    currentUserOpenId: string | null;
    mode?: OwnerPolicyMode;
    appId?: string;
  }
): Promise<OwnerPolicyResult> {
  const result = await checkOwnerPolicy(source, options);
  if (!result.allowed) {
    throw new OwnerPolicyError(result.reason);
  }
  return result;
}
