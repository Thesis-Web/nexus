#!/usr/bin/env tsx
/**
 * scripts/seed-mail-lexicon-coverage.ts
 *
 * One-shot script that adds comprehensive email / mail-target lexicon
 * coverage to the planner-db-lexicon JSONL fixtures, then re-signs all
 * 8 fixtures with the control-plane key.
 *
 * Why this exists in a script (not directly through the admin SigningCouncil
 * route): the lexicon-mutation SigningCouncil flow requires TWO distinct
 * admin keypairs to land each individual mutation. The default install ships
 * with ONE admin keypair under keys/admins/. Owner explicitly approved baking
 * email-domain coverage into the fixtures while the second-admin-keypair
 * onboarding flow lands separately. Every record this script adds is something
 * the SigningCouncil flow could also produce — see admin-writer.ts §lexicon
 * routes; the script just bypasses the 2-of-2 threshold for the initial bake.
 *
 * Records added cover the owner-described scenarios:
 *   - "check my email for new messages"           → mail.read_inbox_recent
 *   - "search inbox for X"                         → mail.search_inbox
 *   - "send/compose/draft an email"                → mail.compose_send
 *   - "reply to email N"                           → mail.reply_in_thread
 *   - "respond to sales emails with template"      → mail.respond_with_template
 *     (NXS read inbox → NVG classify → NXS send per match)
 *   - "summarise my inbox"                          → mail.summarize_inbox
 *     (NXS read → NVG summarize)
 *
 * Pre-existing intent records, target catalog, workflow templates, and
 * lexical terms are left untouched. Re-running the script is idempotent at
 * the record level: each addition is keyed by (rawTerm, canonicalTerm) for
 * lexical terms and (intentId / templateId / nodeKey / etc.) for the others.
 * If a record with the same key already exists, the script skips it.
 *
 * Run from repo root:
 *   pnpm exec tsx scripts/seed-mail-lexicon-coverage.ts
 *
 * Then re-sign:
 *   pnpm exec tsx scripts/sign-planner-lexicon-fixtures.ts
 *
 * (This script invokes the signing step itself at the end.)
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

const FIXTURE_DIR = 'fixtures/planner/db-lexicon';

interface Fixture<T> {
  readonly filename: string;
  readonly newRecords: ReadonlyArray<T>;
  readonly keyOf: (r: T) => string;
}

// ── New lexical terms (verbs map to ACTION_VERB; nouns + business_phrases ──
// to canonical lemmas that the lexical-resolver and target-catalog use).
const NEW_LEXICAL_TERMS = [
  // verbs — email-specific aliases (canonical must be in ACTION_VERB)
  { rawTerm: 'check', canonicalTerm: 'read', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'check on', canonicalTerm: 'read', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'peek', canonicalTerm: 'read', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'browse', canonicalTerm: 'read', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'scan', canonicalTerm: 'read', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'poll', canonicalTerm: 'read', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'view', canonicalTerm: 'read', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'open', canonicalTerm: 'read', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'reread', canonicalTerm: 'read', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'mail', canonicalTerm: 'send', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'email', canonicalTerm: 'send', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'reply', canonicalTerm: 'send', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'respond', canonicalTerm: 'send', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'respond to', canonicalTerm: 'send', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'follow up', canonicalTerm: 'send', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'forward', canonicalTerm: 'send', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'fwd', canonicalTerm: 'send', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'notify', canonicalTerm: 'send', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'acknowledge', canonicalTerm: 'send', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'ack', canonicalTerm: 'send', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'dispatch', canonicalTerm: 'send', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'deliver', canonicalTerm: 'send', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'compose', canonicalTerm: 'create', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'draft', canonicalTerm: 'create', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'write up', canonicalTerm: 'create', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'prepare', canonicalTerm: 'create', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'archive', canonicalTerm: 'update', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'star', canonicalTerm: 'update', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'flag', canonicalTerm: 'update', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'label', canonicalTerm: 'update', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'tag', canonicalTerm: 'update', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'mark read', canonicalTerm: 'update', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'mark unread', canonicalTerm: 'update', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'unarchive', canonicalTerm: 'update', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'classify', canonicalTerm: 'synthesize', phraseClass: 'verb', source: 'mail_seed_v1' },
  {
    rawTerm: 'categorize',
    canonicalTerm: 'synthesize',
    phraseClass: 'verb',
    source: 'mail_seed_v1',
  },
  { rawTerm: 'hunt', canonicalTerm: 'search', phraseClass: 'verb', source: 'mail_seed_v1' },
  { rawTerm: 'locate', canonicalTerm: 'search', phraseClass: 'verb', source: 'mail_seed_v1' },
  // nouns
  { rawTerm: 'email', canonicalTerm: 'email_message', phraseClass: 'noun', source: 'mail_seed_v1' },
  {
    rawTerm: 'emails',
    canonicalTerm: 'email_message',
    phraseClass: 'noun',
    source: 'mail_seed_v1',
  },
  { rawTerm: 'mail', canonicalTerm: 'email_message', phraseClass: 'noun', source: 'mail_seed_v1' },
  {
    rawTerm: 'message',
    canonicalTerm: 'email_message',
    phraseClass: 'noun',
    source: 'mail_seed_v1',
  },
  {
    rawTerm: 'messages',
    canonicalTerm: 'email_message',
    phraseClass: 'noun',
    source: 'mail_seed_v1',
  },
  { rawTerm: 'inbox', canonicalTerm: 'email_inbox', phraseClass: 'noun', source: 'mail_seed_v1' },
  { rawTerm: 'mailbox', canonicalTerm: 'email_inbox', phraseClass: 'noun', source: 'mail_seed_v1' },
  { rawTerm: 'drafts', canonicalTerm: 'email_draft', phraseClass: 'noun', source: 'mail_seed_v1' },
  { rawTerm: 'draft', canonicalTerm: 'email_draft', phraseClass: 'noun', source: 'mail_seed_v1' },
  { rawTerm: 'thread', canonicalTerm: 'email_thread', phraseClass: 'noun', source: 'mail_seed_v1' },
  {
    rawTerm: 'conversation',
    canonicalTerm: 'email_thread',
    phraseClass: 'noun',
    source: 'mail_seed_v1',
  },
  {
    rawTerm: 'attachment',
    canonicalTerm: 'email_attachment',
    phraseClass: 'noun',
    source: 'mail_seed_v1',
  },
  {
    rawTerm: 'attachments',
    canonicalTerm: 'email_attachment',
    phraseClass: 'noun',
    source: 'mail_seed_v1',
  },
  // business phrases
  {
    rawTerm: 'new emails',
    canonicalTerm: 'recent_inbox',
    phraseClass: 'business_phrase',
    source: 'mail_seed_v1',
  },
  {
    rawTerm: 'new messages',
    canonicalTerm: 'recent_inbox',
    phraseClass: 'business_phrase',
    source: 'mail_seed_v1',
  },
  {
    rawTerm: 'unread mail',
    canonicalTerm: 'recent_inbox',
    phraseClass: 'business_phrase',
    source: 'mail_seed_v1',
  },
  {
    rawTerm: 'last hour',
    canonicalTerm: 'recent_inbox',
    phraseClass: 'business_phrase',
    source: 'mail_seed_v1',
  },
  {
    rawTerm: 'today',
    canonicalTerm: 'recent_inbox',
    phraseClass: 'business_phrase',
    source: 'mail_seed_v1',
  },
  {
    rawTerm: 'sales email',
    canonicalTerm: 'sales_email',
    phraseClass: 'business_phrase',
    source: 'mail_seed_v1',
  },
  {
    rawTerm: 'sales emails',
    canonicalTerm: 'sales_email',
    phraseClass: 'business_phrase',
    source: 'mail_seed_v1',
  },
  {
    rawTerm: 'order received',
    canonicalTerm: 'order_received_template',
    phraseClass: 'business_phrase',
    source: 'mail_seed_v1',
  },
  {
    rawTerm: 'vendor email',
    canonicalTerm: 'vendor_email',
    phraseClass: 'business_phrase',
    source: 'mail_seed_v1',
  },
  {
    rawTerm: 'customer email',
    canonicalTerm: 'customer_email',
    phraseClass: 'business_phrase',
    source: 'mail_seed_v1',
  },
  {
    rawTerm: 'internal email',
    canonicalTerm: 'internal_email',
    phraseClass: 'business_phrase',
    source: 'mail_seed_v1',
  },
  {
    rawTerm: 'thank you note',
    canonicalTerm: 'thank_you_template',
    phraseClass: 'business_phrase',
    source: 'mail_seed_v1',
  },
];

// ── New alias rules (safety patterns the planner must catch) ──
const NEW_ALIAS_RULES = [
  {
    rawTerm: 'send to everyone',
    canonicalTerm: 'send',
    status: 'review_required',
    reason: 'Bulk send to all-of-mailbox is risk-tier high — requires human review at plan time',
  },
  {
    rawTerm: 'reply to all',
    canonicalTerm: 'send',
    status: 'review_required',
    reason: 'Reply-all multiplies blast radius — review required before plan-time approval',
  },
  {
    rawTerm: 'mass email',
    canonicalTerm: 'send',
    status: 'review_required',
    reason: 'Mass-email pattern requires human review before plan-time approval',
  },
  {
    rawTerm: 'spam everyone',
    canonicalTerm: 'send',
    status: 'blocked',
    reason: 'Spam pattern explicitly blocked',
  },
  {
    rawTerm: 'delete all mail',
    canonicalTerm: 'delete',
    status: 'blocked',
    reason: 'Bulk mailbox wipe is catastrophic — use per-message archive flow instead',
  },
  {
    rawTerm: 'delete all emails',
    canonicalTerm: 'delete',
    status: 'blocked',
    reason: 'Bulk mailbox wipe is catastrophic — use per-message archive flow instead',
  },
  {
    rawTerm: 'empty inbox',
    canonicalTerm: 'delete',
    status: 'blocked',
    reason: 'Bulk mailbox wipe is catastrophic — use per-message archive flow instead',
  },
  {
    rawTerm: 'unsubscribe all',
    canonicalTerm: 'update',
    status: 'review_required',
    reason: 'Bulk unsubscribe affects external systems — review required',
  },
];

// ── New target catalog entries (system must be a known connector system) ──
// `system: 'mailpit-local'` is registered in config/connectors/connectors.v1.yaml.
const NEW_TARGET_CATALOG = [
  {
    businessTerm: 'email_inbox',
    system: 'mailpit-local',
    resourceType: 'inbox',
    resourceScope: 'bulk',
  },
  {
    businessTerm: 'recent_inbox',
    system: 'mailpit-local',
    resourceType: 'inbox',
    resourceScope: 'bulk',
  },
  {
    businessTerm: 'email_message',
    system: 'mailpit-local',
    resourceType: 'message',
    resourceScope: 'single',
  },
  {
    businessTerm: 'email_thread',
    system: 'mailpit-local',
    resourceType: 'thread',
    resourceScope: 'collection',
  },
  {
    businessTerm: 'email_draft',
    system: 'mailpit-local',
    resourceType: 'draft',
    resourceScope: 'single',
  },
  {
    businessTerm: 'sales_email',
    system: 'mailpit-local',
    resourceType: 'message',
    resourceScope: 'bulk',
  },
  {
    businessTerm: 'vendor_email',
    system: 'mailpit-local',
    resourceType: 'message',
    resourceScope: 'bulk',
  },
  {
    businessTerm: 'customer_email',
    system: 'mailpit-local',
    resourceType: 'message',
    resourceScope: 'bulk',
  },
  {
    businessTerm: 'internal_email',
    system: 'mailpit-local',
    resourceType: 'message',
    resourceScope: 'bulk',
  },
];

// ── New task intents (the planner uses these to anchor a workflow template) ──
const NEW_TASK_INTENTS = [
  {
    intentId: 'mail.read_inbox_recent',
    name: 'read email_inbox recent_inbox',
    description:
      'Pull the most recent slice of the user mail inbox. Single NXS read against the mail target; returns message metadata for downstream review.',
  },
  {
    intentId: 'mail.search_inbox',
    name: 'search email_message',
    description:
      'Search the mail inbox using deterministic operator syntax (from:, to:, subject:, free text). Single NXS read with a search query.',
  },
  {
    intentId: 'mail.compose_send',
    name: 'create send email_message',
    description:
      'Compose a single new email message and dispatch it through the governed mail target. NVG drafts the body if needed; NXS sends.',
  },
  {
    intentId: 'mail.reply_in_thread',
    name: 'create send email_thread',
    description:
      'Reply to a specific message within a thread, preserving In-Reply-To and References headers so threading is honored.',
  },
  {
    intentId: 'mail.respond_with_template',
    name: 'read synthesize send sales_email order_received_template',
    description:
      'Three-step canonical flow: NXS reads recent inbox → NVG classifies which messages match a target intent (e.g. sales orders) → NXS sends a templated response per match.',
  },
  {
    intentId: 'mail.summarize_inbox',
    name: 'read synthesize email_inbox',
    description: 'NXS reads inbox slice → NVG synthesizes a plain-english summary of the messages.',
  },
  {
    intentId: 'mail.archive_message',
    name: 'update email_message',
    description:
      'Archive a single message in the mail target (update its label / archive state). Single NXS update.',
  },
];

// ── New task capabilities (cross-referenced to CAPABILITY_IDS) ──
const NEW_TASK_CAPABILITIES = [
  { intentId: 'mail.read_inbox_recent', requiredCapabilities: ['read:record:bulk'] },
  { intentId: 'mail.search_inbox', requiredCapabilities: ['search:data'] },
  {
    intentId: 'mail.compose_send',
    requiredCapabilities: ['synthesize:content', 'send:message:external'],
  },
  {
    intentId: 'mail.reply_in_thread',
    requiredCapabilities: ['read:record:single', 'send:message:external'],
  },
  {
    intentId: 'mail.respond_with_template',
    requiredCapabilities: ['read:record:bulk', 'synthesize:content', 'send:message:external'],
  },
  {
    intentId: 'mail.summarize_inbox',
    requiredCapabilities: ['read:record:bulk', 'synthesize:content'],
  },
  { intentId: 'mail.archive_message', requiredCapabilities: ['update:record:internal'] },
];

// ── New workflow templates (each links to an intentId + node list) ──
const NEW_WORKFLOW_TEMPLATES = [
  {
    templateId: 'workflow_mail_read_inbox_recent_v1',
    intentId: 'mail.read_inbox_recent',
    name: 'Mail read inbox recent',
    description: 'Single-node template: NXS dispatches read:record:bulk against the mail target.',
    nodeIds: ['read_recent_inbox'],
  },
  {
    templateId: 'workflow_mail_search_inbox_v1',
    intentId: 'mail.search_inbox',
    name: 'Mail search inbox',
    description: 'Single-node template: NXS dispatches search:data against the mail target.',
    nodeIds: ['search_inbox'],
  },
  {
    templateId: 'workflow_mail_compose_send_v1',
    intentId: 'mail.compose_send',
    name: 'Mail compose and send',
    description:
      'Two-node template: NVG synthesizes the message body → NXS sends through the mail target.',
    nodeIds: ['compose_message_body', 'send_composed_message'],
  },
  {
    templateId: 'workflow_mail_reply_in_thread_v1',
    intentId: 'mail.reply_in_thread',
    name: 'Mail reply in thread',
    description:
      'Two-node template: NXS reads parent message (for In-Reply-To/References) → NXS sends the reply.',
    nodeIds: ['read_parent_message', 'send_reply_message'],
  },
  {
    templateId: 'workflow_mail_respond_with_template_v1',
    intentId: 'mail.respond_with_template',
    name: 'Mail respond with template (sales-email canonical flow)',
    description:
      'Three-node template: NXS reads recent inbox → NVG classifies sales emails → NXS sends a templated response per match (fan-out happens at execution time, not template).',
    nodeIds: ['read_recent_for_classify', 'classify_sales_emails', 'send_template_responses'],
  },
  {
    templateId: 'workflow_mail_summarize_inbox_v1',
    intentId: 'mail.summarize_inbox',
    name: 'Mail summarize inbox',
    description: 'Two-node template: NXS reads inbox slice → NVG summarizes.',
    nodeIds: ['read_inbox_for_summary', 'summarize_inbox_messages'],
  },
  {
    templateId: 'workflow_mail_archive_message_v1',
    intentId: 'mail.archive_message',
    name: 'Mail archive message',
    description: 'Single-node template: NXS dispatches update:record:internal on a single message.',
    nodeIds: ['archive_single_message'],
  },
];

// ── New workflow nodes (kind ∈ {nxs, nvg, secure_handoff}; capability ∈ CAPABILITY_IDS) ──
const NEW_WORKFLOW_NODES = [
  {
    templateId: 'workflow_mail_read_inbox_recent_v1',
    nodeKey: 'read_recent_inbox',
    kind: 'nxs',
    capability: 'read:record:bulk',
    expectedOutputSlots: ['inbox_messages'],
  },
  {
    templateId: 'workflow_mail_search_inbox_v1',
    nodeKey: 'search_inbox',
    kind: 'nxs',
    capability: 'search:data',
    expectedOutputSlots: ['search_results'],
  },
  {
    templateId: 'workflow_mail_compose_send_v1',
    nodeKey: 'compose_message_body',
    kind: 'nvg',
    capability: 'synthesize:content',
    expectedOutputSlots: ['draft_body'],
  },
  {
    templateId: 'workflow_mail_compose_send_v1',
    nodeKey: 'send_composed_message',
    kind: 'nxs',
    capability: 'send:message:external',
    expectedOutputSlots: ['send_receipt'],
  },
  {
    templateId: 'workflow_mail_reply_in_thread_v1',
    nodeKey: 'read_parent_message',
    kind: 'nxs',
    capability: 'read:record:single',
    expectedOutputSlots: ['parent_message'],
  },
  {
    templateId: 'workflow_mail_reply_in_thread_v1',
    nodeKey: 'send_reply_message',
    kind: 'nxs',
    capability: 'send:message:external',
    expectedOutputSlots: ['send_receipt'],
  },
  {
    templateId: 'workflow_mail_respond_with_template_v1',
    nodeKey: 'read_recent_for_classify',
    kind: 'nxs',
    capability: 'read:record:bulk',
    expectedOutputSlots: ['inbox_messages'],
  },
  {
    templateId: 'workflow_mail_respond_with_template_v1',
    nodeKey: 'classify_sales_emails',
    kind: 'nvg',
    capability: 'synthesize:content',
    expectedOutputSlots: ['classification_result', 'matched_message_ids'],
  },
  {
    templateId: 'workflow_mail_respond_with_template_v1',
    nodeKey: 'send_template_responses',
    kind: 'nxs',
    capability: 'send:message:external',
    expectedOutputSlots: ['send_receipts'],
  },
  {
    templateId: 'workflow_mail_summarize_inbox_v1',
    nodeKey: 'read_inbox_for_summary',
    kind: 'nxs',
    capability: 'read:record:bulk',
    expectedOutputSlots: ['inbox_messages'],
  },
  {
    templateId: 'workflow_mail_summarize_inbox_v1',
    nodeKey: 'summarize_inbox_messages',
    kind: 'nvg',
    capability: 'synthesize:content',
    expectedOutputSlots: ['summary_text'],
  },
  {
    templateId: 'workflow_mail_archive_message_v1',
    nodeKey: 'archive_single_message',
    kind: 'nxs',
    capability: 'update:record:internal',
    expectedOutputSlots: ['archive_receipt'],
  },
];

// ── New workflow edges (edgeType ∈ {data_dependency, conditional, sequential}) ──
const NEW_WORKFLOW_EDGES = [
  // workflow_mail_compose_send_v1: NVG draft → NXS send
  {
    templateId: 'workflow_mail_compose_send_v1',
    sourceNodeKey: 'compose_message_body',
    targetNodeKey: 'send_composed_message',
    edgeType: 'data_dependency',
    outputSlotRef: 'draft_body',
  },
  // workflow_mail_reply_in_thread_v1: NXS read parent → NXS send reply
  {
    templateId: 'workflow_mail_reply_in_thread_v1',
    sourceNodeKey: 'read_parent_message',
    targetNodeKey: 'send_reply_message',
    edgeType: 'data_dependency',
    outputSlotRef: 'parent_message',
  },
  // workflow_mail_respond_with_template_v1: read → classify → send
  {
    templateId: 'workflow_mail_respond_with_template_v1',
    sourceNodeKey: 'read_recent_for_classify',
    targetNodeKey: 'classify_sales_emails',
    edgeType: 'data_dependency',
    outputSlotRef: 'inbox_messages',
  },
  {
    templateId: 'workflow_mail_respond_with_template_v1',
    sourceNodeKey: 'classify_sales_emails',
    targetNodeKey: 'send_template_responses',
    edgeType: 'data_dependency',
    outputSlotRef: 'matched_message_ids',
  },
  // workflow_mail_summarize_inbox_v1: NXS read → NVG summarize
  {
    templateId: 'workflow_mail_summarize_inbox_v1',
    sourceNodeKey: 'read_inbox_for_summary',
    targetNodeKey: 'summarize_inbox_messages',
    edgeType: 'data_dependency',
    outputSlotRef: 'inbox_messages',
  },
];

const FIXTURES = [
  {
    filename: 'planner-lexical-term.v1.jsonl',
    newRecords: NEW_LEXICAL_TERMS,
    keyOf: (r: (typeof NEW_LEXICAL_TERMS)[number]) => `${r.rawTerm}|${r.canonicalTerm}`,
  },
  {
    filename: 'planner-alias-rule.v1.jsonl',
    newRecords: NEW_ALIAS_RULES,
    keyOf: (r: (typeof NEW_ALIAS_RULES)[number]) => `${r.rawTerm}|${r.canonicalTerm}`,
  },
  {
    filename: 'planner-task-intent.v1.jsonl',
    newRecords: NEW_TASK_INTENTS,
    keyOf: (r: (typeof NEW_TASK_INTENTS)[number]) => r.intentId,
  },
  {
    filename: 'planner-task-capability.v1.jsonl',
    newRecords: NEW_TASK_CAPABILITIES,
    keyOf: (r: (typeof NEW_TASK_CAPABILITIES)[number]) => r.intentId,
  },
  {
    filename: 'planner-target-catalog.v1.jsonl',
    newRecords: NEW_TARGET_CATALOG,
    keyOf: (r: (typeof NEW_TARGET_CATALOG)[number]) => r.businessTerm,
  },
  {
    filename: 'planner-workflow-template.v1.jsonl',
    newRecords: NEW_WORKFLOW_TEMPLATES,
    keyOf: (r: (typeof NEW_WORKFLOW_TEMPLATES)[number]) => r.templateId,
  },
  {
    filename: 'planner-workflow-node.v1.jsonl',
    newRecords: NEW_WORKFLOW_NODES,
    keyOf: (r: (typeof NEW_WORKFLOW_NODES)[number]) => `${r.templateId}:${r.nodeKey}`,
  },
  {
    filename: 'planner-workflow-edge.v1.jsonl',
    newRecords: NEW_WORKFLOW_EDGES,
    keyOf: (r: (typeof NEW_WORKFLOW_EDGES)[number]) =>
      `${r.templateId}:${r.sourceNodeKey}->${r.targetNodeKey}`,
  },
] as const;

function looksLikeHeader(line: string): boolean {
  try {
    const parsed = JSON.parse(line);
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      'signature' in parsed &&
      'contentDigest' in parsed
    );
  } catch {
    return false;
  }
}

async function seedFixture<T>(f: Fixture<T>): Promise<{ added: number; skipped: number }> {
  const filePath = path.join(FIXTURE_DIR, f.filename);
  const raw = await fs.readFile(filePath, 'utf-8');
  const lines = raw.split('\n').filter(l => l.length > 0);
  const existingRecordLines = lines[0] && looksLikeHeader(lines[0]) ? lines.slice(1) : lines;
  const existingRecords = existingRecordLines.map(l => JSON.parse(l));
  const existingKeys = new Set(existingRecords.map(r => f.keyOf(r as T)));

  let added = 0;
  let skipped = 0;
  const newRecordLines: string[] = [];
  for (const rec of f.newRecords) {
    if (existingKeys.has(f.keyOf(rec))) {
      skipped += 1;
      continue;
    }
    newRecordLines.push(JSON.stringify(rec));
    added += 1;
  }
  if (added === 0) {
    return { added, skipped };
  }
  // Append (re-signing rebuilds the header anyway).
  const headerLine = lines[0] && looksLikeHeader(lines[0]) ? lines[0] : '';
  const out = [...(headerLine ? [headerLine] : []), ...existingRecordLines, ...newRecordLines].join(
    '\n'
  );
  await fs.writeFile(filePath, out + '\n', 'utf-8');
  return { added, skipped };
}

function runSignScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'tsx', 'scripts/sign-planner-lexicon-fixtures.ts'], {
      stdio: 'inherit',
    });
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`sign script exited with code ${code}`));
    });
  });
}

async function main(): Promise<void> {
  console.log('Seeding email/mail lexicon coverage…');
  for (const f of FIXTURES) {
    const { added, skipped } = await seedFixture(f as unknown as Fixture<unknown>);
    console.log(`  ${f.filename}: +${added} new, ${skipped} skipped (already present)`);
  }
  console.log('Re-signing fixtures…');
  await runSignScript();
  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
