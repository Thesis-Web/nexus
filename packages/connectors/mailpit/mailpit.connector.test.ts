/**
 * MailpitConnector unit tests — boundary contract, no network I/O.
 *
 * The connector is driven through its public Connector interface (execute /
 * redeemGrant / supportedCapabilities / describeToolSchemas / probe /
 * testConnection). Both SMTP transport and HTTP fetch are injected as
 * deterministic fakes so these tests exercise the gate logic, allow-list
 * enforcement, payload validation, and persisted-receipt shape without
 * touching the network.
 *
 * Integration tests in mailpit.connector.integration.test.ts cover the
 * same surface against a real Mailpit container.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  MailpitConnector,
  type SmtpTransport,
  type MailpitConnectorFactoryConfig,
} from './mailpit.connector.js';
import {
  DATA_CLASS,
  type AgentAction,
  type ExecutionGrant,
  type GrantVault,
  type IsoTimestamp,
  type NonEmpty,
  type Sha256Hex,
  type Uuid,
} from '@nexus/contracts';

const NOW = '2026-05-22T12:00:00.000Z' as IsoTimestamp;

class FakeVault implements GrantVault {
  private readonly secrets = new Map<string, string>();
  setSecret(grant: ExecutionGrant, secret: string): void {
    this.secrets.set(grant.grantId, secret);
  }
  hasSecret(grant: ExecutionGrant): boolean {
    return this.secrets.has(grant.grantId);
  }
  getSecret(grant: ExecutionGrant): string | null {
    return this.secrets.get(grant.grantId) ?? null;
  }
  assertPresent(grant: ExecutionGrant): void {
    if (!this.secrets.has(grant.grantId)) {
      throw new Error(`vault missing secret for grant ${grant.grantId}`);
    }
  }
  assertNotExpired(_grant: ExecutionGrant): void {
    /* no expiry in fake */
  }
}

class CapturingSmtpTransport implements SmtpTransport {
  public calls: Array<{
    host: string;
    port: number;
    mailFrom: string;
    rcptTo: readonly string[];
    data: string;
  }> = [];
  public throwOnNext: Error | null = null;
  async send(
    host: string,
    port: number,
    envelope: { mailFrom: string; rcptTo: readonly string[]; data: string },
    _timeoutMs: number
  ): Promise<{ smtpCode: string; smtpResponse: string }> {
    if (this.throwOnNext !== null) {
      const err = this.throwOnNext;
      this.throwOnNext = null;
      throw err;
    }
    this.calls.push({
      host,
      port,
      mailFrom: envelope.mailFrom,
      rcptTo: envelope.rcptTo,
      data: envelope.data,
    });
    return { smtpCode: '250', smtpResponse: '250 2.0.0 OK' };
  }
}

function fakeFetch(handlers: Array<(url: string) => Promise<Response>>): typeof fetch {
  let i = 0;
  return (async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
    const h = handlers[Math.min(i, handlers.length - 1)];
    if (h === undefined) throw new Error(`fake fetch out of handlers for ${u}`);
    i += 1;
    return h(u);
  }) as typeof fetch;
}

async function tmpdir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mailpit-conn-test-'));
}

function makeAction(opts: { capability: string; payload: unknown; system: string }): AgentAction {
  return {
    actionId: 'action-1' as Uuid,
    runId: 'run-1' as Uuid,
    timestamp: NOW,
    rawTarget: opts.system as NonEmpty,
    resolvedTarget: {
      system: opts.system as NonEmpty,
      resourceType: 'message' as NonEmpty,
      resourceScope: 'single' as NonEmpty,
    },
    rawPayload: opts.payload,
    rawVerb: 'send' as NonEmpty,
    resolvedVerb: 'send' as NonEmpty,
    resolvedCapability: opts.capability as NonEmpty,
    agentId: 'agent-1' as Uuid,
    principalId: 'principal-1' as Uuid,
  };
}

function makeGrant(): ExecutionGrant {
  return {
    grantId: 'grant-1' as Uuid,
    actionId: 'action-1' as Uuid,
    issuedAt: NOW,
    expiresAt: '2026-05-22T13:00:00.000Z' as IsoTimestamp,
    capability: 'send:message:external' as NonEmpty,
    target: {
      system: 'mailpit-local' as NonEmpty,
      resourceType: 'message' as NonEmpty,
      resourceScope: 'single' as NonEmpty,
    },
    grantDigest: 'a'.repeat(64) as Sha256Hex,
    signedAt: NOW,
    signature: 'sig' as NonEmpty,
  };
}

