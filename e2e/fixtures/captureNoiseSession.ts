// This adapter is substituted by e2e/recordings/capture.config.ts only.
// Normal development and packaged builds never import it or expose the recorder.
import { createNoiseSession as createActual, type NoiseSessionConfig } from '../../src/main/transport/noiseSession'
import { createExchangeCapture, type ExchangeCapture } from './exchangeCapture'
import { decodeEnvelope } from '../../src/main/transport/codec'
export * from '../../src/main/transport/noiseSession'

declare global { var __desktopExchangeCapture: ExchangeCapture }
const capture = createExchangeCapture()
globalThis.__desktopExchangeCapture = capture
if (process.env.PYRY_CAPTURE_ON_LAUNCH === '1') capture.begin()

export async function createNoiseSession(config: NoiseSessionConfig) {
  let connection = 0
  const actual = await createActual({ ...config, onEvent: event => {
    if (event.type === 'message') capture.observe('daemon', event.plaintext, connection)
    if (event.type === 'handshake-complete') {
      connection = capture.openConnection()
      const ack = decodeEnvelope(event.helloAck).payload as { capabilities?: string[] }
      capture.setCapabilities(connection, ack.capabilities ?? [])
    }
    config.onEvent(event)
  } })
  return { ...actual, sendMessage(...args: Parameters<typeof actual.sendMessage>) {
    capture.observe('client', args[0], connection)
    actual.sendMessage(...args)
  } }
}
