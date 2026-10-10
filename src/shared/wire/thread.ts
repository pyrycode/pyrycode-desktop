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
