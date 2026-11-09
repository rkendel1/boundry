import assert from 'node:assert/strict';
import test from 'node:test';

import { createEventEmitter } from '../src/emitter.mjs';
import { event, harness } from './support.mjs';

const at = (minutes) => new Date(Date.parse('2026-11-09T10:00:00Z') + minutes * 60_000).toISOString();

/**
 * One agent's journey across products, as each product would report it:
 * discover FeltDB → invoke a capability through AppPort Services → fail → submit feedback → resolution → release →
 * use the corrected API. No prompt or task content anywhere.
 */
test('correlation across products reconstructs one journey, and feedback links to its resolution and release', async () => {
  const h = await harness({ now: () => new Date('2026-11-10T12:00:00Z') });
  try {
    const keys = { feltdb: (await h.source('feltdb')).key, services: (await h.source('appport-services')).key, appport: (await h.source('appport')).key };
    const context = { correlationId: 'task_month_end_0042', taskCategory: { status: 'asserted', value: 'invoice.creation' }, integrationMechanism: { status: 'asserted', value: 'sdk' }, originatingApplication: { status: 'asserted', value: { id: 'com.example.procurement' } } };
    const actor = { principal: { status: 'verified', value: { id: 'svc_procurement', type: 'service' } }, agent: { status: 'asserted', value: { id: 'procurement-agent' } } };
    const services = { id: 'appport-services', version: '0.16.0' };
    const send = async (token, e) => assert.equal((await h.call('POST', '/events', { token, body: e })).body.results[0].status, 'accepted');

    await send(keys.feltdb, event({ occurredAt: at(0), type: 'product.discovered', product: { id: 'feltdb', version: '0.21.0' }, data: { via: 'documentation' }, actor: { agent: actor.agent }, context }));
    await send(keys.services, event({ occurredAt: at(1), type: 'capability.invoked', product: services, capability: { name: 'invoices.create', version: 2 }, outcome: { status: 'failed', errorCode: 'INVALID_INPUT' }, actor, context }));
    await send(keys.services, event({ occurredAt: at(2), type: 'task.failed', product: services, outcome: { status: 'failed', errorCode: 'INVALID_INPUT' }, actor, context }));
    await send(keys.services, event({ occurredAt: at(3), type: 'feedback.submitted', product: services, data: { feedbackId: 'fb_01JC7Q4N00000001', category: 'unexpected_behavior', severity: 'high' }, actor, context }));
    await send(keys.services, event({ occurredAt: at(60), type: 'feedback.updated', product: services, data: { feedbackId: 'fb_01JC7Q4N00000001', from: 'submitted', to: 'acknowledged', sequence: 1 } }));
    await send(keys.appport, event({ occurredAt: at(200), type: 'product.improved', product: { id: 'appport', version: '1.5.0' }, data: { change: 'invoices.create@2 accepts ISO 8601 dueDate', feedbackIds: ['fb_01JC7Q4N00000001'] } }));
    await send(keys.services, event({ occurredAt: at(300), type: 'product.released', product: { id: 'appport-services', version: '0.16.1' }, data: { version: '0.16.1', previousVersion: '0.16.0', breaking: false, feedbackIds: ['fb_01JC7Q4N00000001'] } }));
    await send(keys.services, event({ occurredAt: at(301), type: 'feedback.updated', product: services, data: { feedbackId: 'fb_01JC7Q4N00000001', from: 'released', to: 'resolved', sequence: 8 } }));
    await send(keys.services, event({ occurredAt: at(400), type: 'capability.invoked', product: { id: 'appport-services', version: '0.16.1' }, capability: { name: 'invoices.create', version: 2 }, outcome: { status: 'succeeded' }, actor, context }));
    await send(keys.services, event({ occurredAt: at(401), type: 'task.completed', product: { id: 'appport-services', version: '0.16.1' }, outcome: { status: 'succeeded' }, actor, context }));

    const journey = (await h.owner('GET', '/correlations/task_month_end_0042')).body;
    assert.deepEqual(journey.products, ['feltdb', 'appport-services']);
    assert.deepEqual(journey.events.map((e) => e.event.type), ['product.discovered', 'capability.invoked', 'task.failed', 'feedback.submitted', 'capability.invoked', 'task.completed']);

    const feedback = (await h.owner('GET', '/feedback/fb_01JC7Q4N00000001')).body;
    assert.equal(feedback.state, 'resolved');
    assert.equal(feedback.resolved, true);
    assert.deepEqual(feedback.updates.map((u) => u.event.data.to), ['acknowledged', 'resolved']);
    assert.deepEqual(feedback.improvements.map((e) => e.event.product.id), ['appport']);
    assert.deepEqual(feedback.releases.map((e) => e.event.data.version), ['0.16.1']);
    assert.deepEqual(feedback.task.map((e) => e.event.type), ['product.discovered', 'capability.invoked', 'task.failed', 'capability.invoked', 'task.completed'], 'the submitting task, by correlation id');

    const metrics = (await h.owner('GET', `/metrics?from=${at(-1)}&to=${at(500)}`)).body;
    assert.deepEqual(metrics.apiOperations, { operations: 2, succeeded: 1, failed: 1 });
    assert.deepEqual([metrics.completedTasks, metrics.failedTasks], [1, 1], 'API calls are not tasks');
    assert.deepEqual(metrics.feedbackResolutionRate, { submitted: 1, resolved: 1, rejected: 0, rate: 1 });
    assert.deepEqual(metrics.distinctAgents.authenticated, 1);
    assert.deepEqual(metrics.uniqueApplications, { asserted: 1 });
    assert.equal(metrics.productAdoption['appport-services'].principals, 1);
  } finally {
    await h.close();
  }
});

