# Reusable modal presentation

## Context

Ticket #1347 introduces one reusable renderer presentation for the separate Edit host
(#1348) and Add workspace (#1346) adoption tickets. The panel has no save flow or
dialog lifecycle of its own. No ADR is needed.

## Files read

- `src/renderer/src/screens/channels/EditHostDialog.tsx` → `EditHostDialogView` — caller-owned save state and explicit non-submit actions.
- `src/renderer/src/screens/channels/AddWorkspaceDialog.tsx` → `AddWorkspaceDialogView`, `AddWorkspaceDialog` — content and asynchronous creation remain with the adopter.
- `src/renderer/src/screens/channels/EditHostDialog.test.tsx` → `renderView` — static markup assertions in the Node test environment.
- `src/renderer/src/screens/channels/channels.css` → `.edit-host`, `.edit-host__save` — scrolling, native buttons, disabled and focus treatments; existing text buttons do not match the new footer.
- `src/renderer/src/screens/conversation/ComposerAttach.tsx` → `ComposerAttachmentRemoveButton` — matching circular glyph, but the existing private control is attachment-specific.
- `src/renderer/src/theme/tokens.css` → `:root` — dark scheme, spacing, radius and M3 type scale.
- `src/renderer/src/index.css`, `src/renderer/src/main.tsx` → root stylesheet and renderer entry — global tokens are loaded once; component CSS must be imported by the new component.
- `docs/knowledge/features/edit-host-dialog.md` → save status and Cancel policy — callers must retain their available dismissal path while saving.
- `docs/knowledge/features/add-workspace-dialog.md` → in-flight gate — the presentation must not acquire asynchronous state.
- `docs/knowledge/features/development-verification.md` → What each test tier proves — static rendering cannot establish clicks, focus or layout.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `package.json`, `vitest.config.ts` — process boundaries, reading map, existing dependencies and Node-only renderer tests.

Codegraph context was attempted but the worktree index is not initialized; repository
search and direct reads supplied the map above. No reusable generic button exists.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=489-1942

The design context and screenshot show a 600px column panel with 6px corners,
24px vertical / 28px horizontal padding, 20px section gaps, a title-large heading
beside a 28px circular close control, and a divider 12px below the title row.
The content slot stacks with 12px gaps; the centred footer adds 4px top padding
and separates outlined Cancel and filled OK by 20px, using body-large emphasized text.

Use existing dark tokens: on-primary-fixed `#001d34` panel, on-primary-container
`#cfe4ff` text, inverse-primary `#32628d` divider at 60%, primary `#9dcbfc`
actions and on-primary `#003355` filled-action text. These are the variable definitions,
not the generated code's light-scheme fallbacks. Add the missing body-large emphasized
weight token (500) and elevation-5 shadow token (black 15% at 0/8/12/6px and black
30% at 0/4/4/0px). Commit the exact downloaded close SVG; its two inks match those tokens.
Typography retains the app's existing Roboto/system font fallback.

## Design

Add `components/Modal.tsx`, importing its own `modal.css` and `assets/modal-close.svg`.
Export `Modal`, `ModalProps` and `ModalAction`. Props are `title: string`,
`children: ReactNode`, `cancelAction` and `confirmAction` (each a label, optional
disabled boolean and required `onClick: () => void`), required `onClose: () => void`,
and optional numeric `width` in CSS pixels. All three controls are native
`type="button"` buttons: each calls only its corresponding callback.

Use `useId` for the heading's id and dialog's `aria-labelledby`, independent of
supplied text. The panel has `role="dialog"` and `aria-modal="true"`; close has the
fixed accessible name `Close dialog` and a decorative image. Titles and labels are
escaped text; content is ordinary React children with no Figma sample fallback.

Use border-box sizing, a default width of 600px and a caller width override,
constrained to both the containing width and viewport minus two 24px gutters.
Cap panel height at viewport height minus the same gutters and scroll the whole
panel, preserving access to content, header and footer even in short windows.
Children remain shrinkable, text wraps, and footer actions wrap when necessary.

## State + concurrency model and error handling

No store, effect, subscription, async task, I/O or new error branch. Callers own
mounting, overlay placement, focus, Escape/backdrop handling and save outcomes.
Callbacks carry no synthesized events or submitted data. Lifecycle/error logging
stays with those caller-owned flows; rendering performs no diagnostic side effect.

## Testing strategy

Write `components/Modal.test.tsx` first and run it RED before implementation.
Static checks cover supplied title/content replacing samples, empty content,
custom action labels, each disabled combination, non-submit native controls,
title association including multiple instances, decorative close markup and width override.
Run that file GREEN and `npm run build`; inspect rendered markup against the design.
No app dialog or preview route is added. Browser interaction, focus and integrated
window layout are explicitly handed to adoption tickets #1348 and #1346.

## Scope check and open questions

One deliverable; about 350–400 total written lines (the refiner forecast ~350;
the analogue added 484 including its plan). One production TSX file, two stylesheets,
one asset, one test file and this plan; three exported symbols; zero consumers
requiring updates; three acceptance criteria; zero state-machine rejection branches.
All six limits pass. Refreshed remote feature branches: no overlaps in the proposed files.
No unresolved questions; the issue has no security-sensitive label.

## Documentation handoff

Pending for the documentation stage: the ticket specifies no documentation path,
section or documentation-only acceptance criterion. Record the reusable props and
caller ownership in the appropriate renderer topic when documenting adoption.

## Revisions

### 2026-09-12 — recovery and visual evidence

The committed plan survived the earlier interrupted run; its implementation did not.
Rechecked the current Figma context, variable definitions and screenshot, and refreshed
20 remote feature branches with no file overlap. The design and scope counts stand.
Recreate the component with RED → GREEN coverage. Following the shared visual-review
recipe, capture the actual statically rendered component with inline assets at 1280×800,
800×600 and 800×240, including a caller width override and tall content. Inspect the
images against Figma. This replaces the earlier markup-only visual check; clicks,
focus and integrated scrolling remain the adoption tickets' browser-tier checks.
