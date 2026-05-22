/**
 * MailpitConnector — Nexus default-shipped local-mail target-system connector.
 *
 * Layer 4 — imports from @nexus/contracts only (+ node:net, node:fs, node:path).
 * Implements §12.3.25 Connector. Gate 06 looks up an instance by
 * `action.resolvedTarget.system` (== `systemType`) and calls execute().
 *
 * One process-wide instance per configured Mailpit target. Each holds:
 *  - SMTP host/port for the local Mailpit substrate (default 127.0.0.1:1025)
 *  - HTTP API base URL for read/search/retrieve (default http://127.0.0.1:8025)
 *  - allowedSenders / allowedRecipients / allowedDomains (concrete, no wildcards)
 *  - dataClass for OCT floor by NVG dispatch (typically `local-restricted`)
 *
 * What this connector DOES:
 *  - send  capability (send:message:external, send:message:internal, transmit:data):
 *      builds RFC 5322 message from action.rawPayload, sends via Node net SMTP
 *      client (matches the proven mailpit-integration.sh roundtrip), persists
 *      a send receipt to runs/payloads/<runId>/<actionId>.json including the
 *      Message-ID it assigned + the Mailpit-side ID once visible via API.
 *  - read  capability (read:record:bulk, read:record:single, search:data, query:data):
 *      issues HTTP GET to Mailpit /api/v1/messages or /api/v1/search with
 *      operator-form query, persists the result rows + result envelope.
 *
 * What this connector does NOT do:
 *  - TLS / AUTH PLAIN — local Mailpit is loopback-only, no auth/TLS.
 *    Non-`tlsMode: 'none'` configurations are rejected fail-closed at construct
 *    time. Future TLS/auth would extend the connector cleanly.
 *  - Mailbox handoff — Gate 06 owns the connector surface; the orchestrator
 *    dispatch loop drains the action payload into the per-actor mailbox.
 *  - Direct Mailpit DB writes — every read goes through the public HTTP API;
 *    every send goes through the public SMTP port. No backdoor.
 *  - Wildcard sender/recipient — the manifest's allowedSenders /
 *    allowedRecipients / allowedDomains is the concrete authority floor;
 *    actions that step outside it are rejected.
 *
 * Security boundary:
 *  - The agent never sees the SMTP host/port or the Mailpit API URL.
 *  - The connector never logs the message body. redactedSummary covers
 *    sender/recipient/subject only.
 *  - All inbound payload validation happens before any network I/O.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as net from 'node:net';
import {
  type Connector,
  type ConnectorFactory,
  type AgentAction,
  type DataClass,
  type ExecutionGrant,
  type ExecutionResult,
  type ExecutionGrantTemplate,
  type GrantVault,
  type NonEmpty,
  type ToolSchemaDescriptor,
  type ToolInputSchema,
} from '@nexus/contracts';

// ── Types ────────────────────────────────────────────────────────────────────

/** Configuration parsed from a connector manifest entry. */
export interface MailpitConnectorFactoryConfig {
  readonly systemType: NonEmpty;
  readonly dataClass: DataClass;
  readonly smtpHost: string;
  readonly smtpPort: number;
  readonly apiBaseUrl: string;
  readonly tlsMode: 'none' | 'starttls' | 'tls';
  readonly authMode: 'none' | 'plain';
  readonly allowedSenders: readonly string[];
  readonly allowedRecipients: readonly string[];
  readonly allowedDomains: readonly string[];
  readonly queryLimit: number;
  readonly payloadsRoot: string;
  readonly displayLabel?: string;
  readonly defaultDomain?: string;
  readonly smtpTimeoutMs?: number;
  readonly httpTimeoutMs?: number;
}

export interface MailpitConnectorOptions extends MailpitConnectorFactoryConfig {}

/**
 * Action payload shape for send actions.
 * The orchestrator's planner/lexicon is responsible for assembling this from
 * the user prompt. The connector verifies the shape and rejects anything else.
 */
export interface MailpitSendPayload {
  readonly from: string;
  readonly to: string | readonly string[];
  readonly subject: string;
  readonly body: string;
  readonly cc?: string | readonly string[];
  readonly bcc?: string | readonly string[];
  readonly inReplyTo?: string;
  readonly references?: string;
  readonly customHeaders?: Readonly<Record<string, string>>;
}

/**
 * Action payload shape for read/search actions.
 * `query` follows Mailpit search operator syntax (from:, to:, subject:, ...).
 * Empty string returns the most-recent inbox slice up to `queryLimit`.
 */
export interface MailpitReadPayload {
  readonly query?: string;
  readonly limit?: number;
}

// ── Capability classification ────────────────────────────────────────────────

const SEND_CAPABILITIES = new Set([
  'send:message:external',
  'send:message:internal',
  'transmit:data',
]);

const READ_CAPABILITIES = new Set([
  'read:record:single',
  'read:record:bulk',
  'search:data',
  'query:data',
]);

function isSendCapability(cap: string): boolean {
  return SEND_CAPABILITIES.has(cap);
}

