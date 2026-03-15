/**
 * In-memory sliding window rate limiter.
 *
 * Tracks request timestamps per IP and rejects when the window limit is exceeded.
 * Automatically prunes expired entries to prevent unbounded memory growth.
 */

const DEFAULT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_LIMIT = 10;
const PRUNE_INTERVAL_MS = 5 * 60 * 1000; // prune every 5 minutes

export interface RateLimitOptions {
  windowMs?: number;
  limit?: number;
}

export class RateLimiter {
  #windowMs: number;
  #limit: number;
  #hits: Map<string, number[]> = new Map();
  #pruneTimer: Timer;

  constructor(options: RateLimitOptions = {}) {
    this.#windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.#limit = options.limit ?? DEFAULT_LIMIT;
    this.#pruneTimer = setInterval(() => this.#prune(), PRUNE_INTERVAL_MS);
    // Don't prevent process exit
    this.#pruneTimer.unref();
  }

  /** Returns true if the IP should be rate-limited (rejected). */
  isLimited(ip: string): boolean {
    const now = Date.now();
    const cutoff = now - this.#windowMs;

    let timestamps = this.#hits.get(ip);
    if (timestamps) {
      // Remove expired timestamps
      timestamps = timestamps.filter((t) => t > cutoff);
    } else {
      timestamps = [];
    }

    if (timestamps.length >= this.#limit) {
      this.#hits.set(ip, timestamps);
      return true;
    }

    timestamps.push(now);
    this.#hits.set(ip, timestamps);
    return false;
  }

  /** Remove all expired entries. */
  #prune() {
    const cutoff = Date.now() - this.#windowMs;
    for (const [ip, timestamps] of this.#hits) {
      const valid = timestamps.filter((t) => t > cutoff);
      if (valid.length === 0) {
        this.#hits.delete(ip);
      } else {
        this.#hits.set(ip, valid);
      }
    }
  }

  dispose() {
    clearInterval(this.#pruneTimer);
    this.#hits.clear();
  }
}

const LOCALHOST_IPS = new Set(["127.0.0.1", "::1", "localhost", "0.0.0.0", "::ffff:127.0.0.1"]);

/** Extract the client IP from a request, respecting X-Forwarded-For (first hop). */
export function getClientIp(
  req: Request,
  server: { requestIP(req: Request): { address: string } | null },
): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    // First hop = real client IP (we trust the first proxy)
    const firstHop = xff.split(",")[0]?.trim();
    if (firstHop) return firstHop;
  }
  return server.requestIP(req)?.address ?? "unknown";
}

/** Check if an IP is localhost (should skip rate limiting). */
export function isLocalhost(ip: string): boolean {
  return LOCALHOST_IPS.has(ip);
}
