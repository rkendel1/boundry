import assert from 'node:assert/strict';
import test from 'node:test';

import { validateFeedbackReport } from '@appport/protocol';

import { attribute, EVENT_TYPES, validateEvent } from '../src/contract.mjs';
import { event } from './support.mjs';

const codes = (result) => (result.ok ? [] : result.issues.map((i) => i.code));

const VALID = {
  'product.discovered': { data: { via: 'manifest' } },
  'product.used': { data: { operation: 'collections.list' } },
  'capability.invoked': { capability: { name: 'invoices.create', version: 2 }, outcome: { status: 'succeeded' }, counters: { operations: 3, durationMs: 41 } },
  'task.completed': { outcome: { status: 'succeeded' }, data: { taskId: 'task_0001' } },
  'task.failed': { outcome: { status: 'failed', errorCode: 'INVALID_INPUT' } },
  'feedback.submitted': { data: { feedbackId: 'fb_00000001', category: 'unexpected_behavior', severity: 'high' } },
  'feedback.updated': { data: { feedbackId: 'fb_00000001', from: 'released', to: 'resolved', sequence: 8 } },
  'product.improved': { data: { change: 'invoices.create@2 accepts ISO 8601 dueDate', feedbackIds: ['fb_00000001'] } },
  'product.released': { data: { version: '3.2.1', previousVersion: '3.2.0', breaking: false, feedbackIds: ['fb_00000001'] } },
};

test('every event type has a valid form', () => {
  assert.deepEqual(Object.keys(VALID).sort(), [...EVENT_TYPES].sort());
  for (const type of EVENT_TYPES) assert.deepEqual(codes(validateEvent(event({ type, ...VALID[type] }))), [], type);
});

test('the contract is closed and type-specific', () => {
  assert.ok(codes(validateEvent(event({ prompt: 'You are a helpful agent' }))).includes('event.field.unknown'));
  assert.ok(codes(validateEvent(event({ data: { operation: 'x', taskContent: 'reconcile ACME invoices' } }))).includes('event.field.unknown'));
  assert.ok(codes(validateEvent(event({ type: 'capability.invoked' }))).includes('event.field.required'));
  assert.ok(codes(validateEvent(event({ type: 'task.completed', outcome: { status: 'failed' } }))).includes('event.outcome.mismatch'));
  assert.ok(codes(validateEvent(event({ type: 'capability.invoked', ...VALID['capability.invoked'], data: {} }))).includes('event.field.unknown'));
  assert.ok(codes(validateEvent(event({ type: 'usage.logged' }))).includes('event.enum.invalid'));
  assert.ok(codes(validateEvent(event({ product: { id: 'FeltDB', version: '1' } }))).includes('event.product.invalid'));
  assert.ok(codes(validateEvent(event({ counters: { operations: -1 } }))).includes('event.integer.invalid'));
  assert.ok(codes(validateEvent(event({ id: 'short' }))).includes('event.identifier.invalid'));
});

test('schema versions: an unknown version is refused distinctly from a malformed one', () => {
  assert.deepEqual(codes(validateEvent(event({ schema: 'boundry.event/2' }))), ['event.schema.unsupported']);
  assert.deepEqual(codes(validateEvent(event({ schema: 'telemetry' }))), ['event.schema.invalid']);
  assert.deepEqual(codes(validateEvent(event({ schema: undefined }))), ['event.schema.required']);
});

test('timestamps: future events beyond the skew window are refused', () => {
  const now = new Date('2026-11-09T12:00:00Z');
  assert.deepEqual(codes(validateEvent(event({ occurredAt: '2026-11-09T12:04:00Z' }), { now })), []);
  assert.deepEqual(codes(validateEvent(event({ occurredAt: '2026-11-09T12:06:00Z' }), { now })), ['event.occurred-at.future']);
});

test('credentials are refused anywhere, without echoing them', () => {
  const secret = 'Bearer abcdefghijklmnopqrstuvwxyz012345';
  const result = validateEvent(event({ type: 'product.used', data: { operation: secret } }));
  assert.deepEqual(codes(result), ['event.sensitive-content']);
  assert.ok(!JSON.stringify(result).includes(secret));
});

