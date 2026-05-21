/**
 * tests/e2e/03-nxs-single.e2e.test.ts — E2E v0.4.0 §3.3
 *
 * Category 3: single-agent NXS dispatch to a target system. Tests
 * span the 10-user capability ladder so denial differentials at
 * Gate 02 / 03 / 04 are explicit.
 */
import { describe, it } from 'vitest';

describe('E2E Category 3 — single-agent NXS dispatch (target system read)', () => {
  it.skip('E2E-21-nxs-sales-list-orders: analyst → last 7 days of sales orders', async () => {});
  it.skip('E2E-22-nxs-sales-by-customer: analyst → acme-corp orders last month', async () => {});
  it.skip('E2E-23-nxs-warehouse-inventory-snapshot: sr_analyst → WIDGET-100 qty on hand', async () => {});
  it.skip('E2E-24-nxs-warehouse-low-stock: sr_analyst → SKUs under 50 qty', async () => {});
  it.skip('E2E-25-nxs-sales-top-customers: manager → top 10 by revenue last quarter', async () => {});
  it.skip('E2E-26-nxs-sales-bulk-pull: sr_manager → Q1 export bulk pull', async () => {});
  it.skip('E2E-27-nxs-warehouse-reorder-list: director → reorder this week by velocity', async () => {});
  it.skip('E2E-28-nxs-sales-delete-denied-for-analyst: analyst → delete ORD-12345 → Gate 03 denied', async () => {});
  it.skip('E2E-29-nxs-warehouse-update-bulk-allowed-for-manager: manager → mark batch shipped', async () => {});
  it.skip('E2E-30-nxs-sales-delete-allowed-for-vp: vp → delete duplicate order → Gate 05 approval', async () => {});
});
