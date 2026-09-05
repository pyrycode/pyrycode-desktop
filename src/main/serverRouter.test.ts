// The server router (#1120): a command that is about a WHOLE server reaches the server the window
// named, and an ambiguous one is refused. Both registry lookups are injected fakes and the logger
// collects, so there is no Electron, no store, no socket — and, unlike its two siblings, no event
// stream to drive, because this module learns nothing.
//
// The assertions pin the SAFETY property (three outcomes, no fallback to an arbitrary server) and
// the LOGGING posture (two static literals, and the named id never among them).
import { describe, expect, it, vi } from 'vitest'
import { createServerRouter, type ServerTarget } from './serverRouter'
import type { DiagnosticEvent } from './diagnosticLog'

/** A stand-in connection, distinguishable per server so a mis-route is visible in an assertion. */
interface FakeConnection {
  readonly name: string
}

interface Harness {
  router: ReturnType<typeof createServerRouter<FakeConnection>>
  records: DiagnosticEvent[]
  connectionFor: ReturnType<typeof vi.fn>
  soleConnection: ReturnType<typeof vi.fn>
}

/**
 * Build a router over a fixed entry set. `held` is the set of connected servers by id; `sole` is
 * what the registry's "exactly one entry" accessor answers — passed separately rather than derived,
 * because the not-paired stand-in is a held ENTRY with no id at all, which is exactly the case a
 * derived fake would get wrong.
 */
function setup(held: string[], sole: ServerTarget<FakeConnection> | null): Harness {
  const records: DiagnosticEvent[] = []
  const connectionFor = vi.fn((serverId: string): FakeConnection | null =>
    held.includes(serverId) ? { name: serverId } : null
  )
  const soleConnection = vi.fn((): ServerTarget<FakeConnection> | null => sole)
  const router = createServerRouter<FakeConnection>({
    connectionFor,
    soleConnection,
    diagnosticLog: { event: (record) => records.push(record) }
  })
  return { router, records, connectionFor, soleConnection }
}

/** One paired server, held as the registry's single entry — the ordinary single-daemon shape. */
function oneServer(serverId: string): Harness {
  return setup([serverId], { serverId, connection: { name: serverId } })
}

describe('createServerRouter — a named server (AC1/AC2)', () => {
  it('reaches the connection for the server the window named', () => {
    const h = setup(['server-a', 'server-b'], null)

    expect(h.router.route('server-b')).toEqual({ name: 'server-b' })
    expect(h.router.resolve('server-a')).toEqual({
      serverId: 'server-a',
      connection: { name: 'server-a' }
    })
  })

  it('never consults the one-connection fallback when an id is named', () => {
    // The fallback exists for an ABSENT id only. If a named id could fall through to it, an id
    // naming a disconnected server would reach the sole connection instead of refusing — which is
    // the "no fallback to an arbitrary server" half of AC2.
    const h = setup(['server-a'], { serverId: 'server-a', connection: { name: 'server-a' } })

    h.router.route('server-a')
    h.router.route('server-unknown')

    expect(h.soleConnection).not.toHaveBeenCalled()
  })

  it('refuses an id naming no connected server, and puts nothing on any wire', () => {
    const h = setup(['server-a'], { serverId: 'server-a', connection: { name: 'server-a' } })

    expect(h.router.route('server-gone')).toBeNull()
    expect(h.router.resolve('server-gone')).toBeNull()
    expect(h.records).toEqual([
      { event: 'server-route-refused', code: 'server-not-connected' },
      { event: 'server-route-refused', code: 'server-not-connected' }
    ])
  })

  it('refuses an empty id on the named branch rather than treating it as absent', () => {
    // `''` is a present string, so it is a NAME that matches no held record — not an omission. If it
    // took the absent branch, a renderer sending an empty id would silently reach the sole server.
    const h = oneServer('server-a')

    expect(h.router.route('')).toBeNull()
    expect(h.soleConnection).not.toHaveBeenCalled()
    expect(h.records).toEqual([{ event: 'server-route-refused', code: 'server-not-connected' }])
  })
})

describe('createServerRouter — an absent id (AC2)', () => {
  it('reaches the sole connection when the registry holds exactly one entry', () => {
    const h = oneServer('server-a')

    expect(h.router.route(undefined)).toEqual({ name: 'server-a' })
    expect(h.router.resolve(undefined)).toEqual({
      serverId: 'server-a',
      connection: { name: 'server-a' }
    })
    expect(h.connectionFor).not.toHaveBeenCalled()
  })

  it('reaches the not-paired stand-in, whose id is null, rather than refusing (AC4)', () => {
    // The entry list is never empty: with nothing paired it holds ONE stand-in built with
    // `serverId: null`, whose dial IS the failed(not-paired) settle. A fallback written as "exactly
    // one paired RECORD" would refuse here and turn today's inert no-ops into refusals.
    const standIn: ServerTarget<FakeConnection> = { serverId: null, connection: { name: 'stand-in' } }
    const h = setup([], standIn)

    expect(h.router.resolve(undefined)).toEqual(standIn)
    expect(h.records).toEqual([])
  })

  it('refuses an absent id when the registry holds more than one entry', () => {
    const h = setup(['server-a', 'server-b'], null)

    expect(h.router.route(undefined)).toBeNull()
    expect(h.router.resolve(undefined)).toBeNull()
    expect(h.records).toEqual([
      { event: 'server-route-refused', code: 'ambiguous-server' },
      { event: 'server-route-refused', code: 'ambiguous-server' }
    ])
  })
})

describe('createServerRouter — route and resolve are one decision', () => {
  it('agrees on every branch, so the safety property has one implementation', () => {
    const cases: Array<{ held: string[]; sole: ServerTarget<FakeConnection> | null; ask: string | undefined }> = [
      { held: ['server-a'], sole: { serverId: 'server-a', connection: { name: 'server-a' } }, ask: 'server-a' },
      { held: ['server-a'], sole: { serverId: 'server-a', connection: { name: 'server-a' } }, ask: 'server-b' },
      { held: ['server-a'], sole: { serverId: 'server-a', connection: { name: 'server-a' } }, ask: undefined },
      { held: ['server-a', 'server-b'], sole: null, ask: undefined },
      { held: [], sole: { serverId: null, connection: { name: 'stand-in' } }, ask: undefined }
    ]

    for (const { held, sole, ask } of cases) {
      const h = setup(held, sole)
      const resolved = h.router.resolve(ask)
      const routed = h.router.route(ask)
      expect(routed).toEqual(resolved === null ? null : resolved.connection)
    }
  })
})

describe('createServerRouter — logging (AC2)', () => {
  it('emits exactly one content-free line per refusal, and never the id it was asked for', () => {
    const h = setup(['server-a', 'server-b'], null)

    h.router.route('9dcb0e2a-secret-looking-id')
    h.router.route(undefined)

    expect(h.records).toHaveLength(2)
    for (const record of h.records) {
      expect(Object.keys(record).sort()).toEqual(['code', 'event'])
      expect(JSON.stringify(record)).not.toContain('9dcb0e2a')
    }
  })

  it('logs nothing at all on a successful resolution', () => {
    const h = oneServer('server-a')

    h.router.route('server-a')
    h.router.route(undefined)
    h.router.resolve('server-a')

    expect(h.records).toEqual([])
  })

  it('works without a diagnostic log — the dependency is optional, and a refusal is still a refusal', () => {
    const router = createServerRouter<FakeConnection>({
      connectionFor: () => null,
      soleConnection: () => null
    })

    expect(router.route('server-a')).toBeNull()
    expect(router.route(undefined)).toBeNull()
  })
})
