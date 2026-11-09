# Boundry Ecosystem Intelligence: architecture and ownership audit

Phase 0 of Workstream B. 2026-11-09. A documentation and evidence record: it decides where ecosystem
intelligence belongs, how it runs, and how it integrates with FeltDB and AppPort, from the code and
deployment configuration that exist, and it names what is not resolved. It introduces no implementation.

**Status of the ground this was written on.** An implementation already exists in this repository:
`intelligence/` (`@boundry/intelligence` 0.1.0, private) and the Vercel function `api/intelligence.mjs`,
merged in [rkendel1/boundry#7](https://github.com/rkendel1/boundry/pull/7) at 20:03 UTC today (commit
`b3c55c2`, merge `e089b61`; CI run 42689333718 green, including the `intelligence` job). The roadmap
asked for ownership to be established before a backend was built; the order was inverted. This audit
therefore does two things: it decides ownership on the evidence, and it evaluates the merged
implementation against that decision instead of pretending it is not there. Where the implementation
is right, the audit says so and points at it; where it rests on an assumption the ecosystem does not
yet satisfy, the audit names the assumption.

## 1. Decision summary

| Question | Decision | Confidence | Evidence (§) |
|---|---|---|---|
| Repository owner | **`rkendel1/boundry`** (this repository), as a separately versioned package beside the website | established | §3 |
| Runtime | one **Vercel Function** on the existing `boundry.company` project; no new server, container or control plane | established for the API; **the FeltDB authority it reaches is not** | §4, §10 |
| FeltDB | one ordinary FeltDB **application** (`boundry-intelligence`) with its own state contract and a data key, on an existing control plane, through the existing management API and the existing `@feltdb/core` remote client; no FeltDB code change | established as design; **not provisioned anywhere** | §5 |
| Ingestion | `POST /api/intelligence/v1/events/` in `intelligence/src/http.mjs` | established | §6 |
| Event contract | `boundry.event/1` (closed, versioned, provenance from `appport.feedback/1`) | established as a proposal; see [ecosystem-events.md](ecosystem-events.md) for the minimum and the open points | §6 |
| Provenance | disclosures `asserted` / `unavailable` / `withheld` preserved as sent; `verified` only from the reporting product; attribution derived at ingestion | established | §7 |
| Security | product-bound ingestion keys (hash-only, revocable); one owner bearer token (hash-only); audit-before-read; rate limit in FeltDB | established for v0; **owner sign-in through AuthBoundry is not designed** | §8 |
| AppPort | feedback lifecycle is owned by `appport.feedback/1` (protocol 1.5.0) and stored by AppPort Services 0.16.0; **no forwarding to Boundry exists**, and where the forwarder lives is unresolved | unresolved | §9 |
| Website | the static site stays static; the function is a private API under the same domain; **an owner interface needs an authentication model before it can exist** | unresolved | §11 |
| Deployment | yes without another server, database or control plane, **if** a FeltDB authority reachable from Vercel is chosen | conditional | §10 |

## 2. What was inspected

Code and deployment configuration, not README claims, in the checkouts at the commits below.

