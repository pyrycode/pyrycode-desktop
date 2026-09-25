# #1657 — advertise `multi_agent` in the handshake

## Files read

- `src/shared/wire/types.ts` → `CAPABILITY_INTERACTIVE`, `HelloAckPayload` — where the new constant sits; the ack's `capabilities: string[]` is what the daemon echoes.
- `src/shared/wire/types.test.ts` → the `advertises the interactive capability` case — the constant-value pin to mirror.
- `src/main/daemonConnection.ts` → `loadDialConfig` (its `buildClientHello` call) — the single production site that sets the advertised set.
- `src/main/daemonConnection.test.ts` → `sources the hello early-data from the record token via buildClientHello` — already decodes the real hello `loadDialConfig` built and asserts `payload.capabilities`; it becomes the pin.
- `e2e/fixtures/daemonCapabilityGate.ts` → `decideCapabilityGate`, `readDaemonCapabilities` — the probe advertises exactly the spec's `requiredCapabilities` and skips when the ack intersection lacks one; its docblock names production's advertised set.
- `e2e/fixtures/realDaemon.ts` → the `requiredCapabilities` option, `spawnClaude` option — gating and claude-less mode.
- `e2e/real-daemon-add-workspace.spec.ts` → the smallest real-daemon spec; its pairing preamble (`pairFromUnpairedLaunch`, `encodePairingPayload`) is the template.
- `e2e/update-required-host.spec.ts` → `window.pyry.reconnectServer(serverId)` from `page.evaluate` — the existing way a spec forces a fresh dial.
- `src/preload/index.ts` → `onDaemonEvent`, `serverInfo`, `reconnectServer` — the renderer surface the live spec reads the app's own `connected` ack through.
- `src/main/daemonConnection.ts` → the handle's `reconnect()` — calls `dial()` unconditionally, so a reconnect on a live connection emits a fresh `connected` with a fresh ack.

In-flight overlap: `feature/1544` edits `daemonConnection.ts` and its test, but not `loadDialConfig` or the hello; no dependency, build through it.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=103-2985

Codex channels appear as ordinary channel rows; the row itself is unchanged. This ticket adds no UI — the rendering of Codex rows, menus and frames shipped in the blockers (#1649–#1656). Visual fidelity check is N/A for this diff.

## Context

The daemon (pyrycode#2643, v0.27.0+) withholds Codex conversations, their frames and Codex model rows from any client that does not advertise `multi_agent`. Every blocker that makes the desktop render those correctly has merged, so the flag can now be turned on. No ADR needed — this is the same one-line flip as #179's `interactive`.

## Change

1. `types.ts`: add `export const CAPABILITY_MULTI_AGENT = 'multi_agent' as const` beside `CAPABILITY_INTERACTIVE`, with a one-line doc comment.
2. `daemonConnection.ts` `loadDialConfig`: `capabilities: [CAPABILITY_INTERACTIVE, CAPABILITY_MULTI_AGENT]`, extending the existing comment by one sentence (what `multi_agent` turns on). Nothing else moves: the daemon returns the intersection, `parseHelloAck` already accepts any string list, and the agent decode (#1649) already maps unknown agents to Claude.
3. `e2e/fixtures/daemonCapabilityGate.ts`: the `readDaemonCapabilities` docblock names production's advertised set; update that comment so it stays true. Comment only.

## Testing strategy

- **Unit (AC1).** `types.test.ts`: pin `CAPABILITY_MULTI_AGENT === 'multi_agent'`. `daemonConnection.test.ts`: the existing hello-decode case changes its expectation to `['interactive', 'multi_agent']` — it decodes the hello `loadDialConfig` really built, so it pins the production wiring. RED first by editing the expectation.
- **Real daemon (AC2).** New `e2e/real-daemon-multi-agent.spec.ts`, `spawnClaude: false`, `requiredCapabilities: ['interactive', 'multi_agent']` so a daemon older than v0.27.0 SKIPS through `decideCapabilityGate` rather than fails. Body:
  - pair from an unpaired launch (the add-workspace preamble) and wait for the seeded row;
  - in the renderer, subscribe `window.pyry.onDaemonEvent` and record, for the first `connected` event, which of the two spec-owned names appear in `ack.capabilities` (a filter over the spec's constants, never the daemon's strings — the gate module's provenance rule, so nothing the daemon sent can reach a Playwright failure message);
  - read the server id via `window.pyry.serverInfo()`, call `window.pyry.reconnectServer(serverId)` to force a fresh handshake whose ack the recorder sees;
  - `expect.poll` the recorded list to equal `['interactive', 'multi_agent']`.
  This proves the APP's own hello (not the gate probe's) got both echoed. The builder does not run the live tier; the dispatcher's real-claude gate runs it. Keep `needs-real-claude` on the issue.

## Documentation handoff (pending — documentation stage)

- `docs/knowledge/features/conversation-shell-conversation-and-modals.md` — the sentence that says the single production `buildClientHello` call passes `capabilities: [CAPABILITY_INTERACTIVE]` must name both constants and what `multi_agent` unlocks (Codex conversations, frames and model rows from a v0.27.0+ daemon).
- `docs/knowledge/features/wire-codec.md` — its mention of the advertised set, same update.
- `docs/knowledge/features/live-e2e-runbook.md` / real-claude liveness overview — list the new `real-daemon-multi-agent.spec.ts` and its capability gate.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings — no new inbound parsing. The ack still crosses at `parseHelloAck`; the daemon's `capabilities` are held as an untrusted `string[]` and no production code branches on them. The Codex rows the flag unlocks are decoded by the already-merged `agentFromWire`, which collapses every string but `codex` to Claude so no daemon agent text is held.
- [Tokens] No findings — the hello still carries the record token exactly as before; the change adds one static client-owned string to the advertised list. The e2e spec reads no token and records no daemon string.
- [File / storage] No findings — no file or storage path touched.
- [Electron attack surface] No findings — no new IPC channel, bridge method or window. The spec uses the existing `onDaemonEvent`, `serverInfo` and `reconnectServer` bridge calls from the test page only.
- [Crypto] No findings — the Noise variant, keys and session material are unchanged; `multi_agent` rides the existing hello early-data.
- [Network & I/O] No findings on the client — frame caps unchanged. Advertising `multi_agent` means a daemon now sends more frame types (Codex conversations, frames, models). Every one of those arrives through the existing size-capped codec and the per-frame decoders hardened by the blockers; unknown or malformed frames are dropped by the existing decode paths.
- [Logs] No findings — no new log call. The live spec records only a filter over its own two constant names, so no daemon-supplied capability string can reach a Playwright diagnostic or the salvaged run log (same rule as `decideCapabilityGate`).
- [Concurrency] No findings — no new async work. The spec's `onDaemonEvent` subscription lives for the test page only and dies with the app teardown; `reconnectServer` reuses the handle's `reconnect()`, which replaces the driver rather than stacking a second one.
- [Threat model] Hostile daemon response: the new vocabulary the flag unlocks was the subject of #1649–#1656, each of which bounded its own decode; this ticket adds no decoder. OUT OF SCOPE: Codex-specific frame semantics beyond those tickets — any new Codex frame type the daemon adds later is dropped as unknown until a ticket decodes it.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-25
