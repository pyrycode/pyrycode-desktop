# #1601 — Fake-daemon setup failures name their class

## Files read

- `e2e/fixtures/fakeDaemonSetup.ts` → `startFakeDaemonForTest` — the only file that changes; today it maps every error except an exact HTTP 404 to one generic message.
- `e2e/fixtures/fakeDaemonSetup.test.ts` — the unit spec the new cases sit beside, including the private-sentinel `it.each`.
- `src/main/transport/noiseLib.ts` → `NoiseLoadError` — its `reason` (`wasm-load-failed` / `wasm-load-timeout`) is one of the suffix sources.
- `src/main/transport/fakeDaemon.ts` → `startFakeDaemon` — awaits `loadNoiseLib` before dialing with `ws`, so the two failure families are Noise load and the relay dial.

## Design source

N/A — test fixture only, nothing UI-visible.

## Change

`startFakeDaemonForTest` keeps throwing a fresh `Error` with no `cause`, but the message becomes `Fake daemon setup failed before Electron launch: <class>`, where `<class>` is chosen by a private `classifySetupFailure(error: unknown): string` returning only fixed strings:

1. a `NoiseLoadError` whose `reason` is one of its two known values → that reason;
2. an `Error` whose `code` is a string in a fixed socket-code allowlist (`ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, `EPIPE`, `ECONNABORTED`, `EHOSTUNREACH`, `ENETUNREACH`, `EADDRNOTAVAIL`, `EAI_AGAIN`, `ENOTFOUND`) → the allowlist's own literal, never the error's value;
3. an `Error` whose message matches exactly `^Unexpected server response: (\d{3})$` → `HTTP <digits>` (so 404 keeps today's exact text);
4. anything else → `unclassified`.

The suffix is always read back from a constant (allowlist entry, the known reason, or three matched digits), so no text from the original error reaches the message, stack or `cause`. No retry is added; the failure stays red.

## Testing strategy

In `fakeDaemonSetup.test.ts`, beside the existing cases:

- the existing real-404 case is unchanged;
- new `it.each` over a `NoiseLoadError` of each reason, an `Error` with `code: 'ECONNREFUSED'` / `'ECONNRESET'`, and `Unexpected server response: 503`, each asserting the exact suffixed message and no `cause`;
- the private-sentinel `it.each` now expects the `unclassified` suffix and gains an `Error` whose `code` is `'private-sentinel'`, asserting the sentinel is absent from message and stack.

## Documentation handoff

None named by the ticket.
