/**
 * Threat test 2 — Injection Guard
 * Spec §17.2, §27.2 item 2
 * Built API: guardString(raw, maxLen): GuardResult
 *   { value: string; truncated: boolean; injectionDetected: boolean }
 * Truncation: slice(0, maxLen-1) + '…' — result.length === maxLen
 * Note: built function differs from spec's sanitizeIntentField name (HOLE-403).
 */
import { describe, it, expect } from 'vitest';
import { guardString } from '../security/injection-guard.js';

describe('Threat: Injection Guard (spec §17.2)', () => {
  it('passes through short string unchanged, truncated=false', () => {
    const result = guardString('hello world', 500);
    expect(result.value).toBe('hello world');
    expect(result.truncated).toBe(false);
  });

  it('truncates strings exceeding maxLen — result.length equals maxLen', () => {
    const longString = 'a'.repeat(600);
    const result = guardString(longString, 500);
    expect(result.truncated).toBe(true);
    expect(result.value.length).toBe(500);
    expect(result.value.endsWith('…')).toBe(true);
    expect(result.value.startsWith('a'.repeat(499))).toBe(true);
  });

  it('does not truncate string exactly at maxLen', () => {
    const exact = 'b'.repeat(500);
    const result = guardString(exact, 500);
    expect(result.truncated).toBe(false);
    expect(result.value).toBe(exact);
  });

  it('truncated result is exactly maxLen characters', () => {
    const result = guardString('x'.repeat(1000), 200);
    expect(result.truncated).toBe(true);
    expect(result.value.length).toBe(200);
  });

  it('empty string passes through with truncated=false', () => {
    const result = guardString('', 500);
    expect(result.value).toBe('');
    expect(result.truncated).toBe(false);
  });

  it('returns injectionDetected boolean in result', () => {
    const result = guardString('normal input', 500);
    expect(typeof result.injectionDetected).toBe('boolean');
  });

  it('string shorter than maxLen after any processing has truncated=false', () => {
    const result = guardString('short', 100);
    expect(result.truncated).toBe(false);
    expect(result.value.length).toBeLessThanOrEqual(100);
  });

  it('GuardResult has value, truncated, injectionDetected fields', () => {
    const result = guardString('test input', 50);
    expect(result).toHaveProperty('value');
    expect(result).toHaveProperty('truncated');
    expect(result).toHaveProperty('injectionDetected');
  });

  it('very long string produces correct truncated output at boundary', () => {
    const input = 'z'.repeat(501);
    const result = guardString(input, 500);
    expect(result.truncated).toBe(true);
    expect(result.value.length).toBe(500);
  });
});
