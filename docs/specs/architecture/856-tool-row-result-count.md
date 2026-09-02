# 856 — draw the tool result count at the row's trailing edge

## Files read

- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ToolRow`, `chipRuns`, `TOOL_ROW_CHEVRON_PATH` — the insertion point. The `result !== null` gate around `.tool-row__right` and its shipped comment ("THE CHEVRON IS THE GROUP'S LAST CHILD. #856 inserts the result count BEFORE it") name this ticket's seam exactly.
- `ConversationScreen.tsx`'s SAFETY block (the comment above `ToolRow`, running from #697 through #855) — the file's standing posture on untrusted daemon display text, and the running list of declined sinks each ticket inherits. This ticket adds the fourth untrusted string to the same chip.
- `src/renderer/src/store/threadTimeline.ts` → `ToolResult` — `resultDetail?: string`, whose docblock hands the absent-vs-empty decision to this ticket by name and forbids the `in` test.
- `src/renderer/src/screens/conversation/conversation.css` → `.tool-row__right`, `.tool-row__left`, `.tool-row__summary`, `.tool-row__name`, `.tool-row__chevron` — the group whose `gap: var(--space-3)` its own comment says is stated *for* this count, and the run whose body-medium quartet the count reuses.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` → `toolItem`, `RESOLVED_CHIP_HEAD`, `RESOLVED_CHIP_TAIL` — the byte-level chip expectations, and the fixture builder that already takes a whole `ToolResult` (so it needs no widening).
- `e2e/tool-row-toggle.spec.ts` → `boxOf`, `WIDTH_TOLERANCE_PX`, `routedToolUseFrame`, `routedToolResultFrame` — the module-level helpers and the described/undescribed shell fixtures AC4 rides.
- `src/shared/wire/types.ts` → `ToolResultPayload.result_detail` — the optional sixth field the e2e fixture sets to drive the whole client path.
- `docs/knowledge/features/conversation-shell-tool-row-layout.md` § "#855" — carries the lesson this ticket must not re-learn: *switching a run on or off can silently change a row's height, and only e2e can see it.* The count is body-medium, the same step `.tool-row__left`'s `min-height` floors at, which is why it should not move any row's height — and why the e2e asserts it rather than assuming it.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=155-553

The Count (`155:557`) is the Right group's **first** child, the Chevron (`155:558`) its second, 12px apart, the pair hugging the header's trailing edge. The count is **M3/body/medium in full** — the same font, 14px size, 20px line height, 0.25px tracking and 400 weight the Subject (`155:556`) takes — inked `Schemes/On Background`, and declared `shrink-0` with `whitespace-nowrap`. It carries no box, no border, no background: it is one text run, drawn as `"110 of 1676 lines"` in the design's own example. The screenshot confirms it reads as a quiet trailing annotation, not a badge.

## Context

The tool row's header ends in a group that today holds only the chevron. `resultDetail` — the daemon's short précis of what a call returned, `"265 lines"` or `"110 of 1676 lines"` — has been carried onto `ToolResult` since #773 and rendered nowhere. This ticket is its first and only consumer: it draws the string in the reserved slot so a thread of tool calls can be scanned without opening any of them.

Every seam this needs already exists and names this ticket. #773 carried the field and deliberately deferred *every* display decision here, including whether absent and empty differ at all. #854 built the group, put the chevron last, and stated the gap for this child. #855 floored the left group's height at body-medium so a run switching on or off cannot change a row's height — which is half of why AC4 holds before a line is written.

No ADR is warranted. The one genuinely new decision (absent and empty both draw nothing) is local to this row, and the docblocks upstream already point at it; the documentation phase folds it into `conversation-shell-tool-row-layout.md` beside #854's and #855's sections.

## Design

### One element, inside the existing gate

`chipRuns` gains one child in `.tool-row__right`, before the `<svg>`, inside the `result !== null` conditional that already ships. **No second predicate, no `hasResult` const, no pending variant** — the group's own comment forbids exactly that, and a pending row has no `result` to read a detail from, so the question structurally does not arise there.

The element is a `<span className="tool-row__count">` carrying the string as its only child.

