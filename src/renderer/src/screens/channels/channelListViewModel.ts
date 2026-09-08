// The pure view-model for the Channel List home screen (#141). Framework-free `.ts`, mirroring
// messageViewModel.ts, so every derivation unit-tests without React or the store. The wire
// `ConversationSummary` carries NO message text (types.ts) — only a `last_message_ts` timestamp — so
// each row's honest signal is a last-activity relative time, not the body-preview the Figma shows
// (deferred; needs a daemon + wire change first).
import type { ConversationSummary } from '@shared/wire/types'

/** AC3 fallback for a row with no usable name — never a blank row. */
export const UNNAMED_LABEL = 'Untitled'

/**
 * The row title. Returns `name` when it is present and non-blank; otherwise `UNNAMED_LABEL`. Guards
 * `null` (the wire's literal "unnamed scratch conversation") AND empty / whitespace-only strings, so
 * a daemon-supplied blank never renders as an empty row (AC3).
 */
export function titleFor(name: string | null): string {
  if (name !== null && name.trim() !== '') return name
  return UNNAMED_LABEL
}

/**
 * Split the store's rows into the two Figma sections by `is_promoted` (`true` = a saved Channel,
 * `false` = an ad-hoc Recent discussion). Two order-preserving filters — no sort: the daemon's array
 * order is authoritative (AC2), so within each section rows keep their store order.
 */
// Generic over the row since #1070, so a filter never ERASES a property the caller put on its rows: the
// sidebar hands in `ServerConversationSummary`s and needs the server stamp to survive to `groupByServer`.
// Both partitions are `filter` calls, which preserve the element type at runtime already — this only
// makes the signature say so. Every existing caller passes plain `ConversationSummary`s and infers
// `T = ConversationSummary`, so their types are byte-identical to before.
export function partitionByPromotion<T extends ConversationSummary>(
  rows: readonly T[]
): {
  channels: readonly T[]
  discussions: readonly T[]
} {
  return {
    channels: rows.filter((r) => r.is_promoted),
    discussions: rows.filter((r) => !r.is_promoted)
  }
}

/**
 * The active Channel List's row source: drop archived rows first, then split the survivors by
 * promotion via the shared primitive. The exact dual of `archiveViewModel.partitionArchived`
 * (which keeps `r.is_archived`) — the two symmetric callers of `partitionByPromotion`, which itself
 * stays the neutral shared split. Order-preserving (no sort). Fixes #469: `list_conversations`
 * returns archived rows tagged `is_archived` (pyrycode#880) and the active list never filtered them,
 * so archived conversations leaked into both the active list and the Archive screen.
 */
export function partitionActive<T extends ConversationSummary>(
  rows: readonly T[]
): {
  channels: readonly T[]
  discussions: readonly T[]
} {
  return partitionByPromotion(rows.filter((r) => !r.is_archived))
}

/**
 * AC3 fallback label for a row whose `cwd` yields no usable segment — the `UNNAMED_LABEL` idiom, a
 * client-owned constant standing in for unusable daemon text so no group renders blank.
 */
export const UNKNOWN_WORKSPACE_LABEL = 'Unknown workspace'

// The fallback group's grouping key. `''` is collision-proof BY CONSTRUCTION rather than by guessing an
// improbable string: a `cwd` of `''` has no usable segment, so any row that could collide with the
// sentinel is already in the fallback bucket.
//
// EXPORTED since #1178, which gave the sidebar its first consumer that must tell this group from a real
// one: the workspace row's plus sends the group's key as a create's `cwd`, and this key names no
// directory. It is emphatically NOT the `null` "take the daemon default" signal — `CreateConversationPayload`
// keeps those distinct on the wire — so the group draws no plus at all. Compared against the KEY and
// never against `UNKNOWN_WORKSPACE_LABEL`, for `workspaceLabelFor`'s stated both-directions reason: a
// real directory named `Unknown workspace` is an ordinary group and keeps its control.
export const UNKNOWN_WORKSPACE_KEY = ''

/** One workspace group: its exact `cwd` grouping key, its display label, and its rows in array order. */
export type WorkspaceGroup = {
  readonly key: string
  readonly label: string
  readonly rows: readonly ConversationSummary[]
}

/**
 * The last usable path segment of `cwd`, or `null` when there is none (AC2/AC3). Split on `/` and walk
 * the segments from the end, returning the first that is non-blank after trimming — one walk, which is
 * why a trailing separator, repeated separators and a whitespace-only tail all fall out of the same
 * rule rather than needing special cases.
 *
 * `cwd` is untrusted daemon text held as an opaque display string (types.ts, CLAUDE.md 2026-08-20), so
 * this is deliberately string work and nothing else: no `path`, no `fs`, no `node:*`, no `URL`. It is
 * also TOTAL over `string` — it never throws, because a thrown error would carry the offending `cwd`
 * into an error boundary, and `cwd` may never be logged or echoed. The returned segment is NOT trimmed:
 * the trim is only the usability predicate, and the client normalises nothing.
 *
 * `\` is deliberately not a separator. Treating it as one would assume the daemon's host OS — an
 * interpretation this client never makes — and would corrupt a legal Unix directory whose name contains
 * a backslash. A `\`-separated value therefore survives whole, as its own single segment.
 *
 * Returns `string | null` rather than folding the fallback in like `titleFor`, on purpose: the caller is
 * a grouper that must tell "no usable label" from "a label that happens to read like the fallback".
 * Deriving the grouping key by comparing against `UNKNOWN_WORKSPACE_LABEL` would fold a real directory
 * named `Unknown workspace` into the fallback bucket, which AC3 forbids in both directions.
 */
