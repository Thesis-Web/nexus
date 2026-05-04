// packages/workspace-ref/src/stores/workspace-blob-store.ts
// AMEND-nexus-spec-workspace-v1-1-1 §6.5, §3 blob store law
// Layer 7 — filesystem-backed blob store (reference implementation).
//
// Blob store law:
//   - Streaming only, sha256 while streaming (hard rule 21)
//   - Max-size mid-stream enforcement
//   - Quarantined blobs return null from read()
//   - Contents never logged
// Production: swap for S3/GCS via WorkspaceBlobStorePort.

import type { WorkspaceBlobStorePort, Uuid } from '@nexus/contracts';
import {
  createWriteStream,
  createReadStream,
  renameSync,
  unlinkSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import path from 'node:path';

export class FilesystemWorkspaceBlobStore implements WorkspaceBlobStorePort {
  private readonly baseDir: string;
  private readonly quarantineDir: string;

  constructor(baseDir: string = 'workspace-blobs') {
    this.baseDir = path.resolve(baseDir);
    this.quarantineDir = path.join(this.baseDir, '.quarantine');
    mkdirSync(this.baseDir, { recursive: true });
    mkdirSync(this.quarantineDir, { recursive: true });
  }

  async write(input: {
    fileId: Uuid;
    stream: NodeJS.ReadableStream;
    declaredMediaType: string;
    maxSizeBytes: number;
  }): Promise<{ storedAt: string; sha256: string; sizeBytes: number }> {
    const storedAt = path.join(this.baseDir, input.fileId);
    const hash = createHash('sha256');
    let sizeBytes = 0;

    // Transform: track size + compute sha256 while streaming (hard rule 21)
    const tracker = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        sizeBytes += chunk.length;
        if (sizeBytes > input.maxSizeBytes) {
          callback(new Error('File exceeds maximum allowed size'));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });

    const output = createWriteStream(storedAt);

    try {
      await pipeline(input.stream as NodeJS.ReadableStream, tracker, output);
    } catch (err) {
      // Clean up partial write on failure
      if (existsSync(storedAt)) unlinkSync(storedAt);
      throw err;
    }

    return {
      storedAt,
      sha256: hash.digest('hex'),
      sizeBytes,
    };
  }

  async read(storedAt: string): Promise<NodeJS.ReadableStream | null> {
    // Quarantined blobs return null from read()
    if (!existsSync(storedAt)) return null;
    if (storedAt.includes('.quarantine')) return null;
    return createReadStream(storedAt);
  }

  async quarantine(storedAt: string): Promise<void> {
    if (!existsSync(storedAt)) return;
    const quarantinedPath = path.join(this.quarantineDir, path.basename(storedAt));
    renameSync(storedAt, quarantinedPath);
  }

  async delete(storedAt: string): Promise<void> {
    if (existsSync(storedAt)) unlinkSync(storedAt);
  }
}
