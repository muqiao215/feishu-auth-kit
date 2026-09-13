export class DomainSet {
  readonly openBase: string;
  readonly accountsBase: string;
  readonly applinkBase: string;
  readonly wwwBase: string;
  readonly mcpBase: string;

  constructor(options: {
    openBase: string;
    accountsBase: string;
    applinkBase: string;
    wwwBase: string;
    mcpBase: string;
  }) {
    this.openBase = options.openBase;
    this.accountsBase = options.accountsBase;
    this.applinkBase = options.applinkBase;
    this.wwwBase = options.wwwBase;
    this.mcpBase = options.mcpBase;
  }

  get tenantTokenUrl(): string {
    return `${this.openBase}/open-apis/auth/v3/tenant_access_token/internal`;
  }

  get appInfoBase(): string {
    return `${this.openBase}/open-apis/application/v6/applications`;
  }

  get deviceAuthorizationUrl(): string {
    return `${this.accountsBase}/oauth/v1/device_authorization`;
  }

  get oauthTokenUrl(): string {
    return `${this.openBase}/open-apis/authen/v2/oauth/token`;
  }
}

function normalizeBase(value: string): string {
  return value.replace(/\/+$/, "");
}

export function resolveDomains(brand: string = "feishu"): DomainSet {
  const normalized = (brand || "feishu").trim().toLowerCase();
  if (normalized === "feishu") {
    return new DomainSet({
      openBase: "https://open.feishu.cn",
      accountsBase: "https://accounts.feishu.cn",
      applinkBase: "https://applink.feishu.cn",
      wwwBase: "https://www.feishu.cn",
      mcpBase: "https://mcp.feishu.cn",
    });
  }
  if (normalized === "lark") {
    return new DomainSet({
      openBase: "https://open.larksuite.com",
      accountsBase: "https://accounts.larksuite.com",
      applinkBase: "https://applink.larksuite.com",
      wwwBase: "https://www.larksuite.com",
      mcpBase: "https://mcp.larksuite.com",
    });
  }

  const openBase = normalizeBase(brand);
  let accountsBase = openBase;
  try {
    const parsed = new URL(openBase);
    if (parsed.hostname && parsed.hostname.startsWith("open.")) {
      accountsBase = `${parsed.protocol}//${parsed.host.replace(/^open\./, "accounts.")}`;
    }
  } catch {
    accountsBase = openBase;
  }

  return new DomainSet({
    openBase,
    accountsBase,
    applinkBase: openBase,
    wwwBase: openBase,
    mcpBase: openBase,
  });
}

export function openPlatformDomain(brand: string = "feishu"): string {
  return resolveDomains(brand).openBase;
}

export function applinkDomain(brand: string = "feishu"): string {
  return resolveDomains(brand).applinkBase;
}

export function wwwDomain(brand: string = "feishu"): string {
  return resolveDomains(brand).wwwBase;
}

export function mcpDomain(brand: string = "feishu"): string {
  return resolveDomains(brand).mcpBase;
}