export function workspaceLabelFor(cwd: string): string | null {
  const segments = cwd.split('/')
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i]
    if (segment.trim() !== '') return segment
  }
  return null
}

/**
 * Group `rows` by workspace (#703), one group per distinct `cwd`. Two rows share a group only when their
 * `cwd` values are IDENTICAL strings — the key is the raw `cwd`, normalised in no way, so `/a/b` and
 * `/a/b/` honestly surface as two groups both labelled `b` rather than being silently merged (AC1).
 * Rows with no usable label all collapse into the single fallback group (AC3).
 *
 * Accumulates into a `Map`, never a plain object: object keys that look like integers enumerate FIRST in
 * numeric order regardless of insertion order, and `cwd` is arbitrary untrusted text, so a relative cwd
 * of `'2'` would jump ahead of every earlier group. `Map` preserves insertion order for all keys, which
 * is what makes AC4's "group order follows first appearance, no sort anywhere" hold — including for the
 * fallback group, which is ordered by first appearance like any other and is NOT pinned last.
 *
 * THE LABEL AND THE KEY HAVE DIFFERENT SOURCES SINCE #1287, AND KEEPING THEM APART IS LOAD-BEARING. The
 * label now prefers the daemon-held `workspace_label` (pyrycode#2208) over the folder name; the key is
 * still the raw `cwd` and NOTHING ELSE. That separation is not tidiness: this function has one output
 * that is display-only (`label`) and one that makes a round trip back OUT to the wire (`key`, which the
 * workspace row's plus sends as a create's `cwd` — see the `CollapsibleWorkspaceGroup` call site in
 * `ChannelList`). Keying on the label instead would send a daemon-asserted workspace NAME to the daemon
 * as a DIRECTORY PATH. A unit test asserts `key === row.cwd` for a labelled row — on the KEY, not on the
 * label — so a "the label is the nicer identity" refactor reddens rather than shipping.
 *
 * The label comes from the group's FIRST row. The daemon stores one label per exact `cwd` string, so
 * every row of a group agrees and reading the first is the cheapest way to say so; it also falls out of
 * the `Map` for free, since a group's label is written only when the group is created. TWO deliberate
 * non-preferences sit on top of it:
 *   - THE FALLBACK GROUP ignores its rows' labels entirely and always reads `UNKNOWN_WORKSPACE_LABEL`.
 *     It is a BUCKET, not a workspace — every row with an unusable `cwd` collapses into it whatever its
 *     origin — so naming it after one member would assert something false about the others.
 *   - A NON-NULL LABEL IS USED VERBATIM, blank included: no trim, no blank-to-fallback guard, the exact
 *     opposite of `titleFor`. A label is state a user set from some client, and rewriting a blank one
 *     locally would make this desktop disagree with every other client about what the workspace is
 *     called, silently and only on this machine. Refusing a blank belongs to the verbs that SET one
 *     (#1288 / #1289) and to the dialog that sends it (#1180), where it can be refused to the user's face.
 */
export function groupByWorkspace(
  rows: readonly ConversationSummary[]
): readonly WorkspaceGroup[] {
  const groups = new Map<string, { label: string; rows: ConversationSummary[] }>()
  for (const row of rows) {
    const segment = workspaceLabelFor(row.cwd)
    const key = segment === null ? UNKNOWN_WORKSPACE_KEY : row.cwd
    const existing = groups.get(key)
    if (existing !== undefined) {
      existing.rows.push(row)
      continue
    }
    const label = segment === null ? UNKNOWN_WORKSPACE_LABEL : (row.workspace_label ?? segment)
    groups.set(key, { label, rows: [row] })
  }
  return Array.from(groups, ([key, group]) => ({ key, label: group.label, rows: group.rows }))
}

/**
 * The minimum a row must carry to be filed under a server (#1070). A STRUCTURAL constraint, never an
 * import of `conversationListStore`'s `ServerConversationSummary`: this module's header promises it is
 * framework- and store-free so every derivation unit-tests without React or zustand, and importing that
 * type for a single field would drag the store into the view-model's import graph. The store's
 * `serverId: ConversationListOrigin` (`string | null | undefined`) satisfies this as written.
 */
type ServerStamped = { readonly serverId?: string | null }

/** One server's subtree source: which machine, and that machine's rows in array order. */
export type ServerGroup<T> = {
  readonly serverId: string
  readonly rows: readonly T[]
}

