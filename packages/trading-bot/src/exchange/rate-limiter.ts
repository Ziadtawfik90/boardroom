/**
 * Token Bucket Rate Limiter
 *
 * Enforces exchange-specific rate limits. Callers await `acquire()` which
 * resolves when a token is available or rejects if the max wait time is
 * exceeded.
 */

export interface RateLimiterOptions {
  /** Maximum tokens in the bucket */
  maxTokens: number;
  /** Tokens added per second */
  refillRate: number;
  /** Max time (ms) to wait for a token before rejecting */
  maxWaitMs?: number;
}

export class RateLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillRate: number;
  private readonly maxWaitMs: number;
  private lastRefill: number;
  private queue: Array<{ resolve: () => void; reject: (err: Error) => void; deadline: number }> = [];
  private drainTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: RateLimiterOptions) {
    this.maxTokens = options.maxTokens;
    this.refillRate = options.refillRate;
    this.maxWaitMs = options.maxWaitMs ?? 30_000;
    this.tokens = options.maxTokens;
    this.lastRefill = Date.now();
  }

  /** Current fill level as a percentage (0–100). */
  get remainingPercent(): number {
    this.refill();
    return Math.round((this.tokens / this.maxTokens) * 100);
  }

  /** Acquire a token. Resolves immediately if available, otherwise queues. */
  async acquire(weight = 1): Promise<void> {
    this.refill();

    if (this.tokens >= weight) {
      this.tokens -= weight;
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + this.maxWaitMs;
      this.queue.push({ resolve, reject, deadline });
      this.scheduleDrain();
    });
  }

  /** Release is a no-op for token bucket — tokens refill over time. */
  release(): void {
    // intentional no-op
  }

  destroy(): void {
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
    for (const waiter of this.queue) {
      waiter.reject(new Error("RateLimiter destroyed"));
    }
    this.queue = [];
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  private scheduleDrain(): void {
    if (this.drainTimer) return;

    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      this.refill();

      const now = Date.now();

      // Reject expired waiters
      this.queue = this.queue.filter((w) => {
        if (now >= w.deadline) {
          w.reject(new Error(`Rate limit wait exceeded ${this.maxWaitMs}ms`));
          return false;
        }
        return true;
      });

      // Fulfill waiters with available tokens
      while (this.queue.length > 0 && this.tokens >= 1) {
        const waiter = this.queue.shift()!;
        this.tokens -= 1;
        waiter.resolve();
      }

      if (this.queue.length > 0) {
        this.scheduleDrain();
      }
    }, Math.ceil(1000 / this.refillRate));
  }
}
