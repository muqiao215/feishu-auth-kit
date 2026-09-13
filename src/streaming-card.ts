/**
 * Streaming CardKit card controller.
 *
 * Manages full lifecycle of a streaming LLM response in a Feishu card:
 * idle -> streaming -> completed / error / aborted.
 * Uses FlushController to automatically throttle outbound updates to avoid rate limits.
 */

import { FlushController, DEFAULT_THROTTLE_CONSTANTS, type ThrottleConstants } from "./flush-controller.js";

export type StreamingCardState = "idle" | "streaming" | "completed" | "error" | "aborted";

export interface StreamingCardOptions {
  title?: string;
  initialText?: string;
  throttleMs?: number;
  throttleConstants?: ThrottleConstants;
  onFlush?: (cardPayload: Record<string, any>) => Promise<void>;
}

export class StreamingCardController {
  private state: StreamingCardState = "idle";
  private title: string;
  private reasoningContent: string = "";
  private mainContent: string = "";
  private errorMessage: string | null = null;
  private readonly flushController: FlushController;
  private readonly throttleMs: number;
  private readonly onFlushCallback?: (cardPayload: Record<string, any>) => Promise<void>;

  constructor(options: StreamingCardOptions = {}) {
    this.title = options.title ?? "Agent Working...";
    this.mainContent = options.initialText ?? "";
    this.throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_CONSTANTS.defaultThrottleMs;
    this.onFlushCallback = options.onFlush;

    this.flushController = new FlushController(
      async () => {
        if (this.onFlushCallback) {
          const payload = this.buildCardPayload();
          await this.onFlushCallback(payload);
        }
      },
      options.throttleConstants ?? DEFAULT_THROTTLE_CONSTANTS
    );
    this.flushController.setCardMessageReady(true);
  }

  getState(): StreamingCardState {
    return this.state;
  }

  getContent(): string {
    return this.mainContent;
  }

  getReasoningContent(): string {
    return this.reasoningContent;
  }

  /**
   * Append a token chunk to main streaming response.
   */
  async appendToken(token: string): Promise<void> {
    if (this.state === "completed" || this.state === "error" || this.state === "aborted") {
      return;
    }
    this.state = "streaming";
    this.mainContent += token;
    await this.flushController.throttledUpdate(this.throttleMs);
  }

  /**
   * Append reasoning / thinking text chunk.
   */
  async appendReasoningToken(token: string): Promise<void> {
    if (this.state === "completed" || this.state === "error" || this.state === "aborted") {
      return;
    }
    this.state = "streaming";
    this.reasoningContent += token;
    await this.flushController.throttledUpdate(this.throttleMs);
  }

  /**
   * Replace full main content and trigger throttled update.
   */
  async updateContent(text: string): Promise<void> {
    if (this.state === "completed" || this.state === "error" || this.state === "aborted") {
      return;
    }
    this.state = "streaming";
    this.mainContent = text;
    await this.flushController.throttledUpdate(this.throttleMs);
  }

  /**
   * Complete streaming with optional final override text, flushing immediately.
   */
  async complete(finalText?: string): Promise<void> {
    if (this.state === "completed") return;
    this.state = "completed";
    if (finalText !== undefined) {
      this.mainContent = finalText;
    }
    this.flushController.cancelPendingFlush();
    await this.flushController.flush();
    this.flushController.complete();
  }

  /**
   * Abort streaming.
   */
  async abort(reason: string = "Aborted by user"): Promise<void> {
    if (this.state === "completed" || this.state === "aborted") return;
    this.state = "aborted";
    this.mainContent += `\n\n*(Cancelled: ${reason})*`;
    this.flushController.cancelPendingFlush();
    await this.flushController.flush();
    this.flushController.complete();
  }

  /**
   * Mark stream as error and flush card.
   */
  async error(err: Error | string): Promise<void> {
    this.state = "error";
    this.errorMessage = typeof err === "string" ? err : err.message;
    this.flushController.cancelPendingFlush();
    await this.flushController.flush();
    this.flushController.complete();
  }

  /**
   * Wait for any current flush network request to finish.
   */
  async waitForFlush(): Promise<void> {
    await this.flushController.waitForFlush();
  }

  /**
   * Build Feishu CardKit 2.0 schema representation.
   */
  buildCardPayload(): Record<string, any> {
    const elements: Array<Record<string, any>> = [];

    // If there is reasoning content, render in quote/callout style
    if (this.reasoningContent.trim()) {
      elements.push({
        tag: "div",
        text: {
          tag: "lark_md",
          content: `**Thinking Process**\n> ${this.reasoningContent.trim().replace(/\n/g, "\n> ")}`,
        },
      });
      elements.push({ tag: "hr" });
    }

    // Main content
    let displayContent = this.mainContent;
    if (this.state === "streaming") {
      displayContent += " ▊"; // Cursor indicator
    } else if (!displayContent && this.state === "idle") {
      displayContent = "*Waiting for response...*";
    }

    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: displayContent || "*(Empty response)*",
      },
    });

    if (this.errorMessage) {
      elements.push({
        tag: "div",
        text: {
          tag: "lark_md",
          content: `<font color="red">**Error**: ${this.errorMessage}</font>`,
        },
      });
    }

    let headerColor = "blue";
    if (this.state === "completed") headerColor = "green";
    else if (this.state === "error") headerColor = "red";
    else if (this.state === "aborted") headerColor = "grey";

    return {
      config: {
        wide_screen_mode: true,
        update_multi: true,
      },
      header: {
        title: {
          tag: "plain_text",
          content: this.title,
        },
        template: headerColor,
      },
      elements,
    };
  }
}
