export const CORE_APP_SCOPES: readonly string[] = [
  "contact:contact.base:readonly",
  "docx:document:readonly",
  "im:chat:read",
  "im:chat:update",
  "im:message.group_at_msg:readonly",
  "im:message.p2p_msg:readonly",
  "im:message.pins:read",
  "im:message.pins:write_only",
  "im:message.reactions:read",
  "im:message.reactions:write_only",
  "im:message:readonly",
  "im:message:recall",
  "im:message:send_as_bot",
  "im:message:send_multi_users",
  "im:message:send_sys_msg",
  "im:message:update",
  "im:resource",
  "application:application:self_manage",
  "cardkit:card:write",
  "cardkit:card:read",
  "offline_access",
] as const;

export const SENSITIVE_SCOPES: readonly string[] = [
  "im:message.send_as_user",
  "space:document:delete",
  "calendar:calendar.event:delete",
  "base:table:delete",
] as const;

export interface ScopeCatalogEntry {
  group: string;
  token_types: string[];
  description: string;
  sensitive?: boolean;
}

export const INITIAL_SCOPE_CATALOG: Record<string, ScopeCatalogEntry> = {
  "application:application:self_manage": {
    group: "core_tenant",
    token_types: ["tenant"],
    description: "Inspect app metadata and granted scopes.",
  },
  "offline_access": {
    group: "oauth",
    token_types: ["user"],
    description: "Return refresh tokens for device-flow user auth.",
  },
  "im:message:readonly": {
    group: "messaging",
    token_types: ["tenant", "user"],
    description: "Read message content and history.",
  },
  "im:message:send_as_bot": {
    group: "messaging",
    token_types: ["tenant"],
    description: "Send bot messages.",
  },
  "im:chat:read": {
    group: "messaging",
    token_types: ["tenant"],
    description: "Read chat metadata.",
  },
  "cardkit:card:write": {
    group: "cards",
    token_types: ["tenant"],
    description: "Create and update message cards.",
  },
  "cardkit:card:read": {
    group: "cards",
    token_types: ["tenant"],
    description: "Read message card state.",
  },
  "calendar:calendar:read": {
    group: "calendar",
    token_types: ["user"],
    description: "Read user calendars.",
  },
  "calendar:calendar.event:delete": {
    group: "calendar",
    token_types: ["user"],
    description: "Delete calendar events.",
    sensitive: true,
  },
  "space:document:delete": {
    group: "drive",
    token_types: ["user"],
    description: "Delete cloud docs.",
    sensitive: true,
  },
};

export function dedupePreserveOrder(scopes: Iterable<string>): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const scope of scopes) {
    const normalized = scope.trim();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      items.push(normalized);
    }
  }
  return items;
}

export function filterSensitiveScopes(scopes: Iterable<string>): string[] {
  const sensitive = new Set<string>(SENSITIVE_SCOPES);
  return dedupePreserveOrder(scopes).filter((scope) => !sensitive.has(scope));
}

export function batchScopes(scopes: Iterable<string>, batchSize: number = 100): string[][] {
  if (batchSize <= 0) {
    throw new Error("batch_size must be positive");
  }
  const uniqueScopes = dedupePreserveOrder(scopes);
  const result: string[][] = [];
  for (let index = 0; index < uniqueScopes.length; index += batchSize) {
    result.push(uniqueScopes.slice(index, index + batchSize));
  }
  return result;
}

export function summarizeScopeBatches(batches: Iterable<Iterable<string>>): string[] {
  const result: string[] = [];
  let index = 1;
  for (const batch of batches) {
    const count = Array.from(batch).length;
    result.push(`Batch ${index}: ${count} scopes`);
    index += 1;
  }
  return result;
}

export function missingCoreScopes(scopes: Iterable<string>): string[] {
  const granted = new Set(dedupePreserveOrder(scopes));
  return CORE_APP_SCOPES.filter((scope) => !granted.has(scope));
}
