import assert from 'node:assert/strict';
import test from 'node:test';

import { IntelligenceStore, createHandler } from '../src/index.mjs';
import { BASE, event, harness, OWNER_SHA256 } from './support.mjs';

const invoked = (overrides = {}) => event({ type: 'capability.invoked', capability: { name: 'collections.query', version: 1 }, outcome: { status: 'succeeded' }, ...overrides });

test('valid ingestion: acknowledged after commit, original event and provenance preserved exactly', async () => {
  const h = await harness();
  try {
    const { key } = await h.source('feltdb');
    const sent = invoked({
      actor: { principal: { status: 'verified', value: { id: 'svc_procurement', type: 'service' } }, agent: { status: 'asserted', value: { id: 'procurement-agent', version: '4.1.0' } } },
      context: { correlationId: 'task_month_end_0042', originatingApplication: { status: 'withheld' }, parentAgent: { status: 'unavailable' }, taskCategory: { status: 'asserted', value: 'invoice.creation' }, integrationMechanism: { status: 'asserted', value: 'sdk' } },
      counters: { operations: 2, durationMs: 18 },
    });
    const ack = await h.call('POST', '/events', { token: key, body: sent });
    assert.equal(ack.status, 200);
    assert.deepEqual({ schema: ack.body.schema, accepted: ack.body.accepted, result: ack.body.results[0] }, { schema: 'boundry.ingest-ack/1', accepted: 1, result: { index: 0, id: sent.id, status: 'accepted' } });
    const found = await h.owner('GET', `/correlations/task_month_end_0042`);
    assert.equal(found.status, 200);
    const stored = found.body.events[0];
    assert.deepEqual(stored.event, sent, 'the original event, byte for byte in content');
    assert.deepEqual(stored.attribution, { identity: 'authenticated', confidence: 'high' });
    assert.ok(Date.parse(stored.receivedAt) >= Date.parse(sent.occurredAt) - 1000);
    assert.match(stored.digest, /^sha256:[0-9a-f]{64}$/);
  } finally {
    await h.close();
  }
});

test('invalid events are rejected individually with machine-readable issues; valid ones in the batch are kept', async () => {
  const h = await harness();
  try {
    const { key } = await h.source('feltdb');
    const ack = await h.call('POST', '/events', { token: key, body: { events: [event(), event({ schema: 'boundry.event/2' }), event({ type: 'task.completed' }), event({ prompt: 'secret instructions' })] } });
    assert.equal(ack.status, 200);
    assert.deepEqual(ack.body.results.map((r) => r.status), ['accepted', 'rejected', 'rejected', 'rejected']);
    assert.deepEqual(ack.body.results[1].issues.map((i) => i.code), ['event.schema.unsupported']);
    assert.equal(ack.body.results[3].issues[0].code, 'event.field.unknown');
    assert.equal((await h.call('POST', '/events', { token: key, body: '{not json' })).status, 400);
    assert.equal((await h.call('POST', '/events', { token: key, body: { events: [] } })).status, 400);
  } finally {
    await h.close();
  }
});

test('idempotent retries: the same event is a duplicate and is stored once', async () => {
  const h = await harness();
  try {
    const { key } = await h.source('feltdb');
    const e = event({ context: { correlationId: 'corr_idempotent_01' } });
    assert.equal((await h.call('POST', '/events', { token: key, body: e })).body.results[0].status, 'accepted');
    const again = await h.call('POST', '/events', { token: key, body: { events: [e, structuredClone(e)] } });
    assert.deepEqual(again.body.results.map((r) => r.status), ['duplicate', 'duplicate']);
    assert.equal((await h.owner('GET', '/correlations/corr_idempotent_01')).body.events.length, 1);
  } finally {
    await h.close();
  }
});

test('a reused event id with different content is a conflict and changes nothing', async () => {
  const h = await harness();
  try {
    const { key } = await h.source('feltdb');
    const e = event({ context: { correlationId: 'corr_conflict_001' } });
    await h.call('POST', '/events', { token: key, body: e });
    const conflict = await h.call('POST', '/events', { token: key, body: { ...e, data: { operation: 'something else' } } });
    assert.deepEqual([conflict.body.results[0].status, conflict.body.results[0].issues[0].code], ['conflict', 'event.id.reused']);
    assert.deepEqual((await h.owner('GET', '/correlations/corr_conflict_001')).body.events[0].event, e);
    // The same id from another product is a different event, not a conflict.
    const appport = await h.source('appport');
    assert.equal((await h.call('POST', '/events', { token: appport.key, body: { ...e, product: { id: 'appport', version: '1.5.0' } } })).body.results[0].status, 'accepted');
  } finally {
    await h.close();
  }
});