function isReadCapability(cap: string): boolean {
  return READ_CAPABILITIES.has(cap);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeRecipientList(v: string | readonly string[] | undefined): readonly string[] {
  if (v === undefined) return [];
  if (typeof v === 'string') return [v.trim()].filter(s => s.length > 0);
  return v.map(s => s.trim()).filter(s => s.length > 0);
}

function emailDomain(addr: string): string {
  const at = addr.lastIndexOf('@');
  return at >= 0 ? addr.slice(at + 1).toLowerCase() : '';
}

function isAddressAllowed(
  addr: string,
  allowedAddresses: readonly string[],
  allowedDomains: readonly string[]
): boolean {
  const a = addr.trim().toLowerCase();
  if (a.length === 0) return false;
  if (allowedAddresses.some(x => x.trim().toLowerCase() === a)) return true;
  const d = emailDomain(a);
  if (d.length === 0) return false;
  return allowedDomains.some(x => x.trim().toLowerCase() === d);
}

function isWildcardEntry(s: string): boolean {
  return s === '*' || s.includes('*');
}

function failure(
  grant: ExecutionGrant,
  startMs: number,
  errorType: string,
  errorMessage: string,
  redactedSummary: string
): ExecutionResult {
  return {
    grantId: grant.grantId,
    executedAt: new Date().toISOString(),
    status: 'failure',
    responseCode: null,
    durationMs: Date.now() - startMs,
    redactedSummary: redactedSummary.slice(0, 500),
    errorType,
    errorMessage: errorMessage.slice(0, 500),
  };
}

function extractSendPayload(action: AgentAction): MailpitSendPayload {
  const p = action.rawPayload;
  if (p === null || typeof p !== 'object' || Array.isArray(p)) {
    throw new Error('rawPayload must be an object with { from, to, subject, body }');
  }
  const o = p as Record<string, unknown>;
  const required = ['from', 'to', 'subject', 'body'] as const;
  for (const k of required) {
    if (o[k] === undefined) {
      throw new Error(`rawPayload.${k} is required for send actions`);
    }
  }
  if (typeof o['from'] !== 'string' || (o['from'] as string).trim().length === 0) {
    throw new Error('rawPayload.from must be a non-empty string');
  }
  if (typeof o['subject'] !== 'string') {
    throw new Error('rawPayload.subject must be a string');
  }
  if (typeof o['body'] !== 'string') {
    throw new Error('rawPayload.body must be a string');
  }
  const result: {
    from: string;
    to: string | readonly string[];
    subject: string;
    body: string;
    cc?: string | readonly string[];
    bcc?: string | readonly string[];
    inReplyTo?: string;
    references?: string;
    customHeaders?: Readonly<Record<string, string>>;
  } = {
    from: (o['from'] as string).trim(),
    to: o['to'] as string | readonly string[],
    subject: o['subject'] as string,
    body: o['body'] as string,
  };
  if (o['cc'] !== undefined) result.cc = o['cc'] as string | readonly string[];
  if (o['bcc'] !== undefined) result.bcc = o['bcc'] as string | readonly string[];
  if (typeof o['inReplyTo'] === 'string') result.inReplyTo = o['inReplyTo'];
  if (typeof o['references'] === 'string') result.references = o['references'];
  if (
    o['customHeaders'] !== undefined &&
    typeof o['customHeaders'] === 'object' &&
    o['customHeaders'] !== null &&
    !Array.isArray(o['customHeaders'])
  ) {
    const hdrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(o['customHeaders'] as Record<string, unknown>)) {
      if (typeof v !== 'string') {
        throw new Error(`rawPayload.customHeaders.${k} must be a string`);
      }
      hdrs[k] = v;
    }
    result.customHeaders = hdrs;
  }
  return result;
}

function extractReadPayload(action: AgentAction): MailpitReadPayload {
  const p = action.rawPayload;
  if (p === null || p === undefined) {
    return {};
  }
  if (typeof p !== 'object' || Array.isArray(p)) {
    throw new Error('rawPayload, if provided, must be an object');
  }
  const o = p as Record<string, unknown>;
  const result: { query?: string; limit?: number } = {};
  if (typeof o['query'] === 'string') result.query = o['query'];
  if (typeof o['limit'] === 'number' && Number.isFinite(o['limit'])) {
    result.limit = Math.max(1, Math.floor(o['limit'] as number));
  }
  return result;
}

function buildMessageId(domain: string): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 12);
  return `<${t}.${r}@${domain}>`;
}

function escapeHeader(v: string): string {
  // RFC 5322: strip CR/LF to prevent header injection.
  return v.replace(/[\r\n]/g, ' ').trim();
}

function buildRfc5322Message(
  msg: MailpitSendPayload,
  messageId: string
): { wire: string; cc: readonly string[]; bcc: readonly string[]; toList: readonly string[] } {
  const toList = normalizeRecipientList(msg.to);
  const ccList = normalizeRecipientList(msg.cc);
  const bccList = normalizeRecipientList(msg.bcc);
  const headers: string[] = [];
  headers.push(`From: ${escapeHeader(msg.from)}`);
  if (toList.length > 0) headers.push(`To: ${toList.map(escapeHeader).join(', ')}`);
  if (ccList.length > 0) headers.push(`Cc: ${ccList.map(escapeHeader).join(', ')}`);
  // BCC is intentionally NOT in the wire headers (recipients are issued via SMTP RCPT TO).
  headers.push(`Subject: ${escapeHeader(msg.subject)}`);
  headers.push(`Message-ID: ${escapeHeader(messageId)}`);
  headers.push(`Date: ${new Date().toUTCString()}`);
  headers.push('MIME-Version: 1.0');
  headers.push('Content-Type: text/plain; charset=utf-8');
  headers.push('Content-Transfer-Encoding: 7bit');
  if (msg.inReplyTo) headers.push(`In-Reply-To: ${escapeHeader(msg.inReplyTo)}`);
  if (msg.references) headers.push(`References: ${escapeHeader(msg.references)}`);
  if (msg.customHeaders) {
    for (const [k, v] of Object.entries(msg.customHeaders)) {
      headers.push(`${escapeHeader(k)}: ${escapeHeader(v)}`);
    }
  }
  const body = msg.body.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
  const wire = headers.join('\r\n') + '\r\n\r\n' + body + '\r\n';
  return { wire, cc: ccList, bcc: bccList, toList };
}

