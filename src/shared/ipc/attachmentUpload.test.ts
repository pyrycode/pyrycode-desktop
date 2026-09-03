import { describe, it, expect } from 'vitest'
import {
  ATTACHMENT_UPLOAD_CHANNEL,
  ATTACHMENT_UPLOAD_EVENT_CHANNEL,
  type AttachmentUploadEvent
} from './attachmentUpload'
import { DAEMON_EVENT_CHANNEL } from './events'
import { COMMAND_CHANNEL } from './commands'
import { DIAGNOSTIC_CHANNEL } from './diagnostics'
import { PAIRING_CHANNEL } from './pairing'
import { PAIRING_STATUS_CHANNEL } from './pairingStatus'
import { UNPAIR_CHANNEL } from './unpair'
import { SERVER_INFO_CHANNEL } from './serverInfo'
import { HOST_LABEL_CHANNEL } from './hostLabel'

describe('attachment-upload channels', () => {
  it('are two distinct names, and collide with no existing channel', () => {
    // A collision would silently cross two feeds: an upload outcome reaching the daemon-event
    // bridges hits an assertNever, and an intent landing on the command channel is dropped as a
    // malformed command. Both are one typo away, so the whole set is pinned in one assertion.
    const all = [
      ATTACHMENT_UPLOAD_CHANNEL,
      ATTACHMENT_UPLOAD_EVENT_CHANNEL,
      DAEMON_EVENT_CHANNEL,
      COMMAND_CHANNEL,
      DIAGNOSTIC_CHANNEL,
      PAIRING_CHANNEL,
      PAIRING_STATUS_CHANNEL,
      UNPAIR_CHANNEL,
      SERVER_INFO_CHANNEL,
      HOST_LABEL_CHANNEL
    ]
    expect(new Set(all).size).toBe(all.length)
  })

  it('carry the app-wide pyry: prefix', () => {
    expect(ATTACHMENT_UPLOAD_CHANNEL.startsWith('pyry:')).toBe(true)
    expect(ATTACHMENT_UPLOAD_EVENT_CHANNEL.startsWith('pyry:')).toBe(true)
  })
})

describe('AttachmentUploadEvent', () => {
  it('declares no field beyond the listed ones on any member', () => {
    // AC5 as a property of the TYPE: walked positively over one instance of each member, so a member
    // that later grew a `path` or a `filename` field would have to be added to this list to pass.
    // The type annotation is what makes the walk meaningful — an extra key would not typecheck.
    const members: AttachmentUploadEvent[] = [
      { type: 'refused', uploadId: 'u', reason: 'too-large', limitBytes: 1 },
      { type: 'failed', uploadId: 'u', reason: 'unreadable' },
      { type: 'completed', uploadId: 'u' }
    ]

    expect(members.map((member) => Object.keys(member).sort())).toEqual([
      ['limitBytes', 'reason', 'type', 'uploadId'],
      ['reason', 'type', 'uploadId'],
      ['type', 'uploadId']
    ])
  })

  it('discriminates on type across all three members', () => {
    const seen = new Set<AttachmentUploadEvent['type']>(['refused', 'failed', 'completed'])
    expect(seen.size).toBe(3)
  })
})
