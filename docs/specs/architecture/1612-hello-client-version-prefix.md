# #1612 — send client_version as pyrycode-desktop/<version> in the hello

Short plan: one literal prefix in one constructor, no new type, state or failure mode.

## Files read

- `src/main/transport/codec.ts` → `makeHelloClientPayload` — the one hello payload constructor; the only production edit.
- `src/main/transport/helloExchange.ts` → `buildClientHello` — already builds through `makeHelloClientPayload`, so it inherits the prefix unchanged.
- `src/main/transport/helloExchange.test.ts` → `describe('buildClientHello')` — where the new pinning test sits.
- `src/main/daemonConnection.ts` → the relay connection config that sets `User-Agent` to `pyrycode-desktop/${clientVersion}` — must keep receiving the bare version; untouched.
- `src/main/index.ts` → `app.getVersion()` feeding `logSessionStart` and the connection deps — untouched, so the banner keeps the bare version.
- `src/main/daemonConnection.test.ts` (`User-Agent` assertion) and `src/main/sessionBanner.test.ts` — existing assertions that already pin the bare version in the header and banner.

## Design source

N/A — not UI-visible (wire payload only).

## Change

`makeHelloClientPayload` writes `client_version: \`pyrycode-desktop/${input.clientVersion}\`` instead of the bare `input.clientVersion`, matching the daemon's `<app>/<MAJOR>.<MINOR>.<PATCH>` format (pyrycode `docs/protocol-mobile.md` § `hello`). The app name lives in one module-level constant beside the constructor. Callers keep passing the bare version, so `src/main/index.ts`, the `User-Agent` header and the session banner do not move. The input field name stays `clientVersion`; its doc notes that it is the bare version and the constructor adds the prefix.

## Testing strategy

- New test in `helloExchange.test.ts` under `buildClientHello`: with `clientVersion: '0.1.0'`, the encoded JSON contains `"client_version":"pyrycode-desktop/0.1.0"`. Fails on main (main emits `"0.1.0"`).
- The header and banner stay bare by construction; the existing `User-Agent` assertion in `daemonConnection.test.ts` (`pyrycode-desktop/0.1.0`, which would read `pyrycode-desktop/pyrycode-desktop/0.1.0` if the value were prefixed upstream) and `sessionBanner.test.ts` already pin them.
- Existing hello tests compare against `makeHelloClientPayload` output and need no change.

## Documentation handoff

None named by the ticket. Pending for the documentation stage only if it wants the transport overview to note the `client_version` format.