| Repository | Commit inspected | What was read |
|---|---|---|
| `rkendel1/boundry` | `e089b61` (main) | `intelligence/src/*`, `intelligence/schema/*`, `intelligence/test/*`, `api/intelligence.mjs`, `vercel.json`, `.github/workflows/ci.yml`, `content/stack.json`, `content/products.json`, `AGENTS.md`, PR #7 |
| `rkendel1/flow_db` (FeltDB) | `c72c1be` (local checkout) | `deploy/Dockerfile`, `deploy/docker-compose.yml`, `deploy/control-plane/fly.toml`, `deploy/managed/fly.toml`, `crates/feltdb-server/src/{auth,key_management,control_authorization,main}.rs` (routes, scopes, platform owner), `packages/core/src/application-service.test.ts` (remote client), `website/vercel.json` |
| `rkendel1/appboundry` | `4df3370` (local) | `deploy/boundry/{PLATFORM,SERVER-PLAN,STAGE2,IMAGES}.md`, `compose.yml`, `boundry.caddy`, `provision.mjs`, `deploy/staging-host/SHARED-HOST.md`, `deploy/artifact-runner/hetzner/README.md`, `packages/appboundry-agent/README.md` |
| `rkendel1/appport` | `83c32ec` (origin/main, fetched) | `spec/agent-feedback-1.md`, `packages/protocol/src/feedback*.ts`, `packages/sdk/src/feedback.ts`, package versions |
| `rkendel1/appport-services` | `0456f7c` (origin/main, fetched) | `docs/feedback-store.md`, `src/storage/feedback.ts`, `src/intelligence/*`, `src/webhooks/service.ts`, `package.json` |
| `rkendel1/feltkit` | `74dc4d2` | `packages/sdk/package.json`, `package-lock.json`, `src/server/admin.ts` (its use of `@appport/services` intelligence) |
| `rkendel1/authboundry` | `b8ed659` (local) | README (positioning only; no owner sign-in integration exists to inspect) |
| `rkendel1/boundry-maint` | shallow clone | README (what it is: a generated package/installation inventory, no backend) |

Not inspected: the Hetzner host itself (no SSH from this session), the Vercel project's settings, the
npm registry state of `@boundry/intelligence` (private, unpublished), `rkendel1/relationship-agent`.

## 3. Repository ownership

### 3.1 Candidates and why each was accepted or rejected

| Candidate | What it is, from its code | Verdict |
|---|---|---|
| **AppBoundry** (`rkendel1/appboundry`) | one product: artifacts, deployments, hosts, runtime verification and execution authorization (`packages/appboundry-*`, `apps/cloud-portal`). Its repository also holds the platform's deployment project (`deploy/boundry`) because that project needed a home, not because AppBoundry owns the platform (`deploy/boundry/PLATFORM.md`: "nothing is merged into one application and no new control plane is introduced"). | **Rejected as owner.** Intelligence spans FeltKit, AppPort, FeltDB, Resolver and Intent; placing it in one product's repository would make that product the implicit platform. The portal is also not the right runtime: it is the AppBoundry control plane, with its own FeltDB application and trust boundary. |
| **FeltDB control plane** (`rkendel1/flow_db`, `feltdb-server`) | tenants, applications, keys, contracts, revisions, a platform-owner API (`/api/platform`, `platform:admin`) and application state (`crates/feltdb-server/src/main.rs` routes). | **Rejected as owner; accepted as substrate.** It is the authority for durable state and for who may use it, not a product telemetry API. The `/api/platform` owner surface answers "what exists on this control plane", not "how are products used in the world". Intelligence is one of its applications, like AppBoundry's (`provision.mjs application`). |
| **AppPort Services** (`rkendel1/appport-services`) | a library of durable operational capabilities embedded in applications (API keys, jobs, schedules, secrets, webhooks, files, notifications), and since 0.16.0 the durable `FeltDbFeedbackStore`. Its `src/intelligence` is **model-provider selection** (OpenAI, Anthropic, …; `INTELLIGENCE_CATALOG`), the `intelligence.*` permissions FeltKit's operator role holds. | **Rejected as owner.** It runs inside each application, per tenant, with the application's authority; there is no Boundry-wide instance to own cross-product data. It is a **source** (feedback lifecycle, §9). The name collision is real and must be handled in prose: "Ecosystem Intelligence" (Boundry, cross-product events) is not "intelligence" (AppPort Services, model configuration). |
| **Intent** (`flow_db` `intent-engine` target) | a stateless planner whose state lives in FeltDB (`deploy/docker-compose.yml`, `PLATFORM.md`). | Rejected: stateless, private to the platform network, no ingestion surface. |
| **FeltKit** | the developer product that composes applications. | Rejected: a product and a source; it already depends on everything else, and owning telemetry would invert that. |
| **`boundry-maint`** | a generated, committed inventory of packages, releases and installations; "no database, no hosted backend" by design. | Rejected: observes registries and repositories, never events; adding a backend would break its own contract. |
| **`rkendel1/boundry`** (this repository) | the corporate site, and the one place that describes the whole ecosystem as data: `content/products.json` (the product directory, with published packages) and `content/stack.json` (the stack map: layers, composition, boundaries, evidence). | **Accepted.** Cross-product, Boundry-owned capabilities belong where Boundry, not a product, is the subject. The PR #7 reasoning (`intelligence/README.md` "Why here") is the same and holds on inspection. |

