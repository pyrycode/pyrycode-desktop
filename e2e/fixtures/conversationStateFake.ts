import { encodeEnvelope, decodeEnvelope } from '../../src/main/transport/codec'
import type {
  ConversationSummary,
  ConversationsPayload,
  ConversationCreatedPayload,
  ConversationUpdatedPayload,
  ConversationDeletedPayload,
  CreateConversationPayload,
  RenameConversationPayload,
  ArchiveConversationPayload,
  UnarchiveConversationPayload,
  DeleteConversationPayload,
  PromoteConversationPayload,
  ChangeWorkspacePayload,
  RecentWorkspace,
  RecentWorkspacesPayload
} from '../../src/shared/wire/types'

// The stateful `conversationStateFake` reply factory (#434) — TEST-ONLY e2e infrastructure. The fake
// daemon (src/main/transport/fakeDaemon.ts) is reply-driven and STATELESS: a run passes `buildReplyFrames`
// (an ordered Uint8Array[], each sealed as its own noise_msg), which takes precedence over `buildReply`.
// Per-flow UI e2e specs (the #422–#429 family) need a fake that HOLDS a conversation list and mutates it,
// instead of each re-transcribing the wire semantics. This factory produces exactly that `buildReplyFrames`:
// a stateful closure over a seeded list that answers `list_conversations` from current state and applies
// each list mutation with the correct reply and the broadcast-then-relist / correlated-delete semantics.
//
// It rides `launchPairedApp` (#433): a spec passes the produced function straight through as
// `launchPairedApp({ buildReplyFrames })`, which forwards it (Omit<FakeDaemonOptions,'url'>) to
// startFakeDaemon. Because a scripted `buildReplyFrames` OVERRIDES the fixture's default one-row seed, this
// factory OWNS answering every inbound — including the auto-fired `list_conversations` — from state; the
// default seed is a single PROMOTED, NAMED row so a zero-config fake both launches (the non-empty-seed
// constraint: launchPairedApp's row click needs a clickable row) and renders the rename pencil.
//
// Three reflect paths (matching src/shared/wire/types.ts + conversationListBridge.shouldRefreshList):
//   - rename / archive / unarchive / promote / change_workspace → an unsolicited `conversation_updated`
//     broadcast; the app auto re-requests `list_conversations`, which this fake answers from UPDATED state.
//   - delete_conversation → a CORRELATED `conversation_deleted { id }` echoing the request id as
//     `in_reply_to` (no broadcast); the app also auto re-lists.
//   - create_conversation → a CORRELATED `conversation_created { record }` (no broadcast), consumed by BOTH
//     the create→nav bridge and — since #515 — shouldRefreshList; the app auto re-lists, which this fake
//     answers from state that has ALREADY appended the minted row (`list.push` below), so the new row lands
//     at create time rather than waiting for the next unrelated mutation.
//
// It imports the production `codec` + wire types by RELATIVE path (`../../src/...`) exactly like
// launchPairedApp.ts — the `@shared` alias is not available to e2e, and e2e is not part of any tsconfig.
// LOG-FREE by construction (the fakeDaemon convention): no console.*, no id/payload bytes in any diagnostic.

// Fixed, deterministic reply envelope framing — the fakeDaemon HELLO_ACK_ID/TS convention (no Date.now(),
// no randomness). The app inspects neither the reply envelope `id` nor `ts` (it does not dedupe
// `conversations` replies by id), except `conversation_deleted`'s `in_reply_to`, which echoes the request id.
const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

// The daemon-default cwd a `create_conversation` with a null cwd resolves to (the fake stands in for the
// server default). A fixed literal keeps minted rows deterministic.
const DEFAULT_CREATED_CWD = '/fake/workspace'

/** A single PROMOTED, NAMED default seed: promoted so partitionByPromotion renders the rename pencil,
 *  named so an old-title assertion is crisp, non-empty so launchPairedApp's row click has a target. */
const DEFAULT_SEED: ConversationSummary = {
  id: 'seed-conversation',
  name: 'Seeded channel',
  is_promoted: true,
  is_archived: false,
  cwd: '/fake/workspace',
  last_message_ts: FIXED_TS,
  last_used_at: FIXED_TS,
  workspace_label: null,
}

export interface ConversationStateFakeOptions {
  /** Initial held list, in wire order. Default: a single promoted, named row (DEFAULT_SEED). */
  conversations?: ConversationSummary[]
  /** Seeded recent-workspaces list answered on a `recent_workspaces` request (#456). Default `[]` — a
   *  valid loaded-empty reply. READ-ONLY (recent_workspaces has no mutation verb), so it is captured as a
   *  plain const, unlike the mutable `list`. Reused by the split sibling #457, which is why it lives here
   *  in the shared fixture rather than spec-local. */
  recentWorkspaces?: RecentWorkspace[]
}

