/**
 * Durable storage for Boundry Ecosystem Intelligence, on FeltDB's generic primitives (transactions, `requireAbsent`,
 * `expectedVersion`, equality indexes). FeltDB holds no intelligence-specific code: this module is the only place
 * that knows what the records mean.
 *
 * | Collection                  | One per                          | Written                                                    |
 * |-----------------------------|----------------------------------|------------------------------------------------------------|
 * | `intelligence_events`       | (product, event id)              | once, `requireAbsent`, never rewritten; deleted at retention |
 * | `intelligence_feedback_links` | (feedback id, event)           | with its event, in the same transaction                     |
 * | `intelligence_sources`      | ingestion key                    | on issue; `revokedAt` set under compare-and-set             |
 * | `intelligence_rate_windows` | (source, minute)                 | counter under compare-and-set                               |
 * | `intelligence_access_audit` | owner read or administrative act | once, before the answer is returned                        |
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import { ConditionalConflictError, defineStateContract, field } from '@feltdb/core';
import { digestOf } from '@appport/protocol';

import { attribute, eventDigest, feedbackIdsOf, validateEvent, LIMITS } from './contract.mjs';

export const COLLECTIONS = Object.freeze({
  events: 'intelligence_events',
  links: 'intelligence_feedback_links',
  sources: 'intelligence_sources',
  rate: 'intelligence_rate_windows',
  audit: 'intelligence_access_audit',
});

/* --------------------------------------------------------------------------------------------------------------- */
/* FeltDB application contract                                                                                     */
/* --------------------------------------------------------------------------------------------------------------- */

const declare = (spec) => Object.fromEntries(spec.trim().split(/\s+/).map((entry) => {
  const [name, type] = entry.split(':');
  const options = { required: false, nullable: true };
  return [name, type === 'integer' ? field.integer(options) : type === 'json' ? field.json(options) : type === 'boolean' ? field.boolean(options) : field.string(options)];
}));

/**
 * The FeltDB state contract of the Boundry intelligence application: every collection and field the store writes,
 * with an equality index for every query it makes. Published to its own FeltDB application on the control plane.
 */
export const INTELLIGENCE_CONTRACT = Object.freeze({
  name: 'boundry-intelligence',
  version: 1,
  collections: {
    [COLLECTIONS.events]: {
      fields: declare(`eventId productId productVersion type schema occurredAt day receivedAt sourceId digest event:json
        correlationId feedbackIds:json identity confidence agentId agentStatus principalId principalStatus organizationId
        organizationStatus applicationId capability outcome retentionUntil expiresDay`),
      indexes: [
        { name: 'events_by_day', fields: ['day'] },
        { name: 'events_by_correlation', fields: ['correlationId'] },
        { name: 'events_by_expiry', fields: ['expiresDay'] },
      ],
    },
    [COLLECTIONS.links]: { fields: declare('feedbackId eventKey day'), indexes: [{ name: 'links_by_feedback', fields: ['feedbackId'] }] },
    [COLLECTIONS.sources]: { fields: declare('productId name secretHash createdAt revokedAt'), indexes: [{ name: 'sources_by_product', fields: ['productId'] }] },
    [COLLECTIONS.rate]: { fields: declare('sourceId window count:integer') },
    [COLLECTIONS.audit]: { fields: declare('at day actor action parameters:json resultCount:integer outcome'), indexes: [{ name: 'audit_by_day', fields: ['day'] }] },
  },
});

export const intelligenceStateContract = () => defineStateContract(INTELLIGENCE_CONTRACT);

/* --------------------------------------------------------------------------------------------------------------- */

const PAGE = 1000;
const DAY_MS = 86_400_000;
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const key = (prefix, parts) => `${prefix}_${digestOf(parts).slice('sha256:'.length)}`;
const dayOf = (date) => date.toISOString().slice(0, 10);
const days = (from, to) => {
  const out = [];
  for (let t = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()); t <= to.getTime(); t += DAY_MS) out.push(dayOf(new Date(t)));
  return out;
};

/** Every record of `collection` whose fields equal `where`, through bounded, index-backed queries. */
async function find(db, collection, where, max) {
  const conditions = Object.entries(where).map(([fieldName, eq]) => ({ field: fieldName, eq }));
  const found = [];
  let cursor;
  while (found.length < max) {
    const page = await db.query({ collection, where: conditions, limit: Math.min(PAGE, max - found.length), ...(cursor ? { cursor } : {}) });
    found.push(...page.records.filter((r) => Object.entries(where).every(([k, v]) => r[k] === v)));
    if (page.exhausted || !page.nextCursor || page.records.length === 0) break;
    cursor = page.nextCursor;
  }
  return { records: found.slice(0, max), truncated: found.length >= max };
}

export class IntelligenceStore {
  #db;
  #now;
  #retentionDays;
  #rate;