### 3.2 Conditions on the acceptance

1. **Separate package, separate version, separate CI job.** Done: `intelligence/package.json` is private and
   versioned on its own; `ci.yml` has an `intelligence` job; the site build does not import it. Keep it so.
   The website and the backend share a repository and a Vercel project, not a build.
2. **No site copy depends on intelligence data.** `AGENTS.md` forbids invented traction in copy; nothing in
   `src/build.mjs` reads intelligence. The product directory and stack map stay hand-curated facts.
3. **Products never import Boundry's store.** They emit (`@boundry/intelligence/emitter`) or, until the
   package is published, nothing. The emitter is fail-open and never on a product's request path.
4. **If the function is ever moved off Vercel** (for example to the Hetzner host as its own container), the
   package stays here and the deployment project that hosts it is `appboundry/deploy/boundry` by precedent,
   with the same hardening (§10). The repository owner does not change with the runtime.

## 4. Runtime

**What exists.** `vercel.json` rewrites `/api/intelligence/v1/:path*` to `api/intelligence.mjs`
(`maxDuration: 30`, `Cache-Control: no-store`), and `installCommand` installs only
`intelligence/node_modules` (`npm ci --prefix intelligence --omit=dev`). The function is a thin adapter over
`intelligence/src/http.mjs` (`createConfiguredHandler(process.env)`); missing configuration answers 503
(`REQUIRED_ENVIRONMENT` in `configure.mjs`). CI proves the function loads from a production-only install and
answers 503 unconfigured.

**What this is and is not.** A Vercel Function is a backend process under the website's domain. The
"website without becoming a backend" requirement (§11) is met in the sense that the static pages remain
static and the API is a separate code path with its own dependencies, tests and configuration; it is not met
in the sense that the Vercel project now hosts both. That is the trade the "no new server" requirement buys.

**Not verified.** No deployment has run. Rewrite behaviour, trailing slash and bundling are covered by the
adapter test and the production-mode install in CI, not by a live function. Cold-start cost of
`@feltdb/core` in a function was not measured.

## 5. FeltDB integration

**Control-plane primitives the design uses, all existing** (`crates/feltdb-server/src/main.rs`,
`key_management.rs`, `control_authorization.rs`):

| Need | Existing mechanism | Evidence |
|---|---|---|
| a tenant and an application | `GET/POST /api/tenants`, `GET/POST /api/tenants/{id}/applications` | `provision.mjs application` does exactly this for AppBoundry |
| a data key bound to the application | `POST /api/keys { namespace, application_id, scopes }` with `state:read`, `state:write` (and `application:read`, `application:revision:read`) | `provision.mjs`, `key_management.rs create_key` (refuses end users, requires non-empty scopes); keys are stored hashed (`auth.rs ApiKeyRecord.hash`), revocable, rotatable (`/api/keys/{id}/rotate`) |
| the state contract published and promoted | `ApplicationManifestClient` draft → publish → promote (`@feltdb/core`) | `provision.mjs` for the portal's `feltdb.flow`; intelligence has `INTELLIGENCE_CONTRACT` (`store.mjs`) ready for the same flow |
| reaching the application from the function | `createFeltDB({ server: { url, token, applicationId } })` | `packages/core/src/application-service.test.ts`; `intelligence/src/configure.mjs` uses it |
| isolation from other applications | application-scoped keys and namespaces | the same model AppBoundry's portal relies on (`PLATFORM.md`) |