/**
 * Build a stateful `buildReplyFrames`: a closure over a seeded conversation list that answers
 * `list_conversations` from current state and applies each of the seven list-mutation verbs to that
 * state. Returns the bare `FakeDaemonOptions.buildReplyFrames` shape (a spec composes it into
 * launchPairedApp's options itself).
 *
 * Input is TRUSTED — it is the app-under-test's own well-formed outbound envelopes — so each verb reads
 * its payload with a per-verb cast to the known outbound type (NOT the fail-closed narrowing of the
 * production inbound decoder; this is a fake, kept lean like send-and-stream). A row-not-found mutation
 * is a defensive no-op (return []) — the demonstrating spec and the #422–#429 family always target a
 * seeded row, so this defends an unobserved path without modelling daemon rejections (out of scope).
 */
export function conversationStateFake(
  options: ConversationStateFakeOptions = {}
): (inboundPlaintext: Uint8Array) => Uint8Array[] {
  // One mutable source of state, held per factory call. Copy each seed row so a caller's SEED literal is
  // never mutated across runs. Order is preserved (append on create, in-place edit otherwise), so
  // `list_conversations` reflects wire order.
  const list: ConversationSummary[] = (options.conversations ?? [DEFAULT_SEED]).map((row) => ({
    ...row
  }))
  // ONE LABEL PER `cwd`, exactly as the daemon holds it (#1287): the label is stored against the exact
  // `cwd` string, so a row minted or MOVED into a workspace takes that workspace's name rather than
  // inventing one. Derived from the seeded rows rather than taken as an option, so a spec cannot seed a
  // state the daemon cannot produce (two rows of one `cwd` disagreeing).
  //
  // WITHOUT THIS THE TWO-TREES SETUP LIES. `workspace-collapse.spec.ts`'s idiom mints its second tree
  // with the FAB, and the minted row's `cwd` is DEFAULT_CREATED_CWD — the SAME `/fake/workspace` the
  // seed uses. A fake minting `null` there would render the daemon label in the Channels tree and the
  // folder name in the Chats tree, reddening a spec against correct production code.
  //
  // A `Map`, not a `Record`: the keys are `cwd` strings, and a plain object resolves a `__proto__` key to
  // `Object.prototype` (the `groupByServer` rule). Fixture-authored keys make that unreachable here; the
  // `Map` is the free second fabric.
  const labels = new Map<string, string | null>()
  for (const row of list) {
    if (!labels.has(row.cwd)) labels.set(row.cwd, row.workspace_label)
  }
  const labelFor = (cwd: string): string | null => labels.get(cwd) ?? null
  // The seeded recent-workspaces answer — read-only (no mutation verb touches it), so a plain const, not
  // the mutable `list`. Default `[]` = a valid loaded-empty `recent_workspaces_list` reply (#456).
  const recents: RecentWorkspace[] = options.recentWorkspaces ?? []
  // Monotonic id source for minted rows — deterministic, no clock/random.
  let nextCreatedId = 1

  return (inbound: Uint8Array): Uint8Array[] => {
    // Trusted input: decodeEnvelope throwing would be a genuine bug in the app-under-test, not a case to
    // swallow — let it surface (the production decoder fails closed; a fake does not re-do that job).
    const env = decodeEnvelope(inbound)
    switch (env.type) {
      case 'list_conversations':
        return [conversationsFrame(list)]

      case 'create_conversation': {
        const payload = env.payload as CreateConversationPayload
        const row: ConversationSummary = {
          id: `created-${nextCreatedId++}`,
          name: payload.name,
          is_promoted: payload.is_promoted ?? false,
          is_archived: false,
          cwd: payload.cwd ?? DEFAULT_CREATED_CWD,
          last_message_ts: FIXED_TS,
          last_used_at: FIXED_TS,
          workspace_label: labelFor(payload.cwd ?? DEFAULT_CREATED_CWD)
        }
        list.push(row)
        return [conversationCreatedFrame(row)]
      }

      case 'rename_conversation': {
        const payload = env.payload as RenameConversationPayload
        const row = findRow(list, payload.conversation_id)
        if (row === undefined) return []
        row.name = payload.name
        return [conversationUpdatedFrame(row)]
      }

      case 'archive_conversation': {
        const payload = env.payload as ArchiveConversationPayload
        const row = findRow(list, payload.conversation_id)
        if (row === undefined) return []
        row.is_archived = true
        return [conversationUpdatedFrame(row)]
      }

      case 'unarchive_conversation': {
        const payload = env.payload as UnarchiveConversationPayload
        const row = findRow(list, payload.conversation_id)
        if (row === undefined) return []
        row.is_archived = false
        return [conversationUpdatedFrame(row)]
      }

      case 'promote_conversation': {
        const payload = env.payload as PromoteConversationPayload
        const row = findRow(list, payload.conversation_id)
        if (row === undefined) return []
        row.is_promoted = true
        row.name = payload.name
        row.cwd = payload.cwd
        // A promote can carry a DIFFERENT cwd, which moves the row between workspace groups — so its
        // label is re-resolved from the new workspace rather than carried over from the old one.
        row.workspace_label = labelFor(payload.cwd)
        return [conversationUpdatedFrame(row)]
      }

      case 'change_workspace': {
        const payload = env.payload as ChangeWorkspacePayload
        const row = findRow(list, payload.conversation_id)
        if (row === undefined) return []
        row.cwd = payload.cwd
        row.workspace_label = labelFor(payload.cwd)
        return [conversationUpdatedFrame(row)]
      }

      case 'recent_workspaces':
        // Read-only: answer the seeded list verbatim (broadcast-shaped, no in_reply_to). The app consumes
        // it via the correlation-free `recentWorkspacesReceived` event and the decoder requires no
        // correlation. A fresh one-shot per picker open re-hits this arm; the answer is stable (#456).
        return [recentWorkspacesListFrame(recents)]

      case 'delete_conversation': {
        const payload = env.payload as DeleteConversationPayload
        const index = list.findIndex((row) => row.id === payload.conversation_id)
        if (index === -1) return []
        list.splice(index, 1)
        // Reply field is `id`, correlated to the requester by `in_reply_to` (the request env.id) — no broadcast.
        return [conversationDeletedFrame(payload.conversation_id, env.id)]
      }

      default:
        // A genuinely-other verb (e.g. a snapshot request on thread entry) needs no reply for these flows;
        // returning [] sends nothing, which the fake daemon settles ok.
        return []
    }
  }
}

