# 906 — The question panel takes the composer's place and covers its footer

The frame slice of the question vertical: mount `useQuestionBridge`, and draw the panel's chrome where the
composer sits. Option rows are #907; the picks and the send are #908 / #853.

## Files read

- `src/renderer/src/store/questionBridge.ts` → `useQuestionBridge` — the dormant hook this ticket mounts;
  its docblock names #851 as the mounter, which is the comment this slice corrects.
- `src/renderer/src/store/questionBatchStore.ts` → `useQuestionBatchStore`, `selectBatchFor`,
  `createQuestionBatchStore` — the read surface, the "safe to call inline" ruling, and the `init` seam the
  container's tests need.
- `src/renderer/src/store/questionBatches.ts` → `Question`, `QuestionBatch`, `reduceQuestionBatches` — the
  held shape, and the empty-list guard that makes an empty-state render unreachable.
- `src/renderer/src/App.tsx` → `App` — where `useModalBridge` sits; the mount site and its comment idiom.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `Composer`, `ComposerStatusArea`,
  `ConversationScreen` — `.composer` owns `__row` and `__footer`; `ComposerStatusArea` is a sibling above
  it. `BackgroundTaskPanel`'s `conversationId={activeConversation?.id ?? null}` is the prop idiom this
  slice copies.
- `src/renderer/src/screens/conversation/PermissionModal.tsx` → `PermissionModalView`, `PermissionModal` —
  the #224 pure-view / store-bound-container split, and its untrusted-text-as-children posture.
- `src/renderer/src/theme/PyryMark.tsx` → `PyryMark` — **the title row's glyph is already shipped.** The
  Figma vector is 14×15.9707; that docblock records the status row's node as this same mark at exactly
  1/6.5 scale (91.002/14 = 103.812/15.9707 = 6.5), so the Figma asset URL must not be transcribed — the
  renderer has no `img-src` in its CSP and an outbound fetch would fail closed.
- `src/renderer/src/theme/tokens.css` → the colour/type/space tokens, and the standing warning that Figma's
  generated fallbacks print the LIGHT scheme while desktop is dark-only (ADR 0003).
- `src/renderer/src/screens/conversation/conversation.css` → `.composer`, `.composer__footer` — the slot's
  padding and ground, and the "structural geometry may be a literal" precedent.
- `src/renderer/src/screens/channels/ChannelList.test.tsx` → its four `vi.mock` factories — the per-file
  store-instance override the container's tests need.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=347-6913

A left-aligned column: a title row (the pyry mark, an 8px gap, then one uppercase label in
Schemes/Tertiary), then a 1px Primary-Container-bordered, 6px-radius box on the Background ground holding
the question's text, a full-width 1px Primary-Container separator, and a right-aligned Cancel / Continue
button pair. Cancel is outlined in Schemes/Primary on Background; Continue is filled Schemes/Primary with
On-Primary text. The box's option rows (`347:6025`) belong to #907 and are not drawn here.

Every colour was read from the **variables** on `347:6913`, never from the generated fallbacks — which
print the light scheme, exactly as `tokens.css` warns: Tertiary `#ffb59f`, On Background `#e0e2e8`,
Primary Container `#134a74`, Primary `#9dcbfc`, Background `#101418`, On Primary `#003355`. These resolve
onto the existing `--color-tertiary`, `--color-on-surface`, `--color-primary-container`, `--color-primary`,
`--color-surface` and `--color-on-primary`. M3 dark defines Background = Surface and On Background = On
Surface, which is why no `--color-background` token is minted.

## Context

