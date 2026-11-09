# Boundry Ecosystem Intelligence

How external agents and applications actually discover, use and struggle with Boundry products, recorded as durable
evidence: products report structured events, this service authenticates, validates and stores them on FeltDB with their
provenance, and the owner queries them privately. It is the backend `boundry.company` will present; it is not the
dashboard.

`@boundry/intelligence` 0.1.0 (private, independently versioned in this repository).

## Architecture and ownership

| Party | Responsibility here |
|---|---|
| **Boundry** (this package, this repository) | the event contract, ingestion, correlation, metrics and the owner query API |
| **FeltDB** | durable storage, transactions, indexes and concurrency, through its existing control plane; no intelligence-specific code is added to it |
| **Products** (FeltDB, AppPort Services, AppBoundry, FeltKit, …) | report their own events with the fail-open emitter; none of them owns cross-product intelligence |
| **AppPort** | owns the provenance vocabulary (`appport.feedback/1`), reused here unchanged |
| **boundry.company** | the front door: the owner interface will be built on this API (not in this package) |

Why here: AppBoundry is one product (artifacts, deployments, hosts, execution) and must not own intelligence spanning
FeltKit, AppPort, Resolver, Intent and the rest; the FeltDB management API owns tenants, applications and keys and is
not a product telemetry API; Intent is a stateless planner. This repository is the one place that describes the whole
ecosystem (`content/products.json`, `content/stack.json`), so Boundry-owned capabilities live here.

Runtime: no new server, database or control plane. The API runs as one Vercel Function (`api/intelligence.mjs`) on
the existing `boundry.company` project; its state is its own FeltDB **application** on the existing control plane,
reached as a remote FeltDB authority. The static site build is unchanged.

```
product ──emit()──► queue ──batch──► POST /api/intelligence/v1/events/ ──► validate ─► FeltDB (boundry-intelligence app)
   (never waits, never throws)            (ingestion key, product-bound)          ack after commit        ▲
                                                                                                          │
owner (boundry.company, later) ─► GET /api/intelligence/v1/{events,correlations,feedback,metrics}/ ──audit──┘
```

## Event contract: `boundry.event/1`

Normative schema: [`schema/boundry-event-1.schema.json`](schema/boundry-event-1.schema.json) (events, batches,
acknowledgements). Reference validator: `validateEvent` in `src/contract.mjs`. Both are tested to agree.

```json
{
  "schema": "boundry.event/1",
  "id": "evt_01JC7Q4M8Z1V2X3Y4W5T6R7P8N",
  "type": "capability.invoked",
  "occurredAt": "2026-11-09T10:01:00Z",
  "product": { "id": "appport-services", "version": "0.16.0" },
  "capability": { "name": "invoices.create", "version": 2 },
  "actor": {
    "principal": { "status": "verified", "value": { "id": "svc_procurement", "type": "service" } },
    "agent": { "status": "asserted", "value": { "id": "procurement-agent", "version": "4.1.0" } },
    "organization": { "status": "withheld" }
  },
  "context": {
    "correlationId": "task_month_end_0042",
    "runtime": { "status": "asserted", "value": { "name": "node", "version": "22.11.0" } },
    "originatingApplication": { "status": "withheld" },
    "parentAgent": { "status": "unavailable" },
    "taskCategory": { "status": "asserted", "value": "invoice.creation" },
    "integrationMechanism": { "status": "asserted", "value": "sdk" }
  },
  "outcome": { "status": "failed", "errorCode": "INVALID_INPUT" },
  "counters": { "operations": 1, "durationMs": 41 }
}
```

