/**
 * JSONL ledger backend (Backend v1) — spec §16.1
 * Append-only. No DELETE or UPDATE. MODULAR-003.
 */
import { promises as fs } from 'fs';
export class JsonlLedgerBackend {
    ledgerPath;
    backendId = 'jsonl-v1';
    backendVersion = 'v0.1.0';
    constructor(ledgerPath) {
        this.ledgerPath = ledgerPath;
    }
    async append(record) {
        await fs.appendFile(this.ledgerPath, JSON.stringify(record) + '\n', 'utf-8');
    }
    async listRange(from, to) {
        const results = [];
        let raw;
        try {
            raw = await fs.readFile(this.ledgerPath, 'utf-8');
        }
        catch {
            return [];
        }
        for (const line of raw.split('\n').filter(Boolean)) {
            try {
                const record = JSON.parse(line);
                if (record.ledgerSequence >= from && record.ledgerSequence <= to)
                    results.push(record);
            }
            catch {
                continue;
            }
        }
        return results;
    }
    async getBySequence(seq) {
        return (await this.listRange(seq, seq))[0] ?? null;
    }
    async getByRecordId(recordId) {
        let raw;
        try {
            raw = await fs.readFile(this.ledgerPath, 'utf-8');
        }
        catch {
            return null;
        }
        for (const line of raw.split('\n').filter(Boolean)) {
            try {
                const record = JSON.parse(line);
                if (record.recordId === recordId)
                    return record;
            }
            catch {
                continue;
            }
        }
        return null;
    }
    async getLatestSequence() {
        let raw;
        try {
            raw = await fs.readFile(this.ledgerPath, 'utf-8');
        }
        catch {
            return 0;
        }
        const lines = raw.split('\n').filter(Boolean);
        if (!lines.length)
            return 0;
        try {
            return JSON.parse(lines[lines.length - 1]).ledgerSequence;
        }
        catch {
            return 0;
        }
    }
}
