/** Test-profile-only source checkpoints; ordinary builds never import this module. */
export function pagingWriterTransform(source: string): string {
  const checkpoints = [
    ['      captureChange(host, id, slice)',
      "      globalThis.__observePagingWriter?.('published', { serverId: host, conversationId: id, change: slice.owned })\n      captureChange(host, id, slice)"],
    ['    } else pending.set(key, { serverId: host, head: node, tail: node })',
      "    } else pending.set(key, { serverId: host, head: node, tail: node })\n    globalThis.__observePagingWriter?.('queued', request, { running: running !== undefined, scheduled: cancel !== undefined })"],
    ['        // Yield a task even when elapsed renderer time is paused during a close flush.',
      "        globalThis.__observePagingWriter?.('yielded', request)\n        // Yield a task even when elapsed renderer time is paused during a close flush."],
    ['port1.close(); port2.close(); resolve()',
      "port1.close(); port2.close(); globalThis.__observePagingWriter?.('resumed', request); resolve()"]
  ]
  for (const [anchor, replacement] of checkpoints) {
    if (source.split(anchor).length !== 2) throw Error('Paging checkpoint anchor changed')
    source = source.replace(anchor, replacement)
  }
  return source
}
