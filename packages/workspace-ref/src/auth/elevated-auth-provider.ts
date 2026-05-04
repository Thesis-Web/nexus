// packages/workspace-ref/src/auth/elevated-auth-provider.ts
// AMEND-nexus-spec-workspace-v1-1-1 §5.8, §7.3, blueprint §3.9
// Layer 7 — reference ElevatedAuthProvider implementation.
//
// Reference impl supports 'password_reauth' and 'api_key_reauth' only.
// Enterprise methods are provider-specific strings [GWB4-F05].
//
// Hard rule 6: Elevated re-auth ≠ OCT change.
// Hard rule 30: Elevated session validation is principal-bound.
// Blueprint §3.9: configurable timeout, cannot be silently extended.

import type {
  ElevatedAuthProvider,
  ElevatedAuthChallengeRequest,
  ElevatedAuthChallenge,
  ElevatedAuthVerifyRequest,
  ElevatedSession,
  ElevatedSessionStatus,
  Uuid,
  IsoTimestamp,
} from '@nexus/contracts';
import { nowIso, addSeconds } from '@nexus/contracts';
import { randomUUID } from 'node:crypto';
import { SqliteElevatedSessionStore } from './elevated-session-store.js';

/** Internal challenge record. */
interface ChallengeRecord {
  challengeId: Uuid;
  principalId: string;
  method: string;
  expiresAt: IsoTimestamp;
  consumed: boolean;
}

/** Default elevated session timeout: 15 minutes. */
const DEFAULT_TIMEOUT_SECONDS = 15 * 60;
/** Challenge expiry: 5 minutes. */
const CHALLENGE_EXPIRY_SECONDS = 5 * 60;

export class ReferenceElevatedAuthProvider implements ElevatedAuthProvider {
  private readonly sessionStore: SqliteElevatedSessionStore;
  private readonly challenges: Map<string, ChallengeRecord> = new Map();
  private readonly timeoutSeconds: number;

  constructor(opts?: { dbPath?: string; timeoutSeconds?: number }) {
    this.sessionStore = new SqliteElevatedSessionStore(opts?.dbPath);
    this.timeoutSeconds = opts?.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  }

  async challenge(input: ElevatedAuthChallengeRequest): Promise<ElevatedAuthChallenge> {
    const challengeId = randomUUID() as Uuid;
    const expiresAt = addSeconds(nowIso(), CHALLENGE_EXPIRY_SECONDS);

    let prompt: string;
    switch (input.method) {
      case 'password_reauth':
        prompt = 'Re-enter your password to continue';
        break;
      case 'api_key_reauth':
        prompt = 'Provide your API key to continue';
        break;
      default:
        prompt = `Complete ${input.method} verification`;
        break;
    }

    this.challenges.set(challengeId, {
      challengeId,
      principalId: input.principalId,
      method: input.method,
      expiresAt,
      consumed: false,
    });

    return { challengeId, method: input.method, expiresAt, prompt };
  }

  async verify(input: ElevatedAuthVerifyRequest): Promise<ElevatedSession> {
    const challenge = this.challenges.get(input.challengeId);

    if (!challenge) {
      throw new Error('Challenge not found');
    }
    if (challenge.consumed) {
      throw new Error('Challenge already consumed');
    }
    if (challenge.principalId !== input.principalId) {
      throw new Error('Principal mismatch');
    }
    if (new Date(challenge.expiresAt).getTime() < Date.now()) {
      throw new Error('Challenge expired');
    }
    if (challenge.method !== input.method) {
      throw new Error('Method mismatch');
    }

    // Reference verification: any non-empty response accepted.
    // Production: real password/key verification via identity provider.
    if (!input.response || input.response.length === 0) {
      throw new Error('Empty response');
    }

    // Mark challenge consumed
    challenge.consumed = true;

    // Create elevated session
    const elevatedSessionId = randomUUID() as Uuid;
    const issuedAt = nowIso();
    const expiresAt = addSeconds(issuedAt, this.timeoutSeconds);

    const session: ElevatedSession = {
      elevatedSessionId,
      principalId: input.principalId,
      method: input.method,
      issuedAt,
      expiresAt,
      timeoutSeconds: this.timeoutSeconds,
    };

    this.sessionStore.store({
      elevatedSessionId,
      principalId: input.principalId,
      method: input.method,
      issuedAt,
      expiresAt,
      timeoutSeconds: this.timeoutSeconds,
    });

    return session;
  }

  /** §2.4 AMENDED: validateSession requires principalId (principal-bound). */
  async validateSession(
    elevatedSessionId: Uuid,
    principalId: string
  ): Promise<ElevatedSessionStatus> {
    const row = this.sessionStore.get(elevatedSessionId);

    if (!row) {
      return { valid: false, remainingSeconds: 0, reason: 'Session not found' };
    }

    if (row.closed) {
      return { valid: false, remainingSeconds: 0, reason: row.close_reason ?? 'Session closed' };
    }

    // Hard rule 30: principal-bound validation
    if (row.principal_id !== principalId) {
      return { valid: false, remainingSeconds: 0, reason: 'Principal mismatch' };
    }

    const expiresMs = new Date(row.expires_at).getTime();
    const nowMs = Date.now();
    if (expiresMs <= nowMs) {
      // Write close on expiry detection
      this.sessionStore.close(elevatedSessionId, 'expired');
      return { valid: false, remainingSeconds: 0, reason: 'Session expired' };
    }

    const remainingSeconds = Math.ceil((expiresMs - nowMs) / 1000);
    return { valid: true, remainingSeconds };
  }
}
