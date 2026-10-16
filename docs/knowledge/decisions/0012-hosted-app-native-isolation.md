---
type: ADR
title: Disposable native views isolate hosted apps
status: accepted
created: 2026-10-15
tags: [architecture, electron, security]
---

# 0012 — Disposable native views isolate hosted apps

## Status

Accepted, 2026-10-15. Implemented by
[#1991](https://github.com/pyrycode/pyrycode-desktop/issues/1991), extended with
isolated Fetch by [#1961](https://github.com/pyrycode/pyrycode-desktop/issues/1961).

## Context

Hosted HTML and resources come from a paired daemon but remain untrusted page
content. The privileged client renderer has a preload and `window.pyry`; loading
hosted HTML there would give that content the client's authority. Discovery and
validated resource assembly already provide host/app/release bindings, complete
body validation and cancellation. Hosted scripts also need bounded API writes
and readback without selecting transport identities or gaining client authority.
The browser consumer must preserve those boundaries through navigation,
connection changes, body serialization and late completion.

## Decision

Expose a main-only controller on `app.hostedAppViews`. Trusted callers choose the
parent, named host, app and bounds. Open only through that host's authoritative
`hostedApps.openView(appId)`, requiring a running active release. Do not authorize
from cached records, active-host selection or a caller-supplied release.

Give every successful open a new `WebContentsView`, memory-only session with cache
disabled and unpredictable 128-bit `https://app-<32 lowercase hex>.invalid` origin.
Keep Node off and context isolation/sandbox on. Install only a dedicated hosted
preload (`src/preload/hosted.ts`), built separately from the privileged client
preload. Expose narrow request/abort semantics, never generic IPC or native
handles. Pin host/app/release/connection/view scope outside page code.
The controller permits one live hosted view per parent; a successful replacement
retires the previous one.

Serve same-origin GET resources through the captured binding. The HTTPS handler
checks origin/method/Range itself, preserves validated complete bytes and HTTP
metadata, adds the contract's exact CSP and nosniff, and has no direct-network
fallback. Main cancels and reissues same-origin main-frame navigation with a
private per-view random header stamp; only its exact value grants navigation/SPA
semantics. Subresources cannot self-authorize SPA fallback.

After trusted `about:blank`, attach the native debugger and install app-owned
document-start lockdown before loading hosted bytes. Disable document cookies
natively, remove both Cookie Store globals immutably, and intercept file choosers.
The script disables unsupported browser transports/workers/file APIs and installs
immutable `window.fetch` using the dedicated preload's request/abort bridge.
Native session/navigation handlers deny permissions, downloads,
authentication, frames, popups and URL escape. Setup failure or debugger detachment
retires content rather than leaving a partially protected page alive.

Validate every Fetch request/abort against the exact live WebContents, main frame,
bound origin and private native document token. Page correlations are increasing
document-local cancellation keys, never wire IDs. Main independently validates
untrusted serialized semantics and delegates to the captured readiness-bound
resource service; do not add another transport state machine. Relative/same-view
asset GET and API GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS use bounded request headers
and a 32768-byte decoded body cap before IPC, including multipart overhead and
its matching explicit boundary. Only complete validated bytes/status and the four
permitted response headers reach page code. HEAD/204/205/304 use null bodies;
API redirects expose status without following or Location. Credentials stay omitted.

Own Fetch settlement before asynchronous body serialization. AbortSignal and
pagehide settle independently of a held Blob/multipart read and fence its eventual
completion from dispatch. Rotate the native document token on authenticated
preload bind, not blocked navigation attempts. On document cancellation, clear
correlations and atomically remove requests selected by binding scope and captured
signals before queue promotion, then abort controllers. Both pagehide surfaces
close idempotently through that document cancellation path. Check document and
pending-entry identity after awaiting a resource result.

Retire on authority loss, release/state changes, connection reset/unpair,
replacement, close, parent destruction or renderer failure. Retire the captured
binding before individual controller aborts, dispose Fetch listeners,
close/detach content, unregister HTTPS handling, deny retained session requests
and clear storage. Guard resource completions after await and fence overlapping
navigation failures. Old handles cannot revive; rediscovery permits a fresh view.
Lost/cancelled mutations remain uncertain, including when the service committed
but its reply was lost. Never replay them on reconnect or retry hints; reconcile
with a fresh read through newly confirmed authority.

## Rationale

Fresh origins and sessions prevent identity/storage reuse across releases, views
and hosts sharing an app ID. Main-only named-host selection prevents page URLs
from choosing another tenant or release. Readiness invalidation must destroy
Electron content as well as transport work: stopping requests alone leaves the
old page and its origin alive.

Electron 33's contextBridge refuses overrides of existing browser properties;
protocol interception also bypasses the request-header mutation/destination
metadata considered for navigation classification. A native document-start hook
and private navigation stamp establish those policies before hosted execution.
Debugger attachment is therefore part of the security boundary, with fail-closed
detachment. Disabling `document.cookie` alone leaves Cookie Store operational;
both surfaces and the native jar need regression coverage.

Resource-loader and Fetch semantics remain distinct. The loader accepts only GET,
uses null bodies for 204/205 and rejects 3xx without following. Fetch uses the
broader bound API request semantics without widening raw browser resource loading.
The preload supplies only narrow request/abort; the debugger document-start hook
replaces the existing browser Fetch property. Neither alone establishes the full
boundary. CSP/nosniff remain on browser resource responses; Fetch exposes only
`content-type`, `cache-control`, `etag` and `last-modified`.

Sequential per-request cancellation frees slots synchronously and can promote a
queued mutation before cancelling it. Atomic document-owned removal preserves the
existing resource owner's queue barrier while allowing unaffected work to resume.
Cancellation ownership must also precede body reads: a check after serialization
prevents late dispatch but cannot settle a stalled Fetch. Bounded Blob reads cannot
be stopped; discard their eventual bytes after settling and releasing listeners.
Blocked form/frame navigation attempts can leave the original document running,
so rotating its token before a replacement actually binds would strand that page.

## Consequences

- Hosted content stays outside the client renderer and cannot access its keys,
  tokens, registry, filesystem or bridge. The client CSP remains unchanged.
- The dedicated hosted bridge adds only bounded Fetch/abort. Local policy errors
  and transport failures expose static network errors; cancellation uses AbortError.
  Daemon diagnostics, full URLs/queries and bodies never enter logs or error text.
- A retired view requires authoritative rediscovery/current authority and a fresh
  generation; cached running state cannot reopen it. Ordinary opens need no forced
  refresh, which would invalidate other bindings on that host.
- Debugger-dependent protections must be rechecked on Electron upgrades. Loading
  content before setup, detaching the debugger or reusing sessions would break
  the boundary.
- Fake-transport tests cover native policy and lifecycle. Real daemon/relay/SQL
  proof remains [#1929](https://github.com/pyrycode/pyrycode-desktop/issues/1929).
  Trusted chrome/placement is
  [#1992](https://github.com/pyrycode/pyrycode-desktop/issues/1992), and entry points
  [#1928](https://github.com/pyrycode/pyrycode-desktop/issues/1928).

## Alternatives considered

- **Client window/preload or existing external-link handler:** reuses shell code,
  but exposes privileged capabilities or opens external URLs. Hosted content needs
  its own deny-all boundary.
- **App-only contextBridge preload:** would keep policy beside view creation,
  but cannot replace existing browser properties on the shipped Electron version.
  Use it for the narrow request/abort capability alongside document-start overrides.
- **webRequest/destination-based navigation classification:** avoids a private
  stamp, but does not reliably reach the intercepted HTTPS handler in Electron 33.
- **Retain the old view/session after invalidation:** avoids reconstruction, but
  leaves old content alive and risks stale completion or storage reaching a
  successor. Disposable views make retirement permanent.

## Related decisions and evidence

- [ADR 0002](0002-remote-head-over-relay-shared-wire.md): encrypted remote-head
  transport and shared wire contract.
- [ADR 0007](0007-content-free-diagnostics-by-construction.md): static diagnostics.
- [Hosted resource views](../features/daemon-connection-hosted-resource-views.md):
  caller contract, exact CSP, lifecycle, loader semantics and counted verification.
- [Architecture plan](../../specs/architecture/1991-native-hosted-view.md):
  security review, platform findings and revisions.
- [Fetch architecture plan](../../specs/architecture/1961-hosted-fetch.md):
  bridge security review, document fencing and cancellation ownership.
- [Verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/1993#issuecomment-6186177785):
  independent review of cookie, discovery, navigation and parent-teardown repairs.
- [Fetch verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/1994#issuecomment-6189074574):
  independent confirmation of atomic cancellation and serialization settlement;
  counted evidence is recorded in [Fetch verification](../features/daemon-connection-hosted-resource-views.md#fetch-verification).

## Review trigger

Revisit when Electron's protocol/debugger/preload behavior changes or when adding
browser capabilities, body encodings or bridge methods. Preserve readiness-bound
authority, document cancellation ownership and fail-closed setup while extending
behavior.
