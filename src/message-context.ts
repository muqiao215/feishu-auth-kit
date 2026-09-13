export interface FeishuMention {
  key?: string | null;
  name?: string | null;
  open_id?: string | null;
  user_id?: string | null;
  union_id?: string | null;
}

export class FeishuMessageContext {
  readonly schema: string = "feishu-auth-kit.message-context.v1";
  readonly source: string = "feishu";
  readonly delivery: string = "event_callback";
  readonly event_id?: string | null;
  readonly event_type?: string | null;
  readonly app_id?: string | null;
  readonly tenant_key?: string | null;
  readonly chat_id?: string | null;
  readonly chat_type?: string | null;
  readonly message_id?: string | null;
  readonly message_type: string = "text";
  readonly sender_open_id?: string | null;
  readonly sender_user_id?: string | null;
  readonly sender_union_id?: string | null;
  readonly text: string = "";
  readonly mentions: FeishuMention[] = [];
  readonly raw: Record<string, any> = {};

  constructor(options: {
    schema?: string;
    source?: string;
    delivery?: string;
    event_id?: string | null;
    event_type?: string | null;
    app_id?: string | null;
    tenant_key?: string | null;
    chat_id?: string | null;
    chat_type?: string | null;
    message_id?: string | null;
    message_type?: string;
    sender_open_id?: string | null;
    sender_user_id?: string | null;
    sender_union_id?: string | null;
    text?: string;
    mentions?: FeishuMention[];
    raw?: Record<string, any>;
  }) {
    if (options.schema) this.schema = options.schema;
    if (options.source) this.source = options.source;
    if (options.delivery) this.delivery = options.delivery;
    this.event_id = options.event_id ?? null;
    this.event_type = options.event_type ?? null;
    this.app_id = options.app_id ?? null;
    this.tenant_key = options.tenant_key ?? null;
    this.chat_id = options.chat_id ?? null;
    this.chat_type = options.chat_type ?? null;
    this.message_id = options.message_id ?? null;
    this.message_type = options.message_type ?? "text";
    this.sender_open_id = options.sender_open_id ?? null;
    this.sender_user_id = options.sender_user_id ?? null;
    this.sender_union_id = options.sender_union_id ?? null;
    this.text = options.text ?? "";
    this.mentions = options.mentions ?? [];
    this.raw = options.raw ?? {};
  }

  get eventId(): string | null | undefined { return this.event_id; }
  get eventType(): string | null | undefined { return this.event_type; }
  get appId(): string | null | undefined { return this.app_id; }
  get tenantKey(): string | null | undefined { return this.tenant_key; }
  get chatId(): string | null | undefined { return this.chat_id; }
  get chatType(): string | null | undefined { return this.chat_type; }
  get messageId(): string | null | undefined { return this.message_id; }
  get messageType(): string { return this.message_type; }
  get senderOpenId(): string | null | undefined { return this.sender_open_id; }
  get senderUserId(): string | null | undefined { return this.sender_user_id; }
  get senderUnionId(): string | null | undefined { return this.sender_union_id; }

  promptText(options?: { strip_mentions?: boolean }): string {
    return this.prompt_text(options);
  }

  toDict(options?: { include_raw?: boolean }): Record<string, any> {
    return this.to_dict(options);
  }

  prompt_text(options?: { strip_mentions?: boolean }): string {
    const stripMentions = options?.strip_mentions ?? true;
    let prompt = this.text.trim();
    if (stripMentions) {
      for (const mention of this.mentions) {
        if (mention.key) {
          prompt = prompt.split(mention.key).join(" ");
        }
      }
      prompt = prompt.replace(/(^|\s)@_[A-Za-z0-9_:-]+/g, " ");
    }
    return prompt.split(/\s+/).filter(Boolean).join(" ");
  }

  to_dict(options?: { include_raw?: boolean }): Record<string, any> {
    const payload: Record<string, any> = {
      schema: this.schema,
      source: this.source,
      delivery: this.delivery,
      event_id: this.event_id,
      event_type: this.event_type,
      app_id: this.app_id,
      tenant_key: this.tenant_key,
      chat_id: this.chat_id,
      chat_type: this.chat_type,
      message_id: this.message_id,
      message_type: this.message_type,
      sender_open_id: this.sender_open_id,
      sender_user_id: this.sender_user_id,
      sender_union_id: this.sender_union_id,
      text: this.text,
      prompt_text: this.prompt_text(),
      mentions: this.mentions.map((m) => ({
        key: m.key ?? null,
        name: m.name ?? null,
        open_id: m.open_id ?? null,
        user_id: m.user_id ?? null,
        union_id: m.union_id ?? null,
      })),
    };
    if (options?.include_raw) {
      payload.raw = this.raw;
    }
    return payload;
  }
}

function asDict(value: any): Record<string, any> {
  if (typeof value === "object" && value !== null) {
    return value;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "object" && parsed !== null ? parsed : { value: parsed };
    } catch {
      return { text: value };
    }
  }
  return {};
}

function firstString(...values: any[]): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) {
      return v;
    }
  }
  return null;
}

function parseText(messageType: string, content: any): string {
  const payload = asDict(content);
  if ("text" in payload) {
    return String(payload.text);
  }
  if (messageType === "text" && typeof content === "string") {
    return content;
  }
  if (Object.keys(payload).length > 0) {
    return JSON.stringify(payload, Object.keys(payload).sort());
  }
  return "";
}

function parseMentions(message: Record<string, any>): FeishuMention[] {
  const mentions: FeishuMention[] = [];
  const rawList = Array.isArray(message.mentions) ? message.mentions : [];
  for (const item of rawList) {
    if (!item || typeof item !== "object") continue;
    const mentionId = item.id && typeof item.id === "object" ? item.id : {};
    mentions.push({
      key: firstString(item.key),
      name: firstString(item.name),
      open_id: firstString(item.open_id, mentionId.open_id),
      user_id: firstString(item.user_id, mentionId.user_id),
      union_id: firstString(item.union_id, mentionId.union_id),
    });
  }
  return mentions;
}

export function parseFeishuMessageContext(payload: Record<string, any>): FeishuMessageContext {
  const header = asDict(payload.header);
  const event = asDict(payload.event || payload);
  const message = asDict(event.message || payload.message);
  const sender = asDict(event.sender || payload.sender);
  const senderId = asDict(sender.sender_id || sender.id || sender);
  const messageType = firstString(message.message_type, payload.message_type) || "text";

  return new FeishuMessageContext({
    event_id: firstString(header.event_id, payload.event_id),
    event_type: firstString(header.event_type, payload.event_type),
    app_id: firstString(header.app_id, payload.app_id),
    tenant_key: firstString(
      header.tenant_key,
      event.tenant_key,
      sender.tenant_key,
      payload.tenant_key
    ),
    chat_id: firstString(message.chat_id, payload.chat_id),
    chat_type: firstString(message.chat_type, payload.chat_type),
    message_id: firstString(
      message.message_id,
      message.open_message_id,
      payload.message_id,
      payload.open_message_id
    ),
    message_type: messageType,
    sender_open_id: firstString(senderId.open_id, payload.sender_open_id),
    sender_user_id: firstString(senderId.user_id, payload.sender_user_id),
    sender_union_id: firstString(senderId.union_id, payload.sender_union_id),
    text: parseText(messageType, message.content ?? payload.content),
    mentions: parseMentions(message),
    raw: payload,
  });
}
