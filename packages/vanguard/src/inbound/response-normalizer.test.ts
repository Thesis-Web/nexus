/**
 * NVG-INBOUND-001 Proof Tests — response normalizer carry-through
 *
 * Verifies normalizeInboundResponse() carries:
 *   1. opaqueProviderResponse → opaqueModelOutput
 *   2. providerModelNameReturned → providerModelNameReturned
 *   3. Neither field set when source is undefined (exactOptionalPropertyTypes)
 *
 * spec §24.6, §13.7.1, §22.1
 */
import { describe, it, expect } from 'vitest';
import { normalizeInboundResponse } from './response-normalizer.js';
import type { NvgInvocationResult, NonEmpty } from '@nexus/contracts';

function makeInvocation(overrides: Partial<NvgInvocationResult> = {}): NvgInvocationResult {
  return {
    success: true,
    fallbackApplied: false,
    fallbackFromTier: null,
    endpointUsed: null,
    responseSize: 128,
    latencyMs: 50,
    ...overrides,
  };
}

describe('NVG-INBOUND-001: normalizer carry-through (§24.6, §13.7.1, §22.1)', () => {
  it('carries opaqueProviderResponse as opaqueModelOutput', () => {
    const opaquePayload = { choices: [{ message: { content: 'hello' } }] };
    const inv = makeInvocation({ opaqueProviderResponse: opaquePayload });
    const result = normalizeInboundResponse(inv);

    expect(result.opaqueModelOutput).toEqual(opaquePayload);
  });

  it('carries providerModelNameReturned', () => {
    const inv = makeInvocation({
      providerModelNameReturned: 'gpt-4o-2024-08-06' as NonEmpty,
    });
    const result = normalizeInboundResponse(inv);

    expect(result.providerModelNameReturned).toBe('gpt-4o-2024-08-06');
  });

  it('omits optional fields when source is undefined (exactOptionalPropertyTypes)', () => {
    const inv = makeInvocation();
    const result = normalizeInboundResponse(inv);

    // Fields should not be present at all — not even as undefined
    expect('opaqueModelOutput' in result).toBe(false);
    expect('providerModelNameReturned' in result).toBe(false);
  });
});
