/** The Vercel adapter: fails closed without configuration, and rebuilds the public path behind the rewrite. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { GET, POST, publicRequest } from '../../api/intelligence.mjs';

test('without configuration every route answers 503 and nothing falls back to local storage', async () => {
  for (const name of ['BOUNDRY_INTELLIGENCE_FELTDB_URL', 'BOUNDRY_INTELLIGENCE_FELTDB_TOKEN', 'BOUNDRY_INTELLIGENCE_FELTDB_APPLICATION_ID', 'BOUNDRY_OWNER_TOKEN_SHA256']) delete process.env[name];
  const post = await POST(new Request('https://boundry.company/api/intelligence?__path=events', { method: 'POST', body: '{}' }));
  const get = await GET(new Request('https://boundry.company/api/intelligence/v1/health/'));
  assert.deepEqual([post.status, get.status], [503, 503]);
  assert.equal((await post.json()).error.code, 'UNAVAILABLE');
});

test('the rewritten and the original URL reach the same route, with and without a trailing slash', () => {
  const paths = [
    'https://boundry.company/api/intelligence?__path=events',
    'https://boundry.company/api/intelligence?__path=correlations/task_00000001&x=1',
    'https://boundry.company/api/intelligence/v1/events/',
    'https://boundry.company/api/intelligence/v1/events/?__path=events/',
  ];
  assert.deepEqual(paths.map((p) => new URL(publicRequest(new Request(p)).url).pathname), [
    '/api/intelligence/v1/events',
    '/api/intelligence/v1/correlations/task_00000001',
    '/api/intelligence/v1/events/',
    '/api/intelligence/v1/events/',
  ]);
  assert.equal(new URL(publicRequest(new Request(paths[1])).url).searchParams.get('x'), '1');
});

test('configuration: the handler is built against the FeltDB authority from the environment, and refuses a malformed owner hash', async () => {
  const { createConfiguredHandler } = await import('../src/configure.mjs');
  const { openDb, OWNER_SHA256 } = await import('./support.mjs');
  const env = { BOUNDRY_INTELLIGENCE_FELTDB_URL: 'https://feltdb.example', BOUNDRY_INTELLIGENCE_FELTDB_TOKEN: 'fdb_test', BOUNDRY_INTELLIGENCE_FELTDB_APPLICATION_ID: 'app_1', BOUNDRY_OWNER_TOKEN_SHA256: OWNER_SHA256 };
  assert.equal(createConfiguredHandler({ ...env, BOUNDRY_OWNER_TOKEN_SHA256: 'not-a-hash' }), null);
  const { db } = await openDb();
  let options;
  const handle = createConfiguredHandler(env, { createDb: (o) => { options = o; return db; } });
  assert.deepEqual(options, { server: { url: 'https://feltdb.example', token: 'fdb_test', applicationId: 'app_1' } });
  assert.equal((await handle(new Request('https://boundry.company/api/intelligence/v1/health/'))).status, 200);
  await db.close();
});