// ── Minimal RFC 5321 SMTP client ─────────────────────────────────────────────
//
// Plain TCP only (no TLS, no AUTH). Mailpit local listens on 127.0.0.1 with
// neither, which matches the lab integration proof. STARTTLS / AUTH PLAIN
// would be added here cleanly if a future deployment moves Mailpit off
// loopback — but until then those modes are rejected at construct time, so
// the runtime never sees an unsupported transport state.

export interface SmtpTransport {
  send(
    host: string,
    port: number,
    envelope: { mailFrom: string; rcptTo: readonly string[]; data: string },
    timeoutMs: number
  ): Promise<{ smtpCode: string; smtpResponse: string }>;
}

export class NetSmtpTransport implements SmtpTransport {
  async send(
    host: string,
    port: number,
    envelope: { mailFrom: string; rcptTo: readonly string[]; data: string },
    timeoutMs: number
  ): Promise<{ smtpCode: string; smtpResponse: string }> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      socket.setEncoding('utf-8');
      socket.setTimeout(timeoutMs);
      let buf = '';
      type Step =
        | 'greeting'
        | 'helo'
        | 'mailFrom'
        | 'rcptTo'
        | 'data'
        | 'dataBody'
        | 'quit'
        | 'done';
      let step: Step = 'greeting';
      let rcptIdx = 0;
      let lastResponse = '';

      const cleanup = () => {
        socket.removeAllListeners();
        try {
          socket.end();
        } catch {
          /* ignore */
        }
      };

      socket.on('timeout', () => {
        cleanup();
        reject(new Error(`SMTP timeout at step '${step}' after ${timeoutMs}ms`));
      });
      socket.on('error', err => {
        cleanup();
        reject(new Error(`SMTP transport error at step '${step}': ${err.message}`));
      });

      const writeCmd = (cmd: string) => {
        socket.write(cmd + '\r\n');
      };

      const consumeResponse = (): { code: string; line: string } | null => {
        // SMTP reply is one or more lines; intermediate lines have '-' after
        // the code, final has ' '. We need a full reply terminated by '\r\n'
        // with a space-separator on the last line.
        const idx = buf.lastIndexOf('\r\n');
        if (idx < 0) return null;
        const block = buf.slice(0, idx);
        const lines = block.split(/\r?\n/);
        const last = lines[lines.length - 1] ?? '';
        if (last.length < 4 || last[3] !== ' ') return null;
        buf = buf.slice(idx + 2);
        return { code: last.slice(0, 3), line: block };
      };

      socket.on('data', chunk => {
        buf += chunk;
        let parsed: { code: string; line: string } | null;
        // eslint-disable-next-line no-cond-assign
        while ((parsed = consumeResponse())) {
          lastResponse = parsed.line;
          if (step === 'greeting') {
            if (parsed.code !== '220') {
              cleanup();
              reject(new Error(`SMTP greeting failed: ${parsed.line}`));
              return;
            }
            step = 'helo';
            writeCmd('HELO nexus-mailpit-connector');
            continue;
          }
          if (step === 'helo') {
            if (parsed.code !== '250') {
              cleanup();
              reject(new Error(`SMTP HELO rejected: ${parsed.line}`));
              return;
            }
            step = 'mailFrom';
            writeCmd(`MAIL FROM:<${envelope.mailFrom}>`);
            continue;
          }
          if (step === 'mailFrom') {
            if (parsed.code !== '250') {
              cleanup();
              reject(new Error(`SMTP MAIL FROM rejected: ${parsed.line}`));
              return;
            }
            step = 'rcptTo';
            rcptIdx = 0;
            const r = envelope.rcptTo[rcptIdx];
            if (r === undefined) {
              cleanup();
              reject(new Error('SMTP RCPT TO: no recipients'));
              return;
            }
            writeCmd(`RCPT TO:<${r}>`);
            continue;
          }
          if (step === 'rcptTo') {
            if (parsed.code !== '250' && parsed.code !== '251') {
              cleanup();
              reject(
                new Error(
                  `SMTP RCPT TO rejected (recipient '${envelope.rcptTo[rcptIdx]}'): ${parsed.line}`
                )
              );
              return;
            }
            rcptIdx += 1;
            if (rcptIdx < envelope.rcptTo.length) {
              writeCmd(`RCPT TO:<${envelope.rcptTo[rcptIdx]}>`);
              continue;
            }
            step = 'data';
            writeCmd('DATA');
            continue;
          }
          if (step === 'data') {
            if (parsed.code !== '354') {
              cleanup();
              reject(new Error(`SMTP DATA rejected: ${parsed.line}`));
              return;
            }
            step = 'dataBody';
            socket.write(envelope.data);
            // Terminator: CRLF . CRLF
            socket.write('\r\n.\r\n');
            continue;
          }
          if (step === 'dataBody') {
            if (parsed.code !== '250') {
              cleanup();
              reject(new Error(`SMTP DATA body rejected: ${parsed.line}`));
              return;
            }
            step = 'quit';
            writeCmd('QUIT');
            continue;
          }
          if (step === 'quit') {
            step = 'done';
            cleanup();
            resolve({ smtpCode: parsed.code, smtpResponse: lastResponse });
            return;
          }
        }
      });
    });
  }
}

// ── Connector ────────────────────────────────────────────────────────────────

export class MailpitConnector implements Connector {
  readonly systemType: NonEmpty;
  readonly connectorVersion = 'v0.1.0' as NonEmpty;
  readonly dataClass: DataClass;

  private readonly smtpHost: string;
  private readonly smtpPort: number;
  private readonly apiBaseUrl: string;
  private readonly tlsMode: 'none' | 'starttls' | 'tls';
  private readonly authMode: 'none' | 'plain';
  private readonly allowedSenders: readonly string[];
  private readonly allowedRecipients: readonly string[];
  private readonly allowedDomains: readonly string[];
  private readonly queryLimit: number;
  private readonly payloadsRoot: string;
  private readonly displayLabel: string;
  private readonly defaultDomain: string;
  private readonly smtpTimeoutMs: number;
  private readonly httpTimeoutMs: number;
  private readonly transport: SmtpTransport;
  private readonly fetchImpl: typeof fetch;

