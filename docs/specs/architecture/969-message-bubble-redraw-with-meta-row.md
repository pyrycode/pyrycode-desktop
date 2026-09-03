# #969 — Redraw the message bubble as the design's `Message` component, with the meta row and its copy control

## Files read

| Path | Symbol / section | Why it matters |
| --- | --- | --- |
| `src/renderer/src/theme/tokens.css` | the type-scale block, `--color-inverse-primary`, `--color-on-primary-fixed`, `--color-on-primary`, `--color-on-secondary-container`, `--text-label-medium-weight-emphasized` | every value this restyle names is a token here; the `--text-label-medium-weight-emphasized` comment names this ticket outright as the next `title-small` consumer, and `--text-label-medium-weight` is the precedent for shipping a step's base weight alongside its emphasized one |
| `src/renderer/src/screens/conversation/conversation.css` | `.message-row*`, `.bubble`, `.bubble--user`, `.bubble--daemon`, `.bubble--assistant-text`, `.bubble__markdown`, `.queued-row__drop*` | the blocks the restyle rewrites, plus the icon-button treatment (`padding` + `border-radius: var(--radius-full)` + a `:focus-visible` outline) the copy control mirrors |
| same | the `#629` list/blockquote comment block | its overhang arithmetic is written over the bubble's horizontal padding; the conclusions survive 14 → 20px but three numbers move |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx` | `TimelineRow` (`assistantText` and `userText` arms), `MessageBubble`, `QueuedBacklog` | the three emitters of `.bubble`; only the two `TimelineRow` arms gain a meta row |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` | the `MessageThread` block's `data-message-role="user">text m1</div>` pins, the `CURSOR` ordering assertions | the exact-markup constraints the change must not disturb |
| `src/renderer/src/screens/conversation/interactiveRoundtrip.test.tsx` | the `data-thread-role="assistant"><div class="bubble__markdown"><p>` byte string | makes append-never-prepend a hard constraint |
| `src/renderer/src/screens/conversation/questionResolution.ts` | `console.error('question refusal send failed')` | the renderer's strictest failure-logging posture — event name only, no error object, no content |
| `src/renderer/src/screens/conversation/dropQueuedMessage.ts`, `composerSend.ts` | the pure-helper + `*.test.ts` pair shape | the directory idiom the new copy helper follows |
| `src/shared/wire/types.ts` | `MAX_PLAINTEXT_BYTES` (65519) | the inbound cap that already bounds every byte of daemon text this control can put on the clipboard |
| `e2e/fixtures/launchPairedApp.ts` | `PairedApp` (`app: ElectronApplication`) | the handle that lets the e2e read the real OS clipboard from the main process |
| `e2e/assistant-whitespace.spec.ts` | the frame-builder harness and its computed-style idiom | the spec this ticket's e2e is modelled on; also the one whose padding inequalities the change has to survive |
| `src/main/index.ts` | the `setPermissionRequestHandler` installed in `app.whenReady()` | denies every renderer permission unconditionally; decides which clipboard branch this ticket takes |

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-4477

`Message` is one 6px-cornered box for both sides, padded 16px vertically and 20px horizontally, stacking its content with a 12px rhythm: the message text in title-small-emphasized (14/20/0.1, weight 600), then the optional attachment slot, then a **meta row** at the foot — a 16px-tall, 8px-gap line holding a body-small (12/16/0.4) timestamp and an 11×12 `copy-solid-full` glyph, both in `Schemes/Inverse Primary`. The assistant variant (132:4477) fills with `Schemes/On Primary Fixed` and types its text `Schemes/On Secondary Container`; the user variant (132:4508) fills with `Schemes/On Primary` over `Schemes/On Primary Container` text and its meta row carries `justify-end`. The screenshot of `Message area` (132:4171) confirms the row appears at the foot of every message bubble in the thread, the thumbnail and file-row instances included, and never on the tool rows or the session-reset separator.