**No FeltDB-specific intelligence code is needed or proposed.** The store uses transactions, `requireAbsent`,
compare-and-set and equality indexes only (`store.mjs`; the `FeltDbFeedbackStore` in AppPort Services uses
the same primitives for the same reasons).

**Verified so far:** the whole write and read path against the local file runtime with the contract enforced
(`intelligence/test/support.mjs openDb`: `createFeltDB({ mode: 'local', … })` + `stateContract.evolve`). **Not
verified:** the same paths against a remote authority (`server:` mode): rate-window compare-and-set under
concurrency across function instances, latency per event, and contract publication through the management
API. These are the first things the ingestion PR must show (§13).

## 6. Ingestion and the owner query API

Both exist in `intelligence/src/http.mjs`, under `API_PREFIX = /api/intelligence/v1`:

- `POST /events` (bearer ingestion key): one event or `{ events: [1..100] }`, body ≤ 1 MiB; per-event
  `accepted` (committed before the answer), `duplicate` (same canonical digest), `conflict` (same id, different
  content), `rejected` (issues); `401` unknown or revoked key; `429` over the per-source rate; `503` storage
  unavailable or unconfigured with nothing acknowledged.
- Owner routes (bearer owner token): `GET /events`, `GET /correlations/{id}`, `GET /feedback/{id}`,
  `GET /metrics`, `GET|POST /sources`, `POST /sources/{id}/revoke`, `POST /retention/purge`; `GET /health`
  public. Every owner read writes an audit record first and fails closed if it cannot.

The contract and its open points are in [ecosystem-events.md](ecosystem-events.md).

## 7. Provenance

`boundry.event/1` reuses `appport.feedback/1` §5.3 unchanged: `context` attributes are disclosures with
`asserted` (value present, unchecked), `unavailable` (not known), `withheld` (known, not disclosed);
`verified` is forbidden from a reporter (`event.provenance.verified`, tested in `contract.test.mjs`), and only
`actor` attributes may be `verified`, meaning the reporting product authenticated them (the AppPort provider's
receipt semantics, spec §7.1). Attribution (`authenticated` / `asserted` / `anonymous` / `unknown`, with a
confidence) is **derived at ingestion** and stored beside the event; a source cannot set it. The original
event is stored byte-for-byte with its canonical digest (`@appport/protocol` `canonicalize`/`digestOf`).
Absence of an attribute is distinct from `unavailable`; neither is a value. This is the right model and
needs no change.

## 8. Security boundaries

| Boundary | As implemented (`store.mjs`, `http.mjs`) | Assessment |
|---|---|---|
| Publisher authentication | a 256-bit ingestion key per source, bound to one `productId`, stored as SHA-256, compared in constant time, revocable; an event naming another product is `rejected` (`event.product.forbidden`) | adequate for v0; keys are minted only through the owner API, so key issuance is as strong as the owner token |
| Owner authorization | one bearer token; the deployment holds `BOUNDRY_OWNER_TOKEN_SHA256`; every read audited before answering | adequate for a single owner; **not** an identity model. AuthBoundry exists for exactly this (its README: identity, tenancy, delegation, sessions) and FeltDB's own control plane has a platform-owner notion (`require_platform_owner`, console users). Which of the two signs the owner in is an open decision (§12) |
| Replay and flooding | idempotent ids per product; per-source rate windows as FeltDB counters under compare-and-set | adequate; the window counter shares one record per (source, minute), so contention is bounded by one writer per instance per minute |
| Data minimization | closed schema, 16 KiB cap, credential-shaped strings refused (`detectSensitive`), no member for prompts or task content, `redactions` recorded | adequate; the floor is heuristic and says so |
| Transport | HTTPS by Vercel; no request signing; no mTLS | adequate for bearer keys over TLS; signing would matter only if a relay is introduced (§9) |
| Secrets at rest | Vercel environment variables (token hash, FeltDB data key) | the data key is the sensitive one: it writes Boundry's own FeltDB application; rotation is `POST /api/keys/{id}/rotate` on the control plane plus a Vercel variable change |