function baseConfig(payloadsRoot: string): MailpitConnectorFactoryConfig {
  return {
    systemType: 'mailpit-local' as NonEmpty,
    dataClass: DATA_CLASS.LOCAL_RESTRICTED,
    smtpHost: '127.0.0.1',
    smtpPort: 1025,
    apiBaseUrl: 'http://127.0.0.1:8025',
    tlsMode: 'none',
    authMode: 'none',
    allowedSenders: ['admin@nexlabco.test', 'notifications@nexlabco.test'],
    allowedRecipients: ['support@nexlabco.test', 'owner@nexlabco.test'],
    allowedDomains: ['nexlabco.test'],
    queryLimit: 50,
    payloadsRoot,
    displayLabel: 'mailpit-local',
  };
}

describe('MailpitConnector — construction guards', () => {
  it('rejects tlsMode !== none', async () => {
    const dir = await tmpdir();
    expect(
      () =>
        new MailpitConnector({
          ...baseConfig(dir),
          tlsMode: 'tls',
        })
    ).toThrow(/tlsMode 'tls' is not supported/);
  });

  it('rejects authMode !== none', async () => {
    const dir = await tmpdir();
    expect(
      () =>
        new MailpitConnector({
          ...baseConfig(dir),
          authMode: 'plain',
        })
    ).toThrow(/authMode 'plain' is not supported/);
  });

  it('rejects wildcard allowedSenders', async () => {
    const dir = await tmpdir();
    expect(
      () =>
        new MailpitConnector({
          ...baseConfig(dir),
          allowedSenders: ['*'],
        })
    ).toThrow(/allowedSenders cannot include wildcards/);
  });

  it('rejects wildcard allowedRecipients', async () => {
    const dir = await tmpdir();
    expect(
      () =>
        new MailpitConnector({
          ...baseConfig(dir),
          allowedRecipients: ['*@nexlabco.test'],
        })
    ).toThrow(/allowedRecipients cannot include wildcards/);
  });

  it('rejects wildcard allowedDomains', async () => {
    const dir = await tmpdir();
    expect(
      () =>
        new MailpitConnector({
          ...baseConfig(dir),
          allowedDomains: ['*'],
        })
    ).toThrow(/allowedDomains cannot include wildcards/);
  });

  it('requires at least one sender or domain authority floor', async () => {
    const dir = await tmpdir();
    expect(
      () =>
        new MailpitConnector({
          ...baseConfig(dir),
          allowedSenders: [],
          allowedDomains: [],
        })
    ).toThrow(/at least one allowedSender or allowedDomain is required/);
  });
});

describe('MailpitConnector — supportedCapabilities + tool schemas', () => {
  it('reports the send/read capability set', async () => {
    const dir = await tmpdir();
    const c = new MailpitConnector(baseConfig(dir));
    const caps = c.supportedCapabilities();
    expect(caps).toContain('send:message:external');
    expect(caps).toContain('send:message:internal');
    expect(caps).toContain('read:record:bulk');
    expect(caps).toContain('search:data');
  });

  it('describeToolSchemas emits send_<system> and read_<system>', async () => {
    const dir = await tmpdir();
    const c = new MailpitConnector(baseConfig(dir));
    const tools = c.describeToolSchemas();
    expect(tools).toHaveLength(2);
    const send = tools.find(t => t.name === 'send_mailpit-local');
    const read = tools.find(t => t.name === 'read_mailpit-local');
    expect(send).toBeDefined();
    expect(read).toBeDefined();
    expect(send?.capability).toBe('send:message:external');
    expect(read?.capability).toBe('read:record:bulk');
  });
});

