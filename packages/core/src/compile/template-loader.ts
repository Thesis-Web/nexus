/**
 * Template Signing, Loading, Verification — AMEND-spec-nexus-compile §5
 *
 * File: packages/core/src/compile/template-loader.ts
 * Layer 1 — verifies template digest and Ed25519 signature, loads from store.
 *
 * Key separation per [blueprint §11.1]: template-signing key is distinct
 * from artifact signer, approver, and manifest/policy signer.
 *
 * Digest: sha256(canonicalize({ templateId, templateVersion, format,
 *   sections, guards, denialHandling, createdAt, createdBy })) [blueprint §11.2]
 */
import type { CompileTemplate, NonEmpty, Sha256Hex, Base64Url } from '@nexus/contracts';
import { DENIAL_CODE } from '@nexus/contracts';
import { canonicalize } from '@nexus/runtime-utils';
import { sha256Hex } from '../output/output-digest.js';
import { verify } from '../crypto/verifier.js';
import { CompileTemplateError } from './compile-errors.js';
import type { TemplateRegistryStore } from './template-registry-store.js';

// ─── TemplateVerifier Interface [spec §5.1] ───

export interface TemplateVerifier {
  verifyOrThrow(template: CompileTemplate): Promise<void>;
  verifyDigest(template: CompileTemplate): boolean;
  verifySignature(template: CompileTemplate): Promise<boolean>;
}

// ─── TemplateLoader Interface [spec §5.2] ───

export interface TemplateLoader {
  loadAndVerify(templateId: NonEmpty, templateVersion?: NonEmpty): Promise<CompileTemplate>;
}

// ─── Digest Computation ───
// Covers all fields EXCEPT templateDigest and signature [blueprint §11.2]

function computeTemplateDigest(template: CompileTemplate): Sha256Hex {
  const digestInput = {
    templateId: template.templateId,
    templateVersion: template.templateVersion,
    format: template.format,
    sections: template.sections,
    guards: template.guards,
    denialHandling: template.denialHandling,
    createdAt: template.createdAt,
    createdBy: template.createdBy,
  };
  const canonical = canonicalize(digestInput);
  return sha256Hex(canonical) as Sha256Hex;
}

export { computeTemplateDigest };

// ─── TemplateVerifier Implementation ───

export class TemplateVerifierImpl implements TemplateVerifier {
  private readonly templateSigningPublicKey: Base64Url;

  constructor(templateSigningPublicKey: Base64Url) {
    this.templateSigningPublicKey = templateSigningPublicKey;
  }

  verifyDigest(template: CompileTemplate): boolean {
    const recomputed = computeTemplateDigest(template);
    return recomputed === template.templateDigest;
  }

  async verifySignature(template: CompileTemplate): Promise<boolean> {
    return verify(
      template.templateDigest,
      template.signature as Base64Url,
      this.templateSigningPublicKey
    );
  }

  async verifyOrThrow(template: CompileTemplate): Promise<void> {
    if (!this.verifyDigest(template)) {
      throw new CompileTemplateError(
        DENIAL_CODE.TEMPLATE_DIGEST_MISMATCH,
        `Template digest mismatch for '${template.templateId}@${template.templateVersion}'`
      );
    }

    const sigValid = await this.verifySignature(template);
    if (!sigValid) {
      throw new CompileTemplateError(
        DENIAL_CODE.TEMPLATE_SIGNATURE_INVALID,
        `Template signature invalid for '${template.templateId}@${template.templateVersion}'`
      );
    }
  }
}

// ─── TemplateLoader Implementation ───

export class TemplateLoaderImpl implements TemplateLoader {
  private readonly store: TemplateRegistryStore;
  private readonly verifier: TemplateVerifier;

  constructor(store: TemplateRegistryStore, verifier: TemplateVerifier) {
    this.store = store;
    this.verifier = verifier;
  }

  async loadAndVerify(templateId: NonEmpty, templateVersion?: NonEmpty): Promise<CompileTemplate> {
    // Load from store
    const template =
      templateVersion !== undefined
        ? this.store.getByVersion(templateId, templateVersion)
        : this.store.getLatest(templateId);

    if (template === null) {
      const versionSuffix = templateVersion !== undefined ? `@${templateVersion}` : ' (latest)';
      throw new CompileTemplateError(
        DENIAL_CODE.TEMPLATE_NOT_FOUND,
        `Template not found: '${templateId}${versionSuffix}'`
      );
    }

    // Verify digest + signature
    await this.verifier.verifyOrThrow(template);

    return template;
  }
}
