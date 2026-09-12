# Reusable modal presentation

[`Modal`](../../../src/renderer/src/components/Modal.tsx) supplies the shared panel,
header, content slot and footer for desktop dialogs. It imports its own stylesheet
and close SVG; the renderer entry loads the shared theme tokens. The presentation
is used by [Edit host](edit-host-dialog.md), which supplies a 646px preferred
width and its existing save and dismissal callbacks.
[Add workspace](add-workspace-dialog.md) adoption is tracked separately in
[#1346](https://github.com/pyrycode/pyrycode-desktop/issues/1346).

## Props and caller ownership

The module exports `Modal`, `ModalProps` and `ModalAction`.

| Prop | Contract |
| --- | --- |
| `title` | Required string, rendered as the dialog heading. |
| `children` | Required `ReactNode`; `null` leaves the content slot empty. |
| `cancelAction` | Required `ModalAction` for the outlined footer button. |
| `confirmAction` | Required `ModalAction` for the filled footer button. |
| `onClose` | Required `() => void` callback for the header close control. |
| `width` | Optional preferred width in CSS pixels; defaults to 600. |

Each `ModalAction` has a required `label: string`, required `onClick: () => void`
and optional `disabled: boolean`. Labels and disabled states are independent;
there are no sample-content or action-label defaults. All three controls are native
`type="button"` buttons and invoke only their corresponding callback, without
forwarding the click event or submitting a form. The header close remains enabled.
Callers wire Cancel and close to dismissal and confirmation to their save action.

Callers own data, validation, pending/error state, save outcomes and mounting.
They also provide the overlay and its placement, focus entry/containment/restoration,
and Escape/backdrop policy. `Modal` performs no asynchronous work or lifecycle
handling. An action does not unmount the panel by itself. The adopting dialogs
must preserve their available dismissal path while a save is outstanding; their
round trips have no timeout.

The panel carries `role="dialog"` and `aria-modal="true"`. `useId` associates
`aria-labelledby` with its own heading, including when titles repeat. Titles and
action labels render as escaped text. Close has the fixed accessible name
`Close dialog`; its image is decorative (`alt=""`, `aria-hidden="true"`). Native
buttons and focus-visible outlines support keyboard use; modal focus behavior
still belongs to the caller.

## Layout and theme

[`modal.css`](../../../src/renderer/src/components/modal.css) uses border-box sizing,
`width: min(var(--modal-width), 100%)` and an independent viewport-only
`max-width: calc(100vw - 48px)` through the 24px spacing token. The preferred width
therefore fits the container and leaves room for two viewport gutters.
`max-height: calc(100dvh - 48px)` with `overflow: auto` scrolls the whole panel.
Header, content and footer retain their natural heights; neither header nor footer
is pinned. Content children can shrink, text wraps and footer actions wrap.

Keep the container-relative width separate from the viewport maximum. A percentage
inside `max-width: min(...)` let a caller-owned grid's intrinsic track grow with a
1200px preferred width, pushing even the capped panel beyond an 800px window.
The viewport-only maximum fixes that sizing dependency. Static markup tests remained
green during the failure because they could only check the width custom property.

The panel follows the [Modal design](../../specs/architecture/1347-reusable-modal-presentation.md#design-source):
24px vertical / 28px horizontal padding, 6px corners, a title-large heading and
centred actions. It uses the existing dark palette and Roboto/system fallback
described in [ADR 0003](../decisions/0003-m3-theme-tokens-css-custom-properties.md).
The shared tokens include `--text-body-large-weight-emphasized: 500` for its actions
and `--shadow-elevation-5` for its two-layer shadow.

## Close asset delivery

`electron.vite.config.ts` disables asset inlining only for
`src/renderer/src/assets/modal-close.svg`. The callback returns the default decision
for every other asset. The unchanged SVG is emitted as an app-local file with a
hashed name, retaining the existing import and decorative image markup.

The renderer image policy allows self and blob images, but excludes data URLs.
The first Edit host adoption exposed Vite's default embedding of this small SVG as
a data URL. The close button still worked and static markup checks passed, while
the built window showed a broken image. The fix preserves the security policy and
the exact design asset. Do not relax that policy to accommodate asset packaging.

`e2e/sidebar-host-edit.spec.ts` verifies the image actually decodes in the built app
by requiring a natural width of 28. Its failure before the fix and pass afterwards
establish the regression. Isolated captures that inline assets use a different
image policy and cannot prove this delivery path.

## Verification boundaries

[`Modal.test.tsx`](../../../src/renderer/src/components/Modal.test.tsx) checks supplied
and empty content, labels, all four disabled combinations, escaped text, generated
title associations, decorative close markup, native non-submit buttons and preferred
width. These server renders do not execute callbacks or CSS layout.

Static captures checked the 600px default at 1280×800, a 646px override at 800×600,
and a 1200px override with tall content at 800×240. Document dimensions matched each
viewport after the grid fix. This establishes visible layout without proving that
off-screen controls can be reached. Adoption coverage must exercise callbacks,
keyboard operation, focus/Escape/backdrop policy and scrolling to those controls in
the fake-transport browser tier. See [development verification](development-verification.md#what-each-test-tier-proves).

Edit host adoption supplies the interactive evidence in its fake-transport spec:
keyboard opening and dismissal, preserved Escape/backdrop behaviour, independent
exits during a held save, retry, wrapping and scrolling to off-screen controls.
Its normal and constrained built-app captures also show the decoded close icon.
