/**
 * Throttled flush controller for Feishu CardKit updates.
 *
 * Provides timer-based throttling, mutex-guarded flushing, and reflush-on-conflict.
 * Prevents triggering Feishu card rate limits (approx 3 updates/sec) while ensuring
 * the final state is always delivered without message loss.
 */

export interface ThrottleConstants {
  readonly defaultThrottleMs: number;
  readonly longGapThresholdMs: number;
  readonly batchAfterGapMs: number;
}

export const DEFAULT_THROTTLE_CONSTANTS: ThrottleConstants = {
  defaultThrottleMs: 300,
  longGapThresholdMs: 2000,
  batchAfterGapMs: 100,
};

export class FlushController {
  private flushInProgress = false;
  private flushResolvers: Array<() => void> = [];
  private needsReflush = false;
  private pendingFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastUpdateTime = 0;
  private isCompleted = false;
  private _cardMessageReady = false;

  constructor(
    private readonly doFlush: () => Promise<void>,
    private readonly constants: ThrottleConstants = DEFAULT_THROTTLE_CONSTANTS
  ) {}

  /** Mark the controller as completed - no further flushes will be scheduled. */
  complete(): void {
    this.isCompleted = true;
    this.cancelPendingFlush();
  }

  get completed(): boolean {
    return this.isCompleted;
  }

  /** Cancel any pending deferred flush timer. */
  cancelPendingFlush(): void {
    if (this.pendingFlushTimer) {
      clearTimeout(this.pendingFlushTimer);
      this.pendingFlushTimer = null;
    }
  }

  /** Wait for any in-progress flush to finish. */
  waitForFlush(): Promise<void> {
    if (!this.flushInProgress) return Promise.resolve();
    return new Promise<void>((resolve) => this.flushResolvers.push(resolve));
  }

  /**
   * Execute a flush (mutex-guarded, with reflush on conflict).
   * If a flush is already running, marks needsReflush so another flush
   * runs immediately after the current one completes.
   */
  async flush(): Promise<void> {
    if (!this._cardMessageReady || this.flushInProgress || this.isCompleted) {
      if (this.flushInProgress && !this.isCompleted) {
        this.needsReflush = true;
      }
      return;
    }

    this.flushInProgress = true;
    this.needsReflush = false;
    this.lastUpdateTime = Date.now();

    try {
      await this.doFlush();
      this.lastUpdateTime = Date.now();
    } finally {
      this.flushInProgress = false;
      const resolvers = this.flushResolvers;
      this.flushResolvers = [];
      for (const resolve of resolvers) {
        resolve();
      }

      if (this.needsReflush && !this.isCompleted && !this.pendingFlushTimer) {
        this.needsReflush = false;
        this.pendingFlushTimer = setTimeout(() => {
          this.pendingFlushTimer = null;
          void this.flush();
        }, 0);
      }
    }
  }

  /**
   * Throttled update entry point.
   *
   * @param throttleMs Minimum interval between updates. Defaults to constants.defaultThrottleMs.
   */
  async throttledUpdate(throttleMs: number = this.constants.defaultThrottleMs): Promise<void> {
    if (!this._cardMessageReady) return;

    const now = Date.now();
    const elapsed = now - this.lastUpdateTime;

    if (elapsed >= throttleMs) {
      this.cancelPendingFlush();
      if (elapsed > this.constants.longGapThresholdMs) {
        this.lastUpdateTime = now;
        this.pendingFlushTimer = setTimeout(() => {
          this.pendingFlushTimer = null;
          void this.flush();
        }, this.constants.batchAfterGapMs);
      } else {
        await this.flush();
      }
    } else if (!this.pendingFlushTimer) {
      const delay = throttleMs - elapsed;
      this.pendingFlushTimer = setTimeout(() => {
        this.pendingFlushTimer = null;
        void this.flush();
      }, delay);
    }
  }

  cardMessageReady(): boolean {
    return this._cardMessageReady;
  }

  setCardMessageReady(ready: boolean): void {
    this._cardMessageReady = ready;
    if (ready) {
      this.lastUpdateTime = Date.now();
    }
  }
}