## 9. AppPort: the feedback lifecycle and who forwards it

**What exists.**
- `appport.feedback/1` (AppPort `spec/agent-feedback-1.md`, protocol 1.5.0): reports, provenance disclosures,
  a lifecycle (`submitted → … → resolved | rejected`, §6) moved **only by the provider**, numbered updates,
  receipts, status, and an optional provider event `appport.feedback.updated@1` `{ feedbackId, sequence,
  state }` that MUST be delivered only to the record's reporter (§7.5).
- `@appport/sdk` 1.7.0 `createFeedbackProvider({ product, store, actor })` registers the reserved capabilities
  and delegates every rule to the protocol (`packages/sdk/src/feedback.ts`).
- `@appport/services` 0.16.0 `FeltDbFeedbackStore` persists records, submissions and updates in FeltDB
  (`src/storage/feedback.ts`; `docs/feedback-store.md`): append-only updates, compare-and-set head, every
  read re-verified. It "stores and checks, it decides nothing", and it emits nothing.

**What does not exist.** No component forwards feedback lifecycle events to Boundry. The `boundry.event/1`
types `feedback.submitted` and `feedback.updated` have no producer. The spec's own event is scoped to the
reporter and is not a Boundry channel.

**Where the forwarder can live, by ownership.**

| Option | Owner | Fit |
|---|---|---|
| A. inside `FeltDbFeedbackStore` | AppPort Services | wrong: the store "decides nothing" and would gain a network dependency and a Boundry credential |
| B. a hook on the SDK provider (`createFeedbackProvider` after receipt / after update), with the application wiring the Boundry emitter | AppPort SDK (hook) + the application host | right boundary: the provider already knows every lifecycle fact and the authenticated reporter; the emitter stays the host's, fail-open; **whether such a hook exists in 1.7.0 was not verified** (the module exports a lifecycle tracker; a provider-side observation hook must be confirmed or added) |
| C. the host runtime that embeds the provider (FeltKit's runtime, AppBoundry's portal) emits from its own after-commit path | FeltKit / AppBoundry | right for products that are hosts; FeltKit's `afterCommit` outbox is the durable place to emit from, but FeltKit does not yet host a feedback provider at all |

Recommendation for the forwarding PR (§13 step 3): B, with C as the integration in FeltKit. Until B is
verified, "AppPort Services forwards feedback lifecycle events" is a sentence about the future.

## 10. Deployment model, and the one unresolved dependency

**Requirement:** no new server, database or control plane. **The function satisfies it; the FeltDB authority
it must reach does not yet exist in a form the function can reach from Vercel:**

