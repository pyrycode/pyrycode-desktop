import type { QueuedItem } from '@shared/wire/types'
import type { ThreadItem } from '../../store/threadTimeline'

// #1214: the render-time fold that makes a message sent mid-turn draw ONCE.
//
// Two independent writers used to draw it. `submitMessage` dispatches an optimistic `userText` echo for
// every send and cannot know whether the daemon ran the message or parked it; the daemon parks it, emits
// a `queue_state` snapshot, and the shipped `.conversation__queued` region drew a second, near-identical
// row below the thread. This function joins them on the correlation key #1213 established
// (`QueuedItem.message_id` ↔ the echo's `messageId`, pyrycode#2092) and yields one row list.
//
// THE FOLD IS RENDER-TIME, AND THAT IS AN ARCHITECTURAL LINE RATHER THAN A PREFERENCE.
// `docs/knowledge/features/queue-store.md` § What it does states that `queue_state` is daemon STATE
// (SSOT pyrycode#720), not part of claude's turn stream, "so it never folds into `reduceTimeline` and gets
// its own store instead". That stands: `queueStore` keeps holding the wire `QueuedItem[]` verbatim as
// replacement truth and no queued item is ever written through the timeline reducer. What changed is only
// that the VIEW reads both. It is also what makes a replacement snapshot free — this function re-derives
// every row from scratch on each render, so there is no reconciliation state to hold and nothing to
// orphan when a snapshot (including the empty one a reconnect clears to) replaces the backlog.
//
// Pure, with no store, no clock, no React and no import from `src/main/`, so both the queued and the
// delivered form stay provable from markup under `renderToStaticMarkup` — this repo's renderer tests are
// static server renders and nothing in it can click.

/** The drop affordance's two values for one queued row — exactly what `dropQueuedMessage` takes, and
 *  never `text` or `ts`. Minted here rather than handing the row its whole `QueuedItem`, which resolves
 *  #1213 § Open questions 1 in the stronger direction: the row cannot leak a field back down and up
 *  because it never holds one. `messageId` is `string | undefined` because a pre-pyrycode#2092 daemon
 *  sends none; the container already treats that as "correlates with nothing". */
export interface QueuedRowHandle {
  queuedMsgId: number
  messageId: string | undefined
}

/** One row of the merged thread. `queued` is non-null exactly while the daemon's last snapshot reported
 *  this row's message queued — the whole "not yet run" signal, carried as data so the render fork is a
 *  pure function of it. */
export interface FoldedRow {
  item: ThreadItem
  queued: QueuedRowHandle | null
}

/**
 * Join the timeline against the daemon's backlog into one row list.
 *
 * Contract, in the order it matters:
 *
 * 1. EVERY TIMELINE ITEM APPEARS EXACTLY ONCE, AT ITS OWN INDEX, IN ORDER. This function never reorders,
 *    drops or duplicates a timeline row, which is what makes "one row per message, in the order it was
 *    sent" and "when the message runs, its row stays where it is" structural rather than conventional.
 *    It is also what keeps `Timeline`'s array-index keys sound for item rows: the append-only,
 *    tail-mutating, never-inserting property the reducer guarantees survives the fold untouched.
 * 2. A BACKLOG ITEM CORRELATES TO AT MOST ONE ECHO, AND AN ECHO TO AT MOST ONE BACKLOG ITEM — a greedy
 *    one-to-one assignment walking the backlog in snapshot order against an index built once from
 *    `items`, consuming each echo as it is claimed. Two identical texts with distinct ids therefore claim
 *    two distinct rows; the pathological same-id-twice snapshot claims first-come and leaves the second
 *    unmatched rather than double-marking one row.
 * 3. ONLY `kind === 'userText'` ITEMS ARE CANDIDATES. Enforced by the type system rather than by a filter
 *    — `messageId` lives on the `userText` arm of `ThreadItem` alone — but load-bearing enough to state:
 *    it is the guard that keeps a hostile `queue_state` from putting the operator's own queued treatment,
 *    and its drop control, onto daemon-authored content (assistant text, a tool row, an unrecognized-output
 *    row). See the plan's § Security review 4.
 * 4. ONLY A NON-EMPTY `message_id` ON BOTH SIDES PARTICIPATES. `undefined` and `''` correlate with
 *    nothing, matching the field's contract. This is the FIRST guard in this path, not a redundant second
 *    one: #1213 put its empty-id rule at `dropQueuedMessage`, which this consumer does not go through.
 * 5. A BACKLOG ITEM THAT CLAIMS NO ECHO BECOMES ITS OWN ROW AT THE TAIL, in snapshot order, after every
 *    timeline row. That is a first-class state, not an error — `queue_state` reaches every interactive
 *    connection, so this window sees ids it never minted (a message queued from mobile, or a reconnect
 *    into a backlog it has no echo for). What such a row must never do is attach itself to somebody
 *    else's message, which rule 2 forbids.
 *
 * `message_id` is compared for strict string equality only. It is never a rendered value, an attribute,
 * a lookup path or a React key — the field's contract from #1213 § Security review 1, inherited here.
 *
 * O(items + queued): one pass to index, one to assign. Both lists are small today; the shape is chosen so
 * a long thread does not pay per queued item.
 */
export function foldQueuedRows(
  items: readonly ThreadItem[],
  queued: readonly QueuedItem[]
): readonly FoldedRow[] {
  // messageId -> the indices of the echoes carrying it, in timeline order. Built only from non-empty ids,
  // so rules 3 and 4 are satisfied by what goes IN rather than by a check at every lookup. A list per key
  // rather than a single index because two echoes CAN share an id (nothing forbids it upstream), and
  // shifting off the front is what makes the assignment first-come and one-to-one.
  const echoesById = new Map<string, number[]>()
  items.forEach((item, index) => {
    if (item.kind !== 'userText') return
    const id = item.messageId
    if (id === undefined || id === '') return
    const held = echoesById.get(id)
    if (held === undefined) echoesById.set(id, [index])
    else held.push(index)
  })

  const handleByIndex = new Map<number, QueuedRowHandle>()
  const unmatched: QueuedItem[] = []
  for (const entry of queued) {
    const handle: QueuedRowHandle = {
      queuedMsgId: entry.queued_msg_id,
      messageId: entry.message_id
    }
    const id = entry.message_id
    const candidates = id === undefined || id === '' ? undefined : echoesById.get(id)
    const claimed = candidates?.shift()
    if (claimed === undefined) unmatched.push(entry)
    else handleByIndex.set(claimed, handle)
  }

  const rows: FoldedRow[] = items.map((item, index) => ({
    item,
    queued: handleByIndex.get(index) ?? null
  }))
  for (const entry of unmatched) {
    // SYNTHESIZED, NOT A SEVENTH ThreadItem KIND. `ThreadItem` is the reducer's vocabulary, and a `queued`
    // kind there would invite the next ticket to reduce one — which the store's own architectural line
    // forbids. This value never touches a store; it exists for the length of one render. It carries `text`
    // and nothing else: no `createdAt` (the wire `ts` has never reached the renderer and this ticket does
    // not start), no `attachments`, and NO `messageId` — an id this window did not mint must never look
    // like one it did, or a later consumer would treat somebody else's message as this window's own.
    rows.push({
      item: { kind: 'userText', text: entry.text },
      queued: { queuedMsgId: entry.queued_msg_id, messageId: entry.message_id }
    })
  }
  return rows
}
