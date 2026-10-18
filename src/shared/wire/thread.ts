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
type Revision = { item_id: number; base_rev: number; rev: number }
export type ThreadUpdate =
  | { type: 'thread_item_added'; payload: Routing & { item: ThreadItem } }
  | { type: 'thread_item_changed'; payload: Routing & Revision & { changes: Record<string, unknown> } }
  | { type: 'thread_text_append'; payload: Routing & Revision & { text: string } }

export type ThreadRepairReason = 'malformed' | 'sequence' | 'metadata' | 'limit' | 'final-length' | 'digest' | 'reconstructed' | 'expired'

export type ThreadQuery =
  | { type: 'thread_read_tool_body'; payload: { conversation_id: string; epoch: string; item_id: number; expected_rev: number } }
  | { type: 'thread_catch_up'; payload: { conversation_id: string; epoch: string; version: number; limit?: number } }
  | { type: 'thread_page'; payload: { conversation_id: string; before_order: number; limit?: number } }
export type ThreadReply =
  | { type: 'thread_tool_body'; payload: Routing & { item_id: number; rev: number; kind: 'tool_call' | 'agent' } &
      ({ content: Record<string, unknown>; final: false } | { final: true }) }
  | { type: 'thread_items'; payload: Routing & { items: ThreadItem[]; final: false } }
  | { type: 'thread_items'; payload: Routing & { items: []; final: true } &
      ({ from_version: number } | { lower_order: number; upper_order: number; continuation: number; older_exists: boolean }) }
  | { type: 'thread_reset'; payload: Routing }
export type ThreadQueryFailure = ThreadRepairReason | 'unavailable' | 'send-failed' | 'interrupted' | 'daemon-error'
