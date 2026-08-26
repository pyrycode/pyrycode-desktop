import type { ConversationStatus } from '../../store/conversationStatus'

// #800 — the presentational leaf of a sidebar row (Figma 106:3051, split from #676): one already-resolved
// `ConversationStatus` in, one dot out. It reads no store, resolves nothing and has no call site yet —
// #799 landed the type and the resolver, #801 wires the row and is this file's first consumer.
//
// NO `import './channels.css'` HERE, deliberately. `ChannelList.tsx:1` is this directory's single
// stylesheet import and both dialog siblings decline one; a second import would be an idiom break for no
// behaviour change. The styles for this component live in `channels.css` beside the sidebar's others.
//
// Named for what it reports — what a CONVERSATION is doing — against `HostConnectionDots`
// (ChannelList.tsx:330), which reports whether a MACHINE is reachable. The two sit six pixels apart in the
// same sidebar and must not read as one concept: different contract, different box (a 1px ring vs a filled
// disc), and — see § the class token below — deliberately disjoint class names.
//
// SECURITY: no daemon text can reach this file. The only input is one of three client-owned literals, and
// the label it selects is a client-owned constant in the app's own voice. Nothing is logged on any path,
// matching the resolver's log-free construction.

/**
 * The accessible name per status, so colour is not the only signal (AC2).
 *
 * A `Record<ConversationStatus, string>` rather than a `switch`: the record is exhaustive BY TYPE, so
 * #802's reserved fourth status (input required) becomes a `npm run typecheck` failure here rather than a
 * silently unlabelled dot — which a `switch` with a `default:` arm would swallow. Its copy matches the
 * ticket's own status table.
 *
 * Module-private: nothing outside needs it, and exporting it would ship an unread read surface
 * (`backgroundTaskRosterStore.ts:418-420`'s rule, which `isWorking` in the resolver already follows). The
 * unit spec asserts the shipped literals instead.
 */
const STATUS_LABELS: Record<ConversationStatus, string> = {
  working: 'Assistant working',
  'new-messages': 'New messages',
  idle: 'Idle'
}

/**
 * One dot for one conversation's status: a single <span>, no wrapper, no child, no text node.
 *
 * The class token is `conversation-status-dot`, checked against BOTH hazard families the ticket names —
 * and a rename must re-check both, not just the first:
 *
 *   - Playwright strict mode. `launchPairedApp.ts:224` clicks an unfiltered `.channel-list__row-open` that
 *     28 specs ride, so an element JOINING an existing locator's match set strict-violates rather than
 *     failing an assertion. This token shares no substring with `channel-list__row`, `__row-open`,
 *     `__section-header` or `__host*`, so no file under `e2e/` needs touching.
 *   - Substring assertions on raw markup. `ChannelList.test.tsx` counts `channel-list__host-dot …` as
 *     literal strings and `ConversationScreen.test.tsx` asserts `toContain('conn-dot--up')`; this token
 *     contains neither `conn-dot` nor — the direction that is easy to miss — `conversation__`, the
 *     existing `conversation__thinking` / `__queued` family's double-underscore prefix.
 *
 * Interpolating `status` into the class name is safe and is the shipped `conn-dot--${host.category}` idiom
 * (ChannelList.tsx:340): the union is closed, client-owned and never touches the wire. IDLE GETS AN
 * EXPLICIT `--idle` MODIFIER rather than the base alone, so a dropped modifier fails a test instead of
 * rendering as a correct-looking idle dot.
 *
 * `role="img"` is what makes the label land: on a bare <span> the accessible-name computation drops
 * `aria-label` and the dot ships nameless (ChannelList.tsx:320-322 records this for the host dots). Not
 * `role="status"` — that is a live region, and #801 renders one of these per row.
 *
 * Pure and total: a function of one prop, with no state, no effect, no async work and so no cancellation
 * path. The blink is compositor-owned, so a working conversation costs zero React renders.
 */
export function ConversationStatusDot({ status }: { status: ConversationStatus }): JSX.Element {
  return (
    <span
      className={`conversation-status-dot conversation-status-dot--${status}`}
      role="img"
      aria-label={STATUS_LABELS[status]}
    />
  )
}
