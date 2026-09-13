import { AgentEvent, AgentTurnResult } from './agent-runtime.js';
import { FeishuMessageContext } from './message-context.js';

export interface CardKitStepOptions {
  id: string;
  kind: string;
  title: string;
  status: string;
  detail?: string | null;
  metadata?: Record<string, any>;
}

export class CardKitStep {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly status: string;
  readonly detail: string | null;
  readonly metadata: Record<string, any>;

  constructor(options: CardKitStepOptions) {
    this.id = options.id;
    this.kind = options.kind;
    this.title = options.title;
    this.status = options.status;
    this.detail = options.detail ?? null;
    this.metadata = options.metadata ? { ...options.metadata } : {};
  }

  toDict(): Record<string, any> {
    const payload: Record<string, any> = {
      id: this.id,
      kind: this.kind,
      title: this.title,
      status: this.status,
      detail: this.detail,
      metadata: this.metadata,
    };
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (value === null || value === undefined) {
        continue;
      }
      if (
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.keys(value).length === 0
      ) {
        continue;
      }
      result[key] = value;
    }
    return result;
  }
}

export interface SingleCardRunOptions {
  runner: string;
  messageId: string | null;
  chatId: string | null;
  senderOpenId: string | null;
  status: string;
  summary: string;
  finalText: string;
  steps: CardKitStep[];
  metadata?: Record<string, any>;
}

export class SingleCardRun {
  readonly runner: string;
  readonly messageId: string | null;
  readonly chatId: string | null;
  readonly senderOpenId: string | null;
  readonly status: string;
  readonly summary: string;
  readonly finalText: string;
  readonly steps: CardKitStep[];
  readonly metadata: Record<string, any>;

  constructor(options: SingleCardRunOptions) {
    this.runner = options.runner;
    this.messageId = options.messageId;
    this.chatId = options.chatId;
    this.senderOpenId = options.senderOpenId;
    this.status = options.status;
    this.summary = options.summary;
    this.finalText = options.finalText;
    this.steps = [...options.steps];
    this.metadata = options.metadata ? { ...options.metadata } : {};
  }

  toDict(): Record<string, any> {
    return {
      schema: 'feishu-auth-kit.cardkit.single_card.v1',
      type: 'agent_run_single_card',
      runner: this.runner,
      message_id: this.messageId,
      chat_id: this.chatId,
      sender_open_id: this.senderOpenId,
      status: this.status,
      summary: this.summary,
      final_text: this.finalText,
      steps: this.steps.map((step) => step.toDict()),
      metadata: this.metadata,
    };
  }
}

function eventDetail(event: AgentEvent): string | null {
  if (event.detail) {
    return event.detail;
  }
  if (event.toolInput !== null && event.toolInput !== undefined) {
    if (typeof event.toolInput === 'string') {
      return event.toolInput;
    }
    return JSON.stringify(event.toolInput);
  }
  return event.text;
}

function stepTitle(event: AgentEvent): string {
  if (event.kind === 'tool_call') {
    return `Tool: ${event.toolName || 'unknown'}`;
  }
  if (event.kind === 'tool_result') {
    return `Tool result: ${event.toolName || 'unknown'}`;
  }
  if (event.kind === 'start') {
    return 'Runner started';
  }
  if (event.kind === 'running') {
    return 'Runner running';
  }
  if (event.kind === 'completed') {
    return 'Runner completed';
  }
  if (event.kind === 'error') {
    return 'Runner error';
  }
  if (event.kind === 'stderr_warning') {
    return 'Runner warning';
  }
  if (event.kind === 'assistant_message') {
    return 'Assistant response';
  }
  return event.text || 'Runtime status';
}

function stepFromEvent(index: number, event: AgentEvent): CardKitStep {
  return new CardKitStep({
    id: `step-${index}`,
    kind: event.kind,
    title: stepTitle(event),
    status: event.state || 'completed',
    detail: eventDetail(event),
    metadata: event.metadata,
  });
}

function makeSummary(text: string, maxChars = 160): string {
  const compact = text.trim().split(/\s+/).join(' ');
  if (compact.length <= maxChars) {
    return compact;
  }
  return compact.slice(0, maxChars - 1).trimEnd() + '…';
}

export function buildSingleCardRun(
  context: FeishuMessageContext,
  result: AgentTurnResult,
): SingleCardRun {
  const steps = result.events.map((event, i) => stepFromEvent(i + 1, event));
  return new SingleCardRun({
    runner: result.runner,
    messageId: context.messageId ?? null,
    chatId: context.chatId ?? null,
    senderOpenId: context.senderOpenId ?? null,
    status: result.status,
    summary: makeSummary(result.outputText),
    finalText: result.outputText,
    steps,
    metadata: {
      event_id: context.eventId,
      event_type: context.eventType,
      ...result.metadata,
    },
  });
}