test('batches: up to 100 events in one request; more, or an oversized body, is refused before anything is stored', async () => {
  const h = await harness();
  try {
    const { key } = await h.source('feltdb');
    const hundred = Array.from({ length: 100 }, () => event());
    const ok = await h.call('POST', '/events', { token: key, body: { events: hundred } });
    assert.equal(ok.body.accepted, 100);
    assert.equal((await h.call('POST', '/events', { token: key, body: { events: Array.from({ length: 101 }, () => event()) } })).status, 400);
    const huge = await h.call('POST', '/events', { token: key, body: { events: [event({ data: { operation: 'x'.repeat(1_100_000) } })] } });
    assert.equal(huge.status, 413);
  } finally {
    await h.close();
  }
});

test('durable writes: everything acknowledged survives a restart, and idempotency still holds after it', async () => {
  const first = await harness();
  const { key } = await first.source('appport-services');
  const e = event({ product: { id: 'appport-services', version: '0.16.0' }, context: { correlationId: 'corr_restart_0001' } });
  assert.equal((await first.call('POST', '/events', { token: key, body: e })).body.accepted, 1);
  await first.close();

  const second = await harness({ path: first.path });
  try {
    assert.deepEqual((await second.owner('GET', '/correlations/corr_restart_0001')).body.events.map((x) => x.event), [e]);
    assert.equal((await second.call('POST', '/events', { token: key, body: e })).body.results[0].status, 'duplicate', 'the key and the event survived the restart');
  } finally {
    await second.close();
  }
});

test('isolation: a source reports only its own product, cannot read, and revoked or forged keys are refused', async () => {
  const h = await harness();
  try {
    const feltdb = await h.source('feltdb');
    const impersonation = await h.call('POST', '/events', { token: feltdb.key, body: event({ product: { id: 'appboundry', version: '1.0.0' } }) });
    assert.deepEqual([impersonation.body.results[0].status, impersonation.body.results[0].issues[0].code], ['rejected', 'event.product.forbidden']);
    assert.equal((await h.call('GET', '/events', { token: feltdb.key })).status, 403, 'an ingestion key is not an owner credential');
    assert.equal((await h.call('POST', '/events', { body: event() })).status, 401);
    assert.equal((await h.call('POST', '/events', { token: `${feltdb.key.slice(0, -2)}xx`, body: event() })).status, 401);
    await h.owner('POST', `/sources/${feltdb.id}/revoke`);
    assert.equal((await h.call('POST', '/events', { token: feltdb.key, body: event() })).status, 401);
    const listed = (await h.owner('GET', '/sources')).body.sources;
    assert.ok(listed.every((s) => !('secretHash' in s) && !('key' in s)), 'keys are never listed');
  } finally {
    await h.close();
  }
});

test('owner authorization: only the owner token reads; every read is audited, and an unauditable read is refused', async () => {
  const h = await harness();
  try {
    assert.equal((await h.call('GET', '/events')).status, 401);
    assert.equal((await h.call('GET', '/events', { token: 'not-the-owner' })).status, 403);
    assert.equal((await h.owner('GET', '/events')).status, 200);
    assert.equal((await h.owner('GET', '/metrics')).status, 200);
    const today = new Date().toISOString().slice(0, 10);
    const trail = await h.store.auditTrail({ day: today });
    assert.deepEqual(trail.map((a) => a.action).sort(), ['events.query', 'metrics.read']);
    assert.ok(trail.every((a) => a.actor === 'owner' && typeof a.at === 'string'));

    // The real store, except that the audit write fails. The query itself must have run.
    let queried = 0;
    const failing = new Proxy(h.store, {
      get(target, name) {
        if (name === 'audit') return async () => { throw new Error('audit store down'); };
        if (name === 'events') return async (...args) => { queried += 1; return target.events(...args); };
        const value = target[name];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const handle = createHandler({ store: failing, ownerTokenSha256: OWNER_SHA256 });
    const response = await handle(new Request(`${BASE}/events`, { headers: { authorization: 'Bearer owner-token-for-tests-only-0123456789' } }));
    assert.equal(queried, 1, 'the query ran; only its audit record failed');
    assert.equal(response.status, 503);
    assert.ok(!('events' in (await response.json())), 'no data without an audit record');
  } finally {
    await h.close();
  }
});

test('rate limits are shared by every function instance and answer 429 with a retry hint', async () => {
  const h = await harness({ rateLimit: { events: 5, windowSeconds: 60 } });
  try {
    const { key } = await h.source('feltdb');
    const other = createHandler({ store: new IntelligenceStore(h.db, { rateLimit: { events: 5, windowSeconds: 60 } }), ownerTokenSha256: OWNER_SHA256 });
    assert.equal((await h.call('POST', '/events', { token: key, body: { events: [event(), event(), event()] } })).status, 200);
    const second = await other(new Request(`${BASE}/events`, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: JSON.stringify({ events: [event(), event(), event()] }) }));
    assert.equal(second.status, 429);
    const body = await second.json();
    assert.equal(body.error.code, 'RATE_LIMITED');
    assert.ok(body.error.details.retryAfterSeconds >= 1);
  } finally {
    await h.close();
  }
});
