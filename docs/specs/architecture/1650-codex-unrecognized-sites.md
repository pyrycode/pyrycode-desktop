# #1650 — render Codex's two unrecognized-message sites

## Files read

- `src/shared/wire/types.ts` → `WireUnrecognizedSite` — the closed wire enum, widened by two literals.
- `src/main/transport/inboundMessage.ts` → `parseUnrecognizedMessagePayload` — the literal comparison that throws on any other site; gains the two new literals.
- `src/renderer/src/store/threadTimeline.ts` → `UnrecognizedSite` — the renderer-local re-declaration, kept identical to the wire union so the bridge assigns with no cast.
- `src/shared/chatHistory.ts` → the `unrecognizedMessage` member of `DurableThreadItem` and its `choice(...)` in the snapshot parser — the saved-history site list; without it a restored Codex row fails the snapshot parse.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `unrecognizedSiteLabel` — exhaustive switch; gains two client-owned labels.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=102-4

N/A for visual fidelity: the Unrecognized message row has no drawing. This adds two site labels to the existing row and nothing else.

## Change

pyrycode#2608 added `codex_method` (an unmapped Codex notification) and `codex_item` (an unmapped Codex item) to `unrecognized_message.site`. Add both literals to the four site lists above, in the same order in each, and map them in `unrecognizedSiteLabel` to "Codex notification" and "Codex item". The decode stays a closed literal comparison, so any other site still throws `WireDecodeError`, and the history parser's `choice` still rejects anything else. Nothing else moves: the bridge, the reducer and the row render read `site` only through these types and the label function.

## Testing strategy

- `inboundMessage.test.ts`: the "accepts every drop site" loop gains the two Codex sites; the fail-closed test keeps `a_site_invented_later` and adds a near-miss (`codex_event`).
- `chatHistory.test.ts`: a timeline item with `site: 'codex_method'` / `'codex_item'` round-trips; an unknown site is rejected.
- `ConversationScreen.test.tsx`: the label test asserts the two new labels.
- `types.test.ts`: the closed-enum list grows to six.

## Documentation handoff

None named by the ticket. Pending for the documentation stage: the unrecognized-message package overview may note the two Codex sites.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings. `site` crosses from the daemon at one place, `parseUnrecognizedMessagePayload`. It is a closed literal comparison over six values. Near-misses such as `codex_event` and wrong-case values such as `CODEX_ITEM` still throw `WireDecodeError`, and the whole frame is dropped. Everything downstream holds the literal union, `WireUnrecognizedSite` and then `UnrecognizedSite`, and never an open string. The saved-history snapshot is the second boundary. It is disk input and treated as untrusted: the `choice(...)` over `site` in `threadItem` rejects any value outside the same six, so a tampered or future-dated snapshot cannot put an unknown site into the timeline. Tests: the fail-closed case in `inboundMessage.test.ts` and the rejected-site case in `chatHistory.test.ts`.
- [Rendered daemon text] No findings. `site` only selects a string in `unrecognizedSiteLabel`. The two new labels, "Codex notification" and "Codex item", are client-owned constants. The daemon's `site` value is never rendered and never reaches an attribute, a URL, a React key, a filename or a log. The switch is exhaustive over the union, so an unmapped site is a compile error rather than a blank or fallback label. How `messageType` and `raw` are rendered does not change. They stay escaped React text children, and `raw` stays in a `<pre>` shown only on expand. There is no `innerHTML` or `dangerouslySetInnerHTML`, and the daemon still bounds `raw` and signals that with `truncated`.
- [Tokens, secrets, credentials] No findings. The change touches no token, key or credential.
- [File / storage operations] No findings. The saved-history path, the write discipline and the storage location are unchanged. The only change is a wider literal allowlist in the parser.
- [Electron attack surface] No findings. No IPC channel, bridge API, window option or navigation handler is added or changed. The existing `unrecognizedMessage` daemon event carries the wider union.
- [Cryptographic primitives] No findings. The change touches no crypto.
- [Network & I/O] No findings. The frame size cap, timeouts and relay handling are unchanged. A Codex frame goes through the same decode and size limits as the four Claude sites.
- [Error messages, logs] No findings. The decoder's rejection message is the existing static `missing required field: site`, which does not echo the value it received. No log call is added.
- [Concurrency] No findings. The change adds no async work, state or ordering. The emit in the daemon connection stays stateless.
- [Threat model: hostile daemon response] No findings. A hostile or buggy daemon can now produce two more rows, each labelled by the client. It cannot choose the label text, and the flood behaviour is the same as for the existing four sites: each frame is one row, with no dedup, by design.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-25

## Revisions

- 2026-09-25, rework: added `## Security review` above in response to the verifier's MUST FIX. The ticket carries `security-sensitive` and the first run had no review pass. The pass found no MUST FIX or SHOULD FIX, so the design and the code are unchanged. The fail-closed near-miss tests (`codex_event`, `CODEX_ITEM`) already landed with the implementation.
