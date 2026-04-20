import { SqliteActorRegistry, nowIso } from '@nexus/core';
import { openDb } from '../db.js';
export async function cmdActorRegister(json: string): Promise<void> {
  const db = openDb();
  const data = JSON.parse(json);
  await new SqliteActorRegistry(db).register({ ...data, registeredAt: nowIso() });
  console.log(JSON.stringify({ ok: true, actorId: data.actorId }, null, 2));
}
export async function cmdActorList(): Promise<void> {
  const db = openDb();
  const actors = await new SqliteActorRegistry(db).list();
  console.log(JSON.stringify({ ok: true, data: actors }, null, 2));
}
