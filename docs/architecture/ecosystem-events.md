# Ecosystem events: the minimum contract, identity, provenance, idempotency and acceptance

Companion to [ecosystem-intelligence.md](ecosystem-intelligence.md). This records what the
`boundry.event/1` contract in `intelligence/schema/boundry-event-1.schema.json` (reference validator
`intelligence/src/contract.mjs`) already defines, proposes the **minimum** a first producer must send, and
lists the points the contract leaves open. Nothing here changes the implemented contract; changes go
through the implementation sequence in the architecture document.

## 1. What exists: `boundry.event/1`

A closed, versioned document (unknown members refused; ≤ 16 KiB canonical JSON; strings that look like
credentials refused without echoing them).

| Member | Required | Content |
|---|---|---|
| `schema` | yes | `boundry.event/1` |
| `id` | yes | product-chosen, stable across retries, unique per product; 8–128 of `[A-Za-z0-9_.:-]` |
| `type` | yes | one of nine (§2) |
| `occurredAt` | yes | RFC 3339, at most 300 s in the future; preserved as sent |
| `product` | yes | `{ id, version }`; must be the product the ingestion key is bound to |
| `capability` | for `capability.invoked` | `{ name, version? }` |
| `actor` | no | `principal`, `agent`, `organization`, `delegation`, each a disclosure that may be `verified` (the product authenticated it); or `anonymous: true` |
| `context` | no | exactly `appport.feedback/1` §5.3: `correlationId`, `runtime`, `originatingApplication`, `parentAgent`, `taskCategory`, `integrationMechanism`; reporter disclosures only |
| `outcome` | for `capability.invoked`, `task.*` | `{ status: succeeded \| failed \| partial \| unknown, errorCode? }` |
| `counters` | no | non-negative integers: `operations`, `durationMs`, `items`, `retries`, `bytes` |
| `data` | per type | type-specific (§2) |
| `redactions` | no | JSON pointers removed before reporting |
| `extensions` | no | ≤ 8 namespaced, versioned members (`vendor.topic/1`), never `boundry.*` |

## 2. The minimum viable contract (proposal)

Nine types are defined. A first producer needs four; the rest are for later product integrations.

| Type | In the minimum | Produced by | Minimum `data` |
|---|---|---|---|
| `capability.invoked` | **yes** | a host runtime after a call completes (FeltKit's after-commit path, the AppBoundry portal) | none; `capability`, `outcome`, `counters.operations` |
| `task.completed` / `task.failed` | **yes** | an agent host when a correlated task ends | `{ taskId? }`; `outcome` fixed by the type |
| `feedback.submitted` | **yes** | the feedback provider's host, after the store commits the receipt | `{ feedbackId, category, severity, fingerprint? }` (vocabularies are `appport.feedback/1`'s) |
| `feedback.updated` | **yes** | the same host, after each lifecycle update commits | `{ feedbackId, from, to, sequence }` |
| `product.used` | later | a host, once per (principal, day) at most | `{ operation? }` |
| `product.discovered` | later | a host serving `/.well-known/appport` or a manifest | `{ via }` (closed channel list) |
| `product.improved` | later | a release process | `{ change, feedbackIds? }` |
| `product.released` | later | a release process | `{ version, previousVersion?, breaking, feedbackIds? }` |

Reasoning: the four minimum types are the ones with an authoritative moment in existing code (a call's
completion, a task's end, a feedback transaction's commit) and an idempotent natural id (§3). The others
need a producer that does not exist yet (a release pipeline, a discovery server).

**Mapping from `appport.feedback/1` lifecycle to `feedback.updated`.** One update row (`feedback_updates`,
sequence *n*, `from` → `to`) maps to one event with `data.sequence = n`; the receipt (sequence 0) maps to
`feedback.submitted`. `feedbackId`, `category`, `severity` and `fingerprint` are the report's, copied; the
reporter's `context` is relayed as sent and can therefore never be `verified` on the Boundry side (§4).

## 3. Event identity and idempotency

- **Identity is `(product.id, id)`.** The store writes the record `once` with `requireAbsent`
  (`intelligence_events`), so two sources cannot collide and one source cannot overwrite.
