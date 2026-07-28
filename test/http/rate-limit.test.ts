import { describe, expect, test } from "bun:test";

import {
  InMemoryFreeCallStore,
  createFreeCallLimiter,
  normalizeIp,
  resolveClientIp,
} from "../../src/http/rate-limit.js";

describe("free call limiter", () => {
  test("allows exactly the configured calls in a sliding day", () => {
    let now = 1_000;
    const limiter = createFreeCallLimiter({
      callsPerDay: 2,
      now: () => now,
    });

    expect(limiter.tryFreeCall("198.51.100.1")).toBe(true);
    expect(limiter.tryFreeCall("198.51.100.1")).toBe(true);
    expect(limiter.tryFreeCall("198.51.100.1")).toBe(false);
    expect(limiter.tryFreeCall("198.51.100.2")).toBe(true);

    now += 24 * 60 * 60 * 1_000 + 1;
    expect(limiter.tryFreeCall("198.51.100.1")).toBe(true);
  });

  test("purges expired identities but fails closed when the live cache is full", () => {
    let now = 1_000;
    const store = new InMemoryFreeCallStore({ maxIdentities: 2 });
    const limiter = createFreeCallLimiter({
      callsPerDay: 2,
      store,
      now: () => now,
    });

    expect(limiter.tryFreeCall("198.51.100.1")).toBe(true);
    expect(limiter.tryFreeCall("198.51.100.2")).toBe(true);
    expect(limiter.tryFreeCall("198.51.100.3")).toBe(false);
    expect(store.size).toBe(2);

    now += 24 * 60 * 60 * 1_000 + 1;
    expect(limiter.tryFreeCall("198.51.100.3")).toBe(true);
    expect(store.size).toBe(1);
  });

  test("fails closed without a validated identity or allowance", () => {
    const limiter = createFreeCallLimiter({ callsPerDay: 0 });
    expect(limiter.tryFreeCall(null)).toBe(false);
    expect(limiter.tryFreeCall("198.51.100.1")).toBe(false);
  });
});

describe("trusted request identity", () => {
  test("does not trust proxy headers in none mode", () => {
    const headers = new Headers({
      "fly-client-ip": "198.51.100.10",
      "x-forwarded-for": "203.0.113.20",
    });
    expect(
      resolveClientIp({
        headers,
        directIp: "192.0.2.1",
        trustedProxy: "none",
      }),
    ).toBe("192.0.2.1");
  });

  test("fly mode trusts only a validated Fly-Client-IP and never XFF", () => {
    expect(
      resolveClientIp({
        headers: new Headers({
          "fly-client-ip": "2001:0DB8:0:0:0:0:0:1",
          "x-forwarded-for": "203.0.113.20",
        }),
        directIp: "192.0.2.1",
        trustedProxy: "fly",
      }),
    ).toBe("2001:db8::1");
    expect(
      resolveClientIp({
        headers: new Headers({ "x-forwarded-for": "203.0.113.20" }),
        directIp: "192.0.2.1",
        trustedProxy: "fly",
      }),
    ).toBeNull();
  });

  test("rejects malformed addresses and normalizes valid addresses", () => {
    expect(normalizeIp("not-an-ip")).toBeNull();
    expect(normalizeIp(" 198.51.100.7 ")).toBe("198.51.100.7");
    expect(normalizeIp("2001:0db8:0:0:0:0:0:1")).toBe("2001:db8::1");
  });
});
