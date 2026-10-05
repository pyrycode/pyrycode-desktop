# 0011 — Notification previews: bounded daemon text with main-owned cleaning and fallback

## Status

Accepted, 2026-10-05. Implemented by
[#1737](https://github.com/pyrycode/pyrycode-desktop/issues/1737).

## Context

Notification bodies originally came exclusively from two main-owned strings selected by a closed
`NotifyKind`. Conversation names later became optional title text, cleaned in main. Fixed bodies
tell a user working in another window that something happened, but give no reply or action detail
to help decide whether to switch back. Reply and tool text already exist in the renderer's
conversation timelines; the notification command remains a main-local side effect.

Allowing that text into OS notifications changes the display boundary: daemon-authored content can
appear outside the app, including notification history. Renderer-selected text is still untrusted
at IPC, and renderer cleaning cannot establish a main-side guarantee.

## Decision

Extend `NotifyPayload` with optional `preview?: string`. Keep `kind` closed and the copy table
exhaustive as the fallback for missing or unusable previews. The IPC guard accepts a defined
preview only when it is a string of at most 4000 UTF-16 units; malformed text rejects the whole
command before dispatch.

Select previews synchronously from the event conversation's retained timeline, rejecting slices
stamped with a different server. Use the newest assistant text of the ending turn, extracted by
the existing remark-based `markdownPlainText`, or `Wants to run <tool>: <target>` from the newest
unresolved row whose tool name matches the permission prompt. Reuse `toolHeadline` for the target;
an empty target remains a match. Trust prompts and question batches keep fixed copy.

The renderer collapses whitespace before truncating to 200 code points. Main independently converts
whitespace controls to spaces, removes other control characters, collapses and trims whitespace,
then caps the body at 200 code points including `…` when cut. Empty cleaned text uses the fallback.
Main constructs plain-text notification options explicitly and never logs preview, reply or tool
text. Existing focus, push, mute, dedup and click-routing behavior is retained.

## Rationale

The renderer owns the typed timeline and the event's host/conversation context, so it can select
the relevant content without fetching or moving timeline state into main. Reusing Markdown
extraction and the collapsed tool headline keeps display semantics consistent and avoids a new
parser or target picker. Matching the ending turn prevents an unrelated earlier
reply from being presented as the new result.

The two bounds serve different purposes. Renderer truncation preserves notifications for long
legitimate replies that would otherwise fail IPC validation. Collapsing whitespace first preserves
useful preview content and the ellipsis through main's second pass. The 4000-unit guard bounds
main's work on untrusted input; main's own cleaner enforces the OS display contract even when the
renderer skips its presentation steps. Renderer-only sanitization would leave that boundary open.

## Consequences

- The static-body restriction is replaced by bounded plain-text display. The closed enum now
  guarantees fallback coverage rather than excluding all daemon text from notification bodies.
- Reply and action details may be visible on OS notification surfaces and in their history under
  the existing notification gates. Display does not execute tool text, follow links, parse HTML
  or confer authority. Unicode format characters remain outside the control-character policy.
- A missing/evicted timeline, server-stamp mismatch or missing matching item uses fixed copy.
  Unstamped slices remain eligible under the timeline store's receipt rule. A matching empty
  tool target displays `Wants to run <tool>:` after trimming.
- The preview adds no wire command, fetch, storage or credential surface. The opaque click token
  remains independent of the displayed text and resolves only inside the renderer.
- Mobile shares the 200-character cap, fixed fallback copy and "Wants to run" wording.

## Related

- [Push notifications](../features/push-notifications.md) — selection, cleaning, gates and tests.
- [Architecture plan](../../specs/architecture/1737-notification-reply-preview.md) — design and
  security review.