Every value was read from the Figma **variables** (`get_variable_defs` on both nodes, 2026-09-03), never the generated fallback. The transposition trap `tokens.css`'s `--color-inverse-primary` comment warns about is live on these nodes: the export prints `--schemes/inverse-primary,#9dcbfc` where the variable reads `#32628d`, and `--schemes/on-secondary-container,#3a4857` where the variable reads `#d6e4f7`. The glyph asset confirms the same — its single `<path>` is filled `#32628D`.

## Context

Every other part of the desktop chat screen's message area has been ticketed and built from the desktop drawing — the tool rows, the fenced code block, the session-reset separator, the thumbnail, the file row. The bubble itself still wears the mobile thread's clipped-corner shape and the mobile fills, and it draws no meta row at all. This ticket redraws it and adds the row's copy control. The timestamp that fills the row's other slot is #970, blocked on this; between the two the row shows the control alone.

No ADR is warranted. The restyle introduces no new architectural boundary; the one design decision worth recording outside the diff is the accepted contrast shortfall below, which the ticket body already carries and which is a Figma-side fix rather than a code one.

## Design

### `tokens.css` — the `title-small` family

Five tokens, inserted between `--text-title-medium-*` and `--text-body-large-*` so the block keeps its display → headline → title → body → label order:

| Token | Value | Source |
| --- | --- | --- |
| `--text-title-small-size` | `14px` | `Static/Title Small/Size` |
| `--text-title-small-line` | `20px` | `Static/Title Small/Line Height` |
| `--text-title-small-tracking` | `0.1px` | `Static/Title Small/Tracking` |
| `--text-title-small-weight` | `500` | M3's base weight for the step — not read off Figma, which exposes the emphasized weight only |
| `--text-title-small-weight-emphasized` | `600` | `Static/Title Small/Weight-emphasized` = SemiBold |

The base weight ships with no consumer, on `--text-label-medium-weight`'s stated precedent — three quarters of a quartet would surprise the next consumer of the step. `--text-label-large-*` reading 14/20/0.1 is a coincidence and is not borrowed: the `--text-label-medium-weight-emphasized` comment rules out exactly that reach and predicts this ticket by name.

### `conversation.css` — the bubble

`.bubble` keeps `max-width: min(680px, 75%)` and `word-break: break-word`, and takes `border-radius: var(--radius-xs)` (all four corners, so the two side modifiers stop carrying a radius at all), `padding: var(--space-4) var(--space-5)`, and the `title-small` quartet with the emphasized weight. `.bubble--user` and `.bubble--daemon` keep their fill/text pair and lose their radius line; the fills move to `--color-on-primary` / `--color-on-primary-fixed` and the assistant text role to `--color-on-secondary-container`.

**`.bubble` does NOT become a flex column**, though the drawing's `Message` is one. The in-progress assistant branch renders `{item.text}` and the cursor `<span>` as sibling direct children of `.bubble`; a flex column would make each its own flex item and drop the cursor onto its own line, breaking the inline streaming cursor. The drawing's 12px rhythm is instead a `margin-top: var(--space-3)` on the meta row — the only new sibling this ticket adds, and the only place the rhythm has to appear. `.bubble__markdown > * { margin-block: 0 }` does not reach the row (it is `.bubble`'s child, not the markdown container's), and the row's top margin sits between two siblings so it neither collapses nor escapes the bubble's padding box.

### `conversation.css` — the meta row

`.bubble__meta` is a `display: flex` row: `align-items: center`, `gap: var(--space-2)`, `min-height: var(--text-body-small-line)`, the body-small quartet, and `color: var(--color-inverse-primary)` which the glyph inherits through `fill: currentColor`. `.bubble__meta--user` adds `justify-content: flex-end`, the drawing's `justify-end` on 132:4435.

The `min-height` is load-bearing rather than decorative: the timestamp slot renders empty until #970, an empty inline element generates no line box, and without it the row would collapse to the glyph's 12px. The token is the body-small *line height* because that is precisely why the row is 16px tall.

`align-items: center` where the drawing has `items-start` plus a 1px top pad on the `Copy` frame. Centring is this app's vocabulary for the same intent and lands the 12px glyph within 1px of the drawn position; it is also the only choice compatible with the enlarged hit area below, which `items-start` would let grow the row.

### `conversation.css` — the copy control's hit area

