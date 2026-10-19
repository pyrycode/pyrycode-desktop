# Conversation shell — composer error chip (#797)

Split from [Conversation shell — composer status row and error slot](conversation-shell-composer-status.md)
on 2026-09-15 to stay under the size cap. Part of [Composer](conversation-shell-composer.md); see the
parent page for [the status row](conversation-shell-composer-status-row.md) and the slot's
other occupants.

## Per-message delivery metadata

Local echoes also use the shared fixed-copy treatment for transport delivery:
`COMPOSER_MESSAGE_DELIVERY_COPY` in `composerSend.ts` maps `waiting` to “Waiting for
connection” and `not-sent` to “Not sent”. `TimelineRow` reads the echo sidecar by
stable row key and renders the label inside the existing user `bubble__meta` row.
While a label is present it occupies the metadata slot normally used by the timestamp;
the echo's original timestamp and attachments remain intact. These labels describe
local transport state and do not claim daemon queue membership or acknowledgement.

Waiting uses `.bubble__delivery--waiting`, scoped to
`--color-on-primary-container` (#cfe4ff) on the user bubble's
`--color-on-primary` (#003355) fill, retaining metadata typography and layout.
Do not inherit the timestamp's `--color-inverse-primary` for always-visible delivery
copy: that pairing yields only 2.04:1 contrast. The scoped token gives 10.09:1;
the mounted regression asserts computed RGB colours and contrast of at least 4.5:1.
Not sent uses `composer-status__error`, reusing the error chip's existing styling.
Both labels are client-owned constants; caught errors and daemon text never supply
their copy. Existing Reconnect and Re-pair controls remain the recovery affordances.

A synchronous bridge exception leaves one Not sent echo with its text and
attachments, returns false to preserve the draft, and rolls back pending attachments
for resubmission. Host-stamped updates also reach inactive retained threads; a
matching queue snapshot or user receipt clears local status and settles the existing
row without changing its original metadata. Written clears the label but does not
acknowledge daemon receipt. See [composer status and settlement](composer-send-internals.md#2-local-delivery-status-and-receipt-settlement)
and [connection lifecycle](daemon-connection-disconnected-delivery.md#disconnected-composer-message-delivery)
for ownership, bounded in-memory holding and unchanged-pairing recovery.

The [recorded fake-transport evidence](daemon-connection-disconnected-delivery.md#delivery-verification)
includes the automatic, explicit and terminal scenarios, readable waiting captures
at 1280×800 and 800×800, and terminal Not sent treatment. No new real-Claude
acceptance is required for these statuses.

## Composer error chip (#797)

Retired by [#2076](https://github.com/pyrycode/pyrycode-desktop/issues/2076).
`ComposerErrorChip`, its old container and both chip-copy constants are gone.
The composer status row renders no connection occupant; its remaining reports
stay connected-only. Connection explanation and recovery use
[the Top overlay](conversation-shell-chrome.md#connection-banner-279), with one
atomic polite connection/restoration announcement and no duplicate footer region.

The shared `.composer-status__error` class remains for other reports and delivery
feedback. Its presence is not evidence that the retired connection chip returned.
See [recovery actions and testing](conversation-shell-composer-repair-button.md)
for current host routing, static-test setup and mounted coverage.