  constructor(
    opts: MailpitConnectorOptions,
    deps?: { transport?: SmtpTransport; fetch?: typeof fetch }
  ) {
    if (opts.tlsMode !== 'none') {
      throw new Error(
        `MailpitConnector('${opts.systemType}'): tlsMode '${opts.tlsMode}' is not supported in v0.1. ` +
          "Only 'none' (loopback Mailpit) is wired. Future spec adds STARTTLS/TLS."
      );
    }
    if (opts.authMode !== 'none') {
      throw new Error(
        `MailpitConnector('${opts.systemType}'): authMode '${opts.authMode}' is not supported in v0.1. ` +
          "Only 'none' (loopback Mailpit) is wired. Future spec adds AUTH PLAIN."
      );
    }
    const wildcardSender = opts.allowedSenders.find(isWildcardEntry);
    if (wildcardSender !== undefined) {
      throw new Error(
        `MailpitConnector('${opts.systemType}'): allowedSenders cannot include wildcards (got '${wildcardSender}'). Use concrete addresses.`
      );
    }
    const wildcardRecipient = opts.allowedRecipients.find(isWildcardEntry);
    if (wildcardRecipient !== undefined) {
      throw new Error(
        `MailpitConnector('${opts.systemType}'): allowedRecipients cannot include wildcards (got '${wildcardRecipient}'). Use concrete addresses.`
      );
    }
    const wildcardDomain = opts.allowedDomains.find(isWildcardEntry);
    if (wildcardDomain !== undefined) {
      throw new Error(
        `MailpitConnector('${opts.systemType}'): allowedDomains cannot include wildcards (got '${wildcardDomain}'). Use concrete domain literals.`
      );
    }
    if (opts.allowedSenders.length === 0 && opts.allowedDomains.length === 0) {
      throw new Error(
        `MailpitConnector('${opts.systemType}'): at least one allowedSender or allowedDomain is required to authorize any From: address.`
      );
    }
    if (opts.allowedRecipients.length === 0 && opts.allowedDomains.length === 0) {
      throw new Error(
        `MailpitConnector('${opts.systemType}'): at least one allowedRecipient or allowedDomain is required to authorize any To/Cc/Bcc address.`
      );
    }
    this.systemType = opts.systemType;
    this.dataClass = opts.dataClass;
    this.smtpHost = opts.smtpHost;
    this.smtpPort = opts.smtpPort;
    this.apiBaseUrl = opts.apiBaseUrl.replace(/\/+$/, '');
    this.tlsMode = opts.tlsMode;
    this.authMode = opts.authMode;
    this.allowedSenders = opts.allowedSenders;
    this.allowedRecipients = opts.allowedRecipients;
    this.allowedDomains = opts.allowedDomains;
    this.queryLimit = opts.queryLimit;
    this.payloadsRoot = opts.payloadsRoot;
    this.displayLabel = opts.displayLabel ?? (opts.systemType as string);
    this.defaultDomain =
      opts.defaultDomain ??
      opts.allowedDomains[0] ??
      (opts.allowedSenders[0] !== undefined
        ? emailDomain(opts.allowedSenders[0])
        : 'mailpit.local');
    this.smtpTimeoutMs = opts.smtpTimeoutMs ?? 10_000;
    this.httpTimeoutMs = opts.httpTimeoutMs ?? 10_000;
    this.transport = deps?.transport ?? new NetSmtpTransport();
    this.fetchImpl = deps?.fetch ?? fetch;
  }

  supportedCapabilities(): string[] {
    return [
      'send:message:external',
      'send:message:internal',
      'transmit:data',
      'read:record:single',
      'read:record:bulk',
      'search:data',
      'query:data',
    ];
  }

