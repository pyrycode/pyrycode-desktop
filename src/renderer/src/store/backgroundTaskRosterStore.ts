// Shared task presentation declarations; membership and attribution come from daemon items.

export interface HeldBackgroundTaskUpdate {
  patch: string
  truncatedFields: readonly string[] | null
}

export interface HeldBackgroundTaskSummary {
  text: string
  truncatedFields: readonly string[] | null
}

export interface HeldBackgroundTaskProgress {
  currentActivity: string
  subagentType: string
  lastToolName: string
  totalTokens: number
  toolUses: number
  durationMs: number
  truncatedFields: readonly string[] | null
}

export interface HeldBackgroundTask {
  /** Presence records started provenance even when its id is empty. */
  startedToolCallId?: string
  rosterToolCallId?: string
  taskId: string
  toolCallId: string | null
  taskType: string
  description: string
  truncatedFields: readonly string[] | null
  latestUpdate: HeldBackgroundTaskUpdate | null
  status: string | null
  summary: HeldBackgroundTaskSummary | null
  progress: HeldBackgroundTaskProgress | null
}
