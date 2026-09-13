import { describe, it, expect, vi } from "vitest";
import { StreamingCardController } from "../src/streaming-card.js";

describe("StreamingCardController", () => {
  it("initializes with default options and generates valid card structure", () => {
    const controller = new StreamingCardController({
      title: "Task in Progress",
      initialText: "Hello",
    });

    expect(controller.getState()).toBe("idle");
    expect(controller.getContent()).toBe("Hello");

    const payload = controller.buildCardPayload();
    expect(payload.header.title.content).toBe("Task in Progress");
    expect(payload.header.template).toBe("blue");
    expect(payload.elements.length).toBeGreaterThan(0);
    expect(payload.elements[0].text.content).toContain("Hello");
  });

  it("handles streaming tokens and changes state to streaming", async () => {
    const onFlush = vi.fn().mockResolvedValue(undefined);
    const controller = new StreamingCardController({
      title: "LLM Bot",
      onFlush,
    });

    await controller.appendToken("First chunk");
    expect(controller.getState()).toBe("streaming");
    expect(controller.getContent()).toBe("First chunk");

    await controller.appendReasoningToken("Analyzing intent...");
    expect(controller.getReasoningContent()).toBe("Analyzing intent...");

    const payload = controller.buildCardPayload();
    // In streaming mode, cursor indicator should be appended
    expect(payload.elements.some((e: any) => e.text?.content?.includes("First chunk ▊"))).toBe(true);
    expect(payload.elements.some((e: any) => e.text?.content?.includes("Thinking Process"))).toBe(true);
  });

  it("completes streaming and flushes final payload with green header", async () => {
    let lastPayload: any = null;
    const onFlush = vi.fn().mockImplementation(async (payload) => {
      lastPayload = payload;
    });

    const controller = new StreamingCardController({
      title: "Finishing",
      onFlush,
    });

    await controller.appendToken("Thinking...");
    await controller.complete("Final answer here.");

    expect(controller.getState()).toBe("completed");
    expect(controller.getContent()).toBe("Final answer here.");
    expect(lastPayload).not.toBeNull();
    expect(lastPayload.header.template).toBe("green");
    expect(lastPayload.elements.some((e: any) => e.text?.content === "Final answer here.")).toBe(true);
  });

  it("handles abort and error states appropriately", async () => {
    let lastPayload: any = null;
    const onFlush = vi.fn().mockImplementation(async (payload) => {
      lastPayload = payload;
    });

    const controller1 = new StreamingCardController({ title: "To Abort", onFlush });
    await controller1.abort("user pressed stop");
    expect(controller1.getState()).toBe("aborted");
    expect(lastPayload.header.template).toBe("grey");
    expect(controller1.getContent()).toContain("user pressed stop");

    const controller2 = new StreamingCardController({ title: "To Error", onFlush });
    await controller2.error(new Error("Network disconnect"));
    expect(controller2.getState()).toBe("error");
    expect(lastPayload.header.template).toBe("red");
    expect(lastPayload.elements.some((e: any) => e.text?.content?.includes("Network disconnect"))).toBe(true);
  });
});