The glyph is 11×12, far under the app's 48px target convention, and the Technical Notes ask for a larger hit area that does not change the 16px row. `.bubble__copy` takes `padding: var(--space-2)` and `margin: calc(var(--space-2) * -1)`: a 27×28 border box (the hit area) inside an 11×12 margin box (the layout footprint), so the row's height and the glyph's drawn position are both exactly as drawn. That is the M3 icon-button container trick expressed in this file's tokens, with no literal.

Resting colour is inherited from the row. Hover brightens to `--color-primary` and `:focus-visible` draws `outline: 1px solid var(--color-outline)` — `.queued-row__drop`'s treatment, which also brightens rather than recolours. No hover background: `--color-surface-container-high`, the surface `.queued-row__drop` lifts to, is a neutral grey that would read as a foreign patch on either navy fill. The drawing gives no hover, focus or pressed state; this is the file's existing answer to that gap.

### `ConversationScreen.tsx`

One new module-local component, `BubbleMeta`, rendered as the **last child** of the bubble in the `assistantText` and `userText` arms of `TimelineRow` and nowhere else:

```
function BubbleMeta({ text, side }: { text: string; side: 'user' | 'daemon' }): JSX.Element
```

It emits `.bubble__meta` (plus `--user`), an empty `<span className="bubble__meta-time" />` for #970 to fill, and a `<button type="button" className="bubble__copy" aria-label={COPY_MESSAGE_LABEL}>` wrapping a bare `<svg viewBox="0 0 11 12" fill="currentColor" aria-hidden="true">` with the one `copy-solid-full` path. The drawing's `clipPath` is a full-bleed 11×12 rect and is dropped as the no-op it is. `COPY_MESSAGE_LABEL` is a client-owned constant beside the file's existing `DROP_QUEUED_LABEL`.

Both branches of the assistant arm get the row, the still-growing tail included: the row is appended after the cursor span rather than replacing it, so a settled turn does not reflow the bubble, and a partial reply is as copyable as a finished one. `.bubble--assistant-text`'s `white-space: pre-wrap` reaches the row but is inert there — JSX emits no whitespace text nodes between elements on separate lines.

**No prop threading.** The copy source is the row's own `item.text` and nothing else — no conversation id, no store — so the handler is a closure over that one value calling a module helper directly. `Timeline`'s prop surface is unchanged, which is what keeps the ~30 existing `<Timeline` render sites untouched. This is deliberately *not* `QueuedBacklog`'s injected-`onDrop` shape: that injection exists because the row cannot see the conversation id the send needs.

The row is the bubble's last child by construction, so the attachment slots #691/#686 will land, add themselves above it, and need no change here (neither renders in this file today).

### `copyMessageText.ts` (new)

```
export async function copyMessageText(text: string): Promise<boolean>
```

Returns `true` when the text reached the clipboard. Guards `navigator.clipboard` being absent (returns `false` without throwing), awaits `writeText` inside a `try`, and on rejection logs `console.error('message copy failed')` — the event name alone, `questionResolution`'s posture rather than `composerSend`'s, because the value in flight is relay-peer-authored text and an error object is not a place to risk it. Never propagates: a failed copy must not crash the thread.

The call site is `onClick={() => void copyMessageText(item.text)}` — an explicitly voided promise, never a floating one.

**The markdown source, not the rendered DOM.** `item.text` is the string the store coalesced from the daemon's `assistant_delta` frames, upstream of `AssistantMarkdown`, so AC3's "as the daemon sent it" falls out of *where* the value is read rather than from any un-rendering step. The user side is the same read on `userText`'s echo.

### The clipboard permission — measure, then branch

`src/main/index.ts` denies every renderer permission request unconditionally, and Electron routes `clipboard-sanitized-write` through that handler. Whether Chromium issues a request at all for a user-gesture `navigator.clipboard.writeText` in a focused window, or grants it at the content-settings layer without asking, is measured in the Playwright tier **before** either branch is written:

1. **The write succeeds** — expected. Renderer-only, four production files, no main-process change.
2. **The write is denied** — narrow the handler to allow exactly `clipboard-sanitized-write` and deny everything else. One line, a fifth production file, recorded in `## Security review` below with the reasoning for granting rather than routing through IPC.

