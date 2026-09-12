# Edit host adopts Modal

## Files read

- `src/renderer/src/screens/channels/EditHostDialog.tsx` — `EditHostDialogView` and `requestSetHostLabel`: presentation and existing save-result mapping.
- `src/renderer/src/screens/channels/ChannelList.tsx` — `ChannelList`: sole production caller, selected-server lookup, controlled name/status and keyed save.
- `src/renderer/src/components/Modal.tsx` and `modal.css` — `Modal`: width override, title association, close asset, independent actions and whole-panel scrolling.
- `src/renderer/src/screens/channels/channels.css` — `.edit-host*`: replace the old panel/field/action styling while retaining the overlay.
- `src/renderer/src/theme/tokens.css` — existing dark color, spacing and typography tokens; missing label-large emphasized weight.
- `src/renderer/src/screens/channels/EditHostDialog.test.tsx` — `renderView`, sink guards and save-helper scenarios to preserve.
- `e2e/sidebar-host-edit.spec.ts` and `e2e/fixtures/launchPairedApp.ts` — `launchPairedApp`: two-host integration, persisted-name and IPC test seams.
- `src/shared/ipc/hostLabel.ts` and `serverInfo.ts` — `HOST_LABEL_SET_CHANNEL` and `SERVER_INFO_CHANNEL`: deterministic browser-test responses.
- `docs/knowledge/features/edit-host-dialog.md` — current data/save contract and Cancel availability during pending writes.
- `docs/knowledge/features/modal-presentation.md`, “Props and caller ownership” — adopting caller owns mounting, overlay and focus/Escape policy.
- `docs/knowledge/features/channel-list.md` and `development-verification.md` — host grouping and static-render/browser proof boundaries.

Codegraph reported an uninitialized index, including with the worktree path supplied; source reads and text search supplied the caller map.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=487-2047 (Edit host), https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=489-1942 (shared Modal).

Read both design contexts and the Edit host visual reference. The 646px panel has a divided title/close header, inline Server identity and Relay address rows, a filled Host name field, and centred outlined Cancel / filled OK buttons. `Modal` supplies the 24px/28px padding, 6px radius, shadow and close asset; the body uses 12px row gaps, emphasized label-large captions, body-medium values, and an input with 16px vertical padding.

Variable definitions confirm dark colors: on-primary-fixed `#001d34`, on-primary-container `#cfe4ff`, primary `#9dcbfc`, inverse-primary `#32628d`, on-primary `#003355`, and on-background `#e0e2e8` (existing on-surface token). The input fill is on-primary at 41%; add the missing label-large emphasized weight token, 600 (SemiBold). Express geometry and colors through existing tokens, including a 10px caption gap derived from the spacing scale.

## Change

Replace the private panel/title/footer in `EditHostDialogView` with `Modal` at width 646. Supply client-owned title, Cancel and OK labels; both Cancel and close call `onCancel`, while OK calls `onSave` and retains the current refusal expression. Reorder the identity rows above the Host name field; each row pairs a fixed caption with an escaped value span that can shrink and wrap. Keep Unavailable for a missing server and the current failure copy below the field. Remove obsolete Rename-style CSS and comments only in this dialog's surface.

No prop, store, IPC, async lifecycle, error mapping or save signature changes. `ChannelList` continues to seed the stored name, capture the selected host before saving, update its slot and close on success. The existing idle/saving/failed state, trimmed length bound and blank clear remain. Input and OK freeze during saving; both exits stay enabled. No new listeners or focus changes; Escape and backdrop remain inert. No new lifecycle/error category warrants a new log; this presentation introduces no host-content logging.

## Testing strategy

- First adapt the existing renderer assertions and observe RED: shared Modal width/title association and buttons, new field/row labels and ordering, enabled exits during saving, failure, full long values and narrowly permitted client-owned close metadata/image. Retain all trim/bound/blank/result-helper coverage.
- Adapt the existing fake-transport save/isolation/remount test to the shared controls. Exercise both sidebar trees, keyboard activation, inert Escape/backdrop, and close/Cancel without save; preserve actual IPC persistence.
- Add focused browser scenarios for a held save, failure and retry, and a synthetic long identity/relay response at 800px width in a short viewport. Scroll and tab to input/footer/header controls, check horizontal containment, and capture ordinary and constrained states in scratch space for visual comparison.
- Run the touched renderer test, `npm run build`, and only `e2e/sidebar-host-edit.spec.ts` using the approved Electron launcher. The dispatcher owns full-suite verification.

## Scope check

One deliverable: Edit host presentation adoption. Estimated total written work ~400 lines, consistent with the refiner; analogue #1300 measured 324 implementation/test/style additions and 160 plan additions. One production TypeScript file, two stylesheets, two test files and this short plan; zero new exports, zero required consumer updates, four acceptance criteria and zero new error/reject branches. All six limits hold. Refreshed remotes and checked all 19 feature branches for these files, including the theme token: no overlaps.

## Documentation handoff

Pending for the documentation stage: update `docs/knowledge/features/edit-host-dialog.md` with the Figma references, shared presentation, reordered information and new labels/actions (the opening presentation description, CSS and identity-block sections). #1347 already removed the obsolete claim that no Figma node exists. No shared documentation edits in this implementation.

## Open questions

None.
