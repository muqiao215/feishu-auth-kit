import { describe, it, expect, vi } from "vitest";
import { FlushController } from "../src/flush-controller.js";

describe("FlushController", () => {
  it("does not flush when cardMessageReady is false", async () => {
    const doFlush = vi.fn().mockResolvedValue(undefined);
    const controller = new FlushController(doFlush);

    await controller.flush();
    expect(doFlush).not.toHaveBeenCalled();

    await controller.throttledUpdate(100);
    expect(doFlush).not.toHaveBeenCalled();
  });

  it("flushes immediately when ready and throttledUpdate interval is met", async () => {
    const doFlush = vi.fn().mockResolvedValue(undefined);
    const controller = new FlushController(doFlush);
    controller.setCardMessageReady(true);

    await controller.flush();
    expect(doFlush).toHaveBeenCalledTimes(1);
  });

  it("schedules pending flush when inside throttle window", async () => {
    vi.useFakeTimers();
    const doFlush = vi.fn().mockResolvedValue(undefined);
    const controller = new FlushController(doFlush);
    controller.setCardMessageReady(true);

    await controller.flush();
    expect(doFlush).toHaveBeenCalledTimes(1);

    // Call inside throttle window (e.g. 300ms)
    await controller.throttledUpdate(300);
    expect(doFlush).toHaveBeenCalledTimes(1);

    // Advance timers by 300ms
    await vi.advanceTimersByTimeAsync(350);
    expect(doFlush).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("handles reflush-on-conflict when new events arrive while flush is in flight", async () => {
    let resolveFirstFlush: () => void;
    const firstFlushPromise = new Promise<void>((r) => {
      resolveFirstFlush = r;
    });

    let callCount = 0;
    const doFlush = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        await firstFlushPromise;
      }
    });

    const controller = new FlushController(doFlush);
    controller.setCardMessageReady(true);

    // Start first flush
    const p1 = controller.flush();
    expect(doFlush).toHaveBeenCalledTimes(1);

    // Second flush called while first is in progress
    const p2 = controller.flush();
    expect(doFlush).toHaveBeenCalledTimes(1);

    // Release first flush
    resolveFirstFlush!();
    await p1;
    await p2;

    // After first completes, second scheduled flush should run
    await new Promise((r) => setTimeout(r, 10));
    expect(doFlush).toHaveBeenCalledTimes(2);
  });

  it("cancels pending flush and completes correctly", async () => {
    vi.useFakeTimers();
    const doFlush = vi.fn().mockResolvedValue(undefined);
    const controller = new FlushController(doFlush);
    controller.setCardMessageReady(true);

    await controller.flush();
    await controller.throttledUpdate(300);

    controller.complete();
    expect(controller.completed).toBe(true);

    await vi.advanceTimersByTimeAsync(500);
    expect(doFlush).toHaveBeenCalledTimes(1); // No second flush after complete

    vi.useRealTimers();
  });
});
