/**
 * Target Normalizer — unit tests
 * ENV-001: Adapter environment law — actor.environment is ALWAYS authoritative.
 * Spec §13.3, §19.5. Blueprint §24.5.
 */

import { describe, it, expect } from 'vitest';
import { TargetNormalizer } from '../classification/target-normalizer.js';

const tn = new TargetNormalizer();

describe('TargetNormalizer — environment law (ENV-001)', () => {
  // ── JSON-parsed path ──────────────────────────────────────────────────────

  it('JSON path: uses actorEnvironment when rawTarget has ACTOR_ENVIRONMENT sentinel', () => {
    const result = tn.normalize(
      JSON.stringify({ system: 'stub', environment: 'ACTOR_ENVIRONMENT' }),
      'get_record',
      'production'
    );
    expect(result).not.toBeNull();
    expect(result!.environment).toBe('production');
  });

  it('JSON path: uses actorEnvironment when rawTarget has no environment field', () => {
    const result = tn.normalize(JSON.stringify({ system: 'stub' }), 'get_record', 'staging');
    expect(result).not.toBeNull();
    expect(result!.environment).toBe('staging');
  });

  it('JSON path: DISCARDS adapter-supplied environment — uses actorEnvironment (ENV-001 fix)', () => {
    // This is the exact bug ENV-001 flagged: adapter sends 'dev' but actor is 'production'
    const result = tn.normalize(
      JSON.stringify({ system: 'stub', environment: 'dev' }),
      'get_record',
      'production'
    );
    expect(result).not.toBeNull();
    expect(result!.environment).toBe('production');
  });

  it('JSON path: DISCARDS empty string environment — uses actorEnvironment', () => {
    const result = tn.normalize(
      JSON.stringify({ system: 'stub', environment: '' }),
      'get_record',
      'production'
    );
    expect(result).not.toBeNull();
    expect(result!.environment).toBe('production');
  });

  // ── String-parsed path ────────────────────────────────────────────────────

  it('string path: uses actorEnvironment (colon-separated)', () => {
    const result = tn.normalize('crm:record:single', 'get_record', 'staging');
    expect(result).not.toBeNull();
    expect(result!.environment).toBe('staging');
    expect(result!.system).toBe('crm');
  });

  // ── Fallback path ─────────────────────────────────────────────────────────

  it('fallback path: uses actorEnvironment (bare string)', () => {
    const result = tn.normalize('crm', 'get_record', 'dev');
    expect(result).not.toBeNull();
    expect(result!.environment).toBe('dev');
  });

  // ── Null path ─────────────────────────────────────────────────────────────

  it('returns null for empty rawTarget', () => {
    expect(tn.normalize('', 'get_record', 'production')).toBeNull();
    expect(tn.normalize('  ', 'get_record', 'production')).toBeNull();
  });

  // ── Other field extraction ────────────────────────────────────────────────

  it('JSON path: extracts system, resourceType, scope, externalFacing', () => {
    const result = tn.normalize(
      JSON.stringify({
        system: 'vault',
        resourceType: 'secret',
        resourceScope: 'bulk',
        externalFacing: true,
      }),
      'get_secrets',
      'production'
    );
    expect(result).not.toBeNull();
    expect(result!.system).toBe('vault');
    expect(result!.resourceType).toBe('secret');
    expect(result!.resourceScope).toBe('bulk');
    expect(result!.externalFacing).toBe(true);
    expect(result!.environment).toBe('production');
  });

  it('JSON path: normalizes unknown scope to single', () => {
    const result = tn.normalize(
      JSON.stringify({ system: 'stub', resourceScope: 'global' }),
      'get_record',
      'dev'
    );
    expect(result).not.toBeNull();
    expect(result!.resourceScope).toBe('single');
  });
});
