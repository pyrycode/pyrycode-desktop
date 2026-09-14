# #1423 — a chat with no explicit model draws the model menu from the inherited-default row

`composerModelMenuModel` returns `null` when every layer is `''`, so a chat that has never picked a model
and has never had a turn draws no model trigger at all. Since pyrycode#2085 that is every new chat until
its first turn. This slice resolves that one state to the daemon's inherited-default row — the same
substitution #1168 made for the two effort surfaces — so the trigger is drawn, the menu opens, and the
`default` row is marked current.

## Files read

| Path → symbol | Why it matters |
|---|---|
| `src/renderer/src/screens/conversation/ComposerModelMenu.tsx` → `composerModelMenuModel`, `firstShown`, `modelFamily`, `ComposerModelMenuView` | The whole change. Its `shown === ''` early return is what this ticket replaces; the label chain, the marking and the options mapping below it are untouched. |
| `src/renderer/src/screens/conversation/RunConfigSections.tsx` → `effortRowFor`, `INHERITED_DEFAULT_MODEL_VALUE`, `publishedRowFor` | The one home of the empty-model → inherited-default-row substitution, and the constant this file must not grow a second copy of. `effortRowFor`'s docblock names `composerModelMenuModel` as a caller that must *not* gain the case — that paragraph is now partly false and is rewritten here. |
| `src/renderer/src/screens/conversation/ComposerEffortMenu.tsx` → `composerEffortMenuModel` | The precedent this follows verbatim one button to the right: #1168 re-pointed exactly one lookup and moved nothing else. |
| `src/renderer/src/screens/conversation/ComposerModelMenu.test.tsx` → the `#1168` describe block | Pins that this control does *not* mark the inherited-default row on an announcement with no session model, and says in as many words that whether the trigger should mark it is "a separate question, deliberately out of that ticket's scope". This ticket is that question; the block's two assertions must stay green. |
| `src/renderer/src/screens/conversation/runSettingsControls.ts` → `isAddressableSessionId` | The gate on the write half of AC1. Untouched — see § Change. |
| `docs/knowledge/features/composer-model-menu.md` § "`composerModelMenuModel`, one pure function deciding all three renderings" | Records that the `null` rendering is #988's own decision, widened by #1053, and that a chat on the inherited default "sits in this state permanently". That sentence is the bug. |
| `docs/knowledge/features/run-config-store.md`, `docs/knowledge/features/composer-effort-menu.md` § "Reaches the launch arguments" | Both record that since pyrycode#2085 a conversation's session is minted and bound at creation and the daemon answers a never-messaged conversation with its own `session_id` and stored values — which is why a pick made before the first message persists. |

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=115-3683

The footer's model trigger: a centred row with a 4px gap, a body-small label in `--schemes/primary`
(`var(--color-primary)` here, through `.composer__model-label`) and the 8×4 `chevron-up-solid-full` glyph
beside it. Geometry is unchanged by this ticket — the trigger already renders exactly this shape for every
chat that has a model to show, and the change is only that a chat on the inherited default now reaches
that rendering instead of rendering nothing.

## Change

`composerModelMenuModel` stops treating "no layer has anything" as "nothing is known" and treats it as what
the wire contract says it is: the daemon's inherited default. When `shown === ''` the row is resolved
through `effortRowFor(models, shown)` — #1168's existing helper, `publishedRowFor` with the single
substitution of `INHERITED_DEFAULT_MODEL_VALUE` for the empty model — and that one row answers **both**
lookups this function makes. It can: `shown === ''` means `picked`, `announced` and `stored` are all `''`,
so the marking's input `firstShown(picked, stored)` is `''` too. If no such row is published the function
returns `null` exactly as it does today, which is AC2's second arm. Everything downstream — the
`resolved_model` → `value` family chain, the `display_name` fallback, the options mapping, and the two
view arms — is untouched, so the inherited-default row is labelled and marked by the same rules as any
other hit.

Nothing else on any other input changes. `effortRowFor` is `publishedRowFor` for every non-empty model by
construction, so the substitution reaches exactly the one input AC2 names: `' '`, `'Default'` and
`'default-x'` all miss the same rows they miss today, and an announcement with no session model still
marks nothing, because `shown` is then the announcement and the old path runs unaltered.

