import { describe, expect, test } from "bun:test";

import { readBoundedBody, readBoundedJson, RequestBodyError } from "../../src/http/body.js";
import { paymentFingerprint, PaymentReplayGuard } from "../../src/http/payment-replay.js";

describe("request body boundary", () => {
  test("requires JSON and rejects a declared oversized body", async () => {
    await expect(
      readBoundedJson(
        new Request("http://localhost/tool", {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: "{}",
        }),
      ),
    ).rejects.toMatchObject({ status: 415 });

    await expect(
      readBoundedJson(
        new Request("http://localhost/tool", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": "100",
          },
          body: "{}",
        }),
        10,
      ),
    ).rejects.toMatchObject({ status: 413 });
  });

  test("stops a chunked body as soon as the byte cap is crossed", async () => {
    const request = {
      headers: new Headers({ "content-type": "application/json" }),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(6));
          controller.enqueue(new Uint8Array(6));
          controller.close();
        },
      }),
    };
    try {
      await readBoundedBody(request, 10);
      throw new Error("expected body rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(RequestBodyError);
      expect((error as RequestBodyError).status).toBe(413);
    }
  });
});

describe("shared payment replay guard", () => {
  test("canonicalizes payloads and atomically rejects in-flight or settled reuse", async () => {
    const left = await paymentFingerprint({ b: 2, a: { d: 4, c: 3 } });
    const right = await paymentFingerprint({ a: { c: 3, d: 4 }, b: 2 });
    expect(left).toBe(right);

    let now = 1_000;
    const guard = new PaymentReplayGuard({
      ttlMs: 100,
      maxFingerprints: 2,
      now: () => now,
    });
    expect(guard.reserve(left)).toBe(true);
    expect(guard.reserve(left)).toBe(false);
    guard.settle(left);
    expect(guard.reserve(left)).toBe(false);
    now += 101;
    expect(guard.reserve(left)).toBe(true);
  });

  test("purges expired entries but fails closed when live capacity is full", () => {
    let now = 1_000;
    const guard = new PaymentReplayGuard({
      ttlMs: 100,
      maxFingerprints: 1,
      now: () => now,
    });
    expect(guard.reserve("one")).toBe(true);
    expect(guard.reserve("two")).toBe(false);
    expect(guard.size).toBe(1);
    now += 101;
    expect(guard.reserve("two")).toBe(true);
  });
});
