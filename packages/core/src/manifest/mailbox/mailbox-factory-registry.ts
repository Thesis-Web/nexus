/**
 * MailboxBackendFactoryRegistry — AMEND-spec §5.1, §3.13
 *
 * File: packages/core/src/manifest/mailbox/mailbox-factory-registry.ts
 * Layer 1 — imports from @nexus/contracts only.
 */
import type {
  MailboxBackendFactory,
  MailboxBackendFactoryRegistry as IMailboxBackendFactoryRegistry,
} from '@nexus/contracts';

export class MailboxBackendFactoryRegistry implements IMailboxBackendFactoryRegistry {
  private readonly factories = new Map<string, MailboxBackendFactory>();

  register(factory: MailboxBackendFactory): void {
    if (this.factories.has(factory.mailboxType)) {
      throw new Error(`duplicate mailboxType: '${factory.mailboxType}' is already registered`);
    }
    this.factories.set(factory.mailboxType, factory);
  }

  get(mailboxType: string): MailboxBackendFactory | null {
    return this.factories.get(mailboxType) ?? null;
  }

  list(): MailboxBackendFactory[] {
    return [...this.factories.values()];
  }
}