  /**
   * @param {import('@feltdb/core').StateFirstDB} db  the Boundry intelligence FeltDB application
   * @param {{ retentionDays?: number, rateLimit?: { events: number, windowSeconds: number }, now?: () => Date }} [options]
   */
  constructor(db, options = {}) {
    this.#db = db;
    this.#now = options.now ?? (() => new Date());
    this.#retentionDays = options.retentionDays ?? 400;
    this.#rate = options.rateLimit ?? { events: 1200, windowSeconds: 60 };
    if (!(this.#retentionDays >= 1)) throw new TypeError('retentionDays must be at least 1');
  }

  get retentionDays() {
    return this.#retentionDays;
  }

  /* --------------------------------------------- sources --------------------------------------------- */

  /** Issues an ingestion key bound to one product. The key is returned once and stored only as a SHA-256 hash. */
  async issueSource({ productId, name }) {
    if (typeof productId !== 'string' || !/^[a-z][a-z0-9-]{1,63}$/.test(productId)) throw new TypeError('productId must be a lowercase product id');
    if (typeof name !== 'string' || name.length === 0 || name.length > 200) throw new TypeError('name is required');
    const id = randomBytes(6).toString('hex');
    const secret = randomBytes(32).toString('base64url');
    const keyText = `bik_${id}_${secret}`;
    await this.#db.transaction({ operations: [{ collection: COLLECTIONS.sources, id, requireAbsent: true, value: { id, productId, name, secretHash: sha256(keyText), createdAt: this.#now().toISOString(), revokedAt: null } }] });
    return { id, productId, name, key: keyText };
  }

  async revokeSource(id) {
    const source = await this.#db.collection(COLLECTIONS.sources).get(id);
    if (!source) return false;
    if (source.revokedAt) return true;
    const { __version, ...rest } = source;
    await this.#db.transaction({ operations: [{ collection: COLLECTIONS.sources, id, expectedVersion: __version, value: { ...rest, revokedAt: this.#now().toISOString() } }] });
    return true;
  }

  async listSources() {
    const all = await this.#db.collection(COLLECTIONS.sources).find({});
    return all.map(({ id, productId, name, createdAt, revokedAt }) => ({ id, productId, name, createdAt, revokedAt: revokedAt ?? null }));
  }

  /** The source a presented key belongs to, or null (unknown, malformed, revoked). Compared in constant time. */
  async authenticateSource(presented) {
    const match = typeof presented === 'string' ? /^bik_([0-9a-f]{12})_[A-Za-z0-9_-]{43}$/.exec(presented) : null;
    if (!match) return null;
    const source = await this.#db.collection(COLLECTIONS.sources).get(match[1]);
    if (!source || source.revokedAt) return null;
    const a = Buffer.from(source.secretHash, 'hex');
    const b = Buffer.from(sha256(presented), 'hex');
    return a.length === b.length && timingSafeEqual(a, b) ? { id: source.id, productId: source.productId, name: source.name } : null;
  }

  /**
   * Fixed-window rate limit shared by every function instance (the counter lives in FeltDB). Counts events, not
   * requests. Returns `{ ok: true }` or `{ ok: false, retryAfterSeconds }`.
   */
  async consumeRate(source, count) {
    const windowMs = this.#rate.windowSeconds * 1000;
    const now = this.#now().getTime();
    const window = Math.floor(now / windowMs) * windowMs;
    const id = key('rw', [source.id, window]);
    const counters = this.#db.collection(COLLECTIONS.rate);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = await counters.get(id);
      const used = current?.count ?? 0;
      if (used + count > this.#rate.events) return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((window + windowMs - now) / 1000)) };
      const value = { id, sourceId: source.id, window: String(window), count: used + count };
      try {
        await this.#db.transaction({ operations: [current ? { collection: COLLECTIONS.rate, id, expectedVersion: current.__version, value } : { collection: COLLECTIONS.rate, id, requireAbsent: true, value }] });
        return { ok: true };
      } catch (error) {
        if (!(error instanceof ConditionalConflictError)) throw error;
      }
    }
    return { ok: false, retryAfterSeconds: 1 };
  }

  /* --------------------------------------------- ingestion --------------------------------------------- */

  /**
   * Ingests events from an authenticated source. Each event is answered independently:
   * - `accepted`: validated and durably committed (before this returns);
   * - `duplicate`: the same event (same id and canonical digest) was already stored: idempotent retry;
   * - `conflict`: the id was already used for a different event: nothing written;
   * - `rejected`: invalid, for another product, or already past retention: nothing written, with issues.
   * A storage failure throws: the caller answers 503 and the source retries (idempotently).
   */
  async ingest(source, events) {
    const now = this.#now();
    const results = [];
    for (const [index, event] of events.entries()) {
      const id = typeof event?.id === 'string' ? event.id : null;
      const validated = validateEvent(event, { now });
      if (!validated.ok) {
        results.push({ index, id, status: 'rejected', issues: validated.issues });
        continue;
      }
      if (event.product.id !== source.productId) {
        results.push({ index, id, status: 'rejected', issues: [{ code: 'event.product.forbidden', pointer: '/product/id', message: 'this ingestion key may only report events for its own product' }] });
        continue;
      }
      const occurred = new Date(event.occurredAt);
      const retentionUntil = new Date(Math.min(occurred.getTime(), now.getTime()) + this.#retentionDays * DAY_MS);
      if (retentionUntil.getTime() <= now.getTime()) {
        results.push({ index, id, status: 'rejected', issues: [{ code: 'event.expired', pointer: '/occurredAt', message: `is older than the ${this.#retentionDays}-day retention period` }] });
        continue;
      }
      results.push({ index, id, ...(await this.#store(source, event, now, retentionUntil)) });
    }
    return results;
  }

  async #store(source, event, now, retentionUntil) {
    const recordId = key('ev', [event.product.id, event.id]);
    const digest = eventDigest(event);
    const who = attribute(event);
    const feedbackIds = feedbackIdsOf(event);
    const day = dayOf(new Date(event.occurredAt));
    const record = {
      id: recordId,
      eventId: event.id,
      productId: event.product.id,
      productVersion: event.product.version,
      type: event.type,
      schema: event.schema,
      occurredAt: new Date(event.occurredAt).toISOString(),
      day,
      receivedAt: now.toISOString(),
      sourceId: source.id,
      digest,
      event: JSON.parse(JSON.stringify(event)),
      correlationId: event.context?.correlationId ?? null,
      feedbackIds,
      identity: who.identity,
      confidence: who.confidence,
      agentId: who.agent?.id ?? null,
      agentStatus: who.agent?.status ?? null,
      principalId: who.principal ? `${who.principal.type}:${who.principal.id}` : null,
      principalStatus: who.principal?.status ?? null,
      organizationId: who.organization?.id ?? null,
      organizationStatus: who.organization?.status ?? null,
      applicationId: who.application?.id ?? null,
      capability: event.capability ? `${event.capability.name}${event.capability.version ? `@${event.capability.version}` : ''}` : null,
      outcome: event.outcome?.status ?? null,
      retentionUntil: retentionUntil.toISOString(),
      expiresDay: dayOf(retentionUntil),
    };
    try {
      await this.#db.transaction({
        operations: [
          { collection: COLLECTIONS.events, id: recordId, requireAbsent: true, value: record },
          ...feedbackIds.map((feedbackId) => {
            const id = key('fl', [feedbackId, recordId]);
            return { collection: COLLECTIONS.links, id, requireAbsent: true, value: { id, feedbackId, eventKey: recordId, day } };
          }),
        ],
      });
      return { status: 'accepted' };
    } catch (error) {
      if (!(error instanceof ConditionalConflictError)) throw error;
      const existing = await this.#db.collection(COLLECTIONS.events).get(recordId);
      if (existing?.digest === digest) return { status: 'duplicate' };
      return { status: 'conflict', issues: [{ code: 'event.id.reused', pointer: '/id', message: 'this event id was already used for a different event' }] };
    }
  }

  /* --------------------------------------------- owner queries --------------------------------------------- */

  /**
   * Events in a time range (by `occurredAt`), newest first. Filters: product, type, agent id, application id.
   * The range is at most 92 days; reads are bounded by `limit` (≤ 1000) and report `truncated`.
   */
  async events({ from, to, product, type, agent, application, limit = 100 } = {}) {
    const range = this.#range(from, to, 92);
    const max = Math.max(1, Math.min(Number(limit) || 100, 1000));
    const out = [];
    let truncated = false;
    for (const day of days(range.from, range.to).reverse()) {
      const page = await find(this.#db, COLLECTIONS.events, { day }, 50_000);
      truncated ||= page.truncated;
      for (const r of page.records) {
        const at = Date.parse(r.occurredAt);
        if (at < range.from.getTime() || at > range.to.getTime()) continue;
        if (product && r.productId !== product) continue;
        if (type && r.type !== type) continue;
        if (agent && r.agentId !== agent) continue;
        if (application && r.applicationId !== application) continue;
        out.push(r);
      }
      if (out.length >= max) break;
    }
    out.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0));
    return { from: range.from.toISOString(), to: range.to.toISOString(), events: out.slice(0, max).map(view), truncated: truncated || out.length > max };
  }

  /** Every event sharing a correlation id, in order: one agent's journey across products. */
  async correlation(correlationId) {
    const { records, truncated } = await find(this.#db, COLLECTIONS.events, { correlationId }, 10_000);
    const ordered = records.sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : a.receivedAt < b.receivedAt ? -1 : 1));
    return { correlationId, products: [...new Set(ordered.map((r) => r.productId))], events: ordered.map(view), truncated };
  }

  /**
   * A feedback item's path to resolution: its submission and lifecycle updates, the improvements and releases that
   * name it, and the events of the submitting task (by the submission's correlation id).
   */
  async feedbackJourney(feedbackId) {
    const links = (await find(this.#db, COLLECTIONS.links, { feedbackId }, 10_000)).records;
    const events = (await Promise.all(links.map((l) => this.#db.collection(COLLECTIONS.events).get(l.eventKey)))).filter(Boolean);
    events.sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1));
    const submitted = events.find((e) => e.type === 'feedback.submitted') ?? null;
    const updates = events.filter((e) => e.type === 'feedback.updated');
    const states = updates.map((e) => e.event.data.to);
    const related = submitted?.correlationId ? (await this.correlation(submitted.correlationId)).events.filter((e) => !events.some((x) => x.id === e.key)) : [];
    return {
      feedbackId,
      submitted: submitted ? view(submitted) : null,
      updates: updates.map(view),
      improvements: events.filter((e) => e.type === 'product.improved').map(view),
      releases: events.filter((e) => e.type === 'product.released').map(view),
      state: states.at(-1) ?? (submitted ? 'submitted' : null),
      resolved: states.includes('resolved'),
      task: related,
    };
  }

  /* --------------------------------------------- retention --------------------------------------------- */

  /**
   * Deletes events (and their feedback links) whose retention ended, scanning expiry days from `lookbackDays` ago to
   * today. Run it at least every `lookbackDays` days. Returns how many were deleted.
   */
  async purgeExpired({ lookbackDays = 30 } = {}) {
    const now = this.#now();
    let deleted = 0;
    for (const day of days(new Date(now.getTime() - lookbackDays * DAY_MS), now)) {
      const { records } = await find(this.#db, COLLECTIONS.events, { expiresDay: day }, 50_000);
      for (const record of records) {
        if (Date.parse(record.retentionUntil) > now.getTime()) continue;
        for (const feedbackId of record.feedbackIds ?? []) await this.#db.collection(COLLECTIONS.links).delete(key('fl', [feedbackId, record.id]));
        await this.#db.collection(COLLECTIONS.events).delete(record.id);
        deleted += 1;
      }
    }
    return { deleted, retentionDays: this.#retentionDays };
  }

  /* --------------------------------------------- audit --------------------------------------------- */

  /** Records an owner read or administrative act. Callers write this before answering; a failure fails the request. */
  async audit({ action, parameters = {}, resultCount = null, outcome = 'ok' }) {
    const at = this.#now();
    const id = randomUUID();
    await this.#db.transaction({ operations: [{ collection: COLLECTIONS.audit, id, requireAbsent: true, value: { id, at: at.toISOString(), day: dayOf(at), actor: 'owner', action, parameters: JSON.parse(JSON.stringify(parameters)), resultCount, outcome } }] });
    return id;
  }

  async auditTrail({ day }) {
    return (await find(this.#db, COLLECTIONS.audit, { day }, 10_000)).records.map(({ __version, ...r }) => r);
  }

  /** Events of a range, for metrics: bounded, with `truncated`. */
  async scan({ from, to, product }, max = 100_000) {
    const range = this.#range(from, to, 366);
    const out = [];
    let truncated = false;
    for (const day of days(range.from, range.to)) {
      const page = await find(this.#db, COLLECTIONS.events, { day }, max - out.length);
      truncated ||= page.truncated;
      for (const r of page.records) {
        const at = Date.parse(r.occurredAt);
        if (at >= range.from.getTime() && at <= range.to.getTime() && (!product || r.productId === product)) out.push(r);
      }
      if (out.length >= max) {
        truncated = true;
        break;
      }
    }
    return { from: range.from.toISOString(), to: range.to.toISOString(), records: out, truncated };
  }

  #range(from, to, maxDays) {
    const end = to ? new Date(to) : this.#now();
    const start = from ? new Date(from) : new Date(end.getTime() - 7 * DAY_MS);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) throw new RangeError('from and to must be valid timestamps with from <= to');
    if (end.getTime() - start.getTime() > maxDays * DAY_MS) throw new RangeError(`a range spans at most ${maxDays} days`);
    return { from: start, to: end };
  }
}

/** What the owner API returns for a stored event: the original event and what ingestion derived, never the source key. */
function view(record) {
  return {
    key: record.id,
    receivedAt: record.receivedAt,
    sourceId: record.sourceId,
    digest: record.digest,
    attribution: { identity: record.identity, confidence: record.confidence },
    retentionUntil: record.retentionUntil,
    event: record.event,
  };
}

export { LIMITS };