- **Retries are safe by construction.** A resend with the same canonical digest is `duplicate`; the same `id`
  with different content is `conflict` and nothing is written. Producers must therefore derive `id` from the
  fact, not from the attempt:

  | Type | Proposed `id` |
  |---|---|
  | `capability.invoked` | the host's request id (FeltKit's `requestId`, AppPort's `requestId`) |
  | `task.*` | `task:<taskId>:<completed\|failed>` |
  | `feedback.submitted` | `fb:<feedbackId>:0` |
  | `feedback.updated` | `fb:<feedbackId>:<sequence>` |

- **Correlation** is `context.correlationId` (the feedback protocol's identifier grammar), indexed
  (`events_by_correlation`); a journey is `GET /correlations/{id}`. No ordering is implied between events of
  one correlation beyond `occurredAt`; consumers must not infer causality from arrival order.

## 4. Provenance

Statuses and their owners are the feedback protocol's (§5.3): `asserted`, `unavailable`, `withheld` from the
reporter; `verified` only from a verifier. In `boundry.event/1` the verifier is the **reporting product** for
its own `actor` attributes (it authenticated the principal, it knows which agent key called). Everything the
product merely relays from an agent (`context`) stays at the reporter's status. The ingestion derives
attribution (`authenticated` / `asserted` / `anonymous` / `unknown` with a confidence) and stores it beside
the event, never inside it. Absence is not `unavailable`.

**Invariants a consumer may rely on:** the stored `event` is byte-identical to what was accepted (digest
checked on read paths that compare); `receivedAt` is the ingestion's clock; `occurredAt` is the product's;
attribution never upgrades a status.

## 5. Durable acceptance and retry semantics

| Answer | Meaning for the producer |
|---|---|
| `accepted` | the event's transaction **committed** before the answer; forget it |
| `duplicate` | already stored, same digest; forget it |
| `conflict` / `rejected` | will never be accepted as sent; drop it and count it (resending cannot help) |
| HTTP 429 `RATE_LIMITED` | resend the same batch after `details.retryAfterSeconds` |
| HTTP 503 `UNAVAILABLE` | nothing acknowledged; resend the same batch later |
| a network failure or timeout | unknown outcome; resend the same batch (idempotent ids make it safe) |

The emitter (`intelligence/src/emitter.mjs`) implements this: synchronous `emit()`, bounded in-memory queue
(oldest dropped and counted), background batches with exponential backoff, no local persistence. A process
exit loses queued events, by design: Boundry's availability is never part of a product's.

## 6. Open points the contract leaves (to settle in sequence step 2)

1. **`id` grammar per type** is a convention in §3, not enforced; the schema only bounds the string. Decide
   whether the validator should enforce the per-type prefixes or leave producers free.
2. **Batch atomicity.** A batch is processed event by event (each `accepted` committed on its own); a
   producer that needs all-or-nothing has no option. Likely fine; state it in the schema's description.
3. **Clock skew.** `occurredAt` may be at most 300 s ahead of ingestion; there is no lower bound other than
   retention. Decide whether a very old `occurredAt` (clock reset) should be `rejected` or flagged.
4. **Counters for `product.used`.** Once-per-day semantics are a producer convention; the contract cannot see
   it. Either the producer dedupes by `id` (`used:<principal>:<day>`) or `product.used` is dropped from the
   minimum. The former is the proposal.
5. **Extensions governance.** `vendor.topic/1` members are stored and not interpreted; nothing defines who
   registers a vendor name. Decide before the first product uses one.
6. **Feedback relay without a product principal.** When a FeltKit application relays an agent's feedback,
   the product-verified principal is the application's end user or agent key, not the agent's self-asserted
   identity; the mapping must keep them apart (`actor.principal` verified, `actor.agent` asserted).
7. **Identity of the forwarder.** `product.id` for a FeltKit-hosted provider is `feltkit` (the host), while
   the feedback itself is about the application. `context.originatingApplication` carries the application;
   decide whether an `extensions` member should carry the application's own id, or whether the application
   should be its own source with its own key.
