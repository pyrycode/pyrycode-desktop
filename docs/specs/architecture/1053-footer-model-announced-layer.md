# #1053 — Input footer: show the model claude announced, not only an explicit choice

The footer's model trigger draws nothing when the session carries no explicit model choice, which is the
state a daemon on its inherited default is always in. This ticket layers the announcement in underneath
the client's own pick and over the snapshot's stored choice, so the row names what is running.

## Files read

Codegraph is unavailable in this repo (`codegraph_status` has failed with "CodeGraph not initialized" on
every prior run here), so this list came from grep and reading. Noted per the brief rather than silently
substituted.

- `src/renderer/src/screens/conversation/ComposerModelMenu.tsx` → `composerModelMenuModel`,
  `ComposerModelMenuView`, `ComposerModelMenu` — the whole production surface this ticket changes. Its
  three renderings, its label expression and its "the label is the SESSION's model, not
  `RunningModelSection`'s announced one" docblock are what the layering re-decides.
- `src/renderer/src/screens/conversation/RunConfigSections.tsx` → `publishedRowFor`,
  `RunningModelSection` — the resolution rule AC1 says to reuse, and the sheet's own reading of the
  announcement. `publishedRowFor` is already exported (#988 was its third caller); this ticket adds a
  fourth call, not a fourth copy.
- `src/renderer/src/store/announcedModelStore.ts` → `AnnouncedModel`, `selectAnnouncedModel`,
  `useAnnouncedModelStore` — the value, its `null`-vs-`{ model: '' }` contract, its verbatim-hold rule and
  its untrusted-text security note.
- `src/renderer/src/store/runSettingsWriteStore.ts` → `selectEffectiveSettings`,
  `RunSettingsWriteState` — the pending-over-confirmed-over-snapshot composition. Its documented
  behaviour on a `null` snapshot ("falls to `'' / '' / false / ''`") is what lets this ticket read the
  client's own layers **alone**, without copying the pending walk.
- `src/renderer/src/store/runConfigStore.ts` → `selectSnapshot` — the stored choice's home; `snapshot`
  is `null` until a turn ends.
- `src/renderer/src/screens/conversation/conversation.css` → `.composer__model-label`,
  `.composer__model`, `.composer__footer-button` — the 120px cap plus ellipsis that bounds this label.
  Confirms no CSS change is needed and that a long announced identifier clips rather than overflows.
- `src/shared/wire/types.ts` → `ModelAnnouncedPayload` — the frame the e2e drive pushes: all three fields
  always present, `model` held verbatim, a lookup miss is ordinary.
- `src/renderer/src/screens/conversation/ComposerModelMenu.test.tsx` — the nine call sites of
  `composerModelMenuModel` this ticket's signature change touches, and the `view` helper that absorbs the
  rest.
- `e2e/composer-model-menu.spec.ts` — the frame builders, the withheld-reply idiom, and the
  `toHaveCount(0)` fresh-launch assertion this change must leave green.
- `docs/knowledge/features/composer-model-menu.md` § "A follow-up noted, not filed" — the note this
  ticket answers; § "Turn-end dependency" — why a snapshot is late; § "Testing" — the two e2e lessons
  (the withheld reply, and the whole-attribute-run class assertion) that shape the drive below.
- `docs/knowledge/features/announced-model-store.md` — the store's lifetime: pairing-scoped, cleared by
  `clearPairingScopedState`, never cleared on a reconnect to the same daemon.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=115-3683

The node is the built trigger: a 42×16 row, 4px gap, centred, holding one `M3/body/small` label in
`schemes/primary` (12px / 16px line-height / 0.4px tracking) followed by the 8×4 `chevron-up-solid-full`
glyph. The design's sample string is a short model name ("Opus"), and it draws **no** marker distinguishing
an announcement from a choice. Geometry, treatment and glyph are unchanged by this ticket: no element is
added, no class is added and `conversation.css` is not touched — `.composer__footer-button`,
`.composer__model-label` and `.composer__model-icon` already implement this node under #988, including the
120px cap the announced identifier will clip against.

## Context

`composerModelMenuModel` returns `null` when the session's model is `''`, and `''` is exactly what
`selectEffectiveSettings` resolves to for a session running on the daemon's inherited default. So the
control is absent in the first state the operator actually hit on 2026-09-04, and the run-configuration
sheet is the only way to see what is running. The value the sheet shows is already in the renderer:
`announcedModelStore` holds it app-lifetime and `RunningModelSection` resolves it through
`publishedRowFor`.

This ticket layers that value into the control rather than adding a second one. No store, no bridge, no
wire type and no CSS changes; the label element and its bound stay as they are.

No ADR is warranted — this is a precedence rule inside one control, and the reasoning that the
announcement and the choice are one value in layers lives in the ticket body and here.

## Design

### The four layers

The ticket resolves the precedence and this plan does not re-litigate it: **a pending-or-confirmed pick,
then the announcement, then the snapshot's stored choice, then nothing.** The announcement carries no
ordering information relative to a pick (`announcedModelStore` holds one record with no sequence or
timestamp), so ranking it above a *confirmed* pick would make a confirm and a rejection look identical and
break AC3.

At this control **an empty string means "nothing at this layer"**, uniformly across all three. That is not
a new decision: this control already renders nothing for `model === ''`, and AC4 states the equivalence
itself when it lists "either no announcement or an announcement whose model is the empty string" as one
condition. It is also what lets the container collapse `AnnouncedModel | null` to a plain string at the
boundary — the store's `null`-vs-`{ model: '' }` distinction stays intact where it was established and
where the sheet reads it, and is simply not a distinction this surface can draw.

### `composerModelMenuModel` takes the layers, not one string

The exported pure function keeps owning every rule as data (the property #988 bought by extracting it).
Its second parameter becomes the three layers:

```ts
/** The three layers this control lays over one another. '' means "nothing at this layer". */
export interface ComposerModelLayers {
  picked: string      // the pick made in this client: pending optimistic over client-confirmed
  announced: string   // what claude announced for the running turn
  stored: string      // the snapshot's stored explicit choice
}

export function composerModelMenuModel(
  models: ModelListEntry | null | undefined,
  layers: ComposerModelLayers
): ComposerModelMenuModel | null
```

Two strings come out of the layers and they are **not** the same string:

- **shown** = the first non-empty of `picked`, `announced`, `stored`. `''` → return `null` (AC4, today's
  rendering unchanged). Otherwise it resolves through `publishedRowFor(models, shown)` to that row's
  `display_name`, or renders verbatim on a miss — the existing `row ? row.display_name : shown`
  expression, kept in that form so a matched row's empty `display_name` stays a hit (AC1).
- **session** = the first non-empty of `picked`, `stored` — never the announcement. `currentId` is
  `publishedRowFor(models, session)`'s `value`, or `null` (AC5). Exact equality stays the only rule: with
  a degenerate daemon publishing a row whose `value` is `''`, a session on `''` matches it and that row is
  marked, which is exact equality doing its job rather than a special case.

Two lookups where there was one. They collapse to the same answer whenever a pick is in force, and they
differ precisely in the state this ticket exists for.

`options` is unchanged: `models?.models ?? []` mapped to `{ id: value, label: display_name }`, the daemon's
rows in the daemon's order. `ComposerModelMenuView` takes `layers` in place of `model` and is otherwise
untouched — same two renderings, same markup, same classes, no new prop on `ComposerOptionsMenu`.

**A stated consequence:** the control becomes *operable* in a state where it previously did not render at
all. With an announcement and published rows, an inherited-default session now has a footer menu it can
pick from. The rows, the marking (nothing marked) and the single-field write are the ones already shipped —
AC5's "unchanged" list — so this is the existing operable arm reached from a new state, not a new arm.

### What the container reads

`ComposerModelMenu` gains one store read, `useAnnouncedModelStore(selectAnnouncedModel)`
(`RunConfigSections`' recipe, which this container's docblock already describes itself as "minus the
announced model"). Each announcement writes a fresh object identity, so it re-renders this leaf and nothing
else in the composer.

The pick layer is read as **`selectEffectiveSettings(null, writeState).model`** — the same single home of
the pending-over-confirmed rule, evaluated with no daemon base under it, which that function documents as
falling to `''`. This is deliberately not a second walk over `pending`: `publishedRowFor`'s own docblock
records what happens when a rule like this gets a second copy. The stored layer is `snapshot?.model ?? ''`
straight from `selectSnapshot`, and the announced layer is `announced?.model ?? ''`.

### What does not change

`truncated` is not read here — this surface reports no cut, and the sheet remains the full reading. No
`title` attribute and no tooltip: an attribute is a sink CLAUDE.md's daemon-text ruling forbids outright.
No marker distinguishes an announcement from a choice (the design draws none; #988 AC2 forbids client copy
naming a model concept). `runSettingsWriteStore` is still never reset, so a confirmed pick pins the label
for the app's lifetime and the announcement will not surface after one — already true today.

The announcement is daemon-scoped, not conversation-scoped (`translateModelAnnounced` drops
`conversationId` deliberately), so a second conversation with no pick and no stored choice shows the first
one's announcement. Accepted per the ticket; scoping the store is a separate ticket if it bites.

## State + concurrency model

No new state, no new subscription lifecycle, no async work. Three existing zustand slices are read in one
leaf container: `runConfigStore` (snapshot), `runSettingsWriteStore` (raw state, composed in the render
body so the fresh-object selector cannot defeat `Object.is`), `modelListStore` (per-conversation, through
the existing `useMemo`-stable selector), plus `announcedModelStore` (app-wide singleton, narrow selector).
Teardown is React's own — no effect, no listener, no timer is added.

The announcement's own data path (`AnnouncedModelData`, an App-level headless leaf) is untouched, so
nothing about clear-on-unpair or the queued-frame-after-clear window changes.

## Error handling

No I/O and no IPC is added, so there is no result type to widen. The only failure shapes are absences, and
each has a rendering: no announcement and no choice → the control draws nothing; an announcement that
matches no published row → the identifier renders verbatim (ordinary, not an error); no rows published →
the existing inert arm; no session id → `changeSetting`'s own gate, unchanged. A rejected pick drops the
pending record and the label falls back through the layers on its own — which, in the state this ticket
adds, means back to the announcement.

## Testing strategy

**vitest — `ComposerModelMenu.test.tsx`** (static server renders; nothing in this repo can click). The
existing nine `composerModelMenuModel` call sites move to a `stored(...)` helper that builds a layers
record with the other two empty, so every shipped rule keeps asserting exactly what it asserted. The `view`
helper keeps its `(models, model)` signature and builds the same record internally, so its six call sites
need no edit. New cases, all as data through the pure function:

- The announcement labels the control with no pick and an empty stored choice — resolved to a published
  row's display name, and verbatim on a miss (AC1).
- The announcement outranks a stored choice that names a *different* published row: the label is the
  announcement's row, and `currentId` is still the stored choice's row (AC2 and AC5 in one assertion —
  they are the pair a single-string implementation cannot satisfy).
- A pick outranks both: label and `currentId` are the picked row while announcement and stored choice
  disagree with it (AC3's first half; the revert is the absence of the pick, covered by the row above).
- Nothing at any layer → `null`, including an announcement whose model is `''` over an empty stored
  choice (AC4).

**Playwright — `e2e/composer-model-announced.spec.ts`**, a new spec (the existing model-menu spec's drive
is ordered around *not* having an announcement and its fresh-launch `toHaveCount(0)` must stay). One
launch, one continuous drive, per-spec frame builders — the house pattern. `model_announced` is pushed
unsolicited, which is what the daemon does off claude's `system` / `init` line, so no manufactured input is
supplied. The sequence:

1. Push `model_announced` before anything else. The control appears with **no snapshot at all** — the
   proof that the announcement alone is sufficient, and that this drive needs no turn-end dance for it.
   No list yet, so the identifier shows verbatim on the inert arm.
2. Push `model_list`. The label resolves to the display name of the row whose `value` equals the announced
   identifier (AC1).
3. Push `turn_state` thinking → idle so a snapshot with a *different* stored model arrives (a lone `idle`
   fires nothing — `Set.delete` on an id never inserted returns `false`). The label stays the
   announcement (AC2); opening the panel shows the *stored* row marked current (AC5).
4. Pick a third row: the label moves at once. The reply is withheld from `buildReplyFrames` and a
   correlated `error` frame is pushed from the test body, addressed by the envelope id read back off the
   capture — the only shape that makes the optimistic state observable against the in-process loopback
   fake. The label returns to the announcement (AC3).

Row display names are mutually non-substring and the trigger is located by its own visible text, the
sibling spec's rule. No new fixture is added.

Not covered by choice: the `ConversationScreen` container tests keep the announced store at its default
`null`, so their pinned mount order and inert-arm counts assert the unchanged path — which is the
regression guard worth having there.

## Open questions

1. Does the `''`-means-nothing-at-this-layer rule need to hold for the **pick** layer too, or only for the
   announcement and the stored choice? Resolved in the design above (uniformly, all three) because a pick
   of `''` is only reachable from a daemon that published an empty-valued row, and the alternative would
   need `pending` to carry a presence flag this control cannot see. Recorded here so the implementation
   does not re-open it silently.
2. Whether the two `publishedRowFor` calls should be collapsed when `shown === session`. Expected answer:
   no — the lookup is a `find` over a short published list and two calls state two questions. Confirm
   while implementing; a `## Revisions` entry if it changes.

## Size check

Against the size-S table, re-counted from this written plan: **1** production source file
(`ComposerModelMenu.tsx`); **~570** lines of total written work (this plan ~230, production ~60, unit-test
edits and additions ~130, the new e2e spec ~150); **1** new exported type (`ComposerModelLayers`); **0**
new components or stores; **5** acceptance criteria; **0** error/reject branches added to any state
machine. Consumer call sites needing simultaneous update: **10** — nine `composerModelMenuModel` sites in
`ComposerModelMenu.test.tsx` plus the one production call in `ComposerModelMenuView`, in the same file. The
six `view(...)` sites are absorbed by that helper's own body and are not counted because they are not
edited. At the boundary on that line, under it on every other; no split.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings, and this is the category that matters here. `announced.model` is
  untrusted, model-influenced text that crossed the subprocess trust boundary; the daemon bounds it at 256
  bytes and sanitizes nothing. This ticket adds a **second** render surface for it (the sheet's
  `RunningModelSection` is the first). The boundary is explicit and singular: the value reaches exactly one
  JSX text position, `<span className="composer__model-label">`, where React escapes it. No
  `dangerouslySetInnerHTML`, no attribute, no URL, no filename, no cache key, no lookup path, no log line,
  on any branch — the design adds none of those and the plan forbids a `title` tooltip explicitly for this
  reason. The panel's `aria-label` stays the client-owned constant `COMPOSER_MODEL_MENU_LABEL`.
- [Trust boundaries — the second, easily-missed half] No findings. The announced string reaches
  `publishedRowFor` as a lookup **argument**, and that function is a `find` with `===` over an array — not
  a plain-object index, so no prototype-pollution or `__proto__` key hazard exists on this path. On a hit,
  the string that renders is the *published row's* `display_name`, itself already-trusted-as-inert text
  from the same daemon and already rendered in this element today.
- [Trust boundaries — control input] No findings. The announcement is a REPORT, never a CONTROL INPUT.
  Nothing security-relevant branches on it: the only branch is `=== ''` (present or not) and the exact-
  equality lookup, and the `onSelect` write still dispatches **only** a value a published row carries
  (`option.id`), never the announced string. A hostile daemon cannot make this control send a value it did
  not itself publish, which is unchanged from #988.
- [Denial of service / layout] No findings. A hostile 256-byte identifier cannot break the footer row:
  `.composer__model-label` caps at 120px with `overflow: hidden` and `text-overflow: ellipsis`, and the row
  inherits `white-space: nowrap` from `.composer__footer-button`. This is the exact bound #988 measured
  against a 56-character name, and this ticket puts a longer *class* of string through it (dated
  identifiers) without changing it — accepted and stated by the ticket. Noted for honesty: per the
  measured lesson on this row, the shipped e2e geometry assertions cannot detect a regression in that cap
  (`.composer__footer` has a hard 20px height, and these specs seed short values), so the cap is protected
  by the stylesheet and review, not by a test. This ticket does not weaken it; it also does not add the
  detector, which would need a long seeded value and a `boundingBox().width` read on the label's own
  locator.
- [Electron attack surface / process placement] No findings — nothing crosses `contextBridge` here. This is
  renderer-only wiring between three existing stores and one existing view. No IPC channel, no preload
  surface, no `webPreferences`, no navigation and no window-open path is touched. The one existing
  dereference of `window.pyry` stays inside the `onSelect` arrow, at interaction time.
- [Tokens, secrets, credentials] Not applicable by design — no secret, token, key or credential is read,
  stored, derived or rendered on this path. `safeStorage` is not involved.
- [File / storage operations] Not applicable by design — no filesystem access, no path construction, no
  browser storage. The announced identifier is never used as a filename or a path segment.
- [Cryptographic primitives] Not applicable by design — no randomness, no comparison against a secret, no
  handshake surface. The only string comparison is `row.value === model`, a display join between two
  daemon-authored values with no secret on either side, so `timingSafeEqual` is not the right tool.
- [Network & I/O] No findings — this ticket opens no socket, sets no timeout and parses no frame. The
  `model_announced` frame's decode (`parseModelAnnouncedPayload`, fail-closed) and its 256-byte producer
  bound are #587's and are unchanged; this plan deliberately re-decides no maximum, which would be a second
  place the limit is decided.
- [Error messages, logs, telemetry] No findings — nothing on this path is logged at all, which is the
  store's standing constraint and is preserved. No error message is added, and no daemon text reaches a
  console, a diagnostic or a test failure message beyond the values the e2e spec itself seeds.
- [Concurrency] No findings — no async task, no timer, no listener and no `AbortController` is added.
  There is no check-then-act across an `await` because there is no `await`: the layering is a pure function
  evaluated during render. A flooding daemon costs one object allocation per frame in the store (O(1), the
  store's own rule) and one re-render of this leaf.
- [Threat model alignment] Hostile-daemon-response is the applicable threat and it is addressed above
  (inert escaped text, no control-input use, bounded rendering, no log). Malicious-relay is unchanged —
  the relay is content-blind and on-path, and dropping or delaying a `model_announced` frame degrades to
  the state that exists today (the control shows the stored choice, or nothing). Renderer-compromise is
  unchanged: this code holds no key, token or socket to reach. **OUT OF SCOPE, named rather than
  discovered:** the announcement is app-wide, so a daemon's announcement is displayed while a *different*
  conversation is open. The ticket accepts this explicitly and assigns store-scoping its own future ticket;
  the run-configuration sheet already reads the same app-wide value under the same conditions.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-04
