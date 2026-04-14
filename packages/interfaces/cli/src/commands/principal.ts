import { PrincipalRegistry, nowIso } from '@nexus/core';
import { openDb } from '../db.js';
export async function cmdPrincipalRegister(json: string): Promise<void> {
  const db = openDb();
  const data = JSON.parse(json);
  await new PrincipalRegistry(db).register({ ...data, registeredAt: nowIso() });
  console.log(JSON.stringify({ ok: true, principalId: data.principalId }, null, 2));
}