describe('MailpitConnector — send execute()', () => {
  let transport: CapturingSmtpTransport;
  let vault: FakeVault;
  let grant: ExecutionGrant;
  let dir: string;
  beforeEach(async () => {
    transport = new CapturingSmtpTransport();
    vault = new FakeVault();
    grant = makeGrant();
    dir = await tmpdir();
  });

  it('rejects sender outside allow-list', async () => {
    const c = new MailpitConnector(baseConfig(dir), { transport, fetch: fakeFetch([]) });
    await c.redeemGrant(grant, vault);
    const action = makeAction({
      capability: 'send:message:external',
      payload: {
        from: 'attacker@external.test',
        to: 'support@nexlabco.test',
        subject: 'test',
        body: 'x',
      },
      system: 'mailpit-local',
    });
    const r = await c.execute(action, grant, vault);
    expect(r.status).toBe('failure');
    expect(r.errorType).toBe('SENDER_NOT_ALLOWED');
    expect(transport.calls).toHaveLength(0);
  });

  it('rejects recipient outside allow-list', async () => {
    const c = new MailpitConnector(baseConfig(dir), { transport, fetch: fakeFetch([]) });
    await c.redeemGrant(grant, vault);
    const action = makeAction({
      capability: 'send:message:external',
      payload: {
        from: 'admin@nexlabco.test',
        to: 'unauthorized@external.test',
        subject: 'test',
        body: 'x',
      },
      system: 'mailpit-local',
    });
    const r = await c.execute(action, grant, vault);
    expect(r.status).toBe('failure');
    expect(r.errorType).toBe('RECIPIENT_NOT_ALLOWED');
    expect(transport.calls).toHaveLength(0);
  });

  it('rejects empty/missing payload fields', async () => {
    const c = new MailpitConnector(baseConfig(dir), { transport, fetch: fakeFetch([]) });
    await c.redeemGrant(grant, vault);
    const action = makeAction({
      capability: 'send:message:external',
      payload: { from: 'admin@nexlabco.test' },
      system: 'mailpit-local',
    });
    const r = await c.execute(action, grant, vault);
    expect(r.status).toBe('failure');
    expect(r.errorType).toBe('INVALID_PAYLOAD');
  });

  it('accepts allowed sender via domain match', async () => {
    const c = new MailpitConnector(baseConfig(dir), { transport, fetch: fakeFetch([]) });
    await c.redeemGrant(grant, vault);
    const action = makeAction({
      capability: 'send:message:external',
      payload: {
        from: 'newaddr@nexlabco.test', // not in allowedSenders, but domain matches
        to: 'support@nexlabco.test',
        subject: 'hello',
        body: 'body',
      },
      system: 'mailpit-local',
    });
    const r = await c.execute(action, grant, vault);
    expect(r.status).toBe('success');
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.mailFrom).toBe('newaddr@nexlabco.test');
  });

  it('rejects header-injection in subject', async () => {
    const c = new MailpitConnector(baseConfig(dir), { transport, fetch: fakeFetch([]) });
    await c.redeemGrant(grant, vault);
    const action = makeAction({
      capability: 'send:message:external',
      payload: {
        from: 'admin@nexlabco.test',
        to: 'support@nexlabco.test',
        subject: 'hello\r\nBcc: leak@evil.test',
        body: 'x',
      },
      system: 'mailpit-local',
    });
    const r = await c.execute(action, grant, vault);
    expect(r.status).toBe('success');
    // Wire data must not contain the injected header on its own line.
    const wire = transport.calls[0]?.data ?? '';
    expect(wire).not.toMatch(/^Bcc: leak@evil\.test/m);
    expect(wire).toMatch(/^Subject: hello {1,2}Bcc: leak@evil\.test$/m);
  });

  it('persists send receipt to payloads dir with correct shape', async () => {
    const c = new MailpitConnector(baseConfig(dir), { transport, fetch: fakeFetch([]) });
    await c.redeemGrant(grant, vault);
    const action = makeAction({
      capability: 'send:message:external',
      payload: {
        from: 'admin@nexlabco.test',
        to: ['support@nexlabco.test', 'owner@nexlabco.test'],
        subject: 'persistence proof',
        body: 'body data',
        customHeaders: { 'X-Nexus-Tag': 'unit-test' },
      },
      system: 'mailpit-local',
    });
    const r = await c.execute(action, grant, vault);
    expect(r.status).toBe('success');
    expect(r.responseCode).toBe('250');
    const receiptPath = path.join(dir, action.runId, `${action.actionId}.json`);
    const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf-8')) as Record<string, unknown>;
    expect(receipt['connector']).toBe('mailpit');
    expect(receipt['kind']).toBe('send_receipt');
    expect(receipt['from']).toBe('admin@nexlabco.test');
    expect(receipt['to']).toEqual(['support@nexlabco.test', 'owner@nexlabco.test']);
    expect(receipt['subject']).toBe('persistence proof');
    expect(typeof receipt['messageId']).toBe('string');
    expect(receipt['bodyLength']).toBe('body data'.length);
  });

  it('returns SMTP_TRANSPORT_ERROR when transport throws', async () => {
    transport.throwOnNext = new Error('connection refused');
    const c = new MailpitConnector(baseConfig(dir), { transport, fetch: fakeFetch([]) });
    await c.redeemGrant(grant, vault);
    const action = makeAction({
      capability: 'send:message:external',
      payload: {
        from: 'admin@nexlabco.test',
        to: 'support@nexlabco.test',
        subject: 's',
        body: 'b',
      },
      system: 'mailpit-local',
    });
    const r = await c.execute(action, grant, vault);
    expect(r.status).toBe('failure');
    expect(r.errorType).toBe('SMTP_TRANSPORT_ERROR');
  });

  it('rejects unrecognized capability', async () => {
    const c = new MailpitConnector(baseConfig(dir), { transport, fetch: fakeFetch([]) });
    await c.redeemGrant(grant, vault);
    const action = makeAction({
      capability: 'delete:record',
      payload: {
        from: 'admin@nexlabco.test',
        to: 'support@nexlabco.test',
        subject: 's',
        body: 'b',
      },
      system: 'mailpit-local',
    });
    const r = await c.execute(action, grant, vault);
    expect(r.status).toBe('failure');
    expect(r.errorType).toBe('CAPABILITY_UNRECOGNIZED');
  });
});

