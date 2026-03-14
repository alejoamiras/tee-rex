import { describe, expect, test } from "bun:test";
import { getClientIp, isLocalhost, RateLimiter } from "./rate-limit.js";

describe("RateLimiter", () => {
  test("allows requests under the limit", () => {
    const limiter = new RateLimiter({ limit: 3, windowMs: 60_000 });
    expect(limiter.isLimited("1.2.3.4")).toBe(false);
    expect(limiter.isLimited("1.2.3.4")).toBe(false);
    expect(limiter.isLimited("1.2.3.4")).toBe(false);
    limiter.dispose();
  });

  test("blocks requests exceeding the limit", () => {
    const limiter = new RateLimiter({ limit: 2, windowMs: 60_000 });
    expect(limiter.isLimited("1.2.3.4")).toBe(false);
    expect(limiter.isLimited("1.2.3.4")).toBe(false);
    expect(limiter.isLimited("1.2.3.4")).toBe(true);
    limiter.dispose();
  });

  test("tracks IPs independently", () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 60_000 });
    expect(limiter.isLimited("1.1.1.1")).toBe(false);
    expect(limiter.isLimited("2.2.2.2")).toBe(false);
    expect(limiter.isLimited("1.1.1.1")).toBe(true);
    expect(limiter.isLimited("2.2.2.2")).toBe(true);
    limiter.dispose();
  });

  test("resets after window expires", () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 50 });
    expect(limiter.isLimited("1.2.3.4")).toBe(false);
    expect(limiter.isLimited("1.2.3.4")).toBe(true);

    // Wait for window to expire
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(limiter.isLimited("1.2.3.4")).toBe(false);
        limiter.dispose();
        resolve();
      }, 100);
    });
  });
});

describe("getClientIp", () => {
  test("returns X-Forwarded-For first hop when present", () => {
    const req = new Request("http://localhost/test", {
      headers: { "X-Forwarded-For": "1.2.3.4, 5.6.7.8" },
    });
    const server = { requestIP: () => ({ address: "127.0.0.1" }) };
    expect(getClientIp(req, server)).toBe("1.2.3.4");
  });

  test("falls back to server.requestIP when no X-Forwarded-For", () => {
    const req = new Request("http://localhost/test");
    const server = { requestIP: () => ({ address: "10.0.0.1" }) };
    expect(getClientIp(req, server)).toBe("10.0.0.1");
  });

  test("returns 'unknown' when requestIP returns null", () => {
    const req = new Request("http://localhost/test");
    const server = { requestIP: () => null };
    expect(getClientIp(req, server)).toBe("unknown");
  });
});

describe("isLocalhost", () => {
  test("recognizes localhost IPs", () => {
    expect(isLocalhost("127.0.0.1")).toBe(true);
    expect(isLocalhost("::1")).toBe(true);
    expect(isLocalhost("::ffff:127.0.0.1")).toBe(true);
  });

  test("rejects non-localhost IPs", () => {
    expect(isLocalhost("1.2.3.4")).toBe(false);
    expect(isLocalhost("192.168.1.1")).toBe(false);
  });
});
