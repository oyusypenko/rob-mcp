const DEFAULT_REPLAY_TTL_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_FINGERPRINTS = 10_000;

type FingerprintState = "reserved" | "settled" | "canceled";

interface FingerprintRecord {
  state: FingerprintState;
  expiresAtMs: number;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite payment payload number");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw new Error("unsupported payment payload value");
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

export async function paymentFingerprint(payload: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(payload)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class PaymentReplayGuard {
  readonly #records = new Map<string, FingerprintRecord>();
  readonly #ttlMs: number;
  readonly #maxFingerprints: number;
  readonly #now: () => number;

  constructor(
    options: {
      ttlMs?: number;
      maxFingerprints?: number;
      now?: () => number;
    } = {},
  ) {
    this.#ttlMs = options.ttlMs ?? DEFAULT_REPLAY_TTL_MS;
    this.#maxFingerprints = options.maxFingerprints ?? DEFAULT_MAX_FINGERPRINTS;
    this.#now = options.now ?? Date.now;
    if (!Number.isSafeInteger(this.#ttlMs) || this.#ttlMs <= 0) {
      throw new Error("replay ttlMs must be a positive safe integer");
    }
    if (!Number.isSafeInteger(this.#maxFingerprints) || this.#maxFingerprints <= 0) {
      throw new Error("maxFingerprints must be a positive safe integer");
    }
  }

  get size(): number {
    return this.#records.size;
  }

  reserve(fingerprint: string): boolean {
    const now = this.#now();
    this.#evict(now);
    if (this.#records.has(fingerprint)) return false;
    if (this.#records.size >= this.#maxFingerprints) return false;
    this.#records.set(fingerprint, {
      state: "reserved",
      expiresAtMs: now + this.#ttlMs,
    });
    return true;
  }

  release(fingerprint: string): void {
    if (this.#records.get(fingerprint)?.state === "reserved") {
      this.#records.delete(fingerprint);
    }
  }

  settle(fingerprint: string): void {
    this.#finish(fingerprint, "settled");
  }

  cancel(fingerprint: string): void {
    this.#finish(fingerprint, "canceled");
  }

  #finish(fingerprint: string, state: Exclude<FingerprintState, "reserved">): void {
    const record = this.#records.get(fingerprint);
    if (!record) return;
    this.#records.set(fingerprint, { ...record, state });
  }

  #evict(now: number): void {
    for (const [fingerprint, record] of this.#records) {
      if (record.expiresAtMs > now) continue;
      this.#records.delete(fingerprint);
    }
  }
}
