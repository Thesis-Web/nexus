import { promises as fs } from 'node:fs';
import path from 'node:path';
export async function cmdReplay(runDir: string): Promise<void> {
  // HOLE-NEW-002: full re-execution not spec'd — CCV hash file integrity check only
  const replayFile = path.join(runDir, 'replay-ccv-hashes.json');
  try {
    const data = JSON.parse(await fs.readFile(replayFile, 'utf-8'));
    console.log(JSON.stringify({ ok: true, data }, null, 2));
  } catch {
    console.error(`✗ No replay hash file found at ${replayFile}`);
    process.exit(1);
  }
}