  describeToolSchemas(): readonly ToolSchemaDescriptor[] {
    const sendInput: ToolInputSchema = {
      type: 'object',
      properties: {
        from: {
          type: 'string',
          description: 'Sender address. Must match an allowed sender or fall in an allowed domain.',
        },
        to: {
          type: 'string',
          description:
            'Recipient address (or array of addresses). Each must match the recipient allow-list.',
        },
        subject: { type: 'string', description: 'Subject line. Single line; CR/LF stripped.' },
        body: { type: 'string', description: 'Plain text body. Encoded 7bit.' },
        cc: { type: 'string', description: 'Optional Cc (address or array).' },
        bcc: {
          type: 'string',
          description:
            'Optional Bcc (address or array). Not in wire headers; used for SMTP RCPT only.',
        },
        inReplyTo: {
          type: 'string',
          description: 'Optional parent Message-ID for threaded reply.',
        },
      },
      required: ['from', 'to', 'subject', 'body'],
    };
    const readInput: ToolInputSchema = {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            "Mailpit search query. Supports operators 'from:', 'to:', 'cc:', 'subject:', 'message-id:', plus free text. Empty returns recent inbox slice.",
        },
        limit: { type: 'integer', description: `Result cap (default ${this.queryLimit}).` },
      },
      required: [],
    };
    return [
      {
        name: `send_${this.systemType}` as NonEmpty,
        description:
          (`Send an email through the ${this.displayLabel} mail target. The connector enforces the sender/recipient allow-list ` +
            `at execute time, builds a deterministic RFC 5322 message, dispatches via the configured SMTP port, and records a ` +
            `send receipt with the assigned Message-ID. Returns the receipt; no message body is echoed back.`) as NonEmpty,
        capability: 'send:message:external' as NonEmpty,
        target: {
          system: this.systemType,
          resourceType: 'message' as NonEmpty,
          resourceScope: 'single' as NonEmpty,
        },
        inputSchema: sendInput,
      },
      {
        name: `read_${this.systemType}` as NonEmpty,
        description:
          (`Read or search messages in the ${this.displayLabel} mail target via the Mailpit HTTP API. Use Mailpit operators ` +
            `('from:X to:Y subject:Z') to scope results. Empty query returns the most recent inbox slice up to the configured ` +
            `limit. Returns matched message metadata (id, from, to, subject, snippet, date) — full body retrieval is a separate fetch.`) as NonEmpty,
        capability: 'read:record:bulk' as NonEmpty,
        target: {
          system: this.systemType,
          resourceType: 'message' as NonEmpty,
          resourceScope: 'bulk' as NonEmpty,
        },
        inputSchema: readInput,
      },
    ];
  }

  canProduceDiff(): boolean {
    return true;
  }

  async produceDiff(action: AgentAction, _template: ExecutionGrantTemplate): Promise<string> {
    const cap = action.resolvedCapability ?? '';
    if (isSendCapability(cap)) {
      try {
        const p = extractSendPayload(action);
        const toList = normalizeRecipientList(p.to);
        return `[mailpit:${this.displayLabel}] would send From=${p.from} To=${toList.join(',')} Subject=${p.subject.slice(0, 80)}`;
      } catch (err) {
        return `[mailpit:${this.displayLabel}] preview unavailable: ${(err as Error).message}`;
      }
    }
    if (isReadCapability(cap)) {
      try {
        const p = extractReadPayload(action);
        const q = p.query ?? '(recent slice)';
        return `[mailpit:${this.displayLabel}] would search query='${q.slice(0, 120)}' limit=${p.limit ?? this.queryLimit}`;
      } catch (err) {
        return `[mailpit:${this.displayLabel}] preview unavailable: ${(err as Error).message}`;
      }
    }
    return `[mailpit:${this.displayLabel}] preview unavailable: capability '${cap}' not recognized`;
  }

  async redeemGrant(grant: ExecutionGrant, vault: GrantVault): Promise<void> {
    // Mailpit local has no auth; we deposit a non-sensitive marker so Gate 06's
    // vault.assertPresent() invariant holds. When TLS/AUTH lands, the per-grant
    // credential would be issued here.
    vault.setSecret(grant, `mailpit:${this.displayLabel}:${grant.grantId}`);
  }

  async execute(
    action: AgentAction,
    grant: ExecutionGrant,
    vault: GrantVault
  ): Promise<ExecutionResult> {
    vault.assertPresent(grant);
    vault.assertNotExpired(grant);
    const startMs = Date.now();
    const cap = action.resolvedCapability ?? '';
    if (isSendCapability(cap)) {
      return this.executeSend(action, grant, startMs);
    }
    if (isReadCapability(cap)) {
      return this.executeRead(action, grant, startMs);
    }
    return failure(
      grant,
      startMs,
      'CAPABILITY_UNRECOGNIZED',
      `capability '${cap}' is not recognized by the mailpit connector`,
      `[mailpit:${this.displayLabel}] denied: unrecognized capability '${cap}'`
    );
  }

  private async executeSend(
    action: AgentAction,
    grant: ExecutionGrant,
    startMs: number
  ): Promise<ExecutionResult> {
    let payload: MailpitSendPayload;
    try {
      payload = extractSendPayload(action);
    } catch (err) {
      return failure(
        grant,
        startMs,
        'INVALID_PAYLOAD',
        (err as Error).message,
        `[mailpit:${this.displayLabel}] denied: invalid send payload`
      );
    }
    // Sender allow-list
    if (!isAddressAllowed(payload.from, this.allowedSenders, this.allowedDomains)) {
      return failure(
        grant,
        startMs,
        'SENDER_NOT_ALLOWED',
        `sender '${payload.from}' is not in allowedSenders / allowedDomains`,
        `[mailpit:${this.displayLabel}] denied: sender not allowed`
      );
    }
    const toList = normalizeRecipientList(payload.to);
    const ccList = normalizeRecipientList(payload.cc);
    const bccList = normalizeRecipientList(payload.bcc);
    const rcpts = [...toList, ...ccList, ...bccList];
    if (rcpts.length === 0) {
      return failure(
        grant,
        startMs,
        'INVALID_PAYLOAD',
        'rawPayload.to must contain at least one recipient',
        `[mailpit:${this.displayLabel}] denied: no recipients`
      );
    }
    for (const r of rcpts) {
      if (!isAddressAllowed(r, this.allowedRecipients, this.allowedDomains)) {
        return failure(
          grant,
          startMs,
          'RECIPIENT_NOT_ALLOWED',
          `recipient '${r}' is not in allowedRecipients / allowedDomains`,
          `[mailpit:${this.displayLabel}] denied: recipient '${r}' not allowed`
        );
      }
    }
    const messageId = buildMessageId(this.defaultDomain);
    let wire: string;
    try {
      wire = buildRfc5322Message(payload, messageId).wire;
    } catch (err) {
      return failure(
        grant,
        startMs,
        'INVALID_PAYLOAD',
        (err as Error).message,
        `[mailpit:${this.displayLabel}] denied: message build failed`
      );
    }
    let smtpResult: { smtpCode: string; smtpResponse: string };
    try {
      smtpResult = await this.transport.send(
        this.smtpHost,
        this.smtpPort,
        { mailFrom: payload.from, rcptTo: rcpts, data: wire },
        this.smtpTimeoutMs
      );
    } catch (err) {
      return failure(
        grant,
        startMs,
        'SMTP_TRANSPORT_ERROR',
        (err as Error).message,
        `[mailpit:${this.displayLabel}] smtp send failed`
      );
    }
    // Persist receipt to action-scoped payload file (consistent with postgres connector).
    const payloadDir = path.join(this.payloadsRoot, action.runId);
    const payloadPath = path.join(payloadDir, `${action.actionId}.json`);
    const payloadRelative = path.relative(this.payloadsRoot, payloadPath);
    const receipt = {
      connector: 'mailpit',
      systemType: this.systemType,
      actionId: action.actionId,
      runId: action.runId,
      executedAt: new Date().toISOString(),
      kind: 'send_receipt',
      messageId,
      from: payload.from,
      to: toList,
      cc: ccList,
      bcc: bccList,
      subject: payload.subject,
      bodyLength: payload.body.length,
      smtpCode: smtpResult.smtpCode,
    };
    try {
      await fs.mkdir(payloadDir, { recursive: true });
      await fs.writeFile(payloadPath, JSON.stringify(receipt, null, 2), {
        encoding: 'utf-8',
        mode: 0o600,
      });
    } catch (err) {
      return failure(
        grant,
        startMs,
        'PAYLOAD_WRITE_ERROR',
        err instanceof Error ? err.message : 'payload write failed',
        `[mailpit:${this.displayLabel}] receipt persistence failed`
      );
    }
    const summary =
      `[mailpit:${this.displayLabel}] SEND → ${rcpts.length} recipient(s); ` +
      `from=${payload.from}; messageId=${messageId}; smtp=${smtpResult.smtpCode}; payload=${payloadRelative}`;
    return {
      grantId: grant.grantId,
      executedAt: new Date().toISOString(),
      status: 'success',
      responseCode: smtpResult.smtpCode,
      durationMs: Date.now() - startMs,
      redactedSummary: summary.slice(0, 500),
      errorType: null,
      errorMessage: null,
    };
  }

  private async executeRead(
    action: AgentAction,
    grant: ExecutionGrant,
    startMs: number
  ): Promise<ExecutionResult> {
    let payload: MailpitReadPayload;
    try {
      payload = extractReadPayload(action);
    } catch (err) {
      return failure(
        grant,
        startMs,
        'INVALID_PAYLOAD',
        (err as Error).message,
        `[mailpit:${this.displayLabel}] denied: invalid read payload`
      );
    }
    const limit = Math.min(payload.limit ?? this.queryLimit, this.queryLimit);
    const url =
      payload.query && payload.query.trim().length > 0
        ? `${this.apiBaseUrl}/api/v1/search?query=${encodeURIComponent(payload.query)}&limit=${limit}`
        : `${this.apiBaseUrl}/api/v1/messages?limit=${limit}`;
    let body: unknown;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.httpTimeoutMs);
      try {
        const resp = await this.fetchImpl(url, { signal: controller.signal });
        if (!resp.ok) {
          return failure(
            grant,
            startMs,
            'MAILPIT_HTTP_ERROR',
            `Mailpit API returned HTTP ${resp.status}`,
            `[mailpit:${this.displayLabel}] read failed: HTTP ${resp.status}`
          );
        }
        body = await resp.json();
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown fetch error';
      return failure(
        grant,
        startMs,
        'MAILPIT_TRANSPORT_ERROR',
        msg,
        `[mailpit:${this.displayLabel}] read transport error`
      );
    }
    const root = (body ?? {}) as Record<string, unknown>;
    const messagesRaw =
      (root['messages'] as unknown[] | undefined) ??
      (root['Messages'] as unknown[] | undefined) ??
      [];
    const messages = messagesRaw.filter(
      (m): m is Record<string, unknown> => typeof m === 'object' && m !== null
    );
    const projected = messages.map(m => {
      const from = m['From'] as { Address?: string } | undefined;
      const toArr = (m['To'] as Array<{ Address?: string }> | undefined) ?? [];
      return {
        id: typeof m['ID'] === 'string' ? m['ID'] : '',
        from: from?.Address ?? '',
        to: toArr.map(t => t.Address ?? '').filter(a => a.length > 0),
        subject: typeof m['Subject'] === 'string' ? m['Subject'] : '',
        snippet: typeof m['Snippet'] === 'string' ? m['Snippet'] : '',
        date: typeof m['Created'] === 'string' ? m['Created'] : '',
        size: typeof m['Size'] === 'number' ? m['Size'] : 0,
      };
    });
    const payloadDir = path.join(this.payloadsRoot, action.runId);
    const payloadPath = path.join(payloadDir, `${action.actionId}.json`);
    const payloadRelative = path.relative(this.payloadsRoot, payloadPath);
    try {
      await fs.mkdir(payloadDir, { recursive: true });
      const out = {
        connector: 'mailpit',
        systemType: this.systemType,
        actionId: action.actionId,
        runId: action.runId,
        executedAt: new Date().toISOString(),
        kind: 'read_result',
        query: payload.query ?? '',
        limit,
        rowCount: projected.length,
        rows: projected,
      };
      await fs.writeFile(payloadPath, JSON.stringify(out, null, 2), {
        encoding: 'utf-8',
        mode: 0o600,
      });
    } catch (err) {
      return failure(
        grant,
        startMs,
        'PAYLOAD_WRITE_ERROR',
        err instanceof Error ? err.message : 'payload write failed',
        `[mailpit:${this.displayLabel}] result persistence failed`
      );
    }
    const summary =
      `[mailpit:${this.displayLabel}] READ → ${projected.length} message(s); ` +
      `query='${(payload.query ?? '').slice(0, 80)}'; payload=${payloadRelative}`;
    return {
      grantId: grant.grantId,
      executedAt: new Date().toISOString(),
      status: 'success',
      responseCode: '200',
      durationMs: Date.now() - startMs,
      redactedSummary: summary.slice(0, 500),
      errorType: null,
      errorMessage: null,
    };
  }

  /** Used by the admin probe route. Lightweight — no SMTP send. */
  async probe(): Promise<{
    smtp: { reachable: boolean; latencyMs: number; error?: string };
    api: {
      reachable: boolean;
      latencyMs: number;
      version?: string;
      messagesCount?: number;
      error?: string;
    };
    healthy: boolean;
  }> {
    const smtpStart = Date.now();
    const smtp = await new Promise<{ reachable: boolean; latencyMs: number; error?: string }>(
      resolve => {
        const sock = net.createConnection({ host: this.smtpHost, port: this.smtpPort });
        sock.setTimeout(this.smtpTimeoutMs);
        const done = (r: { reachable: boolean; error?: string }) => {
          sock.removeAllListeners();
          try {
            sock.end();
          } catch {
            /* ignore */
          }
          const out: { reachable: boolean; latencyMs: number; error?: string } = {
            reachable: r.reachable,
            latencyMs: Date.now() - smtpStart,
          };
          if (r.error !== undefined) out.error = r.error;
          resolve(out);
        };
        sock.once('connect', () => done({ reachable: true }));
        sock.once('timeout', () => done({ reachable: false, error: 'timeout' }));
        sock.once('error', err => done({ reachable: false, error: err.message }));
      }
    );
    const apiStart = Date.now();
    let api: {
      reachable: boolean;
      latencyMs: number;
      version?: string;
      messagesCount?: number;
      error?: string;
    };
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.httpTimeoutMs);
      try {
        const resp = await this.fetchImpl(`${this.apiBaseUrl}/api/v1/info`, {
          signal: controller.signal,
        });
        if (!resp.ok) {
          api = {
            reachable: false,
            latencyMs: Date.now() - apiStart,
            error: `HTTP ${resp.status}`,
          };
        } else {
          const info = (await resp.json()) as Record<string, unknown>;
          const version =
            typeof info['Version'] === 'string' ? (info['Version'] as string) : undefined;
          const messagesCount =
            typeof info['Messages'] === 'number' ? (info['Messages'] as number) : undefined;
          const o: {
            reachable: boolean;
            latencyMs: number;
            version?: string;
            messagesCount?: number;
            error?: string;
          } = {
            reachable: true,
            latencyMs: Date.now() - apiStart,
          };
          if (version !== undefined) o.version = version;
          if (messagesCount !== undefined) o.messagesCount = messagesCount;
          api = o;
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      api = {
        reachable: false,
        latencyMs: Date.now() - apiStart,
        error: err instanceof Error ? err.message : 'fetch failed',
      };
    }
    return { smtp, api, healthy: smtp.reachable && api.reachable };
  }

  /**
   * Real SMTP send + Mailpit API retrieve roundtrip used by the admin
   * test-connection route. Sender + recipient must match the allow-list
   * (same gate the runtime applies). Returns a structured proof bundle.
   *
   * Explicitly labeled `admin_probe_message` so it can never be confused
   * with an NXS-dispatched mail action.
   */
  async testConnection(opts: { runId: string }): Promise<{
    ok: boolean;
    runId: string;
    sent: { from: string; to: string; subject: string; messageId: string; smtpCode: string };
    retrieved: { id: string; from: string; to: readonly string[]; subject: string } | null;
    durationMs: number;
    error?: string;
  }> {
    const startMs = Date.now();
    const from = this.allowedSenders[0] ?? `probe@${this.defaultDomain}`;
    const to = this.allowedRecipients[0] ?? `probe@${this.defaultDomain}`;
    if (
      !isAddressAllowed(from, this.allowedSenders, this.allowedDomains) ||
      !isAddressAllowed(to, this.allowedRecipients, this.allowedDomains)
    ) {
      return {
        ok: false,
        runId: opts.runId,
        sent: { from, to, subject: '', messageId: '', smtpCode: '' },
        retrieved: null,
        durationMs: Date.now() - startMs,
        error: 'no allowed sender/recipient configured for admin probe',
      };
    }
    const subject = `ADMIN-PROBE-${opts.runId}`;
    const messageId = buildMessageId(this.defaultDomain);
    const send: MailpitSendPayload = {
      from,
      to,
      subject,
      body: `Admin probe message — kind=admin_probe_message runId=${opts.runId}.`,
      customHeaders: {
        'X-Nexus-Admin-Probe': 'true',
        'X-Nexus-Probe-Run-Id': opts.runId,
        'X-Nexus-Probe-Kind': 'admin_probe_message',
      },
    };
    const { wire } = buildRfc5322Message(send, messageId);
    let smtpCode: string;
    try {
      const r = await this.transport.send(
        this.smtpHost,
        this.smtpPort,
        { mailFrom: from, rcptTo: [to], data: wire },
        this.smtpTimeoutMs
      );
      smtpCode = r.smtpCode;
    } catch (err) {
      return {
        ok: false,
        runId: opts.runId,
        sent: { from, to, subject, messageId, smtpCode: '' },
        retrieved: null,
        durationMs: Date.now() - startMs,
        error: err instanceof Error ? err.message : 'smtp send failed',
      };
    }
    // Retrieve via API search; retry briefly to ride out store-write latency.
    const searchUrl = `${this.apiBaseUrl}/api/v1/search?query=${encodeURIComponent(subject)}&limit=5`;
    let retrieved: { id: string; from: string; to: readonly string[]; subject: string } | null =
      null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.httpTimeoutMs);
        try {
          const resp = await this.fetchImpl(searchUrl, { signal: controller.signal });
          if (resp.ok) {
            const body = (await resp.json()) as Record<string, unknown>;
            const messagesRaw =
              (body['messages'] as unknown[] | undefined) ??
              (body['Messages'] as unknown[] | undefined) ??
              [];
            const m = messagesRaw.find(
              (x): x is Record<string, unknown> =>
                typeof x === 'object' &&
                x !== null &&
                (x as Record<string, unknown>)['Subject'] === subject
            );
            if (m !== undefined) {
              const fromObj = m['From'] as { Address?: string } | undefined;
              const toArr = (m['To'] as Array<{ Address?: string }> | undefined) ?? [];
              retrieved = {
                id: typeof m['ID'] === 'string' ? (m['ID'] as string) : '',
                from: fromObj?.Address ?? '',
                to: toArr.map(t => t.Address ?? '').filter(a => a.length > 0),
                subject: m['Subject'] as string,
              };
              break;
            }
          }
        } finally {
          clearTimeout(timer);
        }
      } catch {
        // Retry on transient transport error.
      }
      await new Promise(r => setTimeout(r, 200));
    }
    if (retrieved === null) {
      return {
        ok: false,
        runId: opts.runId,
        sent: { from, to, subject, messageId, smtpCode },
        retrieved: null,
        durationMs: Date.now() - startMs,
        error: 'message was sent but not visible through Mailpit API within retry budget',
      };
    }
    return {
      ok: retrieved.from === from && retrieved.to.includes(to) && retrieved.subject === subject,
      runId: opts.runId,
      sent: { from, to, subject, messageId, smtpCode },
      retrieved,
      durationMs: Date.now() - startMs,
    };
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Build a MailpitConnector from factory config. The composition root
 * (scripts/nexus-main.ts ensureMailpitConnectors) resolves secrets / paths
 * first, then calls this. Direct construction in tests is allowed.
 */
