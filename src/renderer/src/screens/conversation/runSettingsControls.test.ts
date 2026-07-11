import { describe, it, expect, vi } from 'vitest'
import { changeSetting } from './runSettingsControls'

// changeSetting is the pure, React-free session-id gate over #256's submitSettingsChange (the
// modalResolution.ts idiom): its two effects — sendCommand + dispatch — are injected, so it is
// exercised here with plain spies (no store, no Electron, no DOM). This is the AC5 gate coverage the
// `node` test environment cannot get by firing clicks on the view. The optimistic/rollback behaviour
// of submitSettingsChange itself is #256's; only the null-guard + single-field forwarding is tested.

describe('changeSetting — the AC5 session-id gate', () => {
  it('no-ops when sessionId is null: neither sends a command nor dispatches (AC5)', () => {
    const sendCommand = vi.fn()
    const dispatch = vi.fn()

    changeSetting({ sessionId: null, sendCommand, dispatch }, { field: 'model', value: 'opus' })

    expect(sendCommand).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('forwards a model change to submitSettingsChange: one dispatch + one command, same changeId (AC1)', () => {
    const sendCommand = vi.fn()
    const dispatch = vi.fn()

    changeSetting(
      { sessionId: 'sess-1', sendCommand, dispatch, mintChangeId: () => 'chg-1' },
      { field: 'model', value: 'opus' }
    )

    // Record-before-send: the optimistic pending marker is dispatched first, carrying the change.
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({
      type: 'changeDispatched',
      changeId: 'chg-1',
      change: { field: 'model', value: 'opus' }
    })
    // Exactly one command, carrying only the single changed key + the SAME changeId as the dispatch.
    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledWith({
      type: 'setSessionSettings',
      payload: { session_id: 'sess-1', model: 'opus' },
      changeId: 'chg-1'
    })
  })

  it('forwards an effort change carrying only the effort key (AC2)', () => {
    const sendCommand = vi.fn()
    const dispatch = vi.fn()

    changeSetting(
      { sessionId: 'sess-1', sendCommand, dispatch, mintChangeId: () => 'chg-2' },
      { field: 'effort', value: 'high' }
    )

    expect(dispatch).toHaveBeenCalledWith({
      type: 'changeDispatched',
      changeId: 'chg-2',
      change: { field: 'effort', value: 'high' }
    })
    expect(sendCommand).toHaveBeenCalledWith({
      type: 'setSessionSettings',
      payload: { session_id: 'sess-1', effort: 'high' },
      changeId: 'chg-2'
    })
  })

  it('forwards a yolo toggle carrying only the yolo key (AC3)', () => {
    const sendCommand = vi.fn()
    const dispatch = vi.fn()

    changeSetting(
      { sessionId: 'sess-1', sendCommand, dispatch, mintChangeId: () => 'chg-3' },
      { field: 'yolo', value: true }
    )

    expect(dispatch).toHaveBeenCalledWith({
      type: 'changeDispatched',
      changeId: 'chg-3',
      change: { field: 'yolo', value: true }
    })
    expect(sendCommand).toHaveBeenCalledWith({
      type: 'setSessionSettings',
      payload: { session_id: 'sess-1', yolo: true },
      changeId: 'chg-3'
    })
  })
})
