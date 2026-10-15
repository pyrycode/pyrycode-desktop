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

The successful binding's `view` offers `request(input, signal?)`, native-only
`cancelRequests(signals)` for document-owned work, and `retire()`.
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
call `open(parent, serverId, appId, bounds)`. The production
[trusted pane bridge](paired-shell-routing.md#hosted-app-selection-and-trusted-chrome)
uses this API for named-host/app selection over privileged preload/IPC; sidebar/link
entry points remain #1928. A successful open replaces the previous view under
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

### Pane recovery and placement

`src/main/hostedPane.ts` observes the named discovery service even without a
native handle, since a refused open has no view subscription. Initial selection
stays loading through discovery and document load; complete discovery alone
cannot mark the pane ready. Missing/stopped/failed apps and lost discovery remove
ready content while trusted chrome retains its last confirmed identity.

After retirement, reconnection or completed rediscovery alone never revives the
page. Reopen on unavailable/unsupported discovery leaves recovery feedback in
place without arming automatic opening. Otherwise an accepted Reopen retires any
old view, advances the pane generation and uses the following authority:

- `ready`: reuse the complete current snapshot and contiguous updates;
- `loading`: await the existing discovery walk through its subscription;
- `failed`: request `refresh()` and await authoritative completion.

Dispatching `list_apps` is not completion. Refresh invalidates **every binding on
the host**, so unconditional refresh on Reopen would retire another window's
healthy view or an unrelated native consumer. A selected app still missing or
non-running remains unavailable until opening can succeed. By contrast, an
active-release change on a live pane is already authoritative: retire the old
page and automatically open the current running release in a fresh generation,
session and origin, without another refresh. Native subscriptions are removed
before close and stale callbacks/controls cannot alter the successor.

`HostedPane` measures its separate `.hosted-pane__surface` below the trusted
header with `getBoundingClientRect()`, `ResizeObserver` and window resize. It
rounds inward to nonnegative integer bounds in parent content coordinates;
main also rejects bounds outside the parent. Opening waits for initial layout
and starts hidden until visibility is supplied. This keeps the native surface
outside the fixed sidebar and below chrome, including when the header wraps.

CSS stacking cannot cover a native child. A `MutationObserver` watches client
dialog markers (`dialog[open]`, `[role="dialog"]`, `[aria-modal="true"]`), and
layout commands call native `content.setVisible(false)` while one is present.
Dismissal restores visibility only through the current selection generation;
stale measurements cannot expose or move its successor. Close/navigation,
privileged-page reload and parent teardown release content and subscriptions.
Capture the privileged `webContents` before teardown: reading
`parent.webContents` from the destroyed window's `closed` callback can terminate
the process. Cleanup uses the captured client when removing its owner entry.

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
the operation could have been sent. Page JavaScript gets only the bounded Fetch
adapter below, never this native handle or its authority selectors.

### Hosted Fetch

`src/preload/hosted.ts` is a dedicated sandboxed preload, built separately from
the privileged client preload by `electron.vite.config.ts`. Its `hostedFetch`
surface offers only request/abort; IPC and the document token stay in the isolated
world. `src/main/hostedAppLockdown.js` installs immutable `window.fetch` at document
start through the debugger hook. `src/main/hostedFetch.ts` validates each request
and abort against the exact live WebContents, its actual main frame, bound origin
and private document token. Main supplies host/app/release/view/generation and
wire request identity through the captured readiness-gated binding. Page sequence
numbers are cancellation correlations only; repeated numbers and extra identity
fields cannot select another operation or authority.

Fetch resolves relative or same-view URLs, strips fragments, and extracts encoded
path/query without rebuilding search parameters. Query order, duplicates, empty
values and escape spelling survive; an empty query is omitted. Asset requests
allow GET only, with `navigation: false`; `/api/` allows GET, HEAD, POST, PUT,
PATCH, DELETE and OPTIONS. Paths are bounded to 2048 characters and queries to
1024, with the [wire containment rules](wire-codec.md#resource-requests-and-http-limits).
Cross-origin/credential-bearing URLs, forbidden routes/methods/headers, Range,
GET/HEAD bodies and streaming uploads reject locally. A Request with a body is
unsupported streaming input; bodyless Requests retain method, headers and signal.

Request headers are limited to `accept`, `content-type` and `if-none-match`, with
at most 1024 UTF-8 bytes per value, no controls and at most 4096 bytes of serialized
headers. API headers reach the wire; asset headers are checked but the asset wire
shape has no header field. Credentials are omitted; no cookie or authentication
surface is enabled. Serialization accepts strings, Blob, FormData, ArrayBuffer
and binary views, with a **32768-byte decoded body cap before IPC**:

- Strings use a capped UTF-8 destination; binary views check length before copying.
- Blob size is checked before reading bytes. FormData accounts for all multipart
  headers, separators, field bytes and Blob sizes before reading Blob data, then
  sets an explicit content type with the matching generated boundary.
- Preload bounds the serialized shape again. Main independently validates it,
  including a 4096-character URL limit, before the existing contextual resource
  codec and transport admission/assembly machinery accept it.

Only complete validated responses cross back. Fetch preserves opaque bytes,
status (including non-2xx) and the four permitted headers: `content-type`,
`cache-control`, `etag`, `last-modified`. HEAD/204/205/304 have null bodies. API
redirects return their status without following or exposing Location. Fetch
responses do not inherit the resource loader's synthesized content-length,
CSP or nosniff headers; the document still receives its native isolation policy.
Abort rejects with AbortError; other bridge/transport failures become static
`TypeError('Failed to fetch')`, never daemon diagnostics. There is no browser
network fallback or automatic retry.

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
results. The [Fetch adapter](#hosted-fetch) has its own response semantics and
does not broaden the browser resource handler's GET-only policy.

### Browser isolation and document-start policy

The `WebContentsView` has Node integration and webview tags off, context isolation
and renderer sandbox on, with only the dedicated hosted preload and no client
bridge. Hosted HTML never enters the privileged renderer. Native policy denies
external/cross-view URLs,
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
preload alone would not establish lockdown or replace Fetch. The dedicated
preload supplies the narrow bridge; the document-start hook installs browser
overrides. Native document-cookie disabling alone leaves Cookie Store writes
usable; deny both APIs before page scripts and
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
Cleanup retires the binding **before** aborting individual Fetch/loader
controllers, removes Fetch IPC listeners, detaches/closes content, removes the
HTTPS handler, denies remaining session requests and clears storage. No old
handle reopens, even for the same names and release. Rediscovery authorizes only
a new binding/session/origin.

Loader and bound-request completions check retirement after awaiting resources.
An incrementing navigation fence also stops an earlier aborted `loadURL` from
retiring a newer navigation. Cleanup is idempotent; observer failures cannot
restore authority. Diagnostics contain static event/code only, without identities,
URLs, queries, payloads, credentials or caught exception text. See
[ADR 0012](../decisions/0012-hosted-app-native-isolation.md) for the isolation choice.

Trusted chrome/placement uses the [paired shell selection seam](paired-shell-routing.md#hosted-app-selection-and-trusted-chrome).
Sidebar/link entry points remain [#1928](https://github.com/pyrycode/pyrycode-desktop/issues/1928), and real
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

Fetch owns settlement before starting body serialization: its document active
set and AbortSignal listener are registered before any Blob/multipart await.
Pre-aborted and in-flight signals reject with AbortError, including while a body
read is held. One settlement removes the signal listener and active entry. Blob
reads have no cancellation API; their bounded eventual result or failure is
discarded after settlement and cannot dispatch IPC or settle again. Registering
ownership only after serialization would leave a stalled body uncancellable.

The isolated preload obtains a new native random document token on authenticated
main-frame bind. Rotate there, not on attempted navigation: Electron announces
blocked form/frame navigations without replacing the document, so rotating on
those attempts would strand its live adapter. Each layer admits at most sixteen
pending adapter operations. Completion checks both token and pending-entry identity
after await; a new document can restart its sequence without accepting old replies.

On document bind/replacement or pagehide, invalidate the token and clear native
correlations, then use binding `cancelRequests(signals)` to remove the complete
document-owned set under `withoutPromotion`, selected by both binding scope and
captured signal. Only then abort individual controllers. Sequential aborts would
free a transport slot and dispatch a queued mutation before its turn to cancel.
Unrelated work resumes after the barrier; successor resource loads are unaffected.
Both preload and document-start pagehide paths use one idempotent document abort,
close their request surfaces and settle local work, including pending serialization.
Ordinary AbortSignal cancellation remains per request. Terminal view teardown
retires the entire binding first, then disposes Fetch and loader controllers.

Losing or cancelling a dispatched mutation does not prove it failed at the service.
Fetch exposes a network failure/abort rather than native uncertainty details;
applications reconcile with a fresh read after readiness is confirmed and a new
binding opens. Reconnect and retry hints never replay writes. Old page keys,
tokens, replies and retired handles cannot resolve a successor's work.

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

### Fetch verification

The [verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/1994#issuecomment-6189074574)
at `139fa318` records **427 Playwright tests executed and passed, 0 failed,
1 skipped**, including all **23 hosted-view cases present and passed**. Unit
evidence is **10,287 executed and passed, 0 failed, 3 skipped**. The dispatcher's
gate summary has no per-test counts; these counts and named-case confirmation
come from the verifier's inspected gate evidence.

`e2e/hosted-app-view.spec.ts` drives the production native view and adapter through
`launchPairedApp`, with retained service state confined to the focused scenario.
The passed hosted-view cases include:

- `Fetch writes retained preferences and serializes bounded request bodies`:
  POST/204, recreated-view GET, exact query/header/body bytes, binary/Blob/multipart
  encodings, 32768-byte acceptance and oversized-body/multipart-overhead rejection,
  method restrictions and non-2xx/redirect/null-body semantics.
- `Fetch cancellation and document replacement fence late completions and forged bridge calls`:
  pre/in-flight abort, one settlement, stale token/frame/sender rejection and late
  replies after replacement, followed by a completed allowed read.
- `Fetch reconnect reconciles committed uncertain writes without replay`: the
  fake service commits before withholding its reply; reconnect waits for fresh
  discovery, opens a new origin and reconciles by GET, with exactly one POST.
- `Fetch cancels held Blob serialization on signal`,
  `Fetch cancels held Blob serialization on pagehide`,
  `Fetch cancels held FormData serialization on signal` and
  `Fetch cancels held FormData serialization on pagehide`: a positive body-read
  barrier precedes cancellation; AbortError must settle **before** releasing the
  held read. Releasing first would conceal an unowned serialization await.
- `Fetch bulk cancellation never promotes a queued mutation on <cause>`: all seven
  cases (`close`, `view-replacement`, `parent`, `document-bind`,
  `document-navigation`, `fetch-pagehide`, `preload-pagehide`) saturate eight active
  reads and queue a POST. Ordered native rejection proves enqueue processing;
  cancellation acknowledgements and a completed successor read fence late replies
  before asserting zero POST dispatches.

Held-body cases also await eventual body completion and completed native processing
before checking zero mutations and single settlement. Native boundary unit coverage
in `hostedFetch.test.ts` checks sender/frame/origin/token, independent input
validation, correlation reuse and stale completion; `hostedResources.test.ts`
covers scoped atomic cancellation and unaffected queue resumption. Retained fake
state proves the client contract only. No live-Claude run or real persistence is
claimed; real SQL durability and relay acceptance remain
[#1929](https://github.com/pyrycode/pyrycode-desktop/issues/1929).

### Trusted pane verification

`e2e/hosted-content-pane.spec.ts` uses spec-local fake-daemon replies with
`launchPairedApp` and selects through the production `window.pyry` preload/IPC
path. Its six cases are:

- `geometry, dialogs and selection`;
- `loading discovery and recovery`;
- `release replacement and unavailable states`;
- `two hosts and stale controls`;
- `unsupported and lost discovery retain identity without reviving pages`;
- `pending native load cannot complete into a successor selection`.

The [verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/1995#issuecomment-6188602014)
at `7f0afe7c` confirms the same-host recovery repair and added static coverage.
The dispatcher reports green full gates without per-test counts; the PR/verdict
give focused-run totals. These do not supply per-test execution evidence, so the
case list above describes coverage without claiming named-test passes.
`HostedPane.test.tsx` separately covers escaped retained labels, all lifecycle
statuses, recovery/close controls, a separate surface and closed output through
static markup; it cannot establish effects or native composition.

The geometry case compares measured surface and actual native bounds within one
pixel at 1280, 800 and 1100 content widths, verifies placement below chrome and
outside the sidebar, and hides/restores the same native child around Pair new
host. Electron `View` exposes `setVisible` without a visibility getter; observe
the actual setter calls alongside native bounds rather than treating renderer
visibility as proof. Parent destruction keeps a second window alive so the test
can positively observe the hosted `webContents` disappearing.

Held discovery proves loading before completion and Reopen waiting for an
already pending walk. After a discovery gap, wait for the `hosted-discovery/ready`
diagnostic before asserting that the retired page stayed absent. The same-host
companion regression then retains another native consumer, waits for Reopen's
generation advance, and completes a resource read through that companion without
another `list_apps`. A successful reopened pane alone would miss host-wide
invalidation. For stale document completion, deliver held old bytes followed by
a same-socket authoritative label update before asserting the successor survived.

`BrowserWindow.capturePage()` omits native child views. The focused spec writes
`/tmp/builder-1992/composed-1100.png` by combining actual client and hosted-content
captures at measured native bounds, checking content capture size before copying.
The plan records OS capture failing with “Failed to get sources.” This image is
layout evidence, not an independent whole-window native capture; bounds and
`setVisible` assertions establish placement and hide/restore behavior. The verifier
compared the existing sidebar/inset-pane/chrome structure with Figma node 102:4;
hosted HTML remains synthetic. No live daemon/relay/SQL result is claimed here;
that proof remains #1929.

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
