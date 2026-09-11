import { startFakeDaemon, type FakeDaemon, type FakeDaemonOptions } from '../../src/main/transport/fakeDaemon'

// The paired fixture dials its fake daemons before launching Electron, so launch-fate
// cannot identify these failures. Report only a fixed stage and the observed status.
export async function startFakeDaemonForTest(options: FakeDaemonOptions): Promise<FakeDaemon> {
  try {
    return await startFakeDaemon(options)
  } catch (error) {
    const message = error instanceof Error && error.message === 'Unexpected server response: 404'
      ? 'Fake daemon setup failed before Electron launch: HTTP 404'
      : 'Fake daemon setup failed before Electron launch'
    // A cause would put raw library errors (potentially URLs or paths) back in the report.
    throw new Error(message)
  }
}
