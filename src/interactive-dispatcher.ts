/**
 * Interactive Action Dispatcher for Feishu CardKit card callbacks.
 *
 * Dispatches `card.action.trigger` events to registered handlers based on
 * action tag, action ID, or custom predicates. Supports immediate card update responses,
 * toast messages, and fallback handlers.
 */

export interface CardActionContext {
  openId: string;
  userId?: string;
  messageId: string;
  chatId?: string;
  tag: string;
  actionValue: Record<string, any>;
  rawEvent: Record<string, any>;
}

export interface CardActionToast {
  type: "info" | "success" | "warning" | "danger";
  content: string;
}

export interface CardActionResponse {
  toast?: CardActionToast;
  card?: Record<string, any>;
}

export type CardActionHandler = (
  ctx: CardActionContext
) => Promise<CardActionResponse | void> | CardActionResponse | void;

export type MatchPredicate = (ctx: CardActionContext) => boolean;

export class InteractiveActionDispatcher {
  private handlers: Array<{
    predicate: MatchPredicate;
    handler: CardActionHandler;
  }> = [];

  private fallbackHandler: CardActionHandler = () => {
    return {
      toast: {
        type: "info",
        content: "Action acknowledged",
      },
    };
  };

  /**
   * Register a handler for a specific action string in actionValue (e.g. actionValue.action === 'retry')
   */
  onAction(actionName: string, handler: CardActionHandler): this {
    return this.register(
      (ctx) =>
        ctx.actionValue?.action === actionName ||
        ctx.actionValue?.action_id === actionName,
      handler
    );
  }

  /**
   * Register a handler for a specific tag (e.g. tag === 'button')
   */
  onTag(tag: string, handler: CardActionHandler): this {
    return this.register((ctx) => ctx.tag === tag, handler);
  }

  /**
   * Register a custom predicate matcher.
   */
  register(predicate: MatchPredicate, handler: CardActionHandler): this {
    this.handlers.push({ predicate, handler });
    return this;
  }

  /**
   * Set fallback handler when no registered handlers match.
   */
  setFallback(handler: CardActionHandler): this {
    this.fallbackHandler = handler;
    return this;
  }

  /**
   * Parse raw incoming Feishu webhook/websocket event payload into CardActionContext.
   */
  static parseContext(event: Record<string, any>): CardActionContext {
    const action = event.action || event.event?.action || {};
    const context = event.context || event.event?.context || {};
    const openMessageId =
      context.open_message_id ||
      event.open_message_id ||
      event.event?.open_message_id ||
      "";
    const openId =
      context.open_id ||
      event.open_id ||
      event.event?.operator?.open_id ||
      event.event?.sender?.sender_id?.open_id ||
      "";
    const userId =
      context.user_id ||
      event.user_id ||
      event.event?.operator?.user_id ||
      "";
    const chatId =
      context.open_chat_id ||
      event.open_chat_id ||
      event.event?.open_chat_id ||
      "";

    const tag = action.tag || "button";
    const actionValue = action.value || {};

    return {
      openId,
      userId: userId || undefined,
      messageId: openMessageId,
      chatId: chatId || undefined,
      tag,
      actionValue,
      rawEvent: event,
    };
  }

  /**
   * Dispatch an action trigger event.
   */
  async dispatch(eventOrContext: Record<string, any> | CardActionContext): Promise<CardActionResponse> {
    const ctx: CardActionContext =
      "openId" in eventOrContext && "actionValue" in eventOrContext
        ? (eventOrContext as CardActionContext)
        : InteractiveActionDispatcher.parseContext(eventOrContext);

    for (const entry of this.handlers) {
      if (entry.predicate(ctx)) {
        const res = await entry.handler(ctx);
        if (res) return res;
        return {
          toast: { type: "success", content: "Action executed" },
        };
      }
    }

    const fallbackRes = await this.fallbackHandler(ctx);
    if (fallbackRes) return fallbackRes;
    return {
      toast: { type: "info", content: "Action processed" },
    };
  }
}