**`<span>`, never `<p>`, though Figma draws a `<p>`.** A resolved chip is a real `<button>`, which admits phrasing content only; `<p>` is flow content, so it is invalid HTML and a React DOM-nesting warning. This is #854's ruling for the two group wrappers, applied one level down — the element is chosen for validity, the box for layout.

### The predicate: absent and empty collapse here, and only here

```
result.resultDetail !== undefined && result.resultDetail !== ''
```

Both tests are written out rather than collapsed into a truthiness check, because the collapse *is* the decision this ticket owns and it should be visible at the one place that performs it. Upstream keeps the two states distinct on purpose — the wire decoder, the IPC event, the bridge and the reducer each carry `''` and absent separately, and each says so — and this row is where they finally mean the same thing: nothing to draw. Naming both falsy values makes that legible; `Boolean(...)` would hide it behind a coincidence of JavaScript.

`!== undefined`, **never `'resultDetail' in result`**: structured clone carries the key across the IPC bridge whether or not the wire set it, so the `in` form is true for both and would silently collapse the distinction #773 paid to keep. (This is the trap `emitDaemonEvent`'s own comment records.)

This inverts #855's rule on the neighbouring runs, deliberately and for a stated reason. There, `''` means *draw the element with no text* and a truthiness test would be a bug; here, `''` means *the daemon looked and found no count*, which is the correct answer for a failed call and for the long tail, and draws nothing. Same file, two opposite conventions, because the two values mean opposite things.

### AC2's "no gap" is structural, not a modifier

`.tool-row__right`'s `gap: var(--space-3)` falls only *between* two children. One child renders → no gap. Not rendering the element is therefore the whole of AC2: **no `--empty` modifier class, no pending variant, no rendered-but-blank span.** #854's "the whole group, not just the chevron" argument, one level down again.

### CSS: `.tool-row__count`

A new rule beside `.tool-row__chevron`, holding the design's type quartet and ink plus the two layout declarations Figma states:

- The four body-medium type tokens, identical to `.tool-row__summary`'s — `--text-body-medium-size` / `-line` / `-tracking` / `-weight`. The same four names, not a second set, because it is the same M3 step.
- `color: var(--color-on-surface)`. The design says `Schemes/On Background`; `.tool-row__summary` already records why that maps to the surface pair rather than minting a second name for one colour.
- `flex: 0 0 auto; white-space: nowrap` — Figma's `shrink-0` and `whitespace-nowrap`. The count never shrinks and never wraps: it is the run whose *trailing* edge lines up down the thread, and a wrapped count would break the header's single line box.
- `max-width` plus `overflow: hidden; text-overflow: ellipsis` — the bound, argued below. A real count is an order of magnitude short of it, so it changes nothing this ticket's other criteria measure.

**No `min-width: 0`** and no participation in the left group's truncation chain: `.tool-row__right` stays `flex: 0 0 auto`, untouched, so an oversized tool *name* still ellipsizes the headline rather than squeezing this group — the property #854 states and pins with three width equalities.

### The bound on the count, and why it is not optional

Found by the security pass below and folded into this design before commit. Without a cap the count is an unshrinkable `nowrap` run holding an unbounded untrusted string: a 3000-character `result_detail` gives the trailing group a base size wider than the chip, the left group collapses to nothing, and the chevron — a **client-owned affordance** — is pushed past the chip's `overflow: hidden` edge and disappears. That is qualitatively new. Every other untrusted run on this row lives in the left group and is bounded by its ellipsis; this is the first daemon string that can push *client chrome* out of view.

The fix is the count's own bound rather than a change to either group's flex, so #854's truncation chain is untouched in both directions: a hostile headline still cannot reach the chevron, and a hostile count now ellipsizes at its cap instead of eating the header. A percentage literal, following `.tool-row__body`'s `max-width` and `.tool-row__result`'s `max-height` — a one-off bound with its own precedent in this file does not earn a token.

The ellipsis is a **visual** clip and not a violation of AC3: the DOM text node is the verbatim string, untrimmed and unreformatted, exactly as `.tool-row__summary` has always treated the headline. Nothing parses it, nothing measures it in JavaScript, and no branch reads its length.

