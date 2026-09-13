export interface ScopeGrant {
  scope: string;
  token_types?: string[];
}

export interface AppInfo {
  app_id: string;
  name?: string | null;
  creator_id?: string | null;
  owner_open_id?: string | null;
  owner_type?: number | null;
  effective_owner_open_id?: string | null;
  scopes: ScopeGrant[];
  raw_app: Record<string, any>;
}

export interface TenantAccessToken {
  token: string;
  expire?: number | null;
}

export interface DeviceAuthorization {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export interface DeviceToken {
  access_token: string;
  refresh_token?: string | null;
  expires_in?: number | null;
  refresh_expires_in?: number | null;
  scope?: string | null;
}
