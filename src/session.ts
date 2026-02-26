/**
 * Session state persistence — stores SafariDriver session info
 * in ~/.safari-cli/session.json so CLI commands work across invocations.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface SessionState {
  port: number;
  sessionId: string;
  pid: number;
  startedAt: string;
}

const STATE_DIR = join(homedir(), '.safari-cli');
const STATE_FILE = join(STATE_DIR, 'session.json');

export function loadSession(): SessionState | null {
  try {
    if (!existsSync(STATE_FILE)) return null;
    const raw = readFileSync(STATE_FILE, 'utf-8');
    return JSON.parse(raw) as SessionState;
  } catch {
    return null;
  }
}

export function saveSession(state: SessionState): void {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true });
  }
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

export function clearSession(): void {
  try {
    if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
  } catch { /* ignore */ }
}

/**
 * Require an active session or exit with error.
 */
export function requireSession(): SessionState {
  const session = loadSession();
  if (!session) {
    console.error('No active Safari session. Run `safari-cli start` first.');
    process.exit(1);
  }
  return session;
}
