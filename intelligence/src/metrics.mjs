/**
 * Metric definitions for Boundry Ecosystem Intelligence. Every metric is computed from stored events only, says what
 * identity it rests on, and is returned with the attribution coverage of the events it was computed from.
 *
 * Rules:
 * - A count of distinct things counts only identities that can be told apart reliably. Authenticated (provider-verified)
 *   identities are counted as `authenticated`; asserted ones are counted separately as `asserted` and are not
 *   deduplicated against the authenticated ones (an agent can assert any id). Anonymous and unknown activity is never
 *   counted as a distinct anything; it appears in `coverage`.
 * - API operations are not tasks. `apiOperations` counts capability invocations; tasks are counted only from
 *   `task.completed` / `task.failed` events that a product reported.
 */

const ACTIVE = new Set(['product.used', 'capability.invoked', 'task.completed', 'task.failed']);

export const METRIC_DEFINITIONS = Object.freeze({
  uniqueOrganizations: 'Distinct actor.organization ids, split by status: authenticated (verified by the reporting product) and asserted. Events without an organization are not counted.',
  uniqueApplications: 'Distinct context.originatingApplication ids (always asserted: an application id is relayed from the agent).',
  distinctAgents: 'Distinct agent ids: authenticated (agent or principal verified) and asserted, counted separately. Anonymous and unknown events are never counted as agents.',
  activeIntegrations: 'Distinct (product, authenticated principal or verified organization, integration mechanism) with at least one product.used, capability.invoked, task.completed or task.failed event in the range. Asserted-only identities are reported separately as assertedIntegrations.',
  productAdoption: 'Per product: distinct authenticated principals and distinct verified organizations with at least one active event in the range, and the number of events by identity class.',
  repeatUsage: 'Authenticated principals with active events on two or more distinct UTC days in the range, and the share of authenticated principals that is.',
  apiOperations: 'Sum of counters.operations (1 when absent) over capability.invoked events, with succeeded and failed counts. Not tasks.',
  completedTasks: 'Count of task.completed events.',
  failedTasks: 'Count of task.failed events.',
  feedbackVolume: 'Count of feedback.submitted events, by category and severity.',
  feedbackResolutionRate: 'Of the feedback ids submitted in the range, the share with a feedback.updated to resolved (at any time stored). Rejected ones are reported separately and are not resolved.',
});

/** Computes every metric over a scan result from IntelligenceStore.scan(). Pure. */
export function computeMetrics(scan, { resolutions = new Map() } = {}) {
  const events = scan.records;
  const identity = { authenticated: 0, asserted: 0, anonymous: 0, unknown: 0 };
  const confidence = { high: 0, medium: 0, low: 0, none: 0 };
  for (const e of events) {
    identity[e.identity] = (identity[e.identity] ?? 0) + 1;
    confidence[e.confidence] = (confidence[e.confidence] ?? 0) + 1;
  }
  const distinct = (pick) => new Set(events.map(pick).filter(Boolean)).size;
  const verifiedPrincipal = (e) => (e.principalStatus === 'verified' ? e.principalId : null);
  const authenticatedAgent = (e) => (e.identity === 'authenticated' ? e.agentId ?? (e.principalStatus === 'verified' ? e.principalId : null) : null);
  const mechanism = (e) => (e.event.context?.integrationMechanism?.status === 'asserted' ? e.event.context.integrationMechanism.value : 'unstated');

  const active = events.filter((e) => ACTIVE.has(e.type));
  const integrations = new Set();
  const assertedIntegrations = new Set();
  for (const e of active) {
    const who = verifiedPrincipal(e) ?? (e.organizationStatus === 'verified' ? `org:${e.organizationId}` : null);
    if (who) integrations.add(`${e.productId}|${who}|${mechanism(e)}`);
    else if (e.identity === 'asserted') assertedIntegrations.add(`${e.productId}|${e.agentId ?? e.principalId}|${mechanism(e)}`);
  }

  const adoption = {};
  for (const e of active) {
    const p = (adoption[e.productId] ??= { principals: new Set(), organizations: new Set(), events: { authenticated: 0, asserted: 0, anonymous: 0, unknown: 0 } });
    if (verifiedPrincipal(e)) p.principals.add(verifiedPrincipal(e));
    if (e.organizationStatus === 'verified') p.organizations.add(e.organizationId);
    p.events[e.identity] += 1;
  }

  const daysByPrincipal = new Map();
  for (const e of active) {
    const id = verifiedPrincipal(e);
    if (id) (daysByPrincipal.get(id) ?? daysByPrincipal.set(id, new Set()).get(id)).add(e.day);
  }
  const repeat = [...daysByPrincipal.values()].filter((d) => d.size >= 2).length;

  const invoked = events.filter((e) => e.type === 'capability.invoked');
  const submitted = events.filter((e) => e.type === 'feedback.submitted');
  const byKey = (list, pick) => list.reduce((acc, e) => ((acc[pick(e)] = (acc[pick(e)] ?? 0) + 1), acc), {});
  const submittedIds = [...new Set(submitted.map((e) => e.event.data.feedbackId))];
  const resolved = submittedIds.filter((id) => resolutions.get(id) === 'resolved').length;
  const rejected = submittedIds.filter((id) => resolutions.get(id) === 'rejected').length;

  const total = events.length;
  return {
    range: { from: scan.from, to: scan.to },
    truncated: scan.truncated,
    events: total,
    coverage: {
      identity,
      confidence,
      attributedShare: total ? (identity.authenticated + identity.asserted) / total : null,
      authenticatedShare: total ? identity.authenticated / total : null,
    },
    uniqueOrganizations: {
      authenticated: new Set(events.filter((e) => e.organizationStatus === 'verified').map((e) => e.organizationId)).size,
      asserted: new Set(events.filter((e) => e.organizationStatus === 'asserted').map((e) => e.organizationId)).size,
    },
    uniqueApplications: { asserted: distinct((e) => e.applicationId) },
    distinctAgents: {
      authenticated: distinct(authenticatedAgent),
      asserted: distinct((e) => (e.identity === 'asserted' ? e.agentId ?? e.principalId : null)),
      anonymousEvents: identity.anonymous,
      unknownEvents: identity.unknown,
    },
    activeIntegrations: { authenticated: integrations.size, asserted: assertedIntegrations.size },
    productAdoption: Object.fromEntries(Object.entries(adoption).map(([product, p]) => [product, { principals: p.principals.size, organizations: p.organizations.size, events: p.events }])),
    repeatUsage: { principals: repeat, share: daysByPrincipal.size ? repeat / daysByPrincipal.size : null },
    apiOperations: {
      operations: invoked.reduce((sum, e) => sum + (e.event.counters?.operations ?? 1), 0),
      succeeded: invoked.filter((e) => e.outcome === 'succeeded').length,
      failed: invoked.filter((e) => e.outcome === 'failed').length,
    },
    completedTasks: events.filter((e) => e.type === 'task.completed').length,
    failedTasks: events.filter((e) => e.type === 'task.failed').length,
    feedbackVolume: { submitted: submitted.length, byCategory: byKey(submitted, (e) => e.event.data.category), bySeverity: byKey(submitted, (e) => e.event.data.severity) },
    feedbackResolutionRate: { submitted: submittedIds.length, resolved, rejected, rate: submittedIds.length ? resolved / submittedIds.length : null },
    definitions: METRIC_DEFINITIONS,
  };
}