| FeltDB control plane | State today | Reachable from a Vercel Function |
|---|---|---|
| **Fly** `feltdb-control-plane`, `https://api.feltdb.com` (`flow_db/deploy/control-plane/fly.toml`; the FeltDB website's `vercel.json` sets `FELTDB_API_URL=https://api.feltdb.com`) | running; the only control plane in service | yes (public HTTPS) |
| **Hetzner** `boundry-feltdb-control` (`appboundry/deploy/boundry/compose.yml`) | **not installed**: `SERVER-PLAN.md` opens with "Nothing here has been run on the server"; `STAGE2.md` is the read-only preflight that precedes installation; what runs on `95.217.199.123` today is vote.app (H0), Clearline, Mailport, a kind cluster, Caddy and existing sites | **no by decision**: `boundry.caddy` ships the FeltDB route commented out ("PRIVATE initially: no public route"); only the portal gets a public name; publishing the control plane is a separately authorized step (`SERVER-PLAN.md` step 7) |

So the deployment question has a dependency the roadmap did not state: **either** the intelligence
application is provisioned on the Fly control plane (works today; moves with the FeltDB cutover of
`SERVER-PLAN.md` §9, which retires Fly), **or** the Hetzner control plane gets a public route (an explicit
owner decision that `boundry.caddy` and `PLATFORM.md` currently argue against), **or** the function does not
run on Vercel but as a fifth hardened container in `compose.yml` on the private network (which contradicts
"runs as a Vercel Function" and adds a service to the platform project, though not a server). This is the
owner's call (§12 Q1). The audit recommends the first for Phase 1, because it is the only option that needs
no new decision about the Hetzner host and the migration cost is one FeltDB application's backup and
restore, which `backup-boundry.sh` / `restore-instance.sh` already cover for applications on the control
plane.

**What the deployment needs, whichever authority** (`intelligence/README.md` "Configuration and
provisioning", matched against `provision.mjs`): tenant + application `boundry-intelligence`, the contract
published and promoted, a data key (`state:read`, `state:write`), the four Vercel variables, one ingestion
key per product source minted through `POST /sources/`. Provisioning is operator work with an operator key;
no code.

## 11. The website

`boundry.company` is static HTML built by `src/build.mjs` from `content/*.json`, with no runtime data.
Private intelligence cannot appear on those pages: a page that called the owner API would need the owner
token in the browser. The owner interface is therefore an **authenticated** surface, and nothing today
authenticates an owner except the bearer token. Two honest options, both future work: (a) a small
owner-only page under the same Vercel project that signs in through AuthBoundry (or the FeltDB console's
platform-owner identity) and calls the function server-side; (b) no web interface, the owner uses the API.
The current state is (b). What must not happen is (c): a public page that reads intelligence, because the
API's authorization model is "the owner reads, nobody else", and public aggregates would need a separate,
reviewed disclosure policy that does not exist.

## 12. Unresolved questions (owner decisions, not engineering defaults)

| # | Question | Why it blocks | Recommendation |
|---|---|---|---|
| Q1 | Which FeltDB control plane hosts `boundry-intelligence`: Fly now, Hetzner after a public route, or a container on the private network? | the function cannot be configured without it (§10) | Fly for Phase 1; migrate with the FeltDB cutover |
| Q2 | Who signs the owner in: a bearer token (now), AuthBoundry, or the FeltDB console's platform owner? | the owner interface (§11) and key issuance (§8) depend on it | keep the token for Phase 1; design AuthBoundry owner sign-in before any owner page |
| Q3 | Where does the feedback forwarder live (B or C in §9), and does `createFeedbackProvider` offer an observation hook? | the AppPort forwarding PR cannot be scoped until verified | verify the hook in `@appport/sdk` 1.7.0 first; add it in AppPort if absent |
| Q4 | Which products emit first, and with what identity? | `product.id` values and ingestion keys are per product; nothing emits today | FeltKit (one host, one emitter) and AppBoundry's portal; FeltDB and AppPort Services later, if at all (a library has no process to flush a queue) |
| Q5 | Is `@boundry/intelligence` published to npm, or do products vendor the emitter? | products cannot depend on a private package in another repository | publish `@boundry/intelligence` with only `./emitter` and `./contract` as its public surface |
| Q6 | Retention scheduling | purge is a manual owner route | a `boundry-*.timer` on the Hetzner host once the platform is installed, or a Vercel cron; decide with Q1 |

## 13. Implementation sequence

Each step is its own PR with its own evidence. None starts before Q1 is answered.

1. **Provision and first ingestion (Boundry; Q1 decided).** Provision the application on the chosen
   control plane with the existing management API (the steps `provision.mjs` performs, run against the
   chosen URL); publish `INTELLIGENCE_CONTRACT`; configure Vercel; mint one source key. Evidence: the
   intelligence test suite run against the **remote** authority (not only the local runtime), a live
   `POST /events` accepted-after-commit, a live owner `GET /events` with its audit row, a 503 with the data
   key removed. No product emits yet.
2. **Minimal AppPort-to-Boundry event contract (AppPort / Boundry).** Freeze the minimum types of
   [ecosystem-events.md](ecosystem-events.md) §2; settle the open points there; record the mapping from
   `appport.feedback/1` lifecycle updates to `feedback.updated` events. Evidence: the contract test runs the
   mapped cases through Core's feedback validator (as `contract.test.mjs` already does for `context`).
3. **Feedback forwarding (AppPort SDK hook, then the host).** Q3. Evidence: a provider update in a FeltKit
   application produces exactly one `feedback.updated` event, idempotent across a retry, and none when the
   emitter is unconfigured.
4. **Owner-query API hardening (Boundry).** Q2 and Q6: owner identity, scheduled retention, rollups if
   metrics reads exceed the 100 000-event bound.
5. **Product integrations (one PR per product).** Q4 and Q5: FeltKit first (emit `capability.invoked` and
   `task.*` from the runtime's after-commit path with the product's own authenticated principal marked
   `verified`), then the AppBoundry portal (`product.released`, deployments), then FeltDB's control plane if a
   process-level emitter is acceptable there.

## 14. Parallel work that must not get lost

**Published-package pins in FeltKit are stale.** From `feltkit/packages/sdk/package.json` and
`package-lock.json` against the registry (checked 2026-11-09):

| Package | FeltKit pins / locks | Registry | Note |
|---|---|---|---|
| `@appport/protocol` | `1.4.1` | 1.5.0 | 1.5.0 carries `appport.feedback/1`; `@appport/services` 0.16.0 requires `>=1.5.0` |
| `@appport/sdk` | `1.6.0` | 1.7.0 | 1.7.0 carries `createFeedbackProvider` |
| `@appport/services` | `>=0.15.0 <1.0.0`, locked 0.15.0 | 0.16.0 | 0.16.0 adds `FeltDbFeedbackStore` and requires protocol 1.5.0 |
| `@appport/schema` | `1.1.5` | 1.1.6 | |
| `@appport/authorization` | `1.1.0` | 1.1.1 | |
| `@appport/core` (transitive) | locked 1.7.0 | 1.7.1 | |
| `@feltdb/core` | `>=0.21.0 <1.0.0`, locked 0.21.0 | 0.21.0 | current |

A FeltKit dependency-alignment PR is warranted (sequence item 2 of the roadmap) and must precede any FeltKit
feedback or intelligence work; the protocol bump is the one with semantic content. The monorepo build does
not prove this: FeltKit's lock resolves the registry packages, not the sibling checkouts.

**FeltKit composition gaps**, ordered by dependency evidence: G3 (schema-valued identity claims) needs
nothing new in the SDK and is the next composition PR; G8 (role grant surface) needs a Studio action or CLI
over `accounts.setRoles`, independent of G3; GAP-17 (permission-aware MCP `tools/list`) needs the
authorizer at listing time in `server/mcp.ts`, independent of both. None depends on this workstream.

## 15. Acceptance criteria, checked

| Criterion | Met | Where |
|---|---|---|
| Correct repository ownership established | yes | §3 |
| Existing runtime identified | yes (Vercel Function); its FeltDB authority is Q1 | §4, §10 |
| FeltDB integration established | as design, with the existing API; not provisioned | §5 |
| Ingestion ownership defined | yes | §6 |
| Private query boundary defined | yes; owner identity is Q2 | §6, §8, §11 |
| AppPort integration defined | the protocol and store are identified; the forwarder's home is Q3 | §9 |
| No duplicate infrastructure proposed | yes: one FeltDB application, one function, existing keys and contract flow | §5, §10 |
| Unsupported assumptions explicitly identified | yes | §10, §12 |
| No implementation prematurely introduced by this PR | yes; the one that already exists is evaluated, not extended | §1 |