The `shared/ipc/unpair.ts` request/response idiom is explicitly not reached for: same capability, more code, and it would put this ticket over the size boundary. If branch 2 is somehow unavailable too, the ticket routes back with `needs-rework:refiner` and the measurement rather than growing.

### Comment true-ups (same commit, and only these)

- `.bubble`'s own comment and `.bubble__markdown`'s, which cite the mobile fill, the 14/12 padding and the 20/20/20/6 radius as settled fact.
- Three sentences in #629's list/blockquote block whose overhang arithmetic runs over the horizontal padding: "already padded 14px each side", "overhangs 12px into `.bubble`'s own 14px", and "that 14 plus `.conversation__thread`'s 16 = 30px" → 36px. Every conclusion still holds at 20px; only the numbers move.
- **Not** the other 14s in that block — the UA `<p>`/`<ul>` margin, which is 1em at the unchanged 14px font size. **Not** the `--color-on-surface-variant` sentence citing `.bubble--thinking` / `.bubble--compacting`: falsified by #796 and #967 before this ticket, and out of scope here.

## State + concurrency model

No store change, no new state, no subscription, no timer. `Timeline` and `TimelineRow` stay pure props-in/markup-out. The one async path is `copyMessageText`'s `writeText`, a one-shot promise voided at the call site with its rejection handled inside the helper — nothing outlives the click, so there is nothing to cancel and no teardown handle to hold.

## Error handling

`copyMessageText` returns a boolean and never throws: `navigator.clipboard` absent → `false`; `writeText` rejects (permission denied, a clipboard held by another process) → `false` after a content-free `console.error`. Nothing surfaces in the UI. That is the drawing's own answer — it draws no confirmation after a copy and therefore no failure state either — and it is the right one while the failure is not actionable by the user. If the measurement lands on branch 2 and the narrowed handler makes denial impossible by construction, the guard stays anyway as the belt for a clipboard the OS refuses.

## Testing strategy

**vitest** (`environment: 'node'`, static server renders, no DOM, no computed style):

- `copyMessageText.test.ts` (new) — `navigator.clipboard.writeText` as a mocked global: the exact string reaches it and nothing else; a resolved write returns `true`; a rejected write returns `false` and does not throw; a missing `navigator.clipboard` returns `false` without touching anything.
- `ConversationScreen.test.tsx` — the assistant bubble (settled and in-progress) and the user bubble each end in `.bubble__meta`; the row is the **last** thing in the bubble, asserted by index ordering against the message text and against `bubble__markdown`; the user row carries `bubble__meta--user` and the assistant row does not; the control renders as a `<button type="button">` with the accessible name; the queued row and the `MessageBubble` residue render **no** `bubble__meta` (a count assertion over the whole markup, not a per-string absence); the existing `data-message-role="user">text m1</div>` pins stay untouched and green.

**Playwright** (`e2e/message-copy.spec.ts`, new, fake-transport tier) — everything the unit tier structurally cannot see:

- the clipboard-permission measurement: click the assistant bubble's copy control, then read the real clipboard from the main process via `app.evaluate(({ clipboard }) => clipboard.readText())` and expect the markdown source the daemon sent;
- the keyboard path: focus the control and activate it with Enter, same read-back;
- the geometry the restyle exists for, read as computed style: all four `border-radius` corners equal, `padding` 16/20, and the meta row's `justify-content` differing between the two sides.

Fakes over mocks throughout: the e2e drives the existing `launchPairedApp` fake daemon with a real `assistant_delta` + `turn_end` pair; the unit tier mocks only the clipboard global, which has no fake to stand in for.

## Open questions

1. **Does `navigator.clipboard.writeText` survive `src/main/index.ts`'s blanket permission denial?** Resolved by the e2e above before either branch is written. Whichever way it lands is recorded in `## Revisions`.
2. **Does the meta row belong on the in-progress tail?** Decided here (yes, appended after the cursor) rather than left open, for the no-reflow reason above. Recorded so the verifier reads it as a decision.

## Accepted consequence — the meta row fails WCAG AA

