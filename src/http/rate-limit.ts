import { isIP } from "node:net";

const DAY_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_IDENTITIES = 10_000;

interface CallWindow {
  calls: number[];
  touchedAtMs: number;
}

export interface FreeCallStore {
  consume(key: string, limit: number, nowMs: number, windowMs: number): boolean;
  readonly size: number;
}

export class InMemoryFreeCallStore implements FreeCallStore {
  readonly #calls = new Map<string, CallWindow>();
  readonly #maxIdentities: number;

  constructor(options: { maxIdentities?: number } = {}) {
    this.#maxIdentities = options.maxIdentities ?? DEFAULT_MAX_IDENTITIES;
    if (!Number.isSafeInteger(this.#maxIdentities) || this.#maxIdentities <= 0) {
      throw new Error("maxIdentities must be a positive safe integer");
    }
  }

  get size(): number {
    return this.#calls.size;
  }

  consume(key: string, limit: number, nowMs: number, windowMs: number): boolean {
    if (limit <= 0) return false;

    this.#evictExpired(nowMs, windowMs);
    const existing = this.#calls.get(key);
    const calls = existing?.calls ?? [];
    const cutoff = nowMs - windowMs;
    let firstLive = 0;
    while (firstLive < calls.length && calls[firstLive]! <= cutoff) firstLive += 1;

    const liveCalls = firstLive === 0 ? calls : calls.slice(firstLive);
    if (liveCalls.length >= limit) {
      this.#touch(key, { calls: liveCalls, touchedAtMs: nowMs });
      return false;
    }

    if (!existing && this.#calls.size >= this.#maxIdentities) return false;

    liveCalls.push(nowMs);
    this.#touch(key, { calls: liveCalls, touchedAtMs: nowMs });
    return true;
  }

  #touch(key: string, value: CallWindow): void {
    this.#calls.delete(key);
    this.#calls.set(key, value);
  }

  #evictExpired(nowMs: number, windowMs: number): void {
    const cutoff = nowMs - windowMs;
    for (const [key, window] of this.#calls) {
      if (window.touchedAtMs > cutoff) break;
      this.#calls.delete(key);
    }
  }
}

export interface FreeCallLimiter {
  tryFreeCall(ip: string | null): boolean;
}

export function createFreeCallLimiter(options: {
  callsPerDay: number;
  store?: FreeCallStore;
  now?: () => number;
}): FreeCallLimiter {
  const store = options.store ?? new InMemoryFreeCallStore();
  const now = options.now ?? Date.now;

  return {
    tryFreeCall(ip: string | null): boolean {
      if (ip === null) return false;
      return store.consume(ip, options.callsPerDay, now(), DAY_MS);
    },
  };
}

export type TrustedProxyMode = "none" | "fly";

export function normalizeIp(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;

  const version = isIP(candidate);
  if (version === 4) return candidate.split(".").map(Number).join(".");
  if (version !== 6) return null;

  try {
    return new URL(`http://[${candidate.toLowerCase()}]/`).hostname.slice(1, -1);
  } catch {
    return null;
  }
}

export function resolveClientIp(options: {
  headers: Headers;
  directIp: string | null;
  trustedProxy: TrustedProxyMode;
}): string | null {
  if (options.trustedProxy === "fly") {
    return normalizeIp(options.headers.get("fly-client-ip"));
  }
  return normalizeIp(options.directIp);
}
