# Hosted Fetch adapter

## Files read

- `src/main/hostedAppView.ts` → `createHostedAppViews`: readiness-bound authority, disposable sessions, retirement and debugger bootstrap.
- `src/main/hostedAppLockdown.js` → document-start lockdown: unsupported browser transports stay disabled.
- `src/main/transport/hostedResources.ts` → `request`, `finish`, `reset`: complete assembly, bounded admission, cancellation and uncertain mutations.
- `src/main/transport/hostedResourceCodec.ts` → `encodeHostedResource`: canonical path/header/body validation before dispatch.
- `e2e/hosted-app-view.spec.ts` → `scenario`, `open`, `evaluate`: production-view fake transport coverage.
- `electron.vite.config.ts` → preload build: dedicated isolated entry required.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`: test and scope rules.
- `docs/knowledge/features/daemon-connection-hosted-resource-views.md`, `docs/knowledge/decisions/0012-hosted-app-native-isolation.md`: authority must come from discovery; debugger setup fails closed.
- Hosted contract revision `964c5c4b`, asset/API, transfer and Electron bridge sections: exact HTTP, cap and lifecycle obligations.

## Context

Hosted scripts currently have only read-only browser resource loading. Expose bounded Fetch through the captured native binding without providing identity selection or client authority. This extension merits a later update to ADR 0012 by the documentation stage. No layout or chrome changes. Remote numeric feature branches have no overlapping changes to the planned existing files.

## Design

Use a dedicated sandboxed preload entry (`src/preload/hosted.ts`) exposing only request and abort through contextBridge. Extend document-start lockdown with Fetch installation; no inline hosted scripts or privileged client preload. Main's new `src/main/hostedFetch.ts` owns the narrow channel, validates exact WebContents/main frame/origin on every operation, and grants a private document token to the preload. Page correlation numbers are local cancellation keys only, never wire IDs. Reject repeated keys, additional identity fields and oversized/invalid input. Existing contextual resource validation remains the final wire admission gate.

The page adapter resolves relative/same-origin URLs, removes fragments without reparsing queries, allows asset GET and the seven API verbs, and validates permitted headers. Serialize strings with a capped UTF-8 destination, binary by checked length, Blob by checked size, and FormData by bounded multipart parts with an explicit matching boundary/content type. Check overhead before reading Blob bytes. Reject streams and GET/HEAD bodies. Request objects with bodies are unsupported streaming input; bodyless Request objects retain their semantics. Enforce cap before IPC, independently again in main.

Only complete validated native results cross back: status, permitted headers and opaque bytes. Construct Response with null for HEAD/204/205/304; return API redirect status without following or Location. Keep GET-only resource loading and all existing CSP/cookie/network lockdown. No fetch credentials reach transport.

## State + concurrency model

Each document has a native random token, increasing page sequence and at most sixteen native pending controllers. Every main-frame document replacement aborts its controllers, rotates the token and clears correlations. Retirement removes IPC/navigation listeners and cancels all work. Native request completion checks both document identity and pending-entry identity after await. Preload replies are correlated by private token and sequence. Adapter pending work owns AbortSignal/pagehide listeners and removes them on single settlement. No retries or replay; authority loss destroys the view and new reads require a fresh readiness-bound open.

## State transitions and identity reuse

| Event | Coverage in `e2e/hosted-app-view.spec.ts` |
| --- | --- |
| POST confirmed, close/reopen | Fetch preferences test: retained fake state, HTTP 204 and fresh GET |
| Mutation committed with reply withheld; reconnect | Fetch uncertainty test: one dispatch, fresh discovery, reconciliation GET |
| Pre-abort, in-flight abort, late completion | Fetch cancellation test: AbortError once and processed read barrier |
| Document replacement, reused page key | Fetch cancellation/hostile tests: cancellation, stale token rejected and new request unaffected |
| Cross-view/cross-frame/forged IPC | Fetch hostile test: rejected sender/token/shape and unchanged dispatch count after barrier |
| Release/host/reset/unpair/parent close | Existing authority and retirement tests now exercise production Fetch |

## Error handling

Local unsupported URL/method/header/body/size rejects with TypeError; signal cancellation uses AbortError. Main failures expose only static network failure or aborted outcomes, never daemon error detail. Existing native error classifications and static lifecycle logs remain authoritative. Lost/cancelled writes are uncertain and require application reconciliation.

## Testing strategy

Write focused Electron assertions first and observe the missing adapter failure. Extend the existing scenario locally for retained preferences and held mutation replies. Check exact encoded query/header/body bytes, all supported body classes and bounds, non-2xx/redirect/null bodies, cancellation and hostile calls with positive completion barriers. Run the focused viewer spec, final pre-verify and build. Fake retained state proves the client contract; real SQL durability and relay acceptance belong to #1929. No new dependency or live-Claude spec.

## Open Questions

None. Estimated written work: 780 lines including plan/tests; one deliverable, no new exported types, two existing consumers, four observable acceptance criteria and at most ten reject categories. A cleaner shape is to reuse native assembly/admission entirely; this design does so instead of duplicating transport state.

## Security review

**Verdict:** PASS

- [Trust boundaries] Request semantics are untrusted at `installHostedFetch`; validate shape, limits, exact sender/main-frame/origin and private document token before delegating. Native supplies every transport identity.
- [Tokens/secrets] Document token uses Node randomBytes; confined to isolated preload/main, rotated on navigation. No credentials, registry or keys cross the bridge.
- [Storage/files] No new filesystem or persistence; existing disposable uncached session is retained. Fake state is test-local.
- [Electron attack surface] Dedicated sandboxed/context-isolated preload exposes only request/abort. GET-only loader, navigation/CSP/permission/cookie restrictions remain; debugger setup/detachment stays fail closed.
- [Cryptography] No cryptographic protocol changes; existing Noise implementation and safeStorage remain in main. Random document tokens are routing fences, not transport credentials.
- [Network/I/O] Cap multipart overhead and bytes before allocation/IPC; main rechecks body and resource codec bounds. No browser networking fallback; reuse transport deadlines, assembly limits and cancellation.
- [Errors/logs] Static failures only; never log content, headers, bodies, full URLs/queries or daemon diagnostic text.
- [Concurrency] Pending controllers have document/view owners; rotate before replacement, cancel on retirement, check identity after await, reject duplicate correlations. No mutation replay.
- [Threat alignment] Malicious relay/daemon responses remain subject to existing contextual codec/digest/deadline checks. Compromised hosted pages cannot select hosts/releases or access client secrets. Disk token protection is unchanged safeStorage. Real service SQL durability is OUT OF SCOPE, #1929.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-15

## Revisions

2026-10-15: Rotate the document fence on the isolated preload's authenticated main-frame bind, rather than on attempted navigation. Electron announces blocked form/frame navigations without replacing the document; rotating then stranded its existing adapter. The hostile-page regression requires a successful read after blocked navigation. Main retains the old fence until a new document actually binds, then aborts its controllers; reply checks still fence all awaits. Fetch responses expose only the four permitted headers, whereas browser resource responses continue carrying native CSP/nosniff. Electron omits the preload path from `getLastWebPreferences`; production write/bridge behavior verifies the dedicated preload instead.

Added `src/main/hostedFetch.test.ts` to cover exact sender/frame/document checks, independent native input validation, reused correlations and stale completions after rebinding/retirement. Asset GET accepts permitted headers but the asset wire contract has no header field; API headers are preserved. Final scope remains below 800 written lines.