`--color-inverse-primary` measures 2.67:1 on the assistant fill and 2.04:1 on the user fill, against the 4.5:1 AA wants for 12px text and the 3:1 it wants for an icon control. Both message texts are fine (13.3:1 and 10.1:1). Built as drawn: substituting a colour here would put the app and the Figma out of step, which is the exact failure this redraw is unwinding. The fix is a Figma-side change on 132:4446 / 132:4435 and a one-token edit afterwards. The hover state's `--color-primary` incidentally clears both thresholds, so the control is legible under the pointer even before that change lands.

## Security review

**Verdict:** PASS

Ran because the ticket carries `security-sensitive` — applied for the copy control, which is a new egress path for relay-peer-authored text out of the app and into the OS clipboard.

**Findings:**

**1. Trust boundaries — the one genuinely new crossing, and it is user-gated by construction.** Before this ticket, daemon text terminated at the app's render surface. The copy control adds a second terminus: the OS clipboard, a process-global channel readable by anything running as the user and, on macOS with Handoff on, synced to the user's other devices. That is a real widening of where relay-peer text can go. What closes it is that the write is unreachable except from a user gesture: `copyMessageText` is called from exactly one place, the `onClick` of a `<button>` inside `BubbleMeta`, and nothing in the render path, no effect and no store subscription calls it. A hostile daemon therefore cannot place content on the clipboard; a user must choose one specific message. `writeText` is also the *sanitized* write — text/plain only, so no HTML flavour reaches the clipboard even when the source carries markup. No change required.

**2. Trust boundaries, second order — paste injection. OUT OF SCOPE, named.** Copied daemon text is plain text but the user may paste it into a shell, an editor or another agent's prompt, where an embedded newline plus a command executes. Not fixed here, for three reasons: `writeText` is a plain-text sink and CLAUDE.md's 2026-08-20 ruling scopes its prohibition to raw-markup sinks, attributes, URLs, filenames, cache keys and logs, none of which this is; sanitising the copy would falsify AC3, whose whole point is that the *markdown source* is what lands, byte for byte; and the user can already select-and-copy the same rendered text with the mouse, so the control adds convenience rather than capability. Whoever picks this up owns it for the mouse path too, not just the button.

**3. Electron attack surface — branch 2's permission narrowing carries a binding constraint. SHOULD FIX (conditional).** Branch 1 adds no IPC, no `contextBridge` member and no channel, so the renderer gains nothing from the main process. If the measurement forces branch 2, the change to `setPermissionRequestHandler` must be an **allowlist of exactly one string** — `clipboard-sanitized-write` — with every other permission still answered `false`. Two things it must specifically not become: a denylist (which grants each future Chromium permission by default), and a grant that also covers `clipboard-read` / `clipboard-sanitized-read`. Read is a categorically worse capability than write — it exfiltrates whatever the user last copied, which is routinely a password-manager secret — and nothing in this ticket needs it. The marginal risk of write alone is small: a renderer compromised badly enough to reach it already holds the existing `window.pyry` IPC surface, which sends to the daemon and unpairs. The window hardening it sits behind is unchanged and already correct — `sandbox: true`, `contextIsolation: true`, a `setWindowOpenHandler` deny and a `will-navigate` guard, all in `src/main/index.ts`.

**4. Logging — the copied text must reach no log, and neither must the failure. Addressed in the design.** `copyMessageText` logs `console.error('message copy failed')`, the event name alone: not the text, and not the caught error object either. That follows `questionResolution`'s deliberate departure from `composerSend`'s `console.error(msg, error)` rather than the looser sibling. `writeText`'s rejection is a `DOMException` whose message does not carry the value today, but the posture must not depend on that holding across Chromium versions.

**5. Logging, second order — the accessible name is the trap. Addressed, and worth stating.** "The control has an accessible name" invites `aria-label={`Copy: ${text}`}`, which would put relay-peer text into an **attribute** — precisely what CLAUDE.md's ruling forbids. The design uses `COPY_MESSAGE_LABEL`, a client-owned constant, beside the file's existing `DROP_QUEUED_LABEL`. Tracing every reach of `item.text` in this ticket: React children (auto-escaped, already the case), the click closure's argument, and `writeText`. It reaches no attribute, no URL, no filename, no cache key and no log.

