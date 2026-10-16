// Capture-only adapter: retain observed transport closes without recording handshake material.
import { createNoiseRelayDriver as createActual, type NoiseRelayDriverConfig } from '../../src/main/transport/noiseRelayDriver'
import { capture } from './captureNoiseSession'
export * from '../../src/main/transport/noiseRelayDriver'
export function createNoiseRelayDriver(config: NoiseRelayDriverConfig) {
  return createActual({ ...config, onEvent: event => {
    if (event.type === 'relay-link-down') capture.closeConnection(event.code)
    config.onEvent(event)
  } })
}
