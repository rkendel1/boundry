/** The published schema and the reference validator agree on valid events and on every refusal the schema can express. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { fromJSONSchema } from '@appport/schema';

import { EVENT_TYPES, validateEvent } from '../src/contract.mjs';
import { event } from './support.mjs';

const root = JSON.parse(readFileSync(new URL('../schema/boundry-event-1.schema.json', import.meta.url), 'utf8'));
const schemaFor = (name) => fromJSONSchema(root.$defs[name], root);
const both = (value) => ({ schema: schemaFor('event').validate(JSON.parse(JSON.stringify(value))).ok, reference: validateEvent(value).ok });

const VALID = {
  'product.discovered': { data: { via: 'manifest' } },
  'product.used': {},
  'capability.invoked': { capability: { name: 'invoices.create', version: 2 }, outcome: { status: 'succeeded' } },
  'task.completed': { outcome: { status: 'succeeded' } },
  'task.failed': { outcome: { status: 'failed' } },
  'feedback.submitted': { data: { feedbackId: 'fb_00000001', category: 'api_friction', severity: 'low' } },
  'feedback.updated': { data: { feedbackId: 'fb_00000001', from: 'submitted', to: 'acknowledged', sequence: 1 } },
  'product.improved': { data: { change: 'documented the amount unit' } },
  'product.released': { data: { version: '1.0.1', breaking: false } },
};

test('the schema accepts what the reference accepts, for every type, with full provenance', () => {
  for (const type of EVENT_TYPES) {
    const e = event({
      type,
      ...VALID[type],
      actor: { principal: { status: 'verified', value: { id: 'svc_a', type: 'service' } }, agent: { status: 'asserted', value: { id: 'agent-a' } }, organization: { status: 'withheld' } },
      context: { correlationId: 'task_00000001', runtime: { status: 'unavailable' }, taskCategory: { status: 'asserted', value: 'invoice.creation' }, integrationMechanism: { status: 'asserted', value: 'mcp' } },
      counters: { durationMs: 12 },
    });
    assert.deepEqual(both(e), { schema: true, reference: true }, type);
  }
  assert.equal(schemaFor('batch').validate({ events: [event()] }).ok, true);
});

const refused = [
  ['an unknown member (a prompt)', event({ prompt: 'x' })],
  ['an unsupported schema version', event({ schema: 'boundry.event/2' })],
  ['an unknown type', event({ type: 'usage.logged' })],
  ['capability.invoked without capability', event({ type: 'capability.invoked', outcome: { status: 'succeeded' } })],
  ['task.completed that failed', event({ type: 'task.completed', outcome: { status: 'failed' } })],
  ['relayed provenance marked verified', event({ context: { runtime: { status: 'verified', value: { name: 'node' } } } })],
  ['a withheld attribute with a value', event({ actor: { agent: { status: 'withheld', value: { id: 'a' } } } })],
  ['a free-text task category', event({ context: { taskCategory: { status: 'asserted', value: 'Reconcile ACME' } } })],
  ['data on capability.invoked', event({ type: 'capability.invoked', capability: { name: 'x.y' }, outcome: { status: 'succeeded' }, data: { anything: 1 } })],
  ['feedback.submitted with an unknown category', event({ type: 'feedback.submitted', data: { feedbackId: 'fb_00000001', category: 'bug', severity: 'low' } })],
  ['a negative counter', event({ counters: { operations: -1 } })],
];
for (const [title, value] of refused) {
  test(`both refuse ${title}`, () => assert.deepEqual(both(value), { schema: false, reference: false }));
}
