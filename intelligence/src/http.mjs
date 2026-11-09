/**
 * The Boundry intelligence HTTP API, as one Web-standard handler: `handle(request) -> Response`. The Vercel function
 * in `api/intelligence.mjs` is a thin adapter around it; tests call it directly.
 *
 *   POST /api/intelligence/v1/events                 ingestion (source key)
 *   GET  /api/intelligence/v1/events                 time-range query (owner)
 *   GET  /api/intelligence/v1/correlations/{id}      one journey across products (owner)
 *   GET  /api/intelligence/v1/feedback/{id}          feedback to resolution (owner)
 *   GET  /api/intelligence/v1/metrics                aggregate counts with attribution coverage (owner)
 *   GET  /api/intelligence/v1/sources                ingestion keys (owner)
 *   POST /api/intelligence/v1/sources                issue a key bound to one product (owner)
 *   POST /api/intelligence/v1/sources/{id}/revoke    revoke a key (owner)
 *   POST /api/intelligence/v1/retention/purge        apply the retention policy (owner)
 *   GET  /api/intelligence/v1/health                 liveness (public, reveals nothing)
 *
 * Errors are `{ error: { code, message, details? } }` with AppPort's standard codes.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

import { EVENT_SCHEMA, EVENT_TYPES, LIMITS, SUPPORTED_EVENT_SCHEMAS } from './contract.mjs';
import { computeMetrics } from './metrics.mjs';

export const API_PREFIX = '/api/intelligence/v1';
export const ACK_SCHEMA = 'boundry.ingest-ack/1';

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const failure = (status, code, message, details) => json(status, { error: { code, message, ...(details ? { details } : {}) } });

function bearer(request) {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : null;
}

/** Constant-time check of a presented owner token against the configured SHA-256 (hex). */
export function isOwner(request, ownerTokenSha256) {
  const token = bearer(request);
  if (!token || typeof ownerTokenSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(ownerTokenSha256)) return false;
  const a = Buffer.from(createHash('sha256').update(token).digest('hex'), 'hex');
  const b = Buffer.from(ownerTokenSha256, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * @param {{ store: import('./store.mjs').IntelligenceStore, ownerTokenSha256?: string, log?: (entry: object) => void }} deps
 */
export function createHandler({ store, ownerTokenSha256, log = () => undefined }) {
  return async function handle(request) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(API_PREFIX)) return failure(404, 'NOT_FOUND', 'Not found');
    const path = url.pathname.slice(API_PREFIX.length).replace(/\/+$/, '') || '/';
    try {
      if (path === '/health' && request.method === 'GET') return json(200, { status: 'ok', schemas: SUPPORTED_EVENT_SCHEMAS });
      if (path === '/events' && request.method === 'POST') return await ingest(request);

      // Everything else is the owner's, and audited.
      if (!isOwner(request, ownerTokenSha256)) return failure(bearer(request) ? 403 : 401, bearer(request) ? 'FORBIDDEN' : 'UNAUTHORIZED', 'Owner authorization required');
      const parameters = Object.fromEntries(url.searchParams);
      const owner = async (action, run) => {
        const result = await run();
        await store.audit({ action, parameters: { ...parameters, path }, resultCount: result.count ?? null });
        return json(result.status ?? 200, result.body);
      };
      let match;
      if (path === '/events' && request.method === 'GET') {
        return await owner('events.query', async () => {
          const body = await store.events({ from: parameters.from, to: parameters.to, product: parameters.product, type: parameters.type, agent: parameters.agent, application: parameters.application, limit: parameters.limit });
          return { body, count: body.events.length };
        });
      }
      if ((match = /^\/correlations\/([A-Za-z0-9][A-Za-z0-9_.:-]{7,127})$/.exec(path)) && request.method === 'GET') {
        return await owner('correlation.read', async () => {
          const body = await store.correlation(match[1]);
          return { body, count: body.events.length };
        });
      }
      if ((match = /^\/feedback\/([A-Za-z0-9][A-Za-z0-9_.:-]{7,127})$/.exec(path)) && request.method === 'GET') {
        return await owner('feedback.read', async () => {
          const body = await store.feedbackJourney(match[1]);
          return { body, count: body.updates.length + (body.submitted ? 1 : 0) };
        });
      }
      if (path === '/metrics' && request.method === 'GET') {
        return await owner('metrics.read', async () => {
          const scan = await store.scan({ from: parameters.from, to: parameters.to, product: parameters.product });
          const ids = [...new Set(scan.records.filter((e) => e.type === 'feedback.submitted').map((e) => e.event.data.feedbackId))].slice(0, 1000);
          const resolutions = new Map();
          for (const id of ids) resolutions.set(id, (await store.feedbackJourney(id)).state);
          const body = computeMetrics(scan, { resolutions });
          return { body, count: body.events };
        });
      }
      if (path === '/sources' && request.method === 'GET') return await owner('sources.list', async () => { const sources = await store.listSources(); return { body: { sources }, count: sources.length }; });
      if (path === '/sources' && request.method === 'POST') {
        const input = await readJson(request, 4096);
        if (!input.ok) return input.response;
        let issued;
        try {
          issued = await store.issueSource({ productId: input.value?.productId, name: input.value?.name });
        } catch (error) {
          if (error instanceof TypeError) return failure(400, 'INVALID_INPUT', error.message);
          throw error;
        }
        await store.audit({ action: 'sources.issue', parameters: { productId: issued.productId, sourceId: issued.id } });
        // The key is shown once. It is never stored, logged or returned again.
        return json(201, issued);
      }
      if ((match = /^\/sources\/([0-9a-f]{12})\/revoke$/.exec(path)) && request.method === 'POST') {
        const revoked = await store.revokeSource(match[1]);
        await store.audit({ action: 'sources.revoke', parameters: { sourceId: match[1] }, outcome: revoked ? 'ok' : 'not-found' });
        return revoked ? json(200, { id: match[1], revoked: true }) : failure(404, 'NOT_FOUND', 'No such source');
      }
      if (path === '/retention/purge' && request.method === 'POST') {
        return await owner('retention.purge', async () => { const body = await store.purgeExpired(); return { body, count: body.deleted }; });
      }
      return failure(404, 'NOT_FOUND', 'Not found');
    } catch (error) {
      if (error instanceof RangeError) return failure(400, 'INVALID_INPUT', error.message);
      log({ level: 'error', message: 'intelligence request failed', path, name: error?.name, code: error?.code });
      // Storage is unavailable or failed: nothing was acknowledged; the caller retries.
      return failure(503, 'UNAVAILABLE', 'Temporarily unavailable; retry later', undefined);
    }
  };

  async function ingest(request) {
    const source = await store.authenticateSource(bearer(request));
    if (!source) return failure(401, 'UNAUTHORIZED', 'A valid ingestion key is required');
    const body = await readJson(request, LIMITS.bodyBytes);
    if (!body.ok) return body.response;
    const events = Array.isArray(body.value?.events) ? body.value.events : body.value && typeof body.value === 'object' && !('events' in body.value) ? [body.value] : null;
    if (!events) return failure(400, 'INVALID_INPUT', 'The body is one event or { "events": [ ... ] }');
    if (events.length === 0 || events.length > LIMITS.batch) return failure(400, 'INVALID_INPUT', `A batch has 1-${LIMITS.batch} events`);
    const rate = await store.consumeRate(source, events.length);
    if (!rate.ok) return failure(429, 'RATE_LIMITED', 'Too many events for this source', { retryAfterSeconds: rate.retryAfterSeconds });
    const results = await store.ingest(source, events);
    const summary = results.reduce((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {});
    return json(200, { schema: ACK_SCHEMA, source: { id: source.id, productId: source.productId }, accepted: summary.accepted ?? 0, duplicate: summary.duplicate ?? 0, conflict: summary.conflict ?? 0, rejected: summary.rejected ?? 0, results });
  }
}

async function readJson(request, maxBytes) {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > maxBytes) return { ok: false, response: failure(413, 'PAYLOAD_TOO_LARGE', `The body is limited to ${maxBytes} bytes`) };
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) return { ok: false, response: failure(413, 'PAYLOAD_TOO_LARGE', `The body is limited to ${maxBytes} bytes`) };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, response: failure(400, 'INVALID_INPUT', 'The body is not JSON') };
  }
}

export { EVENT_SCHEMA, EVENT_TYPES };