test('missing, withheld, anonymous and asserted identities are counted honestly, with coverage', async () => {
  const h = await harness();
  try {
    const { key } = await h.source('feltdb');
    const events = [
      event({ actor: { principal: { status: 'verified', value: { id: 'u1', type: 'user' } }, organization: { status: 'verified', value: { id: 'org_acme' } } } }),
      event({ actor: { principal: { status: 'verified', value: { id: 'u1', type: 'user' } } } }),
      event({ actor: { agent: { status: 'asserted', value: { id: 'agent-x' } } } }),
      event({ actor: { agent: { status: 'asserted', value: { id: 'agent-x' } }, organization: { status: 'asserted', value: { id: 'org_claimed' } } } }),
      event({ actor: { anonymous: true } }),
      event({ actor: { agent: { status: 'withheld' }, principal: { status: 'unavailable' } } }),
      event({ context: { originatingApplication: { status: 'withheld' } } }),
    ];
    assert.equal((await h.call('POST', '/events', { token: key, body: { events } })).body.accepted, 7);
    const m = (await h.owner('GET', '/metrics')).body;
    assert.deepEqual(m.coverage.identity, { authenticated: 2, asserted: 2, anonymous: 1, unknown: 2 });
    assert.deepEqual(m.coverage.confidence, { high: 2, medium: 0, low: 2, none: 3 });
    assert.deepEqual(m.distinctAgents, { authenticated: 1, asserted: 1, anonymousEvents: 1, unknownEvents: 2 });
    assert.deepEqual(m.uniqueOrganizations, { authenticated: 1, asserted: 1 }, 'an asserted organization is never counted as a verified one');
    assert.deepEqual(m.uniqueApplications, { asserted: 0 }, 'withheld applications are not counted');
    assert.deepEqual(m.activeIntegrations, { authenticated: 1, asserted: 1 });
    // The withheld status itself is preserved in the stored event.
    const stored = (await h.owner('GET', '/events?limit=10')).body.events.find((e) => e.event.context?.originatingApplication);
    assert.deepEqual(stored.event.context.originatingApplication, { status: 'withheld' });
    assert.ok(m.definitions.distinctAgents.includes('never counted'));
  } finally {
    await h.close();
  }
});

