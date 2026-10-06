# #1804 — report Desktop features in the hello

## Files read

- `src/shared/wire/types.ts` → `HelloClientPayload`: add the daemon's optional field without changing existing constructors.
- `src/main/transport/codec.ts` → `makeHelloClientPayload`: the single default-injecting constructor and location for the fixed report.
- `src/main/transport/helloExchange.ts` → `buildClientHello`: already encodes the constructor's result; no change needed.
- `src/main/transport/helloExchange.test.ts` → `buildClientHello` tests: independent encoded-text pin and report admission assertions.
- `src/main/daemonConnection.ts` → `loadDialConfig`: first, explicit reconnect and supervisor reload all build fresh hellos here.
- `src/main/daemonConnection.test.ts` → connection fixtures and reload tests: exercise each production dial path and pin the existing capability set.
- `docs/knowledge/features/hello-exchange.md` and `wire-codec.md`: preserve main-process-only, log-free serialization and caller-owned capabilities.
- `docs/knowledge/features/development-verification.md` → Source and contract checks: the unavailable codegraph index requires source searches, including test consumers.
- Daemon specs `2897-client-features-hello.md` and `2898-client-features-spawn-prompt.md` (QMD): additive v2 optional string, independently admitted at 512 UTF-8 bytes with no controls or double quotes.

## Change

Add optional `client_features?: string` to `HelloClientPayload`, matching the shipped daemon field. `makeHelloClientPayload` always assigns a private module-level string constant containing the ticket's exact report. `buildClientHello` inherits it without a new input or caller override. The report describes Markdown file links and uploaded attachments; its example path is text only. No capability, version, token, replay, parser, state, async task or failure-mode changes are needed. No new dependency or logging is needed for this pure serialization change.

One deliverable; about 100 written lines including this plan, two production files and two test files; zero new exported types, zero consumer updates, two acceptance criteria and zero new reject branches. Both sketch and finished-plan sizing meet all limits. Overlaps with #1544 and #1761 are unrelated test/DTO additions; keep edits additive and local.

## Testing strategy

- First add an independently literal-pinned encoded-hello test, never deriving its expected report from the production constant or constructor. Check both absent and supplied replay positions, default and supplied capabilities, UTF-8 byte length ≤512 and absence of C0/C1/DEL and double quotes.
- Add a connection test inspecting first-dial, supervisor-provider reload and explicit-reconnect hello bytes against the exact report and unchanged `interactive`, `multi_agent`, `stop_background_task` capabilities.
- Observe the new tests fail because the field is absent, then implement. Run focused hello/codec/connection tests, the pre-verify check and `npm run build` after the final merge of main. No UI interaction or live test changes; the dispatcher owns its broader gates.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings — `makeHelloClientPayload` sources the report from a fixed private constant, with no renderer, daemon or caller-supplied report input; `parseHelloAck` remains the inbound boundary.
- [Tokens, secrets, credentials] No findings — only the public report field changes; the existing token remains Noise early-data, never logged or forwarded to the renderer. Storage and authentication are untouched.
- [File and storage operations] No findings — the sample absolute path is inert report text; no filesystem access, path construction or persistence is added.
- [Electron attack surface] No findings — code stays in main-process serialization and a shared data interface; no IPC, window, navigation or protocol-handler changes.
- [Cryptographic primitives] No findings — existing Noise IK encryption receives the encoded bytes; no crypto, key, nonce or randomness changes.
- [Network and I/O] No findings — the fixed report is tested against the daemon's 512-byte admission limit; existing envelope/frame caps, TLS and reconnect deadlines remain in force.
- [Errors, logs, telemetry] No findings — no new error or logging path; existing hello-exchange console-silence coverage remains applicable. Never log the hello, token or report.
- [Concurrency] No findings — the report is immutable; existing per-dial construction and cancellation ownership remain unchanged, with no new async work.
- [Threat model alignment] No findings — malicious relays still receive Noise ciphertext, disk credential protection and hostile-response parsing remain unchanged, and compromised renderers cannot override this report. The daemon's independent attributed-report admission owns prompt framing; this client supplies only the ticket-approved bounded text.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-06