**Why `effortRowFor` and not a second copy.** The rule — "an empty session model means the row the daemon
publishes for its inherited default" — is one rule, and `INHERITED_DEFAULT_MODEL_VALUE` is deliberately not
exported so that changing the literal fails a test rather than being followed silently. Importing the
helper is what keeps both true. Its *name* now lags its callers: it is named for its first two uses and has
gained a third that is not an effort surface, which is the situation `publishedRowFor`'s own docblock
records for #976 ("named for the rule rather than for either use"). A rename is declined here rather than
overlooked — it would touch three further files plus an e2e comment and staleify five knowledge documents
for no behavioural gain, which is adjacent-refactor work this ticket does not need. `effortRowFor`'s
docblock is corrected instead: it currently states that `composerModelMenuModel` must *not* gain this case,
and after this slice that holds only for the marking lookup on a chat with an announcement.

**The write half of AC1 is inherited, not built.** The container's `onSelect` gate
(`connected && isAddressableSessionId(sessionId)`) is not touched, so a pick made from this rendering goes
through `changeConnectedSetting` exactly as a pick from any other does. It reaches the daemon before the
first message because the conversation's session is minted and bound at creation (pyrycode#2085) and
#1166 asks for the snapshot and model list on open — both recorded in the package overviews above.

**One stale comment goes with it.** `composerModelMenuModel`'s inline note that a daemon publishing a row
whose `value` is literally `''` would have that row marked on an inherited-default session is no longer
true: that state now resolves `default` and consults no other row, which is the precedence `effortRowFor`'s
docblock already states for the effort surfaces. The note is rewritten to match rather than left to
mislead.

## Testing strategy

Unit only, in `ComposerModelMenu.test.tsx` (vitest, `node` environment, static markup). No new interaction
exists — the open→pick→`set_session_settings` path is the one `e2e/composer-model-menu.spec.ts` already
drives, and this slice adds no branch to it.

A new `#1423` describe block seeded with the existing `#1168` block's inherited row:

- **AC1, the decision.** All three layers `''` and a list carrying the `default` row → the whole model by
  `toStrictEqual`: the derived label, `currentId: 'default'`, and the published rows as options.
- **AC1, the label's source chain.** An inherited row whose `resolved_model` derives to a *different*
  family from its `value`, pinning that the trigger reads `resolved_model` first — the seeded rows cannot
  tell the two sources apart, which is why the `#1095` cases already carry rows of their own.
- **AC1, the rendering.** `ComposerModelMenuView` on that state draws the openable trigger, not the inert
  span and not nothing: the `aria-haspopup`/`aria-expanded` button and the chevron. Plus the shared panel
  fed this model marks exactly one row, and it is the inherited-default one.
- **AC2, the only input.** With the same list, a `stored` of `' '` still marks nothing and still labels
  verbatim — the substitution is on `''` and nothing adjacent to it.
- **AC2, no row to resolve.** Already pinned by `returns null when the session model is not known` and
  `renders nothing when the session model is not known`, both of which seed a list with no `default` row
  and a `null` list. Their comments are extended to record that the criterion is now conditional; the
  empty-list input is added alongside so all three of AC2's readings sit in one assertion.

The `#1168` block's two assertions stay green unmodified — its state has an announcement, so it never
reaches the new branch. Its header comment gains a line recording that its own open question is now
answered here, so a later reader does not read it as still open.

## Documentation handoff

The ticket's size estimate names "the knowledge doc" and the issue body carries no separate
**Documentation handoff** section. Pending for the documentation stage, not done here:

- `docs/knowledge/features/composer-model-menu.md` § "`composerModelMenuModel`, one pure function deciding
  all three renderings" — the rendering table's first row and the paragraph stating that a chat on the
  inherited default "sits in this state permanently" both describe pre-#1423 behaviour and need the new
  branch and its `no default row published` arm.
- `docs/knowledge/features/conversation-shell-run-configuration.md` and
  `docs/knowledge/features/composer-effort-menu.md` both describe `effortRowFor` as the home shared by the
  *two effort surfaces*; it has three callers now.

## Open questions

1. **Does one row legitimately answer both lookups in this state?** Expected answer: yes — `shown === ''`
   is only reachable when every layer is `''`, so both lookups take `''`. If that stops being true (a
   fourth layer, or a `firstShown` that skips a layer), the two lookups must separate again.
2. **Should the rename of `effortRowFor` be taken here?** Expected answer: no, per § Change. If the
   verifier reads the name at its new call site as misleading enough to block, the rename is four
   production files and mechanical.
