import { ActorRegistry, nowIso } from '@nexus/core';
import { openDb } from '../db.js';
export async function cmdActorRegister(json: string): Promise<void> {
  const db = openDb();
  const data = JSON.parse(json);
  await new ActorRegistry(db).register({ ...data, registeredAt: nowIso() });
  console.log(JSON.stringify({ ok: true, actorId: data.actorId }, null, 2));
}
export async function cmdActorList(): Promise<void> {
  const db = openDb();
  const actors = await new ActorRegistry(db).list();
  console.log(JSON.stringify({ ok: true, data: actors }, null, 2));
}
