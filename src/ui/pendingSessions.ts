/**
 * A small store for in-progress (awaiting-verification-code) login flows in the
 * config-UI server. Each flow is keyed by an opaque session id and expires after
 * a TTL, so concurrent flows (two tabs / two admins) never collide and stale
 * challenges don't linger. Kept here (compiled) rather than in the untestable
 * IPC server so the logic can be unit-tested.
 */

import { randomUUID } from 'crypto';

/** Default time-to-live for a pending challenge (~ the verification code's life). */
export const DEFAULT_TTL_MS = 10 * 60_000;

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export interface PendingSessionsOptions {
  ttlMs?: number;
  now?: () => number;
  /** Override the id generator (tests). */
  generateId?: () => string;
}

export class PendingSessions<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly generateId: () => string;

  constructor(opts: PendingSessionsOptions = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.now = opts.now ?? (() => Date.now());
    this.generateId = opts.generateId ?? (() => randomUUID());
  }

  /** Store a value, returning the opaque session id needed to retrieve it. */
  create(value: T): string {
    this.sweep();
    const id = this.generateId();
    this.entries.set(id, { value, expiresAt: this.now() + this.ttlMs });
    return id;
  }

  /**
   * Peek the value for a session id without removing it (so a mistyped code can
   * be retried). Returns `undefined`, and drops the entry, if it has expired or
   * the id is unknown. Call `remove` once the flow completes successfully.
   */
  get(id: string): T | undefined {
    const entry = this.entries.get(id);
    if (!entry) {
      return undefined;
    }
    if (this.now() >= entry.expiresAt) {
      this.entries.delete(id);
      return undefined;
    }
    return entry.value;
  }

  /** Drop a session id (after a completed flow). */
  remove(id: string): void {
    this.entries.delete(id);
  }

  /** Number of live (not-yet-expired) entries. */
  get size(): number {
    this.sweep();
    return this.entries.size;
  }

  /** Drop expired entries. */
  private sweep(): void {
    const t = this.now();
    for (const [id, entry] of this.entries) {
      if (t >= entry.expiresAt) {
        this.entries.delete(id);
      }
    }
  }
}