| Member | Required | Meaning |
|---|---|---|
| `schema` | yes | `boundry.event/1`. Another version is refused (`event.schema.unsupported`) with the supported list. |
| `id` | yes | Chosen by the product, stable across retries; unique per product. 8–128 of `[A-Za-z0-9_.:-]`. |
| `type` | yes | `product.discovered`, `product.used`, `capability.invoked`, `task.completed`, `task.failed`, `feedback.submitted`, `feedback.updated`, `product.improved`, `product.released` |
| `occurredAt` | yes | RFC 3339; at most 300 s in the future. Preserved as sent. |
| `product` | yes | `{ id, version }` of the reporting product; must be the product the ingestion key is bound to. |
| `capability` | for `capability.invoked` | `{ name, version? }` |
| `actor` | no | Who acted, as the **product** knows it: `principal`, `agent`, `organization`, `delegation` (`{ id, depth? }`), each a disclosure that may be `verified` (the product authenticated it); or `anonymous: true`. |
| `context` | no | **Exactly** `appport.feedback/1` `context` (spec §5.3): `correlationId`, `runtime`, `originatingApplication`, `parentAgent`, `taskCategory`, `integrationMechanism`; reporter disclosures only (`asserted`, `unavailable`, `withheld`). A test runs the same cases through Core's feedback validator. |
| `outcome` | for `capability.invoked`, `task.*` | `{ status: succeeded | failed | partial | unknown, errorCode? }`; `task.completed` is `succeeded`, `task.failed` is `failed`. |
| `counters` | no | non-negative integers: `operations`, `durationMs`, `items`, `retries`, `bytes` |
| `data` | per type | `product.discovered` `{ via }`; `product.used` `{ operation? }`; `task.*` `{ taskId? }`; `feedback.submitted` `{ feedbackId, category, severity, fingerprint? }`; `feedback.updated` `{ feedbackId, from, to, sequence }`; `product.improved` `{ change, feedbackIds? }`; `product.released` `{ version, previousVersion?, breaking, feedbackIds? }`. Feedback vocabularies are `appport.feedback/1`'s. `capability.invoked` carries none. |
| `redactions` | no | JSON pointers the product removed before reporting (data minimization record). |
| `extensions` | no | ≤ 8 namespaced, versioned members (`vendor.topic/1`); never `boundry.*`. |

