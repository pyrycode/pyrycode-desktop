/** Action handle supplied by an authoritative queued user item. */
export interface QueuedRowHandle {
  queuedMsgId: number
  messageId: string | undefined
}
