import { describe, expect, it } from 'vitest';
import { PendingSessions } from '../src/ui/pendingSessions';

function store<T>(opts: { ttlMs?: number; now?: () => number } = {}) {
  let n = 0;
  return new PendingSessions<T>({ ...opts, generateId: () => `id-${(n += 1)}` });
}

describe('PendingSessions', () => {
  it('round-trips a value by id and peeks non-destructively', () => {
    const s = store<string>();
    const id = s.create('client-A');
    expect(s.get(id)).toBe('client-A');
    expect(s.get(id)).toBe('client-A'); // get is a peek — still there for a retry
  });

  it('isolates concurrent flows by id', () => {
    const s = store<string>();
    const a = s.create('client-A');
    const b = s.create('client-B');
    expect(a).not.toBe(b);
    expect(s.get(a)).toBe('client-A');
    expect(s.get(b)).toBe('client-B');
  });

  it('returns undefined after remove', () => {
    const s = store<string>();
    const id = s.create('client-A');
    s.remove(id);
    expect(s.get(id)).toBeUndefined();
  });

  it('returns undefined for an unknown id', () => {
    expect(store<string>().get('nope')).toBeUndefined();
  });

  it('expires an entry after the TTL', () => {
    let t = 0;
    const s = store<string>({ ttlMs: 1000, now: () => t });
    const id = s.create('client-A');
    t = 999;
    expect(s.get(id)).toBe('client-A'); // still within TTL
    t = 1000;
    expect(s.get(id)).toBeUndefined(); // expired
  });

  it('sweeps expired entries from the live count', () => {
    let t = 0;
    const s = store<string>({ ttlMs: 1000, now: () => t });
    s.create('client-A');
    s.create('client-B');
    expect(s.size).toBe(2);
    t = 1000;
    expect(s.size).toBe(0);
  });
});
