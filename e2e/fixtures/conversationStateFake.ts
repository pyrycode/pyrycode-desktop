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
  RecentWorkspacesPayload,
  WorkspaceUpdatedPayload,
  RenameWorkspacePayload,
  ErrorPayload,
  MCPStatusPayload,
  MCPStatusRequestPayload,
  MCPReconnectPayload,
  MCPTogglePayload
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
//   - rename_workspace → a CORRELATED `workspace_updated` echoing the request id (#1289), the same frame
//     the `renameWorkspace` seam pushes UNSOLICITED. Correlation is the only difference and it changes
//     nothing the app does (the decode is unconditional, the refresh trigger correlation-blind), but it
//     is what the daemon actually sends a requester — a fake answering its own request with a broadcast
//     would be a state the daemon cannot produce. The app auto re-lists.
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

/**
 * The fake's `buildReplyFrames`, plus the one seam a spec needs to change daemon-held state MID-TEST
 * (#1288). Everything else the fake models is driven by the app's own outbound verbs; a workspace rename
 * is not, because the frame that reports one arrives whether or not this client asked for anything (the
 * outbound `rename_workspace` verb is #1289 and this fake does not model it).
 *
 * A CALLABLE WITH A PROPERTY rather than an object of two members, and that shape is deliberate. 29 spec
 * files pass this straight through as `launchPairedApp({ buildReplyFrames })`; a function carrying an
 * extra property is still assignable to the bare `(inbound) => Uint8Array[]` that option takes, so the
 * seam costs ZERO call-site edits, where returning `{ buildReplyFrames, renameWorkspace }` would touch
 * all 29.
 */
export interface ConversationStateFake {
  (inboundPlaintext: Uint8Array): Uint8Array[]
  /**
   * Rename one workspace the way the daemon does: update the label held for `cwd` AND every held row in
   * it, then return the unsolicited `workspace_updated` broadcast frame for the spec to push through
   * `daemon.pushFrame`.
   *
   * ONE CALL DOES BOTH HALVES, on purpose. The state change is what the follow-up `list_conversations`
   * answers with — and that reply, not this frame, is what the sidebar actually renders — while the frame
   * is what triggers that re-list. Split into two calls a spec could push a frame announcing a label the
   * fake does not hold, which is a state the daemon cannot produce and which would prove nothing.
   */
  renameWorkspace(cwd: string, label: string | null): Uint8Array
  /**
   * Set (or with `null`, remove) how the fake answers the next `mcp_status_request` naming
   * `conversationId` (#1579). The answer holds until changed, so every open meets the same one.
   */
  setMcpStatusAnswer(conversationId: string, answer: McpStatusAnswer | null): void
  /** The conversation ids every `mcp_status_request` named, in arrival order. A fresh copy. */
  mcpStatusRequests(): readonly string[]
  /**
   * Set (or with `null`, remove) how the fake answers the next `mcp_reconnect` naming `conversationId`
   * (#1583). The answer holds until changed.
   */
  setMcpReconnectAnswer(conversationId: string, answer: McpReconnectAnswer | null): void
  /** Every `mcp_reconnect` payload received, in arrival order. A fresh copy. */
  mcpReconnectRequests(): readonly MCPReconnectPayload[]
  /** Set (or with `null`, remove) how the fake answers the next `mcp_toggle` naming `conversationId`
   *  (#1587). The answer holds until changed. */
  setMcpToggleAnswer(conversationId: string, answer: McpReconnectAnswer | null): void
  /** Every `mcp_toggle` payload received, in arrival order. A fresh copy. */
  mcpToggleRequests(): readonly MCPTogglePayload[]
}

/**
 * The fake's answer to `mcp_reconnect` (#1583): an accepted reconnect's fresh `mcp_status`, correlated by
 * `in_reply_to` like the daemon's, or `'refused'` for the daemon's one merged `mcp_actuation.refused`.
 */
export type McpReconnectAnswer = MCPStatusPayload | 'refused'

/**
 * The fake's answer to `mcp_status_request` (#1579): a report, correlated like the daemon's
 * requester-only reply, or a correlated refusal. `'unavailable'` is `mcp_status.unavailable`, and
 * `'unclassified'` stands for any other code (`conversation.not_found`), which the client does not show.
 */