### Safety posture — the fourth untrusted string in this chip

`resultDetail` joins `name`, `inputSummary`/the picked input value, and `resultSummary` under the SAFETY block's standing rule: auto-escaped React children of a `<span>`, and nothing else. The block gains a `#856` paragraph naming the sinks this particular string makes newly tempting, each a MUST FIX if it ever appears:

- **NO `title`**, a seventh time — and now with a new pull, because the count is the one run that visibly ellipsizes at a cap, which makes "hover for the whole count" the natural next edit. The answer is that the row opens and the body shows what came back.
- **NO parsing back into a number.** `"110 of 1676 lines"` invites a progress bar, a percentage, a `parseInt`. The field is a précis with unit words and interior spaces, `#773` says so, and a number derived from daemon text would be a client-owned claim about a daemon-owned value.
- **NO `aria-label` and no `data-*`.** Interpolating the count into the button's accessible name is the shape #697 declined; the button's name stays exactly its text runs, and the count now joins them as one more child, which is correct and needs no attribute.
- **NO log line.** Any useful one carries daemon text into a log, which ADR 0007 and CLAUDE.md both forbid.

## State + concurrency model

None. `ToolRow` gains no state, no hook, no effect and no async work. The count is a pure function of `item.result.resultDetail`, read once during render, and the existing `useState` disclosure boolean is untouched. Nothing subscribes, so nothing needs teardown.

## Error handling

No new failure mode and no new result type. The field is already `string | undefined` at the type level, guaranteed by `optionalString` at the decode boundary (`parseInboundMessage`), which throws on a non-string before any of this is reachable. The two in-band states — absent, empty — are handled by the predicate above and are not errors. A hostile-length value is bounded by CSS, not by a thrown error, because there is nothing to fail: an over-long précis is still a valid précis.

## Testing strategy

**Unit — `ConversationScreen.test.tsx`, appended to the tool-row describe.** `toolItem` already takes a whole `ToolResult`, so every case below is a fixture literal and the builder needs no widening.

- A resolved call carrying `"265 lines"` draws `<span class="tool-row__count">265 lines</span>` immediately after `<span class="tool-row__right">` and immediately before the `<svg` — asserted as one contiguous byte fragment, so a stray sibling or a swapped order fails. (AC1)
- Absent draws no `tool-row__count` and leaves the group's bytes contiguous. (AC2)
- Empty renders **byte-identical** to absent — a whole-markup `toBe` equality rather than two `not.toContain`s, which is the strongest available form of "both draw the same thing, which is nothing". (AC2)
- A detail carrying HTML metacharacters and leading/trailing spaces draws escaped and **untrimmed**, and appears in no attribute (`title=`, `aria-label` and `data-` all absent). (AC3)
- The existing `RESOLVED_CHIP_HEAD`/`RESOLVED_CHIP_TAIL` cases stay **unedited** and become AC2's regression baseline for free: their fixtures carry no `resultDetail`, so the chip they pin is exactly the absent-count chip. This is a deliberate departure from the ticket's technical note, which expected the expectation to move; it does not need to, and leaving it fixed is stronger than rewriting it. A new constant pins the with-count chip beside it.

**e2e — `e2e/tool-row-toggle.spec.ts`, a fourth sibling `test(...)` with its own `launchPairedApp`.** Its own app for the reason the third one records: more rows on either existing test's page would make their bare `.tool-row` locators strict-mode-ambiguous. Four rows, driven end to end from `result_detail` on the wire payload, which exercises the whole #773 carry rather than just the render.

- A described shell call (no lead), an undescribed one (no subject) and a path call (both runs), each with a different count. The three counts' **trailing edges** sit in one column within `WIDTH_TOLERANCE_PX` — the count's leading edge cannot be the check, since the strings differ in width and it is the trailing edge the group pins. (AC4)
- Each of those rows' chip height equals the path row's: the count is body-medium, so it must not push any row taller — the failure mode #855's lesson names, invisible to the unit tier and to any element-count assertion. (AC4)
- On the path row, the count sits one `--space-3` gap before the chevron and the group is still flush against the chip's padding edge — the placement half of AC1, which markup cannot observe.
- A fourth row carrying an absurdly long count: the chevron's right edge is still inside the chip's padding box and the count is ellipsized. This is what turns the CSS bound above from an unexercised defence into a proven property — deterministic CSS proved by a deterministic geometry assertion, not by a second reading of the same markup.