`questionBatchStore` (#899) holds the batches and `useQuestionBridge` (#900) fills it, but nothing mounts
the hook, so the whole vertical is inert. This slice mounts it and gives the store its first reader.

No ADR is warranted: the store's placement was settled by ADR 0009 and this adds a view over it.

**Sizing.** All six structural boundaries hold with room — 3 production `*.tsx` files, 1 consumer call
site, 3 new exports, 5 acceptance criteria, no state machine. Production plus tests plus CSS lands near
300 lines. The one line at issue is total written work, and the overage is plan prose I control. Every
available split fails the floor rule: a "mount and cover" child ships a blank slot where the composer was
and is consumed by exactly one sibling in its own family, so merging it back is the rule's own answer.
`needs-human:sizing` marks the judgement on the board; the ticket is built as it stands.

## Design

Three edits and one new file.

**`App.tsx`** — `useQuestionBridge()` beside `useModalBridge()`, unconditional, app-lifetime. Its
`window.pyry` deref is inside the effect, so the `<App/>` server-render smoke test stays `''`.

**`QuestionPanel.tsx` (new)** — `QuestionPanelView({ question }: { question: Question })`, pure and
exported, markup only. `question.header` renders in the title row's single label; `question.question`
renders in the box. Both are React children, so React's auto-escaping is the boundary; neither reaches an
attribute, a URL, a key, or `dangerouslySetInnerHTML`.

**No `title` attribute on the question text, and this is the one trap this component invites.** The design
clamps that text to a single line with `text-overflow: ellipsis`, and the reflex accompaniment to a clamp
is `title={question.question}` so the full string is available on hover. That would put claude-authored
text into an *attribute* — precisely what `questionBatchStore.ts`'s header bans, and the ban that survives
a paraphrase least well. The full text becomes reachable in #907's box, which is where the clamp is
reconsidered; until then the clamp is the render, not a summary of a hidden tooltip. Same rule for
`data-*`: no `data-testid` and no attribute of any kind derived from `header`, `question`, or
`questionBatchId`, whose value is a one-time unguessable nonce this slice never reads at all.

Cancel and Continue are `<button type="button">`
with no `onClick` and no `disabled` — inert, not greyed, the #224 posture. `PyryMark` is reused at
`width={14} height={16}`, the status row's call verbatim.

**`ConversationScreen.tsx`** — a new exported container `ComposerSlot({ conversationId, phase,
onMessageSent })` returning a fragment of `QuestionPanelView` (when a batch is outstanding) plus
`Composer`. It reads the question store; `conversationId` arrives as a prop from `ConversationScreen`,
which already holds `activeConversation`, so a question arrival re-renders this leaf and never the
timeline. The batch read is inline, per the store's own ruling:

```ts
const batch = useQuestionBatchStore((s) =>
  conversationId === null ? undefined : selectBatchFor(conversationId)(s)
)
```

No `useMemo` and no per-conversation cache: `useStore` compares the selector's *result*, the batch comes
back by reference, and a memo table keyed on anything claude-authored would put untrusted text in a lookup
path. `conversationId === null` is an explicit test, not `?? ''`, so an empty-string id stays an ordinary
key rather than collapsing into "nothing open".

`batch.questions[0]` is read with no guard and no `!`: `reduceQuestionBatches` returns state unchanged on
an empty `questions`, so `[]` never reaches `outstanding`, and the repo does not set
`noUncheckedIndexedAccess`, so the index types as `Question`.

**Composer coverage.** `Composer` gains a required `covered: boolean` prop and renders
`<div className="composer" hidden={covered}>`. The native `hidden` attribute is the whole mechanism: one
attribute that hides the subtree, drops it from the tab order and drops it from the accessibility tree,
while leaving the element mounted so `Composer`'s `useState` draft survives. A conditional render would
discard the draft; `aria-hidden` alone would leave a focusable invisible textarea whose Enter still sends.
`.composer__footer` is a child of `.composer`, so the one attribute takes the footer and the send/stop
control with it, and `ComposerStatusArea` — a sibling in the conversation column, not a descendant — is
untouched.

The UA's `[hidden] { display: none }` loses to the author-level `.composer { display: flex }` regardless of
specificity, so `conversation.css` must carry an explicit `.composer[hidden] { display: none }`. Without
it the attribute is a no-op for layout and only the accessibility half works.

**Comment corrections in scope:** the two `#851` pointers in `questionBridge.ts` and `questionBatchStore.ts`
name a parent closed as not planned. They become #906 (mounts, reads) and #907 / #908 (read further).

## State + concurrency model

No new store, no new subscription beyond the one bridge mount, no async work, no cancellation surface. The
bridge's own teardown is `subscribeQuestionBatches`' unsubscribe handle returned as the effect cleanup,
already written and unchanged here; a StrictMode double-mount nets one listener. `ComposerSlot` is a pure
read.

## Error handling

Nothing fallible: no IPC call, no parse, no I/O. The one absent branch is deliberate — no empty-state
render, because a held batch always carries at least one question (see Design), and writing one would
defend a failure mode the store makes unreachable.

## Testing strategy

Vitest static server renders only; interaction is #908's Playwright spec.

`QuestionPanel.test.tsx` (new) — `QuestionPanelView` with injected `Question` fixtures:
- renders `header` in the title row and `question` in the box
- a fixture whose `header` and `question` both carry `<img src=x onerror=alert(1)>` and `&` renders escaped:
  the markup contains `&lt;img` and no `<img`
- Cancel and Continue both render as `<button type="button">` with their visible text as accessible name,
  and the markup carries no `onclick`
- the mark renders once, `aria-hidden`

`composerSlot.test.tsx` (new) — `ComposerSlot`, with `vi.mock` over `questionBatchStore` binding
`useQuestionBatchStore` to a per-file `createQuestionBatchStore(seed)` and keeping `importActual` for the
selectors (the singleton's server snapshot is its creation-time state, so a seed-then-render against it
would silently assert the initial cell):
- batch outstanding for the conversation on screen → the panel renders, and `.composer` carries `hidden`
- the covered markup still contains the textarea, the send control and `.composer__footer` — hidden, not
  unmounted — and carries no `composer-status` markup, so the cover is scoped to `.composer`
- a batch for a *different* conversation, and no batch at all, both leave `.composer` without `hidden` and
  render no panel
- `conversationId={null}` renders the composer untouched

## Open questions

None. The one the original ticket left — how to hide the composer without losing the draft — is resolved
above by the `hidden` attribute.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] **MUST FIX — fixed in this plan before commit.** The design clamps the question text
  to one line with `text-overflow: ellipsis`, and the standard accompaniment to a clamp is
  `title={question.question}`. That is claude-authored text in an *attribute*, which `questionBatchStore.ts`
  bans by name. The Design section now forbids `title` and every `data-*` derived from `header`,
  `question` or `questionBatchId`, and says why the clamp is the render rather than a summary of a hidden
  tooltip. Re-walked after the edit: the only sinks the plan now prescribes for either string are JSX
  children.
