import { describe, it, expect, vi } from 'vitest'
import { changeSetting, isAddressableSessionId } from './runSettingsControls'

// changeSetting is the pure, React-free session-id gate over #256's submitSettingsChange (the
// modalResolution.ts idiom): its two effects — sendCommand + dispatch — are injected, so it is
// exercised here with plain spies (no store, no Electron, no DOM). This is the AC5 gate coverage the
// `node` test environment cannot get by firing clicks on the view. The optimistic/rollback behaviour
// of submitSettingsChange itself is #256's; only the null-guard + single-field forwarding is tested.

describe('isAddressableSessionId', () => {
  // The single definition of the sheet's operability rule, used by both gate sites. null is "never
  // observed"; '' is the daemon explicitly saying it has no session to address. Both are inert, for
  // different reasons that reach the same conclusion: there is nothing to write to (#491).
  it('rejects null — never observed', () => {
    expect(isAddressableSessionId(null)).toBe(false)
  })

  it('rejects the empty string — the daemon says there is no session to address', () => {
    expect(isAddressableSessionId('')).toBe(false)
  })

  it('accepts a real id', () => {
    expect(isAddressableSessionId('sess-a')).toBe(true)
  })
})

describe('changeSetting — the AC5 session-id gate', () => {
  it('no-ops when sessionId is null: neither sends a command nor dispatches (AC5)', () => {
    const sendCommand = vi.fn()
    const dispatch = vi.fn()

    changeSetting({ sessionId: null, sendCommand, dispatch }, { field: 'model', value: 'opus' })

    expect(sendCommand).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('no-ops when sessionId is the empty string: nothing sent, nothing dispatched (#491)', () => {
    // The daemon has told us it cannot resolve a session. Sending anyway would put an empty address
    // on the wire for it to reject, and would leave an optimistic overlay that never confirms.
    const sendCommand = vi.fn()
    const dispatch = vi.fn()

    changeSetting({ sessionId: '', sendCommand, dispatch }, { field: 'model', value: 'opus' })

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