test('provenance: relayed context cannot be verified; actor identity may be verified by the reporting product', () => {
  assert.ok(codes(validateEvent(event({ context: { runtime: { status: 'verified', value: { name: 'node' } } } }))).includes('event.provenance.verified'));
  assert.deepEqual(codes(validateEvent(event({ actor: { principal: { status: 'verified', value: { id: 'svc_procurement', type: 'service' } } } }))), []);
  assert.ok(codes(validateEvent(event({ context: { taskCategory: { status: 'asserted', value: 'Reconcile the Q3 invoices for ACME' } } }))).includes('event.task-category.invalid'));
  assert.ok(codes(validateEvent(event({ context: { parentAgent: { status: 'withheld', value: { id: 'p' } } } }))).includes('event.field.unknown'));
  assert.ok(codes(validateEvent(event({ actor: { anonymous: true, agent: { status: 'asserted', value: { id: 'a1' } } } }))).includes('event.actor.anonymous-identified'));
  assert.deepEqual(codes(validateEvent(event({ actor: { anonymous: true, agent: { status: 'withheld' } } }))), []);
});

test('the event context is exactly appport.feedback/1 context: Core agrees on every case', () => {
  const report = (context) => ({
    protocol: 'appport.feedback/1', type: 'report', submissionId: 'sub_00000001', submittedAt: new Date().toISOString(),
    target: { product: { id: 'com.example.app' }, api: { version: '1.0.0' } }, category: 'api_friction', severity: 'low',
    summary: 's', expected: 'e', observed: 'o', reporter: { agent: { id: 'a' } }, context,
  });
  const cases = [
    { correlationId: 'task_month_end_0042' },
    { runtime: { status: 'asserted', value: { name: 'node', version: '22' } } },
    { runtime: { status: 'unavailable' } },
    { originatingApplication: { status: 'withheld' } },
    { parentAgent: { status: 'asserted', value: { id: 'planner-7' } } },
    { taskCategory: { status: 'asserted', value: 'invoice.reconciliation' } },
    { integrationMechanism: { status: 'asserted', value: 'mcp' } },
    { runtime: { status: 'verified', value: { name: 'node' } } },
    { runtime: { status: 'asserted' } },
    { parentAgent: { status: 'withheld', value: { id: 'p' } } },
    { taskCategory: { status: 'asserted', value: 'Reconcile ACME' } },
    { integrationMechanism: { status: 'asserted', value: 'carrier-pigeon' } },
    { correlationId: 'short' },
    { mood: { status: 'asserted', value: 'x' } },
  ];
  for (const context of cases) {
    const core = validateFeedbackReport(report(context)).ok;
    const ours = validateEvent(event({ context })).ok;
    assert.equal(ours, core, JSON.stringify(context));
  }
});

test('attribution is derived, never accepted, and follows the published table', () => {
  const at = (actor, context) => attribute(event({ ...(actor ? { actor } : {}), ...(context ? { context } : {}) }));
  assert.deepEqual([at({ principal: { status: 'verified', value: { id: 'u1', type: 'user' } } }).identity, at({ principal: { status: 'verified', value: { id: 'u1', type: 'user' } } }).confidence], ['authenticated', 'high']);
  assert.deepEqual([at({ agent: { status: 'asserted', value: { id: 'a1' } } }, { correlationId: 'task_00000001' }).identity, at({ agent: { status: 'asserted', value: { id: 'a1' } } }, { correlationId: 'task_00000001' }).confidence], ['asserted', 'medium']);
  assert.equal(at({ agent: { status: 'asserted', value: { id: 'a1' } } }).confidence, 'low');
  assert.deepEqual([at({ anonymous: true }).identity, at({ anonymous: true }).confidence], ['anonymous', 'none']);
  assert.deepEqual([at({ agent: { status: 'withheld' } }).identity, at().identity], ['unknown', 'unknown']);
  assert.ok(codes(validateEvent(event({ attribution: { identity: 'authenticated' } }))).includes('event.field.unknown'));
});
