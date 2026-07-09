import { describe, it, expect } from 'vitest'
import {
  reduceDownload,
  toDownloadAction,
  downloadView,
  initialDownloadState,
  type DownloadState
} from './logDataDownload'
import type { DaemonEvent, DebugBundleFailure } from '@shared/ipc/events'

// The download state machine is pure and React-free (the composerSend / pairingState precedent):
// a total reducer, an event→action filter, and a view-model deriver — all exercised here as plain
// functions with no store, no React, no Electron bridge.

describe('reduceDownload', () => {
  it('starts idle', () => {
    expect(initialDownloadState).toEqual({ phase: 'idle' })
  })

  it('requested → downloading with a zeroed chunk count', () => {
    expect(reduceDownload({ phase: 'idle' }, { type: 'requested' })).toEqual({
      phase: 'downloading',
      chunks: 0
    })
  })

  it('progress → downloading{chunks}, from either idle or an in-flight download (phase-agnostic)', () => {
    // Each action fully determines the next state — the reducer never branches on the prior phase.
    expect(reduceDownload({ phase: 'downloading', chunks: 0 }, { type: 'progress', chunks: 5 })).toEqual(
      { phase: 'downloading', chunks: 5 }
    )
    // A bare progress from idle re-hydrates the view cleanly (the accepted-ephemerality path).
    expect(reduceDownload({ phase: 'idle' }, { type: 'progress', chunks: 5 })).toEqual({
      phase: 'downloading',
      chunks: 5
    })
  })

  it('saved → saved{path}', () => {
    expect(
      reduceDownload({ phase: 'downloading', chunks: 3 }, { type: 'saved', path: '/tmp/pyry.tar.gz' })
    ).toEqual({ phase: 'saved', path: '/tmp/pyry.tar.gz' })
  })

  it('failed → failed{reason}', () => {
    expect(
      reduceDownload({ phase: 'downloading', chunks: 3 }, { type: 'failed', reason: 'write-failed' })
    ).toEqual({ phase: 'failed', reason: 'write-failed' })
  })
})

describe('toDownloadAction', () => {
  it('maps the three debug-bundle events to their action', () => {
    expect(toDownloadAction({ type: 'debugBundleProgress', chunksReceived: 7 })).toEqual({
      type: 'progress',
      chunks: 7
    })
    expect(toDownloadAction({ type: 'debugBundleSaved', path: '/tmp/pyry.tar.gz' })).toEqual({
      type: 'saved',
      path: '/tmp/pyry.tar.gz'
    })
    expect(toDownloadAction({ type: 'debugBundleFailed', reason: 'unavailable' })).toEqual({
      type: 'failed',
      reason: 'unavailable'
    })
  })

  it('returns null for every non-bundle daemon event (the filter)', () => {
    const unrelated: DaemonEvent[] = [
      { type: 'connecting' },
      { type: 'disconnected' },
      { type: 'snapshotReceived', model: 'Opus 4.7', effort: 'high', yolo: false }
    ]
    for (const event of unrelated) {
      expect(toDownloadAction(event)).toBeNull()
    }
  })
})

describe('downloadView', () => {
  it('idle → Download, not busy, no status caption', () => {
    expect(downloadView({ phase: 'idle' })).toEqual({ label: 'Download', busy: false, status: null })
  })

  it('downloading → busy, with a status caption carrying the running chunk count (AC3)', () => {
    const view = downloadView({ phase: 'downloading', chunks: 3 })
    expect(view.busy).toBe(true)
    expect(view.status?.isError).toBe(false)
    expect(view.status?.text).toContain('3')
  })

  it('saved → not busy (pressable again), status caption carries the saved path (AC4)', () => {
    const path = '/Users/x/pyry-debug.tar.gz'
    const view = downloadView({ phase: 'saved', path })
    expect(view.label).toBe('Download')
    expect(view.busy).toBe(false)
    expect(view.status?.isError).toBe(false)
    expect(view.status?.text).toContain(path)
  })

  it('failed → distinct plain-sentence captions, marked as errors, never leaking the raw reason (AC5)', () => {
    const reasons: DebugBundleFailure[] = ['unavailable', 'stream-corrupt', 'write-failed']
    const views = reasons.map((reason) => downloadView({ phase: 'failed', reason }))

    // Each maps to a distinct, error-flagged, non-busy caption.
    const texts = views.map((v) => v.status?.text ?? '')
    expect(new Set(texts).size).toBe(3)
    for (const [i, reason] of reasons.entries()) {
      const view = views[i]
      expect(view.busy).toBe(false)
      expect(view.status?.isError).toBe(true)
      // AC5: never a raw code/errno/stack — only a human sentence.
      expect(texts[i]).not.toContain(reason)
      expect(texts[i].toLowerCase()).not.toContain('errno')
      expect(texts[i]).not.toContain(' at ')
    }
  })
})

// A type-level pin (unused at runtime): DownloadState must stay exactly these four phases, so a
// widened union is a compile error here. Mirrors the sealed-shape discipline in the wire tests.
const _phasePin: DownloadState['phase'] = 'idle'
void _phasePin