/**
 * Split `rows` by the server they came from (#1070), one group per entry of `serverIds` — the level that
 * sits ABOVE `groupByWorkspace`. It exists because that grouper's key is the raw `cwd` and a path is
 * unique only WITHIN one machine: two servers both holding `/home/user/project` would otherwise merge
 * into a single workspace group holding both machines' conversations, silently.
 *
 * THE JOIN DIRECTION IS THE SECURITY PROPERTY, and it is the reason this takes the ids as a parameter
 * rather than reading them. `serverIds` is the CLIENT's own paired-server list; a row's stamp is only
 * ever TESTED against it. So a stamp can select among existing keys and can never mint one, and the
 * worst a confused or hostile daemon reaches is its own rows under its own host row. This is the
 * read-side twin of the rule `selectConversationsFor`'s docblock states as a condition of its signature:
 * a wire-sourced lookup key would let one server's conversations appear under another server's name.
 *
 * A `Map`, NEVER a `Record<string, T[]>` — and this one is load-bearing rather than stylistic, which is
 * why it is written down. `ServerOrigin`'s docblock in `shared/ipc/events.ts` rules it for any consumer
 * indexing by an id, and here the failure is concrete: on a plain object a `__proto__` stamp resolves
 * `Object.prototype`, a truthy non-array whose `push` corrupts or throws. Client-set stamps make that
 * unreachable today, so the Map is the free second fabric — do not "simplify" it away.
 *
 * Group order is `serverIds` order, which is `pairedServerStore.list()` order — oldest-saved first, so
 * pairing order. Row order within a group is the array's; nothing sorts. A REPEATED id collapses to one
 * group, because two groups sharing an id would be two React siblings sharing a key: unreachable through
 * `decodeCollection` (a repeated `server` reads as a malformed collection), but refused here rather than
 * trusted to the caller.
 *
 * THE PARTITION IS TOTAL. A row whose stamp is not a `string` key of the map — `null` (bound while no
 * paired record was in hand), `undefined` (never bound), or a string naming no paired server — lands in
 * `unattributed` and is rendered by the caller with NO host row above it. Three outcomes were available
 * and two are wrong: dropping the row hides a real conversation, and filing it under the first paired
 * server would put it under a machine's name on no evidence — the same lie the join direction above
 * exists to prevent, arrived at by omission instead of by a hostile stamp. Naming no machine is exactly
 * what is known about such a row. #1068 stamps every daemon event main-side so none of the three is
 * reachable in production; the type admits them and a server-keyed tree has to answer.
 *
 * No `console.*`, here or on any path this feeds. The tempting log is one for an unattributed row, and
 * every useful form of it carries the row — its `cwd`, its name or its stamp — which ADR 0007's
 * content-free rule and CLAUDE.md both forbid.
 */
export function groupByServer<T extends ServerStamped>(
  serverIds: readonly string[],
  rows: readonly T[]
): { readonly servers: readonly ServerGroup<T>[]; readonly unattributed: readonly T[] } {
  const buckets = new Map<string, T[]>()
  for (const serverId of serverIds) {
    if (!buckets.has(serverId)) buckets.set(serverId, [])
  }
  const unattributed: T[] = []
  for (const row of rows) {
    const bucket = typeof row.serverId === 'string' ? buckets.get(row.serverId) : undefined
    if (bucket === undefined) {
      unattributed.push(row)
      continue
    }
    bucket.push(row)
  }
  return {
    servers: Array.from(buckets, ([serverId, serverRows]) => ({ serverId, rows: serverRows })),
    unattributed
  }
}

const MS_MINUTE = 60_000
const MS_HOUR = 3_600_000
const MS_DAY = 86_400_000
const MS_WEEK = 604_800_000

// UTC month lookup for the older-than-a-week short date, so the rendering is timezone-independent
// (a locale/TZ-dependent Date#toLocaleDateString would make the test flaky across runners).
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
] as const

/**
 * Relative last-activity time from an RFC3339 `iso`, measured against an injected `now` (ms) so the
 * function stays pure and deterministic under test (never `Date.now()` inside). Untrusted daemon
 * input degrades silently: a non-parseable timestamp yields `''` (the row then renders its title with
 * no time), and a future timestamp (clock skew) clamps to `'just now'` rather than a negative delta.
 * Buckets match the Figma exemplars ("2m ago", "3h ago", "Yesterday", "2 days ago").
 */
export function formatLastActivity(iso: string, now: number): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  const delta = now - ms
  if (delta < MS_MINUTE) return 'just now'
  if (delta < MS_HOUR) return `${Math.floor(delta / MS_MINUTE)}m ago`
  if (delta < MS_DAY) return `${Math.floor(delta / MS_HOUR)}h ago`
  if (delta < 2 * MS_DAY) return 'Yesterday'
  if (delta < MS_WEEK) return `${Math.floor(delta / MS_DAY)} days ago`
  const d = new Date(ms)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}