export function buildMailpitConnector(
  cfg: MailpitConnectorFactoryConfig,
  deps?: { transport?: SmtpTransport; fetch?: typeof fetch }
): MailpitConnector {
  return new MailpitConnector(cfg, deps);
}

/**
 * Translate a connector manifest record's `configuration` object into a
 * fully-typed MailpitConnectorFactoryConfig. Centralises the field-shape
 * defaulting + type-narrowing so both the composition-root bootstrap
 * (ensureMailpitConnectors) and the admin probe handler use exactly the
 * same translation rules. systemType / dataClass / payloadsRoot come from
 * the manifest envelope (not configuration), and are passed explicitly.
 */
export function mailpitConfigFromManifestRecord(
  record: {
    readonly configuration: Record<string, unknown>;
  },
  envelope: {
    readonly systemType: NonEmpty;
    readonly dataClass: DataClass;
    readonly payloadsRoot: string;
  }
): MailpitConnectorFactoryConfig {
  const cfg = record.configuration;
  const tlsMode = (typeof cfg['tlsMode'] === 'string' ? cfg['tlsMode'] : 'none') as
    | 'none'
    | 'starttls'
    | 'tls';
  const authMode = (typeof cfg['authMode'] === 'string' ? cfg['authMode'] : 'none') as
    | 'none'
    | 'plain';
  const sendersRaw = cfg['allowedSenders'];
  const recipientsRaw = cfg['allowedRecipients'];
  const domainsRaw = cfg['allowedDomains'];
  const allowedSenders = Array.isArray(sendersRaw)
    ? sendersRaw.filter((s): s is string => typeof s === 'string')
    : [];
  const allowedRecipients = Array.isArray(recipientsRaw)
    ? recipientsRaw.filter((s): s is string => typeof s === 'string')
    : [];
  const allowedDomains = Array.isArray(domainsRaw)
    ? domainsRaw.filter((s): s is string => typeof s === 'string')
    : [];
  return {
    systemType: envelope.systemType,
    dataClass: envelope.dataClass,
    smtpHost: typeof cfg['smtpHost'] === 'string' ? cfg['smtpHost'] : '127.0.0.1',
    smtpPort: typeof cfg['smtpPort'] === 'number' ? cfg['smtpPort'] : 1025,
    apiBaseUrl: typeof cfg['apiBaseUrl'] === 'string' ? cfg['apiBaseUrl'] : 'http://127.0.0.1:8025',
    tlsMode,
    authMode,
    allowedSenders,
    allowedRecipients,
    allowedDomains,
    queryLimit: typeof cfg['queryLimit'] === 'number' ? cfg['queryLimit'] : 200,
    payloadsRoot: envelope.payloadsRoot,
    ...(typeof cfg['displayLabel'] === 'string' ? { displayLabel: cfg['displayLabel'] } : {}),
    ...(typeof cfg['defaultDomain'] === 'string' ? { defaultDomain: cfg['defaultDomain'] } : {}),
    ...(typeof cfg['smtpTimeoutMs'] === 'number' ? { smtpTimeoutMs: cfg['smtpTimeoutMs'] } : {}),
    ...(typeof cfg['httpTimeoutMs'] === 'number' ? { httpTimeoutMs: cfg['httpTimeoutMs'] } : {}),
  };
}

/**
 * ConnectorFactory registered at bootstrap step 1c. Like the postgres and
 * stub factories, this is a no-op whose only job is to satisfy the manifest
 * loader's connectorType-presence check (§12.3.48 invariant 2). Real
 * MailpitConnector instances are constructed in nexus-main.ts where
 * payloadsRoot is in scope.
 */
export class MailpitConnectorFactory implements ConnectorFactory {
  readonly connectorType = 'mailpit' as NonEmpty;

  async create(_configuration: Record<string, unknown>): Promise<Connector> {
    throw new Error(
      'MailpitConnectorFactory.create() is not invoked directly. The composition ' +
        'root constructs MailpitConnector instances with vault-resolved configuration ' +
        'and registers them in the SimpleConnectorRegistry. Use buildMailpitConnector() ' +
        'with a fully-resolved factory config.'
    );
  }
}
