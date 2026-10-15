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

## Revisions
2026-10-15: Electron 33's contextBridge refuses overriding existing browser properties, and protocol interception bypasses request-header mutation/destination metadata (confirmed by the focused native spec). Use `Page.addScriptToEvaluateOnNewDocument` on the native debugger after a trusted blank document, before loading hosted bytes. Native cookie disabling and file-chooser interception are installed before loading too. Setup failure or debugger detachment retires the view. The script exposes no bridge and is bundled as raw app-owned source; there is no preload at all. Security re-review: PASS, with unchanged sandbox/secret/network boundaries and fail-closed setup.

Main-frame navigation is cancelled and reissued by main with a private random per-view header stamp; only that stamp grants navigation semantics. Subresources and forged page headers remain false. Repeated navigation uses an incrementing fence so an earlier aborted load cannot retire its successor. The native resource handler itself rejects wrong origin/method/Range; CSP plus document-start API lockdown, frame/navigation guards and session permissions cover unsupported browser routes. No reliance on webRequest/CDP Fetch interception for the HTTPS resource handler.

The composition root publishes the controller on typed native `app.hostedAppViews`, because Playwright main evaluation cannot import the running CJS module. It remains inaccessible to hosted/client page code. Handles also expose a readiness-bound native `request(input, signal?)` capability for #1961, with post-await retirement checks; this does not install Fetch or any page IPC.

Lifecycle proof names: `native resources load modules, SPA navigation, binary bytes and HTTP semantics`; `hostile content cannot escape native policy or dispatch unsupported traffic`; `authority changes retire pending work and isolate releases and two hosts`; parameterized `native view retires on removed/discovery-gap/rehandshake/unpair/parent`; `unsupported and unknown hosts refuse native content without discovery bypass`. These cover the transition table including fresh rediscovery after gap/re-handshake, repeated releases and parent replacement. Final size remains below 800 lines, with two exported declarations plus the native App augmentation and one production consumer.

2026-10-15 rework, findings 2–4: document-cookie emulation does not disable the Cookie Store API. The document-start lockdown now removes both `cookieStore` and `CookieStore` before hosted scripts execute, with immutable descriptors; the existing native document-cookie restriction remains. The hostile-page regression first reproduced a successful Cookie Store write, then verifies denial and an empty native session cookie jar after an allowed-read barrier. Security re-review: PASS with this bypass closed; trust/credential/crypto/network/logging/concurrency boundaries are unchanged, and the file/storage and Electron categories now explicitly cover both cookie APIs. No new IPC or native authority is exposed.

The parent lifecycle case now opens under a separate parent, holds an API read, observes dispatch, destroys that parent, verifies the correlated cancellation and destroyed contents, and delivers the old response after a fresh view opens. An allowed read proves successor processing before checking its ready state. SPA navigation waits for the destination pathname, completed document and module marker together, so the old document cannot satisfy the barrier. No new types, state or failure categories; total written work remains below 800 lines.

## Rework validation
- Candidate: `be436cbf399a1602ebf45ea0aeea401ae71a4446`, containing `origin/main` at `cdf088533ca6f402475f6be27cb2d75fc5ee597b`.
- Cookie regression before correction: hosted-view spec 9 executed, 8 passed, 1 failed because Cookie Store returned `allowed` instead of `denied`. After correction: `e2e/hosted-app-view.spec.ts`, 9 executed, 9 passed, 0 skipped or retries.
- Named history check: `e2e/history-walk.spec.ts`, 3 executed, 3 passed, 0 skipped or retries, including the exact two-viewport boundary case. The earlier full-gate failure's cause remains unestablished; this focused result does not replace the full gate or establish a history reliability repair.
- Pre-verify outside the sandbox: all 5 checks passed, including security labels, typecheck and 10,274 unit tests (3 existing skips). The earlier sandbox attempt failed on denied loopback sockets; it is not product-failure evidence. Subsequent `npm run build`, `npm run check:docs` and diff checks passed.
- Complete configured fake gate: managed task `48b91d1fa6dc95b6b44b3c1852bb4b6bc3ed6d77f47bd903511fc3607336104b` requested for the pushed candidate; queued, no result claimed.

## Documentation handoff
- Pending documentation stage: `docs/knowledge/features/daemon-connection-lifecycle.md` § Hosted resource views — native `app.hostedAppViews`, named-host authoritative opens, lifecycle states, sizing/close, bound `request`, and fresh generations after retirement; document both cookie API restrictions.
- Pending documentation stage: the isolation ADR noted in Context — disposable sessions/origins, document-start lockdown and fail-closed debugger setup/detachment, private navigation stamps, loader versus Fetch semantics and cancellation fences. Preserve remaining ownership: Fetch #1961, trusted chrome/placement #1992, entry points #1928 and real daemon/relay/SQL proof #1929.
