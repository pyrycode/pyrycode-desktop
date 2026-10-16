// This adapter is substituted by e2e/recordings/capture.config.ts only.
// Normal development and packaged builds never import it or expose the recorder.
import { createNoiseSession as createActual, type NoiseSessionConfig } from '../../src/main/transport/noiseSession'
import { createExchangeCapture, type ExchangeCapture } from './exchangeCapture'
export * from '../../src/main/transport/noiseSession'

declare global { var __desktopExchangeCapture: ExchangeCapture }
const capture = createExchangeCapture()
globalThis.__desktopExchangeCapture = capture

export async function createNoiseSession(config: NoiseSessionConfig) {
  const actual = await createActual({ ...config, onEvent: event => {
    if (event.type === 'message') capture.observe('daemon', event.plaintext)
    config.onEvent(event)
  } })
  return { ...actual, sendMessage(...args: Parameters<typeof actual.sendMessage>) {
    capture.observe('client', args[0])
    actual.sendMessage(...args)
  } }
}
