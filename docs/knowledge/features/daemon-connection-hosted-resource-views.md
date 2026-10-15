# Daemon connection — hosted resource views

Part of [Daemon connection lifecycle](daemon-connection-lifecycle.md#hosted-resource-views).

## Discovery and bound resources

Select a named host with `registry.connectionFor(serverId)` (null for an unknown
host). Its trusted main-process `hostedApps` API, backed by
`src/main/transport/hostedApps.ts`, owns discovery independently of conversations:

- `read()` returns a structured copy of `HostedAppsState`: `type` is `unavailable`,
  `unsupported`, `loading`, `failed` with static `error`, or `ready` with `revision`
  and `items: HostedAppRecord[]`. Find the current app in those copied items;
  mutating the copy cannot change authority. Records retain every desired/observed
  state, including stopped or failed apps and nullable releases/error summaries.
- `subscribe(listener)` observes invalidation and status/record changes and returns
  an unsubscribe function. Listeners read the current copy; listener exceptions
  cannot escape into dispatch.
- `refresh()` invalidates readiness and starts a new authoritative walk. Calls
  during an active refresh coalesce. Unavailable/unsupported hosts send no discovery
  requests.
- `openView(appId)` returns `{ ok: true, view }` only from a complete current
  snapshot plus contiguous updates, for a running record with non-null
  `active_release`. Otherwise it returns `{ ok: false, error: 'unconfirmed' }`
  locally. The caller cannot authorize a binding with a cached record or release.

The hello advertises `hosted_apps_v1` with the background handlers installed.
Discovery support requires that capability in the current validated acknowledgement
and `ack.server_id` matching the named paired host. Each supported initial
connection, automatic re-handshake and explicit reconnect starts fresh discovery;
cached running state grants no readiness. Capability downgrade or a foreign host
acknowledgement leaves discovery unsupported. Identical app IDs on different hosts
have independent records and bindings.

The successful binding's `view` offers `request(input, signal?)` and `retire()`.
The underlying `hostedResources.openView(appId, release)` remains the lower-level
transport seam, backed by `src/main/transport/hostedResources.ts`; it checks
authentication/capability and pins identities, but does not establish discovery
readiness. Native consumers use `hostedApps.openView` for that authority. Request
input discriminates `app_asset_request` and `app_api_request`, with wire payload
fields except `app_id`/`release_version`: the closure pins those identities, its
connection, unique view scope and resource generation. Callers supply no envelope
ID or response routing authority. Discovery, resource, credit and cancel IDs share
`nextEnvelopeId`, which stays monotonic across dials.

The synchronous owner queues at most sixteen pending operations per view,
including active work, with at most eight active per connection. Metadata reserves
declared bytes against 16 MiB per connection before allocation. The
[contextual codecs](wire-codec.md#response-metadata-and-original-request-correspondence)
bound assets to 8 MiB/256 chunks, APIs to 1 MiB/32 chunks, and request bodies/chunks
to 32768 decoded bytes. Completion requires one accepted metadata frame, feasible
chunk counts, consecutive granted chunks, exact declared length/count and SHA-256.
Validated zero-body metadata completes immediately. The initial request grants only
chunk 0; consuming each nonfinal chunk sends one next credit, which grants nothing
until its send observation reports written. Other transport/control traffic keeps
running while a resource waits.

`request` resolves to `{ ok: true, metadata, bytes: Buffer }` or
`{ ok: false, error, uncertain }`. Allowed API verbs, encoded queries, binary
bodies and permitted headers retain the
[wire HTTP semantics](wire-codec.md#resource-requests-and-http-limits).
Non-2xx HTTP status remains a successful resource result; HEAD/204/205/304 deliver
an empty buffer. Failure categories are `unavailable`, `retired`, `aborted`,
`limit`, `invalid`, `timeout`, `corrupt`, `bridge` and `send-failed`.
Diagnostics contain static event/code only. Validated bytes travel over the
existing encrypted transport and stay in main until delivered into the isolated
native viewer below; no direct HTTP access or body persistence is added.

## Native viewer

`src/main/index.ts` publishes `createHostedAppViews(registry, diagnosticLog)` on
the readonly native `app.hostedAppViews` property. Trusted Fetch/chrome consumers
call `open(parent, serverId, appId, bounds)`; no production navigation entry or
renderer IPC is installed. A successful open replaces the previous view under
that parent. Bounds are Electron rectangles in the parent's content view;
`resize(bounds)` updates them while live and `close()` is idempotent.

The controller captures the named host's discovery service and calls its
readiness-gated `openView(appId)`. Never substitute `registry.active` or authorize
through the lower-level `hostedResources.openView(appId, release)`. Ordinary opens
can consume existing authority. Refresh is an invalidation, so refreshing on every
open would retire other bindings on that host. A received discovery request is
only dispatch evidence: readiness requires the complete response and contiguous
updates. Wait for authoritative opening, retaining the first successful handle;
repeated successful opens replace the content being observed.

### State and native capability

Refusal returns `{ ok: false, error: 'unconfirmed', state }` without hosted
content. `state.type` is `unsupported` for unsupported discovery, `disconnected`
for an unknown/unavailable host, `loading` while discovery is pending and
`unavailable` for other refusals. A destroyed parent also refuses opening.

Success returns `{ ok: true, view }` with `origin`, native `content`, `read()`,
`subscribe(listener)`, `resize(bounds)`, `close()` and `request(input, signal?)`.
`read()` copies the static state; subscribers re-read it and receive an unsubscribe
function. State starts `loading`, becomes `ready` after hosted document load and
returns to `loading` on navigation. Terminal states are `disconnected` for lost
connection availability, `unsupported` for capability loss, `unavailable` for
other authority/load/setup/render failures and `closed` for close/replacement or
parent/content destruction. Listener exceptions cannot alter policy.

The native `request` delegates to the captured discovery binding, including its
API methods and abort support. A result arriving after native retirement becomes
`{ ok: false, error: 'retired', uncertain }`, preserving mutation uncertainty when
the operation could have been sent. No request capability is installed in page
JavaScript. This seam supports the later Fetch adapter; it does not implement
that adapter's browser behavior.

### Browser resource loading

Each view has a fresh `https://app-<32 lowercase hex>.invalid` origin generated
from 16 random bytes and its own nonpersistent session with cache disabled.
Host/app/release/connection/view scope is held by the binding outside page code.
The session HTTPS handler independently rejects wrong origins, credentials in
URLs, non-GET methods and Range. There is no direct-network fallback or body cache.

Paths under `/api/` become API GET requests with an empty body and only permitted
`accept`, `content-type` and `if-none-match` request headers. Other paths become
asset requests. Fragments are excluded and empty queries omitted; extracting
`URL.search` without rebuilding search parameters preserves encoded query bytes,
order, duplicate keys and empty values. Relative/root-relative modules, dynamic
imports, CSS and images use the same handler and validated complete-body boundary.

Main cancels page main-frame navigation and reissues same-origin loads with a
private random per-view `X-Pyry-Navigation` header. Only an exact stamp grants
asset `navigation: true`; a page-selected header cannot grant SPA semantics.
The service may return the SPA entry only for a missing extensionless navigation
outside API/reserved roots. Missing subresources stay 404. Request-destination
metadata and webRequest header mutation are insufficient in Electron 33's protocol
handler path; the private stamp is the authority.

Successful resource results preserve validated bytes, MIME, permitted headers and
HTTP status, synthesize `content-length`, and add exact CSP/nosniff headers.
204/205 responses use null bodies. The loader rejects 3xx as network errors and
never follows redirects; other non-2xx statuses such as 404 remain HTTP responses.
The lower-level native request retains resource HTTP semantics, including 3xx
results. Fetch adaptation must define its own redirect/mutation behavior in
[#1961](https://github.com/pyrycode/pyrycode-desktop/issues/1961).

### Browser isolation and document-start policy

The `WebContentsView` has Node integration and webview tags off, context isolation
and renderer sandbox on, with no preload or client bridge. Hosted HTML never
enters the privileged renderer. Native policy denies external/cross-view URLs,
other schemes, frames, redirects, popups, downloads, authentication and OS/device
permissions. The app-owned document-start script immutably disables XHR,
EventSource, WebSocket, workers, WebRTC, file pickers and both `cookieStore` and
`CookieStore`; beacon returns false and service workers are unavailable. Forms
are blocked by CSP. Raw non-GET and Range fail locally instead of dropping bodies
and forwarding GETs.

Setup first loads trusted `about:blank`, attaches the native debugger, enables
Page, installs `Page.addScriptToEvaluateOnNewDocument`, disables document cookies
with `Emulation.setDocumentCookieDisabled`, and intercepts file choosers before
loading hosted bytes. Setup failure or debugger detachment retires the view.
Electron 33 contextBridge cannot override existing browser properties, so a
lockdown preload would not establish this policy. Native document-cookie disabling
alone leaves Cookie Store writes usable; deny both APIs before page scripts and
verify the native session jar as well as page-visible behavior.

Every resource response receives `X-Content-Type-Options: nosniff` and this CSP;
the privileged client's CSP is unchanged:

```text
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; worker-src 'none'
```

### Native retirement

Discovery notifications check the captured running release. Release change,
removal/non-running state, discovery gaps/refresh/failure, disconnect,
re-handshake/unpair, replacement and parent teardown all retire the native view.
Cleanup aborts loader work, retires the binding, detaches/closes content, removes
the HTTPS handler, denies remaining session requests and clears storage. No old
handle reopens, even for the same names and release. Rediscovery authorizes only
a new binding/session/origin.

Loader and bound-request completions check retirement after awaiting resources.
An incrementing navigation fence also stops an earlier aborted `loadURL` from
retiring a newer navigation. Cleanup is idempotent; observer failures cannot
restore authority. Diagnostics contain static event/code only, without identities,
URLs, queries, payloads, credentials or caught exception text. See
[ADR 0012](../decisions/0012-hosted-app-native-isolation.md) for the isolation choice.

Trusted chrome/placement remains
[#1992](https://github.com/pyrycode/pyrycode-desktop/issues/1992), entry points
[#1928](https://github.com/pyrycode/pyrycode-desktop/issues/1928), and real
daemon/relay/SQL proof [#1929](https://github.com/pyrycode/pyrycode-desktop/issues/1929).

## Deadlines and retirement

Discovery walks one pending `list_apps` request per connection, with at most
16 records per page and 256 records per host. App IDs must increase strictly
within and across pages at one snapshot revision. Publish only a complete atomic
snapshot, including an empty result. During the walk, buffer at most 256 newer
`app_updated`/`app_removed` notifications. Discard revisions at or below the
snapshot and apply newer whole records or removal tombstones contiguously before
publishing. Ready-state notifications use the same contiguous rule. A correlated
`apps.changed` error (including cursor expiry), page revision/order drift, revision
gap or notification overflow discards the incomplete walk and coalesces a restart.
Malformed owned traffic fails discovery; stale, foreign and cross-generation
replies cannot certify readiness.

A refresh has a fixed thirty-second deadline from enqueue, including all its
restarts, and a five-second inactivity limit refreshed only by an accepted list
page. Restart errors and unrelated notifications cannot extend inactivity. Expiry,
admission exhaustion, invalid traffic, other bridge errors and request/send failure
leave `failed` with static `timeout`, `limit`, `invalid`, `bridge` or `send-failed`.
That state grants no readiness and stays failed until a trusted caller requests
`refresh()` or a new supported connection starts discovery. Daemon retry hints
alone do not authorize another attempt. Completion/failure releases walk buffers
and deadline/restart timers; reset also clears cancellation bookkeeping.

### Resource deadlines

Resource operations separately keep their thirty-second enqueue deadline and
five-second active progress timeout, refreshed only by accepted metadata/chunks.
Queue promotion checks enqueue expiry before sending; inbound progress checks
both deadlines before refreshing inactivity. Timer callback ordering must not
dispatch expired work or let a late frame rescue it.

### Binding retirement

Loss of authoritative discovery retires all discovery bindings before notifying
observers. Release change, removal or non-running state retires just the affected
app's bindings; unaffected apps and hosts remain usable. `hostedResources.retireViews`
holds shared queue promotion until the entire affected binding set is retired,
preserving an existing pump guard. Retiring handles sequentially without that
barrier would let an active read settling in the first scope dispatch a queued
stale mutation in another affected scope. Queued mutations that were never sent
settle with `uncertain: false`; eligible unaffected work resumes after the barrier.

Abort retires one resource operation. View `retire()` permanently invalidates that
handle, unregisters its discovery binding and settles its pending work; owner
`hostedResources.retire()` invalidates every resource view on the connection.
Rediscovery permits fresh bindings and reads, never revival of old handles or
replay of uncertain mutations. Resource terminals settle once, remove timers/abort
listeners and release reservations/partial bytes. Invalid correlated resource
responses, bridge errors and send/drop failures affect their own operation.

### Cancellation ownership

Discovery lists/cancellations and resource credits/cancellations share sixteen
control reservations per connection. Pending correlations and held sends reserve
separately, so fewer than sixteen cancellations may be admitted. A held send's
reservation survives target or acknowledgement expiry until its send observation
or connection reset: releasing it earlier would allow repeated refreshes to grow
the Noise rekey buffer. Exhaustion fails the affected work locally with `limit`.

Retire obsolete pending list work immediately and, while connected and capacity
permits, send `app_cancel` with the target `request_id` and no `app_id`. Resource
retirement, abort, timeout and response failure cancel attempted work with app
scope. Each cancellation has its own allocated envelope ID matched by
`app_cancelled.in_reply_to`; its payload must match the target request and scope
(app omitted for a list). Target settlement and fresh discovery never wait for
the acknowledgement. Cancellation correlations expire independently after five
seconds; acknowledgement, malformed/wrong-target reply or send failure releases
only that cancellation's bookkeeping, without reviving the target. Held-send
reservations retain their independent lifetime.

### Connection reset and dispatch

Relay drop, handshake, explicit reconnect, authentication/update-required failure,
driver error/terminal and stop reset resources before discovery. Unpair removes
and stops the host; pairing replacement reconnects it. Reset resources first so
discovery retirement cannot send old-session resource cancels during re-handshake;
observers run only after both authorities are invalidated. Reset advances resource
generation and releases controls, timers and buffers. Old handles stay retired even
if host/app/release names match;
the dial fence rejects superseded-driver callbacks and the shared allocator prevents
reused IDs across redials. Unknown/late metadata/chunks allocate nothing. Failed
POST/PUT/PATCH/DELETE operations become `uncertain: true` once sending is attempted,
including a thrown/refused send; queued operations never attempted remain certain.
No mutation is automatically replayed.

Hosted dispatch preserves fatal authentication/update-required precedence, then
routes discovery-owned list/cancel replies before resource-owned replies and
generic envelope admission. It validates original bytes through the hosted codecs.
Unvalidated `parseJsonObject` hints may locate and retire owned work even when
`decodeEnvelope` would reject it; they never authorize byte acceptance. Valid fatal
authentication/update errors retain precedence. See the
[wire boundary lesson and focused coverage](wire-codec.md#consumer-obligations-and-testing).

## Native viewer verification

`e2e/hosted-app-view.spec.ts` invokes the production native controller through
main-process evaluation with spec-local fake-daemon replies. It exercises modules,
SPA/history, a multi-frame binary body, sizing/close, HTTP/query/MIME handling,
hostile-content denial, independent hosts/views/releases and lifecycle retirement.

Absence assertions follow a completed allowed read. For pending parent teardown,
observe the held API request before destroying its separate parent, verify the
correlated cancellation and destroyed content, then deliver old bytes after a
fresh view opens. A completed successor read precedes its ready-state assertion.
Cookie proof checks immutable Cookie Store globals, denied writes and the native
session's empty cookie jar. SPA readiness requires destination pathname, complete
document readiness and its module marker together; a marker in the old document
alone can pass before navigation. Held initial/gap/re-handshake discovery replies
prove local refusal until authoritative completion grants a fresh loaded origin.

The [verifier PASS verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1993#issuecomment-6186177785)
independently inspected the configured recovery run at `75f0ea43`: **407 executed,
407 passed, 0 failed, 1 skipped, 0 retries**, with four workers, clipboard/parallel
projects and repeatEach 1. All nine native-view tests were present and passed:

- `native resources load modules, SPA navigation, binary bytes and HTTP semantics`;
- `hostile content cannot escape native policy or dispatch unsupported traffic`;
- `authority changes retire pending work and isolate releases and two hosts`;
- `native view retires on removed/discovery-gap/rehandshake/unpair/parent`
  (five parameterized cases);
- `unsupported and unknown hosts refuse native content without discovery bypass`.

Both history-gap tests and all three history-walk tests also passed, including
`an upward input asks from up to two viewport heights below the top and not one
pixel further`. The original unrecovered history-walk failure's cause remains
unknown; this evidence establishes the required full-suite pass, not a production
history repair. The sole skip was `desktop-isolation.spec.ts` → `an independent
input-enabled cover preserves isolated hover`, whose never-shown window receives
no display pointer. Only the plan changed between the tested repair and reviewed
head `e1085c43`. The dispatcher's later green gate has no per-test counts; the
named-test evidence above comes from the verifier's inspected recovery artifacts.
No live-Claude run is claimed; real daemon/relay/SQL proof remains #1929.

## Discovery verification

`hostedApps.test.ts` covers complete/empty walks, interleaved updates/removal,
restart/deadline/control bounds, copied reads, cancellation correlation and bulk
retirement. `daemonConnection.test.ts` exercises advertisement, per-host support,
re-handshake/downgrade and identical app IDs on two hosts. Its held walk uses a
positively processed unrelated message/control request as the dispatch barrier;
silence alone would not prove unrelated traffic remains runnable.

The [verifier PASS verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1990#issuecomment-6183913898)
at `f27ef45f` records 10,274 unit tests executed/passed, 0 failed and 3 skipped,
and 398 fake-transport Playwright tests executed/passed, 0 failed and 1 skipped.
Its PASS review confirms all seven `retires affected bindings before queue promotion`
variants were present and passed: release, removal, non-running state, refresh,
gap, invalid notification and reset, with queued POSTs unsent and unaffected work
completing. This is fake transport evidence; live acceptance remains with #1929.
