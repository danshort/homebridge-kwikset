/**
 * Cross-process session-health channel. The Homebridge platform process writes
 * this small status file whenever its Kwikset session health changes; the
 * config-UI server (a separate process) reads it to decide whether to show a
 * "session expired" warning. Written atomically (temp file + rename) so a
 * concurrent reader never observes a half-written file. Contains no secrets —
 * only a boolean health flag and a diagnostic timestamp.
 */

import { readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';

export const STATUS_FILENAME = 'kwikset-session-status.json';

export interface SessionStatus {
  /** True when the stored session was rejected and the user must sign in again. */
  needsReauth: boolean;
  /** Epoch ms of the last write; diagnostics only. */
  updatedAt: number;
}

export function statusFilePath(storageDir: string): string {
  return join(storageDir, STATUS_FILENAME);
}

/**
 * Atomically write the status file: serialize to a temp file then rename over
 * the target (atomic on the same filesystem). Throws only on filesystem error;
 * callers wrap this so a write failure never disrupts platform operation.
 */
export function writeSessionStatus(storageDir: string, status: SessionStatus): void {
  const target = statusFilePath(storageDir);
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(status), 'utf8');
  renameSync(tmp, target);
}

/**
 * Read the status file. Returns `undefined` when the file is missing,
 * unreadable, or malformed — callers treat that as "health unknown".
 */
export function readSessionStatus(storageDir: string): SessionStatus | undefined {
  try {
    const raw: unknown = JSON.parse(readFileSync(statusFilePath(storageDir), 'utf8'));
    if (raw && typeof raw === 'object' && typeof (raw as SessionStatus).needsReauth === 'boolean') {
      const parsed = raw as SessionStatus;
      return {
        needsReauth: parsed.needsReauth,
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      };
    }
  } catch {
    // missing / unreadable / malformed → unknown
  }
  return undefined;
}