describe('MailpitConnector — read execute()', () => {
  let vault: FakeVault;
  let grant: ExecutionGrant;
  let dir: string;
  beforeEach(async () => {
    vault = new FakeVault();
    grant = makeGrant();
    dir = await tmpdir();
  });

  it('issues a search request when query is provided + persists projected rows', async () => {
    const captured: string[] = [];
    const f = (async (url: string | URL | Request) => {
      const u = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      captured.push(u);
      return new Response(
        JSON.stringify({
          messages: [
            {
              ID: 'abc123',
              From: { Address: 'support@nexlabco.test' },
              To: [{ Address: 'admin@nexlabco.test' }],
              Subject: 'thread alpha',
              Snippet: 'first line',
              Created: '2026-05-21T10:00:00Z',
              Size: 512,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }) as typeof fetch;
    const c = new MailpitConnector(baseConfig(dir), {
      transport: new CapturingSmtpTransport(),
      fetch: f,
    });
    await c.redeemGrant(grant, vault);
    const action = makeAction({
      capability: 'read:record:bulk',
      payload: { query: 'subject:alpha', limit: 25 },
      system: 'mailpit-local',
    });
    const r = await c.execute(action, grant, vault);
    expect(r.status).toBe('success');
    expect(captured[0]).toMatch(/\/api\/v1\/search\?query=subject%3Aalpha&limit=25/);
    const payloadPath = path.join(dir, action.runId, `${action.actionId}.json`);
    const out = JSON.parse(await fs.readFile(payloadPath, 'utf-8')) as Record<string, unknown>;
    expect(out['kind']).toBe('read_result');
    expect(out['rowCount']).toBe(1);
    const rows = out['rows'] as Array<Record<string, unknown>>;
    expect(rows[0]?.['id']).toBe('abc123');
    expect(rows[0]?.['from']).toBe('support@nexlabco.test');
    expect(rows[0]?.['to']).toEqual(['admin@nexlabco.test']);
  });

  it('issues /messages when query is absent', async () => {
    let seenUrl = '';
    const f = (async (url: string | URL | Request) => {
      seenUrl = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      return new Response(JSON.stringify({ messages: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const c = new MailpitConnector(baseConfig(dir), {
      transport: new CapturingSmtpTransport(),
      fetch: f,
    });
    await c.redeemGrant(grant, vault);
    const action = makeAction({
      capability: 'read:record:bulk',
      payload: {},
      system: 'mailpit-local',
    });
    const r = await c.execute(action, grant, vault);
    expect(r.status).toBe('success');
    expect(seenUrl).toMatch(/\/api\/v1\/messages\?limit=50$/);
  });

  it('caps limit at configured queryLimit', async () => {
    let seenUrl = '';
    const f = (async (url: string | URL | Request) => {
      seenUrl = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      return new Response(JSON.stringify({ messages: [] }), { status: 200 });
    }) as typeof fetch;
    const c = new MailpitConnector(baseConfig(dir), {
      transport: new CapturingSmtpTransport(),
      fetch: f,
    });
    await c.redeemGrant(grant, vault);
    const action = makeAction({
      capability: 'read:record:bulk',
      payload: { limit: 9999 },
      system: 'mailpit-local',
    });
    await c.execute(action, grant, vault);
    expect(seenUrl).toMatch(/limit=50$/);
  });

  it('returns MAILPIT_HTTP_ERROR on non-2xx response', async () => {
    const f = (async () => new Response('upstream down', { status: 503 })) as typeof fetch;
    const c = new MailpitConnector(baseConfig(dir), {
      transport: new CapturingSmtpTransport(),
      fetch: f,
    });
    await c.redeemGrant(grant, vault);
    const action = makeAction({
      capability: 'read:record:bulk',
      payload: {},
      system: 'mailpit-local',
    });
    const r = await c.execute(action, grant, vault);
    expect(r.status).toBe('failure');
    expect(r.errorType).toBe('MAILPIT_HTTP_ERROR');
  });
});

describe('MailpitConnector — probe + testConnection', () => {
  it('probe returns healthy when both SMTP and API respond', async () => {
    const dir = await tmpdir();
    // Stand up a tiny net server to accept the TCP connect, then close.
    const net = await import('node:net');
    const server = net.createServer(socket => {
      socket.end();
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address();
    if (addr === null || typeof addr === 'string') {
      server.close();
      throw new Error('failed to bind tcp probe server');
    }
    const apiFetch = (async () =>
      new Response(JSON.stringify({ Version: 'v1.29.6', Messages: 7 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    try {
      const c = new MailpitConnector(
        {
          ...baseConfig(dir),
          smtpHost: '127.0.0.1',
          smtpPort: addr.port,
        },
        { transport: new CapturingSmtpTransport(), fetch: apiFetch }
      );
      const r = await c.probe();
      expect(r.smtp.reachable).toBe(true);
      expect(r.api.reachable).toBe(true);
      expect(r.api.version).toBe('v1.29.6');
      expect(r.api.messagesCount).toBe(7);
      expect(r.healthy).toBe(true);
    } finally {
      server.close();
    }
  });

  it('probe reports SMTP unreachable when port is closed', async () => {
    const dir = await tmpdir();
    const apiFetch = (async () =>
      new Response(JSON.stringify({ Version: 'v1.29.6' }), { status: 200 })) as typeof fetch;
    const c = new MailpitConnector(
      {
        ...baseConfig(dir),
        smtpHost: '127.0.0.1',
        smtpPort: 1, // closed
        smtpTimeoutMs: 300,
      },
      { transport: new CapturingSmtpTransport(), fetch: apiFetch }
    );
    const r = await c.probe();
    expect(r.smtp.reachable).toBe(false);
    expect(r.healthy).toBe(false);
  });

  it('testConnection sends real labeled probe + retrieves via API', async () => {
    const dir = await tmpdir();
    const transport = new CapturingSmtpTransport();
    let apiCallCount = 0;
    const f = (async (url: string | URL | Request) => {
      apiCallCount += 1;
      const u = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      // First search call returns empty (simulate write-read latency)
      if (apiCallCount === 1) {
        expect(u).toMatch(/\/api\/v1\/search\?/);
        return new Response(JSON.stringify({ messages: [] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          messages: [
            {
              ID: 'probe-1',
              From: { Address: 'admin@nexlabco.test' },
              To: [{ Address: 'support@nexlabco.test' }],
              Subject: 'ADMIN-PROBE-test-run-001',
            },
          ],
        }),
        { status: 200 }
      );
    }) as typeof fetch;
    const c = new MailpitConnector(baseConfig(dir), { transport, fetch: f });
    const r = await c.testConnection({ runId: 'test-run-001' });
    expect(r.ok).toBe(true);
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.mailFrom).toBe('admin@nexlabco.test');
    expect(r.retrieved?.subject).toBe('ADMIN-PROBE-test-run-001');
    // Wire data must carry the X-Nexus-Admin-Probe header so it's never mistaken
    // for an NXS-dispatched message.
    expect(transport.calls[0]?.data ?? '').toMatch(/^X-Nexus-Admin-Probe: true$/m);
  });

  it('testConnection returns ok=false when API never sees the probe', async () => {
    const dir = await tmpdir();
    const transport = new CapturingSmtpTransport();
    const f = (async () =>
      new Response(JSON.stringify({ messages: [] }), { status: 200 })) as typeof fetch;
    const c = new MailpitConnector(baseConfig(dir), { transport, fetch: f });
    const r = await c.testConnection({ runId: 'no-show-002' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not visible through Mailpit API/);
  });
});
