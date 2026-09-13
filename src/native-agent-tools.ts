export interface FeishuNativeAgentToolSpec {
  name: string;
  description: string;
  parameters: Record<string, any>;
  required_scopes: string[];
}

export interface FeishuNativeAgentToolSelection {
  tool_name: string;
  arguments: Record<string, any>;
  reason: string;
}

export function nativeAgentToolSpecs(): readonly FeishuNativeAgentToolSpec[] {
  return [
    {
      name: 'contact.search_user',
      description: 'Search Feishu contacts by a human query.',
      parameters: { query: 'string', page_size: 'integer optional' },
      required_scopes: ['contact:user:search'],
    },
    {
      name: 'contact.get_user',
      description: "Read one Feishu user's profile by open_id, union_id, or user_id.",
      parameters: { user_id: 'string', user_id_type: 'open_id|union_id|user_id optional' },
      required_scopes: [
        'contact:contact.base:readonly',
        'contact:user.base:readonly',
      ],
    },
    {
      name: 'im.get_messages',
      description: 'Read recent messages from a known Feishu chat_id.',
      parameters: { chat_id: 'string', page_size: 'integer optional' },
      required_scopes: [
        'im:chat:read',
        'im:message:readonly',
        'im:message.group_msg:get_as_user',
        'im:message.p2p_msg:get_as_user',
      ],
    },
    {
      name: 'drive.list_files',
      description: 'List files from Feishu Drive root or a known folder_token.',
      parameters: {
        folder_token: 'string optional',
        page_size: 'integer optional',
        page_token: 'string optional',
      },
      required_scopes: ['space:document:retrieve'],
    },
  ];
}

export function getNativeAgentToolSpec(toolName: string): FeishuNativeAgentToolSpec | null {
  for (const spec of nativeAgentToolSpecs()) {
    if (spec.name === toolName) {
      return spec;
    }
  }
  return null;
}

export function nativeUserAuthScopes(): string[] {
  const deduped = new Set<string>(['offline_access']);
  for (const spec of nativeAgentToolSpecs()) {
    for (const scope of spec.required_scopes) {
      deduped.add(scope);
    }
  }
  return Array.from(deduped);
}

function formatJsonCompact(obj: any): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(formatJsonCompact).join(', ')}]`;
  }
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((k) => `${JSON.stringify(k)}: ${formatJsonCompact(obj[k])}`);
  return `{${pairs.join(', ')}}`;
}

export function buildNativeAgentToolSelectionPrompt(options: {
  userText: string;
  inboundContext: Record<string, any>;
}): string {
  const tools = nativeAgentToolSpecs()
    .map(
      (spec) =>
        `- ${spec.name}: ${spec.description} parameters=${formatJsonCompact(spec.parameters)}`,
    )
    .join('\n');
  const contextJson = formatJsonCompact(options.inboundContext);
  return (
    'You are the Feishu native tool selector.\n' +
    'Choose exactly one tool only when it directly helps answer the user. ' +
    'Never guess IDs that are not present in the user message or inbound context.\n\n' +
    'Available tools:\n' +
    `${tools}\n\n` +
    'Return JSON only, no markdown:\n' +
    '{"tool_name":"contact.search_user","arguments":{"query":"Alice"},"reason":"optional"}\n' +
    'or {"tool_name":"none","arguments":{},"reason":"no useful native tool"}\n\n' +
    `Inbound context JSON:\n${contextJson}\n\n` +
    `User message:\n${options.userText}`
  );
}

function extractJsonObject(text: string): Record<string, any> | null {
  const stripped = text.trim();
  const fence = stripped.match(/```(?:json)?\s*(\{.*?\})\s*```/s);
  const candidate = fence ? fence[1] : stripped;
  try {
    const payload = JSON.parse(candidate);
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      return payload;
    }
    return null;
  } catch {
    return null;
  }
}

export function parseNativeAgentToolSelection(
  text: string,
): FeishuNativeAgentToolSelection | null {
  const payload = extractJsonObject(text);
  if (!payload) {
    return null;
  }
  const toolName = String(payload.tool_name || '').trim();
  if (!toolName || toolName === 'none') {
    return null;
  }
  const allowed = new Set(nativeAgentToolSpecs().map((s) => s.name));
  if (!allowed.has(toolName)) {
    return null;
  }
  const args =
    payload.arguments && typeof payload.arguments === 'object' && !Array.isArray(payload.arguments)
      ? payload.arguments
      : {};
  return {
    tool_name: toolName,
    arguments: { ...args },
    reason: String(payload.reason || ''),
  };
}

export function buildToolResultFollowupPrompt(options: {
  originalText: string;
  toolName: string;
  arguments: Record<string, any>;
  result: Record<string, any>;
}): string {
  const payload = {
    tool_name: options.toolName,
    arguments: options.arguments,
    result: options.result,
  };
  return (
    'A Feishu native tool was executed before this response.\n\n' +
    `Original user message:\n${options.originalText}\n\n` +
    'Feishu native tool result:\n' +
    '```json\n' +
    `${JSON.stringify(payload, null, 2)}\n` +
    '```\n\n' +
    'Answer the user directly using the tool result. ' +
    'Do not emit another Feishu native tool selection JSON.'
  );
}