Fakes over mocks throughout: the e2e drives the real decoder, IPC and reducer through the fake daemon, and the unit tier renders the real component.

## Open questions

1. **Does the existing byte-level chip expectation need editing?** Resolved above: no — its fixtures carry no detail, so it already pins the absent-count chip. Recorded because the ticket predicted otherwise.
2. **What exact percentage should the count's `max-width` be?** Settled in Phase B against the 800px-minimum window: large enough that the design's longest example (`"110 of 1676 lines"`) is nowhere near it, small enough that a hostile count leaves the headline readable. Any value inside that band satisfies every criterion; the number itself is not load-bearing and the e2e asserts the *property*, not the number.
3. **Does the count belong in the button's accessible name?** It does, and it gets there for free as one more text child — no attribute, no change. Confirmed rather than open; noted because the tempting alternative is an `aria-label`.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The boundary is `parseInboundMessage`'s `optionalString(payload, 'result_detail')`, which is the single place a wire value becomes `string | undefined`; everything downstream — the IPC event, `timelineBridge`, `fillResult`, `ToolResult` — holds the parsed type and re-derives nothing. This ticket is a pure consumer at the far end and moves the boundary nowhere.
- **[Tokens, secrets, credentials]** Not applicable, and stated rather than assumed: `ToolResult` holds no credential, this row reads exactly one field of it, and no value on this path is compared, hashed or persisted. The row emits no log line at all, which is what keeps the count out of one.
- **[File / storage operations]** Not applicable by construction. The count reaches no path, filename, cache key or lookup key — the SAFETY block's standing prohibition, restated for this string above — and nothing on this path touches the filesystem.
- **[Inter-process / Electron attack surface]** No findings. No IPC channel, `contextBridge` API or handler is added; the field rides the `toolResult` event that has shipped since #773. Nothing crosses toward the main process, and the renderer gains no capability.
- **[Cryptographic primitives]** Not applicable. No randomness, no comparison, no key material anywhere on this path.
- **[Network & I/O]** **MUST FIX — found during this pass, plan revised before commit, re-run PASS.** `result_detail` is unbounded on the wire (`optionalString` type-checks, it does not length-check, and the frame-level `MAX_PLAINTEXT_BYTES` cap in `parseInboundMessage` leaves ample room for a header-filling string). Drawn as an unshrinkable `nowrap` run in a `flex: 0 0 auto` group, a long value collapses the left group and pushes the chevron past the chip's clip edge — the first time a daemon-controlled string can displace **client-owned chrome** on this row, since every other untrusted run is bounded by the left group's ellipsis. Addressed in § "The bound on the count": a `max-width` + ellipsis on the count itself, chosen over relaxing either group's flex so #854's truncation chain is unchanged in both directions, and pinned by a dedicated e2e row.
- **[Error messages, logs, telemetry]** No findings. The row logs nothing, and this ticket adds nothing loggable; the SAFETY paragraph names "no log line for the count" as a MUST FIX if it ever appears. No error path carries the value — the only failure that can involve it is the decoder's type rejection, which `inboundMessage.ts` already documents as recording no decoded field.
- **[Concurrency]** Not applicable, and structurally so: the change is one conditional child in a render function. No task, timer, listener, subscription or `await` is introduced, so there is nothing to cancel, tear down or race.
- **[Threat model alignment]** The applicable threat is **hostile daemon response**, and it is the one that produced the finding above; it is addressed rather than deferred. A **malicious relay** is unaffected — it is content-blind and this ticket changes nothing about framing or session handling. **Renderer compromise reaching the transport** is unchanged: this code is renderer-side, reads one already-parsed string, and touches no key, socket or token. **UI spoofing by daemon text in general** — a daemon choosing what the header says — is pre-existing across every run on this row and out of scope here; it is the accepted consequence of showing a remote agent's own report, and the bound above is what keeps it from reaching the client's own affordances.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-02