test('retention and queries: expired events are refused and purged; range, product and type filters apply', async () => {
  let now = new Date('2026-11-09T12:00:00Z');
  const h = await harness({ now: () => now, retentionDays: 30 });
  try {
    const feltdb = await h.source('feltdb');
    const appport = await h.source('appport');
    const old = await h.call('POST', '/events', { token: feltdb.key, body: event({ occurredAt: '2026-09-01T00:00:00Z' }) });
    assert.equal(old.body.results[0].issues[0].code, 'event.expired');
    await h.call('POST', '/events', { token: feltdb.key, body: { events: [event({ occurredAt: '2026-11-01T09:00:00Z' }), event({ occurredAt: '2026-11-08T09:00:00Z', type: 'product.discovered', data: { via: 'registry' } })] } });
    await h.call('POST', '/events', { token: appport.key, body: event({ occurredAt: '2026-11-08T10:00:00Z', product: { id: 'appport', version: '1.5.0' } }) });

    const week = await h.owner('GET', '/events?from=2026-11-05T00:00:00Z&to=2026-11-09T12:00:00Z');
    assert.equal(week.body.events.length, 2);
    assert.deepEqual(week.body.events.map((e) => e.event.occurredAt), ['2026-11-08T10:00:00Z', '2026-11-08T09:00:00Z'], 'newest first');
    assert.equal((await h.owner('GET', '/events?from=2026-10-25T00:00:00Z&to=2026-11-09T12:00:00Z&product=feltdb')).body.events.length, 2);
    assert.equal((await h.owner('GET', '/events?from=2026-10-25T00:00:00Z&to=2026-11-09T12:00:00Z&type=product.discovered')).body.events.length, 1);
    assert.equal((await h.owner('GET', '/events?from=2026-01-01T00:00:00Z&to=2026-11-09T00:00:00Z')).status, 400, 'ranges are bounded');

    // 31 days after 2026-11-01 the first event's retention has ended; the others remain.
    now = new Date('2026-12-02T12:00:00Z');
    const purged = await h.owner('POST', '/retention/purge');
    assert.deepEqual(purged.body, { deleted: 1, retentionDays: 30 });
    assert.equal((await h.owner('GET', '/events?from=2026-10-25T00:00:00Z&to=2026-12-02T00:00:00Z')).body.events.length, 2);
  } finally {
    await h.close();
  }
});

test('ingestion outage: product workflows never fail or wait; events are delivered once ingestion returns', async () => {
  const h = await harness();
  try {
    const { key } = await h.source('appport-services');
    let available = false;
    let calls = 0;
    const fetch = async (url, init) => {
      calls += 1;
      if (!available) throw new TypeError('fetch failed: ECONNREFUSED');
      return h.handle(new Request(url, init));
    };
    const emitter = createEventEmitter({ endpoint: 'https://boundry.company/api/intelligence/v1/events', key, fetch, flushIntervalMs: 60_000, maxBackoffMs: 1 });

    // A product request handler: does its work, reports an event, answers. Ingestion is down.
    const handleProductRequest = (n) => {
      const reported = emitter.emit(event({ product: { id: 'appport-services', version: '0.16.0' }, context: { correlationId: 'corr_outage_0001' }, data: { operation: `op-${n}` } }));
      return { ok: true, reported };
    };
    const started = performance.now();
    for (let i = 0; i < 20; i += 1) assert.deepEqual(handleProductRequest(i), { ok: true, reported: true });
    assert.ok(performance.now() - started < 200, 'emit never waits on the network');
    await emitter.flush();
    assert.equal(emitter.stats().pending, 20, 'nothing lost while ingestion is down');
    assert.ok(emitter.stats().failedAttempts >= 1);
    assert.equal(emitter.emit({ not: 'an event' }), false, 'an invalid event is dropped locally, not thrown');

    available = true;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await emitter.flush();
    assert.equal(emitter.stats().pending, 0);
    assert.equal(emitter.stats().accepted, 20);
    assert.equal((await h.owner('GET', '/correlations/corr_outage_0001')).body.events.length, 20);
    await emitter.close();
    assert.ok(calls >= 2);
  } finally {
    await h.close();
  }
});

test('the emitter bounds memory and resends safely after an uncertain delivery', async () => {
  const h = await harness();
  try {
    const { key } = await h.source('feltdb');
    const small = createEventEmitter({ endpoint: 'https://x.invalid/', key, fetch: async () => { throw new Error('down'); }, maxQueue: 5, flushIntervalMs: 60_000 });
    for (let i = 0; i < 12; i += 1) small.emit(event());
    assert.deepEqual([small.stats().pending, small.stats().dropped], [5, 7], 'oldest dropped, counted');
    await small.close();

    // The server committed the batch but the answer was lost: the resend is acknowledged as duplicates.
    let lose = true;
    const flaky = createEventEmitter({
      endpoint: 'https://boundry.company/api/intelligence/v1/events', key, flushIntervalMs: 60_000, maxBackoffMs: 1,
      fetch: async (url, init) => {
        const response = await h.handle(new Request(url, init));
        if (lose) { lose = false; throw new Error('connection reset after commit'); }
        return response;
      },
    });
    for (let i = 0; i < 3; i += 1) flaky.emit(event({ context: { correlationId: 'corr_uncertain_01' } }));
    await flaky.flush();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await flaky.flush();
    assert.deepEqual([flaky.stats().duplicate, flaky.stats().accepted, flaky.stats().pending], [3, 0, 0]);
    assert.equal((await h.owner('GET', '/correlations/corr_uncertain_01')).body.events.length, 3, 'stored once each');
    await flaky.close();
  } finally {
    await h.close();
  }
});
