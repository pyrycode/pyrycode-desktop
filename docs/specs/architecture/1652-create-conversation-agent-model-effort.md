# #1652 — create_conversation can carry the agent, model and effort

## Files read

- `src/shared/wire/types.ts` → `CreateConversationPayload` (gains three optional keys), `WireAgent` (the `'claude' | 'codex'` union reused for `agent`), `agentFromWire` (inbound mapping; not used outbound).
- `src/shared/ipc/commands.ts` → `isCreateConversationPayload` — the untrusted renderer→main guard that learns the three optional keys.
- `src/main/daemonConnection.ts` → `createConversation` — the fresh-literal rebuild that copies each new key only when present.
- `src/renderer/src/store/conversationCreatedBridge.ts` → `requestNewChannel` — gains an optional choice argument.
- `src/renderer/src/screens/channels/CreateChannelDialog.tsx` → the one production caller of `requestNewChannel`; unchanged (the dialog passes no choice yet).
- `src/main/transport/createConversationEnvelope.ts` → `buildCreateConversation` — serialises `payload` as given and throws over the plaintext cap; unchanged.
- pyrycode `internal/protocol/conversations_write.go` → Go `CreateConversationPayload`: `Agent *string \`json:"agent,omitempty"\`` (#2647). pyrycode#2665 (open) adds `model` and `effort` the same way, pointers with `omitempty`. Go's decoder ignores unknown keys, so a daemon without #2665 drops them harmlessly.

No in-flight `feature/*` branch touches these four files.

## Design source

N/A — wire and command plumbing only; no UI changes.

## Change

- **Type.** `CreateConversationPayload` gains `agent?: WireAgent`, `model?: string`, `effort?: string`. These are optional (omitted), not nullable-and-present like the first three, because the daemon's new fields are `omitempty`. The JSDoc says why the two groups differ.
- **Guard.** `isCreateConversationPayload` still requires the first three keys. For each new key it accepts no key or an `undefined` value (structured clone keeps an `undefined` property, so this counts as absent). Otherwise `agent` must be exactly `'claude'` or `'codex'`, and `model` and `effort` must be strings. It refuses `null`, numbers, objects and unknown agent strings. Checking the values against the model vocabulary is left to the daemon, as the upstream ticket specifies.
- **Main rebuild.** `createConversation` keeps its fresh literal of the three required fields. It then conditionally spreads `agent`, `model` and `effort`, each copied only when `!== undefined`. Without them the object and the encoded frame match today's output byte for byte. Extra keys smuggled past the guard still never reach the wire.
- **Renderer helper.** `requestNewChannel(sendCommand, name, cwd, serverId?, choice?)`, where `choice?: { agent?: WireAgent; model?: string; effort?: string }`. Each present member is spread into `payload`, and absent members add no key. The existing caller is untouched, so it sends the same command as today.

Four production files, about 25 production lines, and one new exported type-shaped parameter (an inline object type; no new export).

## Testing strategy

- `commands.test.ts` adds acceptance tests for each agent, for string model and effort, and for all three together. It adds refusal tests for an unknown agent (`'gpt'`, `'Codex'`), a `null` agent, a non-string model (number, `null`, object) and a non-string effort.
- `daemonConnection.test.ts` checks that a payload with all three keys sends all three. It checks that one without them sends none: the key list is exactly `is_promoted, name, cwd` and the encoded payload JSON equals today's. It also checks that a present key with an `undefined` value adds no key.
- `conversationCreatedBridge.test.ts` checks that `requestNewChannel` with a choice puts the three keys in `payload`, with none at the top level. It checks that the call without a choice still sends exactly today's literal, and that a partial choice sends only its members.

## Documentation handoff

The ticket has no Documentation handoff section. Pending for the documentation stage: fold the optional-key posture of `CreateConversationPayload` into the wire/conversation-create overview.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings. The renderer→main boundary is `isCreateConversationPayload`, which is the only place the new keys are validated: an agent must be one of two literals, and the model and effort must be strings or absent. The deterministic net is the fresh literal in `createConversation`. It names each allowed key, so a smuggled key such as `harness`, `settings` or `serverId` cannot reach the wire. `serverId` stays a top-level sibling of `payload` by construction.
- [Tokens] No findings. No token, key or secret is touched. The new values are operator choices, not credentials.
- [File / storage] No findings. Nothing is written to disk, and the model and effort strings are never used as paths, filenames or cache keys.
- [Electron attack surface] No findings. No new IPC channel is added. The existing `createConversation` command arm, already allowlisted, gains three optional keys behind the same guard.
- [Network & I/O] No findings. An oversized model or effort string, from a compromised renderer, makes `buildCreateConversation` throw against the plaintext cap. `createConversation` catches that, logs the static code `build-or-send-failed` and emits `conversationCreateRejected`, so nothing reaches the socket. A size within the cap is the daemon's to refuse, and pyrycode#2665 validates it against the agent's vocabulary before creating anything.
- [Injection / parsing] No findings. The values are JSON-encoded by the envelope builder, never concatenated into a string format.
- [Logging] No findings. `createConversation`'s diagnostic events stay content-free, with no event carrying the agent, model or effort value. Upstream #2665 likewise forbids logging them.
- [Concurrency] No findings. The pending-request bookkeeping in `createConversation` is unchanged, and the new keys add no async work.
- [Threat model] OUT OF SCOPE: a Codex create against a daemon that did not negotiate multi-agent is refused daemon-side (#2647). How the UI chooses the values belongs to a later ticket.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-25
