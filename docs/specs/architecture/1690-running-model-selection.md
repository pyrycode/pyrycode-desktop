# Running model selection on inherited conversations

## Files read

- `src/renderer/src/screens/conversation/ComposerModelMenu.tsx` — `composerModelMenuModel`, `modelFamily`, `ComposerModelMenu`: shared selection decision and pick/announcement/snapshot inputs.
- `src/renderer/src/screens/conversation/RunConfigSections.tsx` — `RunConfigView`, `ModelSection`, `EffortSection`, `publishedRowFor`, `effortRowFor`: pure sheet, raw writes, internal default effort resolution and independent Running model lookup.
- `src/renderer/src/store/runSettingsWriteStore.ts` — `selectEffectiveSettings`, `selectDisplayedEffort`: confirmed/pending choices, rollback and applied-effort precedence.
- `src/renderer/src/screens/conversation/ComposerEffortMenu.tsx` — `ComposerEffortMenu`: footer effort reading and effective-model offerings.
- Existing `ComposerModelMenu.test.tsx`, `RunConfigSections.test.tsx`, `e2e/composer-model-menu.spec.ts`, `e2e/real-claude-effort-default.spec.ts`: static selection, correlated rejection and live settings evidence.
- `docs/knowledge/features/composer-model-menu.md` — selection, per-agent filtering and raw-write contracts.
- `docs/knowledge/features/conversation-shell-run-configuration.md` — Model and Effort sections: preserve Running model lookup and effort offerings.
- `docs/knowledge/features/development-verification.md` — independently stated expectations, static-render limits and live executed-count requirement.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=115-3683

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=600-1694

The footer shows a compact primary-colour family label and upward chevron using body-small typography. The sheet reference shows vertically stacked model radios, effort choices and running-model/context readings, with a tertiary-colour selected radio. Reuse the existing desktop dropdown and sheet, tokens and assets; this ticket changes selection and removes Default without migrating layout.

## Context and size

An inherited session launches without a model argument; Claude settings.json can override the recommended resolution published by the default row. After an announcement, that recommendation must not determine marking. One deliverable is consistent running-model/effort marking on the existing two surfaces.

Estimate: about 600 total written lines, two production files, zero new exports/types/components/stores, at most two production consumers updated, five acceptance criteria, zero new error branches. The nearest analogue is the model-menu change in `2af4b19a`; this ticket adds broader shared-input and live evidence. All six size boundaries hold. Remote feature-branch overlap check found no overlapping files. Codegraph reported an uninitialized index, so source searches supplied the symbol map. No dependency on model recall.

## Design

`composerModelMenuModel` remains the authoritative pure decision. Exclude `value === 'default'` from visible agent-filtered rows, retaining order and labels. Picks or explicit saved choices mark only an exact raw value; unmatched choices mark nothing. Preserve explicit trigger-label precedence (pick, announcement, stored).

For inheritance (no pick and saved empty/default), match a non-empty announcement by exact raw value, exact raw resolution, then non-empty `modelFamily(row.value)`. At each tier a unique row wins; ambiguity stops. Without an announcement, match only a unique row with the usable Claude default resolution (neither empty nor `<unmeasured>`). Never use that resolution to mark after announcement. No snapshot with no pick/announcement still renders no trigger.

Inherited Claude labels use the marked row's existing resolution/value family chain, otherwise announced family, usable default-resolution family, then `Model`. Codex retains display-name/raw-announcement labels, with `Model` for its empty snapshot state; its inherited marking uses the same announcement tiers.

Add an optional `modelLayers` input to pure `RunConfigView`, defaulting to its model and announcement for existing callers. Production supplies exactly the footer's picked, stored and announced layers. The view calls `composerModelMenuModel` and gives `currentId` to `ModelSection`; sheet row labels remain published display names. This introduces a module cycle with existing lookup exports, safe because the functions are only invoked after module initialization; no module-level invocation is added.

Widen the existing effort prop to accept null/unavailable readings. The sheet container passes `selectDisplayedEffort`; null marks nothing. Keep the effective model prop separate, so `effortRowFor` retains its internal default row. Preserve `publishedRowFor`, permission mode and Running model lookup. Existing submission diagnostics remain the lifecycle logs; no new I/O or failure classification is introduced.

## State + concurrency and errors

No new state, asynchronous work, subscriptions or teardown paths. Existing per-conversation selectors and correlated write store govern pending, confirmation and rejection. Announcement-derived row IDs are used only for marking; selecting still submits the published raw value. Read-only controls and rejection errors remain unchanged; ambiguity/unmatched inputs are ordinary unmarked readings.

## Testing strategy

- Shared-input unit/static-render table states expected row IDs and trigger labels independently for no snapshot, usable/empty/unmeasured/unmatched/ambiguous defaults, announcement value/resolution/family and ambiguity, recommendation disagreement, saved default, explicit choices and agent filtering/Codex.
- Drive pending, confirmed and rejected picks through the real write-store reducer and render both surfaces from those same inputs. Prove effort applied/saved disagreement, pending priority, saved fallback and explicit null; keep offerings from effective model.
- Update assertions pinned to the removed Default row and inherited marking; fake-transport menu test retains raw writes, optimistic marking and correlated rejection. Capture the integrated screen for visual comparison.
- Extend the real effort-default spec to observe conversation-scoped announcement, fresh published list and settings after the inherited real turn. Independently select the expected row and assert both surfaces, absent Default and applied effort. Dispatcher runs `npm run e2e:real:gate`; skipped tests do not prove live acceptance.
- Builder gate: touched Vitest files, build, and touched fake-transport spec. No full-suite or live-tier run in this role.

## Open questions

None. Optional pure-view inputs preserve existing callers while production uses the full layers.

## Documentation handoff

Pending for documentation stage: update `docs/knowledge/features/composer-model-menu.md`, selection/label rules, with marking/label rules and the settings.json caveat; update `docs/knowledge/features/conversation-shell-run-configuration.md`, Model and Effort section rules.

## Revisions

- Implementation source check: `selectDisplayedEffort` is declared in `ComposerEffortMenu.tsx`, rather than the write-store module named in the reading list. Reuse that existing export; its contract and the plan's state model are unchanged.
- Existing fake-transport announcement and snapshot-wait specs also pinned the removed row. Update these two local fixtures/assertions alongside the menu spec and verify each touched spec.
- Live-gate rework: the question/model-change spec indexed the dropdown using the full published list. The gate failed its Opus announcement assertion because removing Default shifted the click onto Haiku. Filter to visible Claude non-default rows before locating the target, assert the menu count and clicked label, and retain the original continuation/announcement assertions. This is a test-driver regression from this ticket; no production change is needed. Remote feature branches have no overlap on the three test files being updated.
- Verifier evidence improvements: assert the dropdown's selected row position against the independently expected raw value in the shared-input matrix; store the two fake-transport screenshots with `testInfo.outputPath` and attach them. Live execution remains the dispatcher's `needs-real-claude` handoff.
