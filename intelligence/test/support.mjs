import { createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFeltDB } from '@feltdb/core';

import { createHandler, IntelligenceStore, intelligenceStateContract } from '../src/index.mjs';

export const OWNER_TOKEN = 'owner-token-for-tests-only-0123456789';
export const OWNER_SHA256 = createHash('sha256').update(OWNER_TOKEN).digest('hex');
export const BASE = 'https://boundry.company/api/intelligence/v1';

/** A persisted FeltDB at `path` (new unless given) that enforces exactly the intelligence contract. */
export async function openDb(path) {
  const dir = path ?? (await mkdtemp(join(tmpdir(), 'boundry-intelligence-')));
  const db = createFeltDB({ mode: 'local', namespace: 'boundry-intelligence', path: dir, access: 'shared' });
  if (!(await db.stateContract.active())) await db.stateContract.evolve(intelligenceStateContract());
  return { db, path: dir };
}

export async function harness({ path, now, retentionDays, rateLimit } = {}) {
  const { db, path: dir } = await openDb(path);
  const store = new IntelligenceStore(db, { ...(now ? { now } : {}), ...(retentionDays ? { retentionDays } : {}), ...(rateLimit ? { rateLimit } : {}) });
  const handle = createHandler({ store, ownerTokenSha256: OWNER_SHA256 });
  const call = async (method, path, { token, body } = {}) => {
    const response = await handle(new Request(`${BASE}${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) }));
    return { status: response.status, body: await response.json() };
  };
  const owner = (method, path, body) => call(method, path, { token: OWNER_TOKEN, body });
  const source = async (productId) => (await owner('POST', '/sources', { productId, name: `${productId} test source` })).body;
  return { db, store, handle, call, owner, source, path: dir, close: () => db.close() };
}

let n = 0;
/** A valid event; override anything. */
export function event(overrides = {}) {
  n += 1;
  return {
    schema: 'boundry.event/1',
    id: `evt_test_${String(n).padStart(6, '0')}`,
    type: 'product.used',
    occurredAt: new Date().toISOString(),
    product: { id: 'feltdb', version: '0.21.0' },
    ...overrides,
  };
}
