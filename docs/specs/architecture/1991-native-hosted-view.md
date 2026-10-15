# Secure native read-only hosted viewer

## Files read
- `src/main/transport/hostedApps.ts` → `createHostedApps`: authoritative discovery, bindings and synchronous invalidation notifications.
- `src/main/transport/hostedResources.ts` → `HostedResourceInput`, `openView`: validated complete bodies, cancellation and generation fencing.
- `src/main/connectionRegistry.ts` → `connectionFor`: capture one named host, never active selection.
- `src/main/index.ts` → `createWindow`, registry composition: privileged preload must remain separate.
- `e2e/fixtures/launchPairedApp.ts` → `launchPairedApp`: encrypted fake transport and two-host fixture.
- `src/main/transport/fakeDaemon.ts` → `buildReplyFrames`: spec-local resource scripting.
- `docs/knowledge/features/daemon-connection-lifecycle.md` → Hosted resource views: refresh invalidates existing bindings.
- `docs/knowledge/features/development-verification-evidence-that-cannot-pass-too-early.md`: positive processing barriers before absence checks.
- Approved daemon `3120-hosted-app-contract.md` at `964c5c4bab8e9267ee5e4c374d34a5bb1ebeb6f0`, sections 6–9: HTTP, exact CSP and retirement.

## Design source
Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4
Read design context and screenshot: fixed sidebar alongside a filling content pane. This slice supplies a caller-sized native surface only; #1992 supplies placement and trusted chrome. No reference icons, typography or dashboard are implemented here.

## Context
Hosted HTML needs an isolated native consumer of the merged readiness/resource boundary. Fetch adaptation belongs to #1961; shell integration to #1992 and live acceptance to #1929. The native isolation boundary merits a documentation-stage ADR. No fetched feature branch overlaps the proposed files.

## Design
`createHostedAppViews(registry, log)` exposes native-only `open(parent, serverId, appId, bounds)`. The composition root exports its constructed controller for trusted consumers, without IPC or a navigation entry. A handle exposes native `content`, `origin`, `read()`, `subscribe(listener)`, `resize(bounds)` and `close()`. Opening without authority returns a typed failure and static status. Replacing a parent's view retires the previous one.

Each successful open captures `connectionFor(serverId).hostedApps`, its running release and readiness-gated binding. Create a `WebContentsView` with a random 128-bit origin and fresh memory-only session. Attach it to the parent at supplied bounds. No client preload, Node, webview, native bridge or renderer integration. An app-only, copied JS preload uses contextBridge solely to replace unsupported constructors with unavailable values; no IPC is exposed. Electron-vite's existing `?asset` handling packages it without build-config changes.

Session policy allows only same-origin GET resource loads with no Range. Native request destination stamps navigation; the resource service owns SPA fallback and rejects reserved roots. API GET uses the API route with permitted headers and empty body. URL parsing drops fragments and preserves the raw encoded query. Return only complete validated bodies, permitted headers, exact CSP, nosniff and synthesized length; 204/205 use null bodies and loader 3xx fails. No cache is added. Deny other schemes/origins, frames, workers, sockets, beacon, forms, popups, downloads, permissions, cookies and authentication. Preserve the privileged client's CSP.

## State + concurrency model
Main-only handle state: loading → ready or terminal disconnected/unsupported/unavailable/closed. Discovery subscription checks the captured release on every notification. Any loss of authority retires the binding, aborts requests, closes webContents, detaches the surface and unregisters its protocol. A closed handle never reopens; a new open creates fresh content/session/origin. Guard every completion after await against retirement. Parent teardown and renderer failure use the same idempotent cleanup. Observer exceptions cannot alter authority.

## State transitions and identity reuse
| Event | Focused Electron proof in `e2e/hosted-app-view.spec.ts` |
| --- | --- |
| Ordinary open, resize, repeated close | native resource loading and sizing |
| SPA links, history/back/forward, missing resource | modules and navigation semantics |
| Repeated opens/replacement, same app on two hosts | host/view isolation |
| Release update twice, remove/non-running, refresh | authority retirement and fresh origins |
| Disconnect/re-handshake/unpair | authority retirement; old completion cannot load successor |
| Parent teardown with pending resource | pending cancellation and content destruction |

## Error handling
Static categories only: unconfirmed open, denied request, resource failure, load failure and terminal lifecycle status. Resource failures return network errors, never partial bytes or redirect following. Diagnostics record event/static code only; no URL, query, payload, identities, credentials or caught exceptions. Existing bounded assembly/deadlines remain authoritative.

## Testing strategy
- Test first: focused Electron spec fails before native interface exists, then invokes that production interface through the main process, never page IPC.
- Spec-local fake daemon returns metadata/credit-driven chunks; exercise modules, CSS/image loading, dynamic imports, SPA/history, binary assembly and HTTP/query/MIME semantics.
- Hostile external resources, constructors, forms, frames, downloads, permissions and raw non-GET/Range fail; follow each batch with a completed allowed read before asserting no prohibited dispatch. Verify absent client bridge/Node, independent origins/sessions and retired contents.
- Run focused spec after build; final merged-main pre-verify and build. No live spec changes; #1929 owns live proof.

## Open Questions
None. Verify Electron's request-destination header behavior in the failing-first native spec; revise if the platform requires a different native stamp.

## Security review
**Verdict:** PASS
- [Trust boundaries] Only trusted native callers choose host/app; `openView` stamps release and connection. Page URLs cannot change those selectors.
- [Tokens] No credential storage or exposure; random origin uses `randomBytes(16)`.
- [File/storage] No filesystem routing or body cache. Session is nonpersistent, cookies blocked; public bytes come only from validated resources.
- [Electron] Explicit sandbox/context isolation, Node off, app-only lockdown preload with no IPC. Main policy denies navigation escape, popups, frames, downloads, workers and permissions.
- [Cryptography] Inherit Noise and verified SHA-256 assembly; no new crypto except secure randomness.
- [Network/I/O] Session protocol and request allowlist prevent direct-network fallback. Existing queue/body/deadline limits apply; no mutation body is discarded and forwarded as GET.
- [Errors/logs] Static lifecycle/error codes only; no page text, URLs, secrets or thrown details.
- [Concurrency] One owner per parent, idempotent retirement and post-await fences; no old completion can enter a successor.
- [Threat model] Malicious relay/daemon bodies remain bounded and validated below the view. Compromised hosted renderer has no client bridge, secrets or native authority. Disk credential protection remains the existing safeStorage boundary; live daemon proof belongs to #1929.
**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-15

Sizing recount: one independently consumable viewer deliverable, four observable acceptance criteria, approximately 390 production + 285 test + 80 plan lines (755 total), at most five exported types/interfaces, one existing production call site, at most ten terminal/reject categories. No dependency additions.
