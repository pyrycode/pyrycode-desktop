/** Supplied daemon-built thread DTOs; unknown JSON remains inert, never merged into app objects. */
export interface ThreadItem {
  [field: string]: unknown
  id: number
  kind: string
  rev: number
  status: string
  active: boolean
  shown: boolean
  summary: string
  content: unknown
  order?: number
  ended_order?: number
  session?: string
  agent?: string
  no_child?: boolean
  turn?: string
  parent?: number
  subtype?: string
}
type Routing = { conversation_id: string; epoch: string; version: number }
type ProjectionRouting = Routing & { projection?: 'compact-v1' }
export type ThreadCompactUpdate = { type: 'thread_compact_update'; payload: Routing & {
  projection: 'compact-v1'; from_version: number; progress: boolean; item?: ThreadItem; header?: ThreadSummary } }
type Revision = { item_id: number; base_rev: number; rev: number }
export type ThreadChildCursor = Routing & { item_id: number; rev: number; order: number; id: number }
export interface ThreadSummary {
  id: number; order: number; rev: number; parent: number; kind: string; status: string
  active: boolean; shown: boolean; headline: string; detail_omitted: true
  ended_order?: number; session?: string; agent?: string; turn?: string; subtype?: string; no_child?: true
  error_summary?: string; public_child_count?: number; has_public_children?: boolean; subtree_version?: number
}
export type ThreadUpdate =
  | { type: 'thread_item_added'; payload: Routing & { item: ThreadItem } }
  | { type: 'thread_item_changed'; payload: Routing & Revision & { changes: Record<string, unknown> } }
  | { type: 'thread_text_append'; payload: Routing & Revision & { text: string } }

export type ThreadRepairReason = 'malformed' | 'sequence' | 'metadata' | 'limit' | 'final-length' | 'digest' | 'reconstructed' | 'expired'

export type ThreadQuery =
  | { type: 'thread_read_children'; payload: { conversation_id: string; epoch: string; item_id: number; expected_rev: number; limit?: number; cursor?: ThreadChildCursor } }
  | { type: 'thread_read_tool_body'; payload: { conversation_id: string; epoch: string; item_id: number; expected_rev: number } }
  | { type: 'thread_catch_up'; payload: { conversation_id: string; epoch: string; version: number; limit?: number; projection?: 'compact-v1' } }
  | { type: 'thread_page'; payload: { conversation_id: string; before_order: number; limit?: number; projection?: 'compact-v1'; epoch?: string } }
export type ThreadReply =
  | { type: 'thread_children'; payload: Routing & { item_id: number; rev: number; children: ThreadSummary[] } &
      ({ final: false } | { final: true; more: boolean; cursor?: ThreadChildCursor }) }
  | { type: 'thread_tool_body'; payload: Routing & { item_id: number; rev: number; kind: 'tool_call' | 'agent' } &
      ({ content: Record<string, unknown>; final: false } | { final: true }) }
  | { type: 'thread_items'; payload: ProjectionRouting & { items: ThreadItem[]; headers?: ThreadSummary[]; final: false } }
  | { type: 'thread_items'; payload: ProjectionRouting & { items: []; final: true } &
      ({ from_version: number } | { lower_order: number; upper_order: number; continuation: number; older_exists: boolean }) }
  | { type: 'thread_reset'; payload: ProjectionRouting }
export type ThreadQueryFailure = ThreadRepairReason | 'unavailable' | 'send-failed' | 'interrupted' | 'daemon-error'
