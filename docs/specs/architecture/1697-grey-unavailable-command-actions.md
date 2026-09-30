# #1697 — grey out command actions a session cannot run instead of hiding them

## Files read

- `src/renderer/src/screens/conversation/ComposerActionsMenu.tsx` → `composerActionRows`, `COMPOSER_ACTIONS`, `NEW_SESSION_ACTION`. The one function that changes.
- `src/renderer/src/screens/conversation/composerActionAvailability.ts` → `markUnavailableActions`. This is #681's marking (`{ ...action, unavailable: true }`), which the new arm mirrors. It stays untouched.
- `src/renderer/src/screens/conversation/ComposerActionsMenu.test.tsx` → the `a session without slash commands (#1655)` describe. It pins the old hiding behaviour and is rewritten to pin greying.
- `e2e/composer-actions-unavailable.spec.ts`: the #681 greyed-row drive (forced click plus Enter, nothing sent). The ticket names it as the e2e home.
- `e2e/session-capabilities.spec.ts`: #1655's spec. It asserts the menu is `['Reset session']` and must follow the new rule.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=115-3677

This is the Actions trigger (56×16: the word `Actions` beside an up chevron). The ticket adds no visuals. The command rows reuse #681's existing greyed row: the `unavailable` modifier and the `(unavailable in this workspace)` note that `ComposerOptionsPanel` already draws.

## Change

`composerActionRows(menu, false)` currently returns `[NEW_SESSION_ACTION]`. It will return `NEW_SESSION_ACTION` followed by every `COMPOSER_ACTIONS` row marked `unavailable: true`, whatever `menu` says. This is mobile's `absentComposerActions` rule (pyrycode-mobile#1111), per the owner's decision on 2026-09-30. With the flag `true`, the function still returns the `markUnavailableActions` composition. Nothing else changes: `ComposerOptionsMenu` already refuses a pick on an unavailable row, so a pick sends nothing. The control row is not a slash command and stays live. The marking spreads each client-owned option, so `id` and `label` are carried through unchanged, as `markUnavailableActions` requires.

The spec overlaps no in-flight branch.

## Testing strategy

- **Unit** (`ComposerActionsMenu.test.tsx`, #1655 describe): with `slashCommands` false, and with either no menu or a published menu that names both commands, the rows are the control row (not marked) followed by both commands marked `unavailable: true`. The panel markup shows three rows, two of them carrying the unavailable note. The trigger stays unchanged. The flag-true cases are already covered by the existing describes.
- **e2e** (`composer-actions-unavailable.spec.ts`): a second `test()` block. A `session_settings` reply with `slash_commands: false` is sent alongside a published menu that names `compact`. The menu lists Reset session, then Compact session and Knowledge capture, both marked `aria-disabled` and showing the note. A forced click and an Enter on a greyed row both send nothing.
- **e2e** (`session-capabilities.spec.ts`): the menu assertion moves from `['Reset session']` to the three rows, with both command rows `aria-disabled`.

## Documentation handoff

This is pending for the documentation stage. The owning package overview (`docs/knowledge/features/` composer / Actions menu topic) describes #1655 as dropping the command rows for a session without slash commands. It should say they are greyed instead, per mobile's `absentComposerActions`.