export type McpStatusAnswer = MCPStatusPayload | 'unavailable' | 'unclassified'

export interface ConversationStateFakeOptions {
  /** Initial held list, in wire order. Default: a single promoted, named row (DEFAULT_SEED). */
  conversations?: ConversationSummary[]
  /**
   * How the fake answers a `create_conversation` (#1308). Default `'created'` — the shipped behaviour,
   * a correlated `conversation_created` minting a row. `'rejected'` answers with a daemon `error` frame
   * echoing the request's envelope id as `in_reply_to` and mints NOTHING, which is what the daemon does
   * when the requested folder escapes its home or does not exist.
   *
   * THE FIRST DAEMON REFUSAL THIS FAKE MODELS AT ALL, and deliberately the narrowest possible one: a
   * whole-fake switch rather than a per-path predicate. A predicate would have to decide WHICH paths the
   * daemon accepts, which is exactly the server-side policy this client is not allowed to reimplement —
   * and one spec proving "a refused create is reported" needs no such policy. Every other verb in the
   * switch keeps its "modelling daemon rejections is out of scope" posture.
   */
  createOutcome?: 'created' | 'rejected'
  /** Seeded recent-workspaces list answered on a `recent_workspaces` request (#456). Default `[]` — a
   *  valid loaded-empty reply. READ-ONLY (recent_workspaces has no mutation verb), so it is captured as a
   *  plain const, unlike the mutable `list`. Reused by the split sibling #457, which is why it lives here
   *  in the shared fixture rather than spec-local. */
  recentWorkspaces?: RecentWorkspace[]
  /**
   * Answers to `mcp_status_request`, by conversation id (#1579). A conversation with no answer gets
   * SILENCE, which is what keeps specs that push unsolicited reports (channel-mcp-servers.spec.ts) from
   * having them overwritten by an answer they never asked for. Change it mid-test with
   * `setMcpStatusAnswer`.
   */
  mcpStatusAnswers?: Record<string, McpStatusAnswer>
  /** Answers to `mcp_reconnect`, by conversation id (#1583). No answer is SILENCE, the daemon that never
   *  replies. Change it mid-test with `setMcpReconnectAnswer`. */
  mcpReconnectAnswers?: Record<string, McpReconnectAnswer>
  /** Answers to `mcp_toggle`, by conversation id (#1587), shaped like a reconnect's: the daemon answers an
   *  accepted toggle with a fresh report and refuses with the same merged code. No answer is SILENCE. */
  mcpToggleAnswers?: Record<string, McpReconnectAnswer>
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
): ConversationStateFake {
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
  // `Object.prototype` (the `groupByServer` rule). The `Map` alone is what makes that inert — it has no
  // prototype chain to walk — and it has to be, because since #1289 the keys are NOT all fixture-authored:
  // the `rename_workspace` arm below keys this map on a `path` the app under test supplied.
  const labels = new Map<string, string | null>()
  for (const row of list) {
    if (!labels.has(row.cwd)) labels.set(row.cwd, row.workspace_label)
  }
  const labelFor = (cwd: string): string | null => labels.get(cwd) ?? null
  // The seeded recent-workspaces answer — read-only (no mutation verb touches it), so a plain const, not
  // the mutable `list`. Default `[]` = a valid loaded-empty `recent_workspaces_list` reply (#456).
  const recents: RecentWorkspace[] = options.recentWorkspaces ?? []
  // Read-only for the fake's life, like `recents`: a spec picks the outcome when it builds the fake, and
  // no verb changes it mid-run.
  const createOutcome = options.createOutcome ?? 'created'
  // Monotonic id source for minted rows — deterministic, no clock/random.
  let nextCreatedId = 1
  // A `Map` for the same reason as `labels`: the keys are conversation ids the app under test supplied.
  const mcpStatusAnswers = new Map<string, McpStatusAnswer>(Object.entries(options.mcpStatusAnswers ?? {}))
  const mcpStatusRequests: string[] = []
  const mcpReconnectAnswers = new Map<string, McpReconnectAnswer>(Object.entries(options.mcpReconnectAnswers ?? {}))
  const mcpReconnectRequests: MCPReconnectPayload[] = []
  const mcpToggleAnswers = new Map<string, McpReconnectAnswer>(Object.entries(options.mcpToggleAnswers ?? {}))
  const mcpToggleRequests: MCPTogglePayload[] = []

  // The workspace-rename mutation, written once and reached two ways: the `rename_workspace` arm below
  // calls it with the request's envelope id (the daemon's CORRELATED answer to a client that asked,
  // #1289), and the exposed seam calls it without one (the UNSOLICITED broadcast a client that asked for
  // nothing receives, #1288). One implementation, so the two paths cannot drift in what they mutate.
  const renameWorkspace = (cwd: string, label: string | null, inReplyTo?: number): Uint8Array => {
    // BOTH the per-cwd map and every held row move. The map is what a row minted or moved INTO this
    // workspace later reads; the rows are what `list_conversations` answers with, and that reply is
    // what the sidebar renders — so updating only one of the two would leave a drive asserting
    // against a fake the daemon could not produce.
    labels.set(cwd, label)
    for (const row of list) {
      if (row.cwd === cwd) row.workspace_label = label
    }
    return workspaceUpdatedFrame(cwd, label, inReplyTo)
  }

  const buildReplyFrames = (inbound: Uint8Array): Uint8Array[] => {
    // Trusted input: decodeEnvelope throwing would be a genuine bug in the app-under-test, not a case to
    // swallow — let it surface (the production decoder fails closed; a fake does not re-do that job).
    const env = decodeEnvelope(inbound)
    switch (env.type) {
      case 'list_conversations':
        return [conversationsFrame(list)]

      case 'create_conversation': {
        // The refusal arm (#1308), ahead of the mint: nothing is pushed to `list`, so a spec asserting
        // "no row appeared" is asserting about a fake that genuinely created none. The reply correlates by
        // `in_reply_to`, which is what main's `pendingCreateConversations` matches on to emit the bare
        // `conversationCreateRejected` — the message below never reaches the window and is here only
        // because the wire type requires one.
        if (createOutcome === 'rejected') return [errorFrame(env.id)]
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

      case 'rename_workspace': {
        const payload = env.payload as RenameWorkspacePayload
        // REUSES the mid-test seam rather than restating its mutation: one call moves both the per-cwd
        // label map and every held row, so the follow-up re-list cannot answer with a label the daemon
        // never held. What this arm adds is the CORRELATION — the daemon answers the client that asked
        // by echoing the request's envelope id as `in_reply_to`, which the unsolicited push has no id
        // to echo. Unlike its neighbours there is no row lookup and so no not-found no-op: a rename
        // names a WORKSPACE, and a path matching no held row simply moves no row (the daemon would
        // answer `workspace.not_found`; modelling daemon rejections is out of scope here, as it is for
        // every other verb in this switch).
        return [renameWorkspace(payload.path, payload.label, env.id)]
      }

      case 'mcp_status_request': {
        const payload = env.payload as MCPStatusRequestPayload
        mcpStatusRequests.push(payload.conversation_id)
        const answer = mcpStatusAnswers.get(payload.conversation_id)
        if (answer === undefined) return []
        if (answer === 'unavailable') return [mcpStatusErrorFrame('mcp_status.unavailable', true, env.id)]
        if (answer === 'unclassified') return [mcpStatusErrorFrame('conversation.not_found', false, env.id)]
        return [mcpStatusFrame(answer, env.id)]
      }

      case 'mcp_reconnect': {
        const payload = env.payload as MCPReconnectPayload
        mcpReconnectRequests.push({ conversation_id: payload.conversation_id, server_name: payload.server_name })
        const answer = mcpReconnectAnswers.get(payload.conversation_id)
        if (answer === undefined) return []
        if (answer === 'refused') return [mcpStatusErrorFrame('mcp_actuation.refused', false, env.id)]
        return [mcpStatusFrame(answer, env.id)]
      }

      case 'mcp_toggle': {
        const payload = env.payload as MCPTogglePayload
        mcpToggleRequests.push({ conversation_id: payload.conversation_id, server_name: payload.server_name, enabled: payload.enabled })
        const answer = mcpToggleAnswers.get(payload.conversation_id)
        if (answer === undefined) return []
        if (answer === 'refused') return [mcpStatusErrorFrame('mcp_actuation.refused', false, env.id)]
        return [mcpStatusFrame(answer, env.id)]
      }

      default:
        // A genuinely-other verb (e.g. a snapshot request on thread entry) needs no reply for these flows;
        // returning [] sends nothing, which the fake daemon settles ok.
        return []
    }
  }

  // The mid-test seam (#1288). Attached to the callable rather than returned beside it — see
  // ConversationStateFake for why that keeps 29 spec files untouched.
  return Object.assign(buildReplyFrames, {
    // Deliberately drops the third argument: the seam models the UNSOLICITED push a client that asked
    // for nothing receives, so the frame it hands back carries no `in_reply_to` to echo.
    renameWorkspace: (cwd: string, label: string | null): Uint8Array => renameWorkspace(cwd, label),
    setMcpStatusAnswer: (conversationId: string, answer: McpStatusAnswer | null): void => {
      if (answer === null) mcpStatusAnswers.delete(conversationId)
      else mcpStatusAnswers.set(conversationId, answer)
    },
    mcpStatusRequests: (): readonly string[] => [...mcpStatusRequests],
    setMcpReconnectAnswer: (conversationId: string, answer: McpReconnectAnswer | null): void => {
      if (answer === null) mcpReconnectAnswers.delete(conversationId)
      else mcpReconnectAnswers.set(conversationId, answer)
    },
    mcpReconnectRequests: (): readonly MCPReconnectPayload[] => mcpReconnectRequests.map((request) => ({ ...request })),
    setMcpToggleAnswer: (conversationId: string, answer: McpReconnectAnswer | null): void => {
      if (answer === null) mcpToggleAnswers.delete(conversationId)
      else mcpToggleAnswers.set(conversationId, answer)
    },
    mcpToggleRequests: (): readonly MCPTogglePayload[] => mcpToggleRequests.map((request) => ({ ...request }))
  })
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

/** `workspace_updated` — the two-field WorkspaceUpdatedPayload (#1288), in BOTH the shapes the daemon
 *  emits. With `inReplyTo` it is the CORRELATED answer to a `rename_workspace` request (#1289); without
 *  it, the UNSOLICITED broadcast every other connected client receives. `JSON.stringify` omits an
 *  undefined-valued property, so the broadcast's bytes are byte-identical to the pre-#1289 ones. The
 *  client decodes both identically. */
function workspaceUpdatedFrame(
  path: string,
  label: string | null,
  inReplyTo?: number
): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'workspace_updated',
    ts: FIXED_TS,
    in_reply_to: inReplyTo,
    payload: { path, label } satisfies WorkspaceUpdatedPayload
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

/** A daemon `error` CORRELATED reply (#1308) — the request id echoed as `in_reply_to`, which is the only
 *  field the client correlates on. The `code` is one the daemon really uses for this refusal and the
 *  `message` is static and names no path, matching what the daemon promises; neither reaches the window,
 *  which receives a nullary `conversationCreateRejected` and nothing else. `retryable: false` because a
 *  folder that does not exist will not start existing on a retry of the same request. */
function errorFrame(inReplyTo: number): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'error',
    ts: FIXED_TS,
    in_reply_to: inReplyTo,
    payload: {
      code: 'workspace.not_found',
      message: 'workspace not found',
      retryable: false
    } satisfies ErrorPayload
  })
}

/** The requester-only `mcp_status` answer (#1579): correlated by `in_reply_to`, no `event_id`. */
function mcpStatusFrame(payload: MCPStatusPayload, inReplyTo: number): Uint8Array {
  return encodeEnvelope({ id: REPLY_ENVELOPE_ID, type: 'mcp_status', ts: FIXED_TS, in_reply_to: inReplyTo, payload })
}

/** A correlated `mcp_status_request` (#1579) or `mcp_reconnect` (#1583) refusal. The message is static and never reaches the window,
 *  which receives only main's client-owned reason. */
function mcpStatusErrorFrame(code: string, retryable: boolean, inReplyTo: number): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'error',
    ts: FIXED_TS,
    in_reply_to: inReplyTo,
    payload: { code, message: 'mcp status refused', retryable } satisfies ErrorPayload
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
