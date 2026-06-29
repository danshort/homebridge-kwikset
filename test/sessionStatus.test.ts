import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readSessionStatus, statusFilePath, writeSessionStatus } from '../src/sessionStatus';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kwikset-status-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('sessionStatus', () => {
  it('round-trips a written status', () => {
    writeSessionStatus(dir, { needsReauth: true, updatedAt: 123 });
    expect(readSessionStatus(dir)).toEqual({ needsReauth: true, updatedAt: 123 });
  });

  it('overwrites the previous status atomically (latest write wins)', () => {
    writeSessionStatus(dir, { needsReauth: true, updatedAt: 1 });
    writeSessionStatus(dir, { needsReauth: false, updatedAt: 2 });
    expect(readSessionStatus(dir)).toEqual({ needsReauth: false, updatedAt: 2 });
  });

  it('returns undefined when the file is missing', () => {
    expect(readSessionStatus(dir)).toBeUndefined();
  });

  it('returns undefined on malformed JSON (treated as unknown)', () => {
    writeFileSync(statusFilePath(dir), '{ not valid json', 'utf8');
    expect(readSessionStatus(dir)).toBeUndefined();
  });

  it('returns undefined when needsReauth is missing/not a boolean', () => {
    writeFileSync(statusFilePath(dir), JSON.stringify({ updatedAt: 5 }), 'utf8');
    expect(readSessionStatus(dir)).toBeUndefined();
    writeFileSync(statusFilePath(dir), JSON.stringify({ needsReauth: 'yes' }), 'utf8');
    expect(readSessionStatus(dir)).toBeUndefined();
  });

  it('defaults a non-numeric updatedAt to 0', () => {
    writeFileSync(statusFilePath(dir), JSON.stringify({ needsReauth: true }), 'utf8');
    expect(readSessionStatus(dir)).toEqual({ needsReauth: true, updatedAt: 0 });
  });
});
