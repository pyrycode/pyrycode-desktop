import { open } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { AttachmentOpenEvent, AttachmentOpenRequest } from '../shared/ipc/attachmentOpen'
import type { DiagnosticLog } from './diagnosticLog'

interface Owner {
  serverId: string
  conversationId: string
}

/** Main-lifetime preferences, registered only by the successful local-upload seam. */
export function createLocalAttachments(deps: {
  open: (path: string) => Promise<boolean>
  diagnosticLog?: DiagnosticLog
}) {
  const originals = new Map<string, Owner & { path: string }>()
  const log = (code: string): void => deps.diagnosticLog?.event({ event: 'attachment-local', code })

  return {
    remember(attachmentId: string, path: string, owner: Owner): void {
      if (originals.has(attachmentId)) return
      originals.set(attachmentId, { ...owner, path: resolve(path) })
      log('registered')
    },
    async open(request: AttachmentOpenRequest): Promise<AttachmentOpenEvent> {
      const { attachmentId } = request
      const original = originals.get(attachmentId)
      const unavailable = (): AttachmentOpenEvent => {
        log('unavailable')
        return { type: 'failed', attachmentId, reason: 'unavailable' }
      }
      if (
        original === undefined || original.serverId !== request.serverId ||
        original.conversationId !== request.conversationId
      ) return unavailable()

      try {
        const handle = await open(original.path, 'r')
        try {
          if (!(await handle.stat()).isFile()) return unavailable()
        } finally {
          await handle.close()
        }
      } catch {
        return unavailable()
      }

      try {
        if (await deps.open(original.path)) {
          log('opened')
          return { type: 'opened', attachmentId }
        }
      } catch {
        // OS errors may contain the original path; report only the static outcome.
      }
      log('open-failed')
      return { type: 'failed', attachmentId, reason: 'open-failed' }
    }
  }
}