**6. Network & I/O — the unbounded-daemon-text worry is already closed upstream.** The text this control egresses was capped before it reached the store: `parseInboundMessage` enforces `MAX_PLAINTEXT_BYTES` (65519, `src/shared/wire/types.ts`) on the decrypted envelope, throwing before `decodeEnvelope` and before any narrower runs. A single message's text is therefore bounded by that cap end-to-end, and the control copies one message, never a thread. No new cap needed here, and adding one would be a second, drifting source of truth. This ticket opens no socket, builds no frame and parses no URL.

**7. Concurrency — nothing outlives the click.** One `writeText` promise per activation, explicitly voided at the call site, rejection handled inside the helper, no floating promise. A double-click issues two writes of the same string: last-write-wins on the clipboard, both resolve, no shared state is read-then-mutated across an await. Nothing is long-lived, so there is no `AbortSignal` to thread and no listener to remove; if the window closes mid-write the promise is discarded with the renderer.

**8. Threat model alignment.** *Malicious relay:* content-blind and on-path — it can drop, delay or reorder, none of which reaches this control, and it cannot inject text into a session it cannot read. *Hostile daemon inside the session:* it can author arbitrary message text, which the user can now copy — that is finding 2, deferred, and bounded by finding 6. *Token theft from disk, key material, `safeStorage`:* untouched; this ticket writes nothing to disk and holds no secret. *Renderer compromise reaching the transport:* branch 1 adds nothing; branch 2 adds clipboard-write only, strictly less than the existing IPC surface, under the constraint in finding 3.

**Not applicable, with the reason.** *Tokens/credentials* — no token, key or credential enters this path; the copy source is display text already held in the renderer store, and a secret a user pasted into their own composer returning to their own clipboard is no new exposure. *File and storage operations* — no filesystem access, no path construction, no persistence, so no traversal, TOCTOU, atomic-write or at-rest-encryption question arises. *Cryptographic primitives* — no randomness, no comparison against a secret, no key schedule; the feature is one DOM element and one clipboard call.

## Revisions

### 2026-09-03 — the clipboard measurement landed on **branch 2**

Open question 1 is resolved, and against the plan's expectation. `src/main/index.ts`'s blanket permission denial **does** reach `navigator.clipboard.writeText`: with the control shipped and the handler untouched, `e2e/message-copy.spec.ts` seeded the OS clipboard with a sentinel, clicked the control, and read the clipboard back through the main process to find the sentinel still there. The write was silently refused — no exception the renderer could see, just a no-op control.

So the ticket takes branch 2 and `src/main/index.ts` is a fifth production file. The change is one line: the handler goes from `callback(false)` to `callback(permission === 'clipboard-sanitized-write')`.

That is exactly the shape `## Security review` finding 3 made binding, and it is met on both counts:

- **An allowlist of one string, not a denylist.** An identity comparison against a single permission, so every permission Chromium adds in a future version is denied by default rather than granted.
- **`clipboard-read` and `clipboard-sanitized-read` stay denied**, falling out of the same comparison. The e2e now carries the guard on that half of the line: it drives a permission that is *not* on the list (`Notification.requestPermission()`, which routes through the same handler) and asserts it still comes back `denied`, so the handler cannot quietly become "grant what the renderer asks for".

The spec is a genuine two-sided proof rather than a green-only assertion: it failed on the sentinel before the one-line change and passes after it, with nothing else altered.

No other part of the design moved. The renderer side is exactly as planned — `copyMessageText` still reaches `navigator.clipboard.writeText` directly, no IPC channel was added, and the `shared/ipc/unpair.ts` request/response idiom the Technical Notes ruled out was not reached for.

### 2026-09-03 — open question 2, recorded as built

The meta row **is** rendered on the in-progress assistant tail, appended after the streaming cursor rather than in place of it, for the no-reflow reason the Design section gives. `ConversationScreen.test.tsx` pins all three subjects (settled, in-progress, user) in one case so the decision is visible as a test rather than only as prose.