/** Find the held row by its conversation id, or undefined if the id is absent (a defensive no-op case). */
function findRow(
  list: ConversationSummary[],
  conversationId: string
): ConversationSummary | undefined {
  return list.find((row) => row.id === conversationId)
}

/** `conversations` reply — the full held list in wire order (ConversationsPayload). */
function conversationsFrame(list: ConversationSummary[]): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'conversations',
    ts: FIXED_TS,
    payload: { conversations: list } satisfies ConversationsPayload
  })
}

/** `recent_workspaces_list` reply — the seeded rows in wire order (RecentWorkspacesPayload). BROADCAST-
 *  shaped: no `in_reply_to` (like `conversation_updated`), since the app consumes it via the
 *  correlation-free `recentWorkspacesReceived` event and the production decoder needs no correlation (#380). */
function recentWorkspacesListFrame(workspaces: RecentWorkspace[]): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'recent_workspaces_list',
    ts: FIXED_TS,
    payload: { workspaces } satisfies RecentWorkspacesPayload
  })
}

/** `conversation_updated` BROADCAST — the 6-field ConversationUpdatedPayload (`name` before `cwd`,
 *  deliberately WITHOUT is_archived / last_message_ts; the held row keeps those for the follow-up list).
 *  No `in_reply_to` — it is a broadcast. */
function conversationUpdatedFrame(row: ConversationSummary): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'conversation_updated',
    ts: FIXED_TS,
    payload: {
      id: row.id,
      is_promoted: row.is_promoted,
      name: row.name,
      cwd: row.cwd,
      last_used_at: row.last_used_at,
      workspace_label: row.workspace_label
    } satisfies ConversationUpdatedPayload
  })
}

/** `conversation_deleted` CORRELATED reply — the bare `{ id }` (ConversationDeletedPayload), the request
 *  id echoed as `in_reply_to`. */
function conversationDeletedFrame(id: string, inReplyTo: number): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'conversation_deleted',
    ts: FIXED_TS,
    in_reply_to: inReplyTo,
    payload: { id } satisfies ConversationDeletedPayload
  })
}

/** `conversation_created` reply — the 6-field ConversationCreatedPayload (`cwd` before `name`, the
 *  intentional reorder vs. conversation_updated). */
function conversationCreatedFrame(row: ConversationSummary): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'conversation_created',
    ts: FIXED_TS,
    payload: {
      id: row.id,
      is_promoted: row.is_promoted,
      cwd: row.cwd,
      name: row.name,
      last_used_at: row.last_used_at,
      workspace_label: row.workspace_label
    } satisfies ConversationCreatedPayload
  })
}
