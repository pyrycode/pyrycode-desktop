# Run configuration store — related

Cross-references for [Run configuration store](run-config-store.md): the other stores and
modules it composes with, the decisions that shaped it, and the ticket-by-ticket record of
what each change added. Split out of the parent document on size (documentation stage, #1655)
— purely a location move, nothing here was rewritten.

- [Conversation list store](conversation-list-store.md) — `conversationListBridge`, the shape
  `runConfigLive.ts` clones (a `.ts` module of React-free injected helpers plus a headless leaf, and
  the refresh-trigger-predicate idiom the ticket named as precedent).
- [Conversation activity store](conversation-activity-store.md) — source of `isTurnRunning`'s
  #648-defect rationale (import it, never re-derive) and of the `connected`-clears-stale-liveness
  discriminator the refresh trigger's `Set` reuses.
- [Session store](session-store.md) — the structural precedent this store's DI-factory → singleton
  → hook → selectors shape mirrors, contrasted on reducer-vs-single-setter.
- [Session-id store](session-id-store.md) — the second write destination this data path feeds
  (`toSnapshotSessionId`/`setSessionId`, #491/#500); `sessionIdBridge` is the store's other,
  reactive-only ingress.
- [Daemon-event bridge](daemon-event-bridge.md) — the `assertNever`-guarded consumer whose
  `runConfigReceived → null` arm reserves this feature's consumer role (originally
  `snapshotReceived → null`, added at [#180](../codebase/180.md); re-pointed at #491/#500).
- [Screen snapshot fetch](screen-snapshot-fetch.md) — the original transport half this store fetched
  from through #491: the `request_snapshot`/`screen_snapshot` round trip and the
  content-minimisation seam that kept the rendered screen `text` off `snapshotReceived`. Superseded
  for this store's purposes by `request_session_settings`/`runConfigReceived`; both old events were
  later removed outright by [#621](../codebase/621.md).
- [Conversation shell](conversation-shell.md) — the Run configuration sheet
  `RunConfigData` mounts inside.
- [Run configuration write store](run-settings-write-store.md) / [#256 codebase
  notes](../codebase/256.md) — the reason #500 added the session-id half: the write-side controls
  need an address to send a `set_session_settings` change to.
- [#187 codebase notes](../codebase/187.md) — implementation summary and patterns established.
- [#188 codebase notes](../codebase/188.md) — the three read-only sections
  (`RunConfigSections`/`RunConfigView`) that read `selectSnapshot`.
- [#191 codebase notes](../codebase/191.md) — the transport slice that carried `used_tokens`/
  `window_tokens` to this store's input event.
- [#192 codebase notes](../codebase/192.md) — widened this store by the two usage figures and added
  the fourth read-only section (Context window) that renders them.
- [Run configuration write store](run-settings-write-store.md) / [#256 codebase notes](../codebase/256.md)
  — the adjacent pending-write store whose `selectEffectiveSettings` composes over this store's
  `snapshot` as its base value; deliberately not folded in as a facet (lifecycle mismatch: sheet-scoped
  vs. App-level always-listening).
- [#257 codebase notes](../codebase/257.md) — made `RunConfigSections`/`RunConfigView` interactive:
  selecting a model, picking an effort, or toggling YOLO now submits a change through the write store
  above instead of the sections only ever reading this store's snapshot.
- [Announced-model store](announced-model-store.md) / [#560 codebase notes](../codebase/560.md) —
  the sixth section, `RunningModelSection`, added ahead of `ModelSection`; sources its own store,
  not this one — see § Running model section above.
- [Model-list store](model-list-store.md) / [#975 codebase notes](../codebase/975.md) — deleted
  `MODEL_CATALOG` and re-anchored `RunningModelSection`'s lookup and `ModelSection`'s rows onto the
  daemon-published list; see § Running model section above.
- **#810** — split the store's feed by lifetime: the app-lifetime subscription moved to the new
  `RunConfigLiveData` leaf, refreshed on the connected edge and each turn-end edge, so the figures
  are true whether or not the sheet has ever been opened; `RunConfigData` kept its per-open request
  unchanged. Security-sensitive, architect self-review PASS. See § Live outside the sheet in the
  parent document.
- **#811** — gave this store's live figures a second reader: the [conversation shell](conversation-shell-composer-message-box.md#composer-footer-row-811)'s
  new composer footer row, a "Context: N%" reading beside the four blocked desktop-layout slots
  (#680/#682/#683/#685). Added no store change here — `usedTokens`/`windowTokens` were already
  required `number`s under this store's `snapshot`. What moved is the *consumer-side* percentage math:
  `ContextWindowSection`'s inline clamp (§ Configuration and usage, [#192 codebase
  notes](../codebase/192.md)) is now `contextUsagePercent(usedTokens, windowTokens)`, a shared
  `number | null` function both the sheet's gauge and the new reading call, closing a `NaN`/`Infinity`
  gap the old clamp had on an overflowing daemon value (`Number.isFinite(windowTokens)` added to the
  guard). See [conversation shell § Run configuration Context window
  section](conversation-shell-run-configuration.md#run-configuration-context-window-section-192) for the extraction and
  [§ Composer footer row](conversation-shell-composer-message-box.md#composer-footer-row-811) for the new consumer.
- **[#945](https://github.com/pyrycode/pyrycode-desktop/issues/945)** — root-cause slice 1 of
  [#941](https://github.com/pyrycode/pyrycode-desktop/issues/941): threaded a `conversation_id` onto
  the wire `request_session_settings` frame (main/shared only) after the daemon made it conversation-
  keyed on 2026-08-20, silently degrading every unnamed request to a zero-valued reply since.
- **[#946](https://github.com/pyrycode/pyrycode-desktop/issues/946)** — root-cause slice 2, and the
  slice that closed [#941](https://github.com/pyrycode/pyrycode-desktop/issues/941): both this store's
  request sites now resolve the active conversation and supply it, and the payload #945 left optional
  is required since. See § Conversation-keyed since 2026-08-20 in the parent document.
- [Command channel](command-channel.md) — the `requestSessionSettings` `RendererCommand` member's
  payload (optional from #945, required since #946) and its `isRequestSessionSettingsPayload` guard.
- [Daemon connection](daemon-connection.md) — hosts `requestSessionSettings(conversationId?)`, the
  connection method this store's data path calls into.
- **#1020** — added `permissionMode` end to end from `SessionSettingsPayload.permission_mode`
  (pyrycode#1687) through to this store's snapshot; no consumer yet. See § Permission mode in the
  parent document.
- [Run configuration write store](run-settings-write-store.md) — #1021 is the write half's mirror:
  `set_session_settings` accepts a closed five of modes, `bypassPermissions` excluded, the deliberate
  asymmetry § Permission mode (parent document) names.
- [Model-list wire types](model-list-wire-types.md) — `WireModelOption.supports_auto_mode`, whose
  docblock names the same `set_session_settings.permission_mode` field this store's read half mirrors
  (corrected by #1020 to stop saying `set_permission_mode`).
- **[#1166](https://github.com/pyrycode/pyrycode-desktop/issues/1166)** — added the fourth request
  occasion, conversation activation, via `PairedShell`'s `activateDeps.requestConversationConfig`; see
  § What it does in the parent document and [Paired shell — conversation exits and stamps § The
  run-configuration and model-list ask](paired-shell-conversation-exits.md#the-run-configuration-and-model-list-ask-activateconversationts-modellistbridgets-1166).
  Widened the frequency of the pre-existing late-reply attribution gap, closed client-side by #1176
  below.
- **[#1176](https://github.com/pyrycode/pyrycode-desktop/issues/1176)** — closed the late-reply
  attribution gap: envelope-id correlation in `daemonConnection.ts`, a required `conversationId` on
  `runConfigReceived`, and a gate in `subscribeRunConfig`. See § Conversation-attributed since #1176
  in the parent document. Filed [#1192](https://github.com/pyrycode/pyrycode-desktop/issues/1192) for
  the one ingress into `sessionIdStore` it could not reach (`sessionIdBridge`'s unsolicited
  `session_transition`).
- **[#1192](https://github.com/pyrycode/pyrycode-desktop/issues/1192)** — closed that remaining
  ingress, by a different mechanism: since the marker answers no request, there was no envelope id to
  correlate against, so this ticket instead brought `SessionTransitionPayload` into line with the
  daemon's already-shipped `conversation_id` (upstream #740/#741) and gave `subscribeSessionId` the
  same shape of gate `subscribeRunConfig` uses. See [Session-id store](session-id-store.md) § Related.
- **[#1167](https://github.com/pyrycode/pyrycode-desktop/issues/1167)** — added `clearSnapshot`, called
  by `activateConversation` and `exitActiveConversation` through the shared `clearRunConfig` dep member
  that also resets [Run configuration write store](run-settings-write-store.md). See § Scoped to the
  open chat since #1167 in the parent document and [Paired shell — conversation exits and stamps § The
  run-configuration clear](paired-shell-conversation-exits.md#the-run-configuration-clear-activateconversationts-exitactiveconversationts-both-stores-1167).
- [System-prompt store](system-prompt-store.md) — [#1231](https://github.com/pyrycode/pyrycode-desktop/issues/1231)
  copied this store's DI-factory → singleton → hook → selector shape verbatim, joined
  `requestConversationConfig` as a third ask and `clearRunConfig` as a third clear.
- [System prompt write](system-prompt-write.md) — [#1250](https://github.com/pyrycode/pyrycode-desktop/issues/1250)
  joined `clearRunConfig` as its fourth clear (no ask — the write store has nothing to re-request, only
  to drop). Reducer-shaped rather than named-setters, on `runSettingsWriteStore`'s template, since a
  write outcome reads prior state; ships dormant, #1078 is the first reader.
- **#1655** — added three optional capability flags to `RunConfigSnapshot`
  (`slashCommands`/`mcpServers`/`contextUsageDetail`) and the `sessionSupports` reading rule. See §
  Session capability flags in the parent document, [Conversation shell — actions menu and reader
  cutover](conversation-shell-actions-menu-and-reader-cutover.md), and [Conversation shell — channel
  info and MCP](conversation-shell-channel-info-mcp.md).