- [Trust boundaries] No further findings. The boundary is explicit and singular: `QuestionPanelView`'s JSX,
  the first and only render of these two fields. `string` carries no untrusted signal, so the plan names
  the two fields at the one place they are read. There is no `.map` in this slice, hence no React `key`,
  hence no path from `header` into a lookup — the failure mode `questionBatches.ts` singles out. #907 adds
  the option `.map` and inherits the question.
- [Tokens] No findings. `questionBatchId` is a one-time unguessable nonce and is the batch's only
  correlation key; this slice never reads it — not as a key, not as an attribute, not as text. The
  composer draft stays in `Composer`'s `useState` and is not persisted by anything this ticket adds; the
  `hidden` attribute changes its visibility, not its storage.
- [File / storage] No findings — no `fs`, no `localStorage`, no `safeStorage`, no path built from any
  input. Nothing in this slice touches disk.
- [Electron attack surface] No findings. No new IPC channel and no new `contextBridge` surface: the bridge
  subscribes to the existing broadcast `onDaemonEvent` alongside three sibling subscribers, and neither new
  component dereferences `window.pyry` at all — so the `<App/>` and `ComposerSlot` server renders never
  touch the bridge. Mounting the bridge does mean `questionShown` payloads now reach renderer memory where
  they were previously dropped; that is the ticket, and it moves nothing across the process line.
- [Cryptographic primitives] Not applicable — no randomness, no key material, no secret comparison. The
  `conversationId === null` test and `selectBatchFor`'s `===` scan compare two values the client already
  holds for a local routing decision, which `questionBatches.ts` already rules on.
- [Network & I/O] No findings, on a **verified** bound rather than an assumed one: `decodeInnerFrame` in
  `src/main/transport/codec.ts` rejects an outer frame over `MAX_FRAME_BYTES` (256 KiB), so `header` and
  `question` are size-bounded before they reach the store. The design's own single-line clamp is the second
  bound — a hostile string cannot grow the panel or push the composer slot off screen, it is cut at one
  line.
- [Errors, logs, telemetry] No findings. Neither new file imports a logger or calls `console.*`, matching
  the deliberate absence both store modules record. No `data-*` attribute carries claude text, which also
  keeps it out of test output.
- [Concurrency] No findings. No async work, no timer, no listener beyond the bridge's own — whose cleanup
  is the unsubscribe handle already written in `subscribeQuestionBatches` and unchanged here, so a
  StrictMode double-mount still nets one listener. `ComposerSlot` is a pure read; zustand dispatches
  synchronously with no `await`, so there is no check-then-act gap between a batch arriving and the cover
  applying.
- [Threat model] OUT OF SCOPE — **a daemon that raises a batch and never dismisses it covers that
  conversation's composer indefinitely**, and this slice draws no expiry (settled 2026-08-31: the timeout
  is a daemon matter) and its Cancel dispatches nothing. The exposure is bounded by design rather than
  unaddressed: the cover is scoped to one conversation, so every other chat stays usable — which is the
  stated reason the panel is not a centred dialog — and the `reconnected` arm clears every held batch on
  each handshake. A local escape lands with the answer path in #908; the send is #853.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-02
