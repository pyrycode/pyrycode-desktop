import type { DaemonEvent } from '../../src/shared/ipc/events'

/** Self-contained so Playwright can evaluate this same tested function in the renderer. */
export function createQueueTurnEvidence(options: {
  conversationId: string; markers: string[]; subscribe?: boolean
}) {
  type Turn = {
    start: number; end: number; completions: number; normal: boolean; markers: number[]
    suffix: string
  }
  const turns = new Map<string, Turn>()
  let order = 0
  let conversationId = options.conversationId
  let queuedMessageIds: (string | undefined)[] = []
  let queueSnapshots = 0
  const suffixLimit = Math.max(...options.markers.map(marker => marker.length)) - 1

  function observe(event: DaemonEvent): void {
    if (event.type === 'conversationCreated' && conversationId === '') conversationId = event.conversation.id
    if (!('conversationId' in event) || event.conversationId !== conversationId) return
    order += 1
    if (event.type === 'queueState') {
      queuedMessageIds = event.queued.map(item => item.message_id)
      queueSnapshots += 1
      return
    }
    if (event.type !== 'assistantDelta' && event.type !== 'toolUse' && event.type !== 'turnEnd') return
    let turn = turns.get(event.turnId)
    if (!turn) {
      turn = { start: order, end: 0, completions: 0, normal: false, markers: [], suffix: '' }
      turns.set(event.turnId, turn)
    }
    if (event.type === 'assistantDelta') {
      const text = turn.suffix + event.text
      options.markers.forEach((marker, index) => {
        if (text.includes(marker) && !turn.markers.includes(index)) turn.markers.push(index)
      })
      turn.suffix = text.slice(-suffixLimit)
    }
    if (event.type === 'turnEnd') {
      turn.end = order
      turn.completions += 1
      turn.normal = event.stopReason === 'end_turn' && event.isError !== true &&
        (!event.outcome || event.outcome === 'success') &&
        (!event.terminalReason || event.terminalReason === 'completed') && !event.errorCategory
      turn.suffix = ''
    }
  }

  function snapshot(expectedMarkers: number[]) {
    const summaries = [...turns.values()].map(({ suffix: _suffix, ...summary }) => summary)
    const complete = summaries.length === expectedMarkers.length && summaries.every((turn, index) =>
      turn.completions === 1 && turn.normal && turn.markers.length === 1 &&
      turn.markers[0] === expectedMarkers[index] &&
      (index === 0 || turn.start > summaries[index - 1].end))
    return { complete, conversationId, turns: summaries, queuedMessageIds, queueSnapshots }
  }
  if (options.subscribe) {
    const target = window as unknown as { pyry: { onDaemonEvent: (listener: typeof observe) => () => void };
      queueTurnEvidence: { snapshot: typeof snapshot; stop: () => void } }
    target.queueTurnEvidence = { snapshot, stop: target.pyry.onDaemonEvent(observe) }
  }
  return { observe, snapshot }
}