Every event is closed (unknown members are refused), at most 16 KiB of canonical JSON, and refused if any string looks
like a credential (Core's `detectSensitive`; the issue never repeats the value). There is no member for prompts, model
conversations, task descriptions or business data, and `taskCategory` is a label, never a sentence.

**Disclosures.** `asserted` (stated, unchecked; has a value), `unavailable` (not known), `withheld` (known, not
disclosed), and `verified` only on `actor` attributes, meaning the reporting product authenticated it, as an AppPort
provider marks the principal verified in a feedback receipt. A relayed attribute can never be `verified`. Absence says
nothing and is not `unavailable`.

**Attribution** is derived at ingestion; a source cannot set it:

| identity | when | confidence |
|---|---|---|
| `authenticated` | principal or agent `verified` | high |
| `asserted` | principal or agent `asserted`, none verified | medium with a `correlationId`, else low |
| `anonymous` | `actor.anonymous: true` | none |
| `unknown` | nothing stated, or only withheld / unavailable | none |

No external agent identity is assumed globally stable: identities are only ever compared within their class, and the
same asserted id from two agents is not evidence they are one agent.

**Evolution.** `boundry.event/1` is closed and immutable; growth is `extensions` or `boundry.event/2`, stored side by
side (each stored event keeps its `schema`; readers dispatch on it).

## Ingestion API

Base: `https://boundry.company/api/intelligence/v1/`. Canonical URLs end with `/` (the site sets `trailingSlash`); the
handler accepts both forms. JSON in and out; errors are `{ "error": { "code", "message", "details"? } }` with AppPort's
standard codes.

`POST events/` with `Authorization: Bearer <ingestion key>`: one event, or `{ "events": [ … ] }` (1–100, body ≤ 1 MiB).

```json
{ "schema": "boundry.ingest-ack/1", "source": { "id": "3fa8…", "productId": "appport-services" },
  "accepted": 1, "duplicate": 0, "conflict": 0, "rejected": 1,
  "results": [ { "index": 0, "id": "evt_…", "status": "accepted" },
               { "index": 1, "id": "evt_…", "status": "rejected", "issues": [ { "code": "event.schema.unsupported", "pointer": "/schema", "message": "…" } ] } ] }
```

| Per-event status | Meaning | The product should |
|---|---|---|
| `accepted` | validated and **committed** before this answer was sent | forget it |
| `duplicate` | already stored with the same canonical digest (an idempotent retry) | forget it |
| `conflict` | the id was used for a different event; nothing written | fix the id scheme; do not resend |
| `rejected` | invalid, another product's, or already past retention; `issues` say why | fix the producer; do not resend |

| HTTP | When | The product should |
|---|---|---|
| 200 | the batch was processed (see per-event statuses) | — |
| 400 / 413 | malformed body, empty or over-size batch | fix the producer |
| 401 | missing, unknown, malformed or revoked key | rotate the key |
| 429 `RATE_LIMITED` | over the source's rate (`details.retryAfterSeconds`) | resend the same batch later |
| 503 `UNAVAILABLE` | storage unavailable or not configured; nothing was acknowledged | resend the same batch later (idempotent) |

### Reporting from a product: never in the critical path

```js
import { createEventEmitter } from '@boundry/intelligence/emitter';
const intelligence = createEventEmitter({ endpoint: 'https://boundry.company/api/intelligence/v1/events/', key: process.env.BOUNDRY_INGESTION_KEY });
intelligence.emit({ schema: 'boundry.event/1', id, type: 'capability.invoked', occurredAt, product, capability, outcome, context });
```

`emit` is synchronous, never throws and never touches the network; batches go out in the background with exponential
backoff on network errors, 429 and 5xx, and resends are safe because ids are idempotent. The queue is bounded (oldest
dropped and counted); nothing is persisted locally, so events queued when a process exits are lost and counted in
`stats().pending`. A product whose Boundry ingestion is down keeps serving its customers.

## Owner query API

`Authorization: Bearer <owner token>`; only the owner token reads. Every read writes an audit record before it is
answered; if the audit cannot be written the read fails (503) and returns nothing.

| Route | Returns |
|---|---|
| `GET events/?from&to&product&type&agent&application&limit` | events by `occurredAt`, newest first; range ≤ 92 days (default 7), `limit` ≤ 1000, `truncated` |
| `GET correlations/{correlationId}/` | every event sharing it, in order, and the products involved: one journey |
| `GET feedback/{feedbackId}/` | submission, lifecycle updates, improvements and releases naming it, current state, and the submitting task's events |
| `GET metrics/?from&to&product` | the metrics below, with attribution coverage and their definitions; range ≤ 366 days |
| `GET sources/` · `POST sources/` `{ productId, name }` · `POST sources/{id}/revoke/` | ingestion keys (a new key is shown once) |
| `POST retention/purge/` | applies the retention policy |
| `GET health/` | public liveness; reveals nothing |

Each returned event carries the original event exactly as sent, `receivedAt`, the source id, its canonical digest,
derived attribution and `retentionUntil`.

## Metrics

Computed from stored events only, always returned with `coverage` (events by identity class and confidence, and the
attributed and authenticated shares) and `definitions`.

| Metric | Definition |
|---|---|
| Unique organizations | distinct `actor.organization` ids, **authenticated** (product-verified) and **asserted** reported separately |
| Unique applications | distinct `context.originatingApplication` ids; always asserted |
| Distinct agents | authenticated agents (agent or principal verified) and asserted agent ids, separately; anonymous and unknown events are counted as events, never as agents |
| Active integrations | distinct (product, authenticated principal or verified organization, integration mechanism) with ≥ 1 `product.used`, `capability.invoked` or `task.*` event; asserted-only reported separately |
| Product adoption | per product: distinct authenticated principals and verified organizations with active events, and events by identity class |
| Repeat usage | authenticated principals active on ≥ 2 distinct UTC days in the range, and their share |
| API operations | Σ `counters.operations` (1 when absent) over `capability.invoked`, with succeeded / failed. **Not tasks.** |
| Completed / failed tasks | counts of `task.completed` / `task.failed` events only |
| Feedback volume | `feedback.submitted` count, by category and severity |
| Feedback resolution rate | of the feedback ids submitted in the range, the share whose latest stored update is `resolved`; rejected reported separately |

Never: an API call counted as a task; an asserted identity counted as a verified one; anonymous or unknown activity
counted as a distinct organization, application or agent.

## Persistence (FeltDB)

One FeltDB application, `boundry-intelligence`, on the existing control plane, with the state contract
`INTELLIGENCE_CONTRACT` (`src/store.mjs`). Tests run every write path on a FeltDB that enforces exactly that contract.

| Collection | One per | Written |
|---|---|---|
| `intelligence_events` | (product, event id) | once with `requireAbsent`, never rewritten; the original event, its canonical digest, `receivedAt`, source, product and version, schema, correlation id, feedback ids, derived attribution, `retentionUntil`. Indexed by day, correlation id and expiry day. |
| `intelligence_feedback_links` | (feedback id, event) | with its event, in the same transaction; indexed by feedback id |
| `intelligence_sources` | ingestion key | the product it is bound to and a SHA-256 of the key (never the key); revocation under compare-and-set |
| `intelligence_rate_windows` | (source, minute) | a counter under compare-and-set, shared by every function instance |
| `intelligence_access_audit` | owner read or administrative act | once, before the answer |

* **Durable before acknowledgement**: an event is `accepted` only after its transaction commits.
* **Immutable history**: events are created with `requireAbsent` and never updated; a second submission is compared by
  canonical digest (`duplicate` or `conflict`).
* **Retention**: explicit, default **400 days** from `min(occurredAt, receivedAt)` (`BOUNDRY_INTELLIGENCE_RETENTION_DAYS`).
  Events already past it are refused at ingestion; `POST retention/purge/` deletes expired events and their links
  (scanning 30 days of expiry buckets: run it at least monthly). Retention is the only deletion.
* **Isolation**: the store is Boundry's own FeltDB application; products can only write events for their own product,
  only the owner can read, and organization identities are visible only to the owner.

## Security model

| Threat | Control |
|---|---|
| A product impersonating another | each ingestion key is bound to one product id; events for any other product are `rejected` (`event.product.forbidden`) |
| Stolen or guessed keys | 256-bit random secret, stored only as SHA-256, compared in constant time; revocable; never listed or logged |
| Replay | event ids are idempotent per product: a replayed event is a `duplicate` and changes nothing |
| Flooding | per-source rate limit in FeltDB (default 1200 events/minute), batch and body limits |
| Sensitive data | no member for prompts or task content; closed contract; credential floor; `withheld` / `unavailable` preserved |
| Forged provenance | relayed context cannot be `verified`; attribution is derived, never accepted |
| Owner data exposure | only the owner token reads; every read audited, and unaudited reads refused |
| Untrusted content | every string is data: validated, bounded, stored, never executed or interpreted |
| Storage unavailable | 503, nothing acknowledged; products keep working (emitter) |

## Configuration and provisioning

| Environment variable (Vercel project) | |
|---|---|
| `BOUNDRY_INTELLIGENCE_FELTDB_URL` | the FeltDB control plane's authority URL |
| `BOUNDRY_INTELLIGENCE_FELTDB_TOKEN` | the `boundry-intelligence` application's **data** key (`state:read`, `state:write`) |
| `BOUNDRY_INTELLIGENCE_FELTDB_APPLICATION_ID` | its application id |
| `BOUNDRY_OWNER_TOKEN_SHA256` | `printf %s "$TOKEN" \| sha256sum`; the token itself is kept by the owner only |
| `BOUNDRY_INTELLIGENCE_RETENTION_DAYS` | optional, default 400 |

Missing configuration fails closed (503). Provisioning, with the control plane's own API and an operator key: create
the `boundry-intelligence` application, publish and promote `INTELLIGENCE_CONTRACT`, mint a data key bound to it, set
the variables above, then issue one ingestion key per product source with `POST sources/`.

## Development

```bash
cd intelligence
npm ci
npm test       # real FeltDB (local file runtime, enforced contract); no network
```

## Limits and gaps

* Not yet deployed or provisioned; Vercel behaviour (rewrite, trailing slash, bundling) is covered by tests of the
  adapter and a production-mode install, not by a live deployment.
* No product emits yet: wiring the emitter into FeltDB, AppPort Services, AppBoundry and FeltKit is per-product work, and
  the package is not published to npm.
* Owner authentication is one bearer token; AuthBoundry-based owner sign-in is future work.
* Time-range reads scan day buckets (bounded); metrics read at most 100 000 events per request; no rollups yet.
* Retention purge is manual (owner route); no scheduler is configured.
* No erasure-by-subject request flow beyond retention.
