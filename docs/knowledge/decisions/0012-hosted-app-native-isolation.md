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
[#1991](https://github.com/pyrycode/pyrycode-desktop/issues/1991).

## Context

Hosted HTML and resources come from a paired daemon but remain untrusted page
content. The privileged client renderer has a preload and `window.pyry`; loading
hosted HTML there would give that content the client's authority. Discovery and
validated resource assembly already provide host/app/release bindings, complete
body validation and cancellation. The browser consumer must preserve those
boundaries through navigation, connection changes and late completion.

## Decision

Expose a main-only controller on `app.hostedAppViews`. Trusted callers choose the
parent, named host, app and bounds. Open only through that host's authoritative
`hostedApps.openView(appId)`, requiring a running active release. Do not authorize
from cached records, active-host selection or a caller-supplied release.

Give every successful open a new `WebContentsView`, memory-only session with cache
disabled and unpredictable 128-bit `https://app-<32 lowercase hex>.invalid` origin.
Keep Node off, context isolation/sandbox on, and install no preload, renderer IPC
or native page API. Pin host/app/release/connection/view scope outside page code.
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
The script also disables unsupported browser transports/workers/file APIs and
exposes no bridge. Native session/navigation handlers deny permissions, downloads,
authentication, frames, popups and URL escape. Setup failure or debugger detachment
retires content rather than leaving a partially protected page alive.

Retire on authority loss, release/state changes, connection reset/unpair,
replacement, close, parent destruction or renderer failure. Abort resources,
close/detach content, unregister HTTPS handling, deny retained session requests
and clear storage. Guard resource completions after await and fence overlapping
navigation failures. Old handles cannot revive; rediscovery permits a fresh view.

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
uses null bodies for 204/205 and rejects 3xx without following. The native handle's
bound `request(input, signal?)` retains the resource service's broader API methods
and status results for the later Fetch adapter, with a post-await retirement
check preserving mutation uncertainty. This capability is never exposed directly
to page JavaScript.

## Consequences

- Hosted content stays outside the client renderer and cannot access its keys,
  tokens, registry, filesystem or bridge. The client CSP remains unchanged.
- A retired view requires authoritative rediscovery/current authority and a fresh
  generation; cached running state cannot reopen it. Ordinary opens need no forced
  refresh, which would invalidate other bindings on that host.
- Debugger-dependent protections must be rechecked on Electron upgrades. Loading
  content before setup, detaching the debugger or reusing sessions would break
  the boundary.
- Fake-transport tests cover native policy and lifecycle. Real daemon/relay/SQL
  proof remains [#1929](https://github.com/pyrycode/pyrycode-desktop/issues/1929).
  Fetch adaptation remains [#1961](https://github.com/pyrycode/pyrycode-desktop/issues/1961),
  trusted chrome/placement [#1992](https://github.com/pyrycode/pyrycode-desktop/issues/1992),
  and entry points [#1928](https://github.com/pyrycode/pyrycode-desktop/issues/1928).

## Alternatives considered

- **Client window/preload or existing external-link handler:** reuses shell code,
  but exposes privileged capabilities or opens external URLs. Hosted content needs
  its own deny-all boundary.
- **App-only contextBridge preload:** would keep policy beside view creation,
  but cannot replace existing browser properties on the shipped Electron version.
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
- [Verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/1993#issuecomment-6186177785):
  independent review of cookie, discovery, navigation and parent-teardown repairs.

## Review trigger

Revisit when Electron's protocol/debugger behavior changes, when adding browser
capabilities, or when installing the Fetch adapter. Preserve the isolation boundary
and fail-closed setup while extending behavior.
