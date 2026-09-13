import { describe, it, expect, vi } from "vitest";
import {
  InteractiveActionDispatcher,
  type CardActionContext,
} from "../src/interactive-dispatcher.js";

describe("InteractiveActionDispatcher", () => {
  it("parses context correctly from Feishu webhook card callback event", () => {
    const rawEvent = {
      open_id: "ou_tester1",
      open_message_id: "om_msg123",
      open_chat_id: "oc_chat456",
      action: {
        tag: "button",
        value: {
          action: "approve",
          task_id: "task-001",
        },
      },
    };

    const ctx = InteractiveActionDispatcher.parseContext(rawEvent);
    expect(ctx.openId).toBe("ou_tester1");
    expect(ctx.messageId).toBe("om_msg123");
    expect(ctx.chatId).toBe("oc_chat456");
    expect(ctx.tag).toBe("button");
    expect(ctx.actionValue).toEqual({ action: "approve", task_id: "task-001" });
  });

  it("dispatches to registered action handler by actionName", async () => {
    const dispatcher = new InteractiveActionDispatcher();
    const approveHandler = vi.fn().mockReturnValue({
      toast: { type: "success", content: "Task approved" },
      card: { config: { wide_screen_mode: true }, elements: [] },
    });

    dispatcher.onAction("approve", approveHandler);

    const event = {
      open_id: "ou_user1",
      open_message_id: "om_1",
      action: {
        tag: "button",
        value: { action: "approve" },
      },
    };

    const response = await dispatcher.dispatch(event);
    expect(approveHandler).toHaveBeenCalledTimes(1);
    expect(response.toast?.content).toBe("Task approved");
    expect(response.card).toBeDefined();
  });

  it("routes by action_id if specified", async () => {
    const dispatcher = new InteractiveActionDispatcher();
    const retryHandler = vi.fn().mockReturnValue({
      toast: { type: "info", content: "Retrying..." },
    });

    dispatcher.onAction("retry_btn", retryHandler);

    const event = {
      open_id: "ou_user1",
      open_message_id: "om_1",
      action: {
        tag: "button",
        value: { action_id: "retry_btn" },
      },
    };

    const response = await dispatcher.dispatch(event);
    expect(retryHandler).toHaveBeenCalledTimes(1);
    expect(response.toast?.content).toBe("Retrying...");
  });

  it("falls back to default fallback handler when no matches", async () => {
    const dispatcher = new InteractiveActionDispatcher();
    const event = {
      open_id: "ou_user1",
      open_message_id: "om_1",
      action: {
        tag: "button",
        value: { action: "unknown_cmd" },
      },
    };

    const response = await dispatcher.dispatch(event);
    expect(response.toast?.type).toBe("info");
    expect(response.toast?.content).toBe("Action acknowledged");
  });

  it("supports custom fallback handler", async () => {
    const dispatcher = new InteractiveActionDispatcher();
    dispatcher.setFallback((ctx) => ({
      toast: { type: "warning", content: `Unrecognized action: ${JSON.stringify(ctx.actionValue)}` },
    }));

    const event = {
      open_id: "ou_user1",
      open_message_id: "om_1",
      action: {
        tag: "button",
        value: { custom: 123 },
      },
    };

    const response = await dispatcher.dispatch(event);
    expect(response.toast?.type).toBe("warning");
    expect(response.toast?.content).toContain("Unrecognized action");
  });
});
