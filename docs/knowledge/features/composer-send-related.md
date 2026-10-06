# Composer send — related documents

Part of [Composer send](composer-send.md).

## Related

- [#1779 architecture spec](../../specs/architecture/1779-message-reply.md) — literal message quotes,
  retained draft ownership, permission-covered focus and SVG loading.
- [#1039](https://github.com/pyrycode/pyrycode-desktop/issues/1039) — added `takeAttachments` to
  `ComposerSendDeps`, covered in [attachment handling](composer-send-internals.md#10-attachments-named-on-the-outbound-frame--takeattachments-1039-reworked-by-1055). Producer: [Composer attach § Pending
  attachments](composer-attach-pending.md#pending-attachments-1039)'s `drainPendingAttachments`, bound to
  `takePendingAttachments` on `useAttachmentUpload`. Consumer: [Thread
  timeline](thread-timeline-internals.md#types)'s `userText.attachments` field.
- [#1055](https://github.com/pyrycode/pyrycode-desktop/issues/1055) — reworked #1039's take into a
  `PendingAttachmentTake` (set + `rollback`), moved the read above the guarded send, and named the taken
  ids on the outbound frame as `SendMessagePayload.attachment_ids` ([attachment handling](composer-send-internals.md#10-attachments-named-on-the-outbound-frame--takeattachments-1039-reworked-by-1055)) — the leg that makes an attached
  file actually reach claude, closed on the daemon side since `pyrycode#2036`/`pyrycode#2038`. Boundary
  guard: [command channel](command-channel.md)'s `isAttachmentIdList`. Live proof:
  [real-claude liveness e2e](real-claude-liveness-e2e.md)'s `e2e/real-claude-attachment.spec.ts`.
- [#1213](https://github.com/pyrycode/pyrycode-desktop/issues/1213) (PR
  [#1215](https://github.com/pyrycode/pyrycode-desktop/pull/1215)) — retains the minted `message_id` on
  the echo as `ThreadEvent.userText.messageId`, covered in [the submit helper](composer-send-internals.md#1-the-pure-submit-helper--composersendts). Consumer:
  [dequeue message envelope](dequeue-message-envelope.md)'s `dropQueuedMessage`, which correlates a drop
  against it via [thread timeline](thread-timeline-internals.md#types)'s `dropUserText` arm. Full design:
  `docs/specs/architecture/1213-drop-queued-message-removes-echo.md`.
- [Outbound send path](outbound-send-path.md) / [#65](../codebase/65.md) — the **main/transport half** this drives: the `sendMessage` command becomes an encrypted `send_message` envelope on the live Noise relay session. Together #65 + #66 are the two halves of sending a message.
- [Session store](session-store.md) / [#2](../codebase/2.md) — hosts the `messageSent` action and the `appendUnique` dedupe (added #27) this relies on; #66 closes its "No optimistic send" limitation.
- [Conversation shell](conversation-shell.md) / [#1](../codebase/1.md) — the screen whose inert `Composer` this wires.
- [Command channel](command-channel.md) / [#17](../codebase/17.md) — the `sendCommand` bridge + pure `sendMessageCommand` constructor (which deliberately does **not** mint the id — the composer does).
- [Pairing input screen](pairing-input-screen.md) / [#55](../codebase/55.md) — the pure-logic / thin-container split (`pairingState.ts`) `composerSend.ts` mirrors.
- [ADR 0006 — ephemeral screen-local state](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md) · [ADR 0004 — renderer session store / wire types](../decisions/0004-renderer-session-store-reducer-wire-types.md)
- [#66 codebase notes](../codebase/66.md) — implementation summary, patterns, lessons.
- [#31 codebase notes](../codebase/31.md) — the connection-status gate on this composer: `composerAvailability` + the disabled control. The inline "why" caption it originally shipped with was retired by [#968](../codebase/968.md).
- [#968 codebase notes](../codebase/968.md) — drops the `composer__hint` caption and the `hint` field: the connection state is said once, by the banner (#279) and, in the `error` arm, by the status row (#797/#963).
- [#167 codebase notes](../codebase/167.md) — the `shouldOfferRepair` predicate beside `composerAvailability`, and the original `Re-pair` affordance it gated (retired as a separate surface by #963, see below).
- [Conversation shell § Actionable-error button](conversation-shell-composer-repair-button.md#actionable-error-button-and-the-row-that-grows-to-fit-it-963) / #963 — `shouldOfferRepair`'s current surface: a button in the composer status row's error slot, using `COMPOSER_REPAIR_BUTTON_COPY` ([recovery copy](composer-send-internals.md#9-actionable-error-button-copy--composerrepairbuttoncopy-963)), replacing #167's block beneath the composer.
- [#279 codebase notes](../codebase/279.md) — the `shouldShowBanner`/`CONNECTION_BANNER_COPY` pair beside `composerAvailability`/`shouldOfferRepair`, and the [connection banner](conversation-shell-chrome.md#connection-banner-279) it gates.
- [#512 codebase notes](../codebase/512.md) — the `shouldSubmitOnKeyDown` keystroke-intent predicate: the Enter that commits an IME composition no longer submits or suppresses the commit.
- [#1072](https://github.com/pyrycode/pyrycode-desktop/issues/1072) — added the sibling `shouldInterruptOnKeyDown` predicate ([keyboard gates](composer-send-internals.md#7-keystroke-intent-gates--shouldsubmitonkeydown-512-and-shouldinterruptonkeydown-1072)) and its two bindings; see [Interrupt envelope § The render affordance](interrupt-envelope.md#the-render-affordance-307-merged-into-the-send-button-by-678) for the second binding and the ordering argument against the screen's other Escape claimants.
- [Conversation shell § Composer error chip](conversation-shell-composer-error-chip.md#composer-error-chip-797) / #797 — the fourth read of `ConnectionStatus`, using `COMPOSER_ERROR_CHIP_COPY`/`COMPOSER_ERROR_CHIP_PREFIX_COPY` ([error chip copy](composer-send-internals.md#8-error-chip-copy--composersendts-797)) in the composer status row's `trailing` slot.
- [Conversation timeline holder](conversation-timeline-holder.md) / [#756 codebase notes](../codebase/756.md) — `dispatchFor`'s target: the keyed store the echo folds into, dual-write alongside the flat `dispatch`, still unread until #758.
- [#1013](https://github.com/pyrycode/pyrycode-desktop/issues/1013) — the optional `now` clock on `ComposerSendDeps`, implementation summary in [internals](composer-send-internals.md). [Thread timeline § Types](thread-timeline-internals.md#types) has the full `createdAt` contract; [conversation timeline store](conversation-timeline-store.md) has the mirror wiring for the assistant-side echo.
- [Interrupt envelope](interrupt-envelope.md) — since [#678](https://github.com/pyrycode/pyrycode-desktop/issues/678), the send button this page describes is one component with two variants: `ComposerSendButton` renders send at idle and the stop affordance (that page's subject) while a turn is running. `Composer` is the one render site for both.
