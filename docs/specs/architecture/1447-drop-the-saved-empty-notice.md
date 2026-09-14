# 1447 — Drop the saved-empty notice

A loaded, empty local timeline renders no `SavedTimelineNotice`. The red-bordered
`.conversation__banner` reading "No messages are saved on this device." reads as an error for
what is the ordinary state of a chat opened for the first time on this machine.

## Files read

- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `SavedTimelineNotice` (the
  three-text view) and `ConversationScreen`'s mount gate for it, beside `ConnectionBannerControl`.
  Also `offline`, `selectedHost`, `localStatus` and `ownSlice`, the four values the gate reads.
- `src/renderer/src/store/conversationTimelineStore.ts` → `beginLocalTimelineRead` — confirms
  `complete(null)` settles `localRead: 'loaded'` with an empty `items`, which is the state under test.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` → the `saved timeline notices`
  describe block: the notice-results test, and the two screen-level tests that assert the empty copy.
- `e2e/host-row-per-server.spec.ts`, `e2e/pairing-recovery.spec.ts` → the two healthy-host
  assertions that pin `.conversation__banner` to the empty copy.
- `docs/knowledge/features/conversation-shell.md` § "Held reading and host availability" — records
  that pending/failed/empty local-read notices appear while connected because they describe local
  storage; the empty third of that sentence stops being true here (documentation handoff below).
- `docs/knowledge/features/chat-history.md` — the results paragraph and the test-tier paragraph the
  ticket names (documentation handoff below).

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=102-4

N/A for the banner itself — no node draws it. Confirmed against the Chat Screen frame: the chat pane
runs overflow menu → hairline divider → first message bubble, with nothing occupying a banner band
above the thread. Removing the notice moves the render toward the frame, not away from it.

## Change

`SavedTimelineNotice` loses its `empty` prop and the `'No messages are saved on this device.'` branch,
leaving the failed, loading and offline texts. Its mount gate in `ConversationScreen` loses the
loaded-and-empty branch and becomes: a selected host whose local read is still pending or has failed,
or an offline host whose read loaded rows.

The ticket body asks only to drop the loaded-and-empty branch from the gate, which would leave the
`offline` disjunct mounting the notice over an empty thread with "Offline. Showing saved messages." —
a statement with no saved messages behind it. AC1 is the wider reading ("connected or offline"), and
AC2 keeps only the *offline-with-rows* text, so the offline arm gains a row count. That is the one
judgement in this change; everything else is deletion. The #279 connection banner is a separate
component on a separate gate and still announces the disconnection in that state, so nothing is lost
by the notice going quiet there.

Nothing else moves: `olderSaved`, `Timeline`'s own coverage banner, and the loading/failed texts are
all untouched, and no caller outside this file passes `empty`.

## Testing strategy

- The notice-results unit test drops its `empty` argument and asserts the three surviving texts.
- One new screen test, connected and offline, over a `complete(null)` read: neither saved-timeline
  text renders, and the offline leg still shows `CONNECTION_BANNER_COPY` — the AC1 pair in one case.
- The existing "isolates saved rows" test already pins offline-with-rows to the offline text; it is
  the AC2 regression guard and stays as written.
- "keeps explicit saved coordinates after metadata reseeding" asserts the *absence* of the empty copy
  to prove a rejected other-host slice reads as pending. That string is about to stop existing, which
  would make the assertion vacuous, so it flips to the positive form: the screen shows
  "Loading saved messages…".
- The two e2e specs assert no `.conversation__banner` at all, which is the stronger form of what their
  comments already claim (another host's failure adds no warning). `pairing-recovery` gets a mounted
  `.conversation` anchor first, so the new count-zero cannot pass against an unmounted screen.

## Documentation handoff

Pending for the documentation stage — not edited here, both files are `docs/knowledge/features/`:

- `docs/knowledge/features/chat-history.md`, the local-read results paragraph (the one beginning
  "Timeline reading shows 'Loading saved messages…'"): the sentence "Both `missing` and a stored empty
  timeline succeed and show 'No messages are saved on this device.'" is now wrong — both still
  succeed, and neither shows a notice. The same paragraph's "Nonempty restored content shows 'Offline.
  Showing saved messages.'" is now exact rather than incidental.
- `docs/knowledge/features/chat-history.md`, the test-tier paragraph near the end: "Healthy-host
  interaction tests assert exactly the local empty-storage notice, so they still reject an additional
  connection warning caused by another host's failure" — those tests now assert no banner at all.
- `docs/knowledge/features/conversation-shell.md` § "Held reading and host availability": "Pending,
  failed and empty local-read notices can still appear while connected because they describe local
  storage, not connectivity" — drop "and empty"; the other two still appear while connected.

## Open questions

None.
