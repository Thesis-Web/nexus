/**
 * Threat test 2 — Injection Guard
 * Spec §17.2, §27.2 item 2
 * Non-ASCII chars stripped. Overlong strings truncated with [TRUNCATED] suffix.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeIntentField } from '../security/injection-guard.js';

describe('Threat: Injection Guard (spec §17.2)', () => {
  it('returns empty string for null input', () => {
    expect(sanitizeIntentField(null, 500)).toBe('');
  });

  it('returns empty string for undefined input', () => {
    expect(sanitizeIntentField(undefined, 500)).toBe('');
  });

  it('returns empty string for empty string input', () => {
    expect(sanitizeIntentField('', 500)).toBe('');
  });

  it('strips non-ASCII characters (é, ñ, emoji, null byte)', () => {
    // é = 0xE9, ñ = 0xF1 — both outside 0x20-0x7E
    const result = sanitizeIntentField('héllo wörld 🔥\x00', 500);
    expect(result).toBe('hllo wrld ');
  });

  it('preserves printable ASCII, newline, and tab', () => {
    const input = 'valid intent\nwith tab\there';
    const result = sanitizeIntentField(input, 500);
    expect(result).toBe(input);
  });

  it('truncates strings exceeding maxLen and appends [TRUNCATED]', () => {
    const longString = 'a'.repeat(600);
    const result = sanitizeIntentField(longString, 500);
    expect(result).toBe('a'.repeat(500) + ' [TRUNCATED]');
    expect(result.length).toBe(513); // 500 + len(" [TRUNCATED]")
  });

  it('does not truncate strings exactly at maxLen', () => {
    const exact = 'b'.repeat(500);
    const result = sanitizeIntentField(exact, 500);
    expect(result).toBe(exact);
    expect(result.includes('[TRUNCATED]')).toBe(false);
  });

  it('strips non-ASCII then truncates if still overlong', () => {
    // Build a string of 600 non-ASCII + 600 ASCII chars — after stripping non-ASCII,
    // 600 ASCII chars remain → truncated to 500 + [TRUNCATED]
    const mixed = 'é'.repeat(600) + 'c'.repeat(600);
    const result = sanitizeIntentField(mixed, 500);
    expect(result).toBe('c'.repeat(500) + ' [TRUNCATED]');
  });

  it('rejects SQL injection patterns as non-printable-free ASCII (harmless passthrough)', () => {
    // SQL injection uses ASCII chars — sanitizer doesn't block them (schema validation does).
    // The sanitizer only strips non-ASCII and truncates. This test documents the behaviour.
    const sql = "'; DROP TABLE actors; --";
    const result = sanitizeIntentField(sql, 500);
    expect(result).toBe(sql); // unchanged — all ASCII
  });
});
