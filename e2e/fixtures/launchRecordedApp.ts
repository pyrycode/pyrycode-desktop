import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test, expect, type PairedApp } from './launchPairedApp'
import { pairFromUnpairedLaunch } from './pairingArrival'
import { RecordedExchange, parseRecording, type Recording } from './recordedExchange'

export { expect }
export const recordedTest = test.extend<{
  recording: Recording
  recordedApp: PairedApp
}>({
  recording: async ({}, use) => {
    // An explicit candidate lets verification exercise new captures without replacing the committed fixture.
    const file = process.env.PYRY_RECORDING_FILE ?? resolve('e2e/recordings/permission-allow.json')
    await use(parseRecording(readFileSync(file, 'utf8')))
  },
  recordedApp: async ({ launchPairedApp, recording }, use, info) => {
    const replay = new RecordedExchange(recording)
    let failed = false
    const app = await launchPairedApp({ threadMode: 'native', helloAck: { capabilities: recording.capabilities },
      buildReplyFrames: bytes => {
        try { return replay.reply(bytes) }
        catch { failed = true; return [] } // Never echo payloads through the fake transport's error handling.
      }
    }, { skipPairing: true, onLaunched: async app => {
      const identity = await (await app.firstWindow()).evaluate(() => window.pyry.deviceIdentity())
      if (!identity.ok) throw new Error('Recorded exchange device identity unavailable')
      replay.setDeviceId(identity.deviceId)
    } })
    const server = app.servers[0]
    await pairFromUnpairedLaunch(app.page, Buffer.from(JSON.stringify({ server: server.serverId,
      relay: `${server.forwarder.url}/v1/client`, token: 'dummy-token-not-a-real-credential',
      server_static_pubkey: Buffer.from(server.daemon.staticPublicKey).toString('base64') })).toString('base64url'))
    try { await use(app) }
    finally {
      await info.attach('recorded-exchange', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
        scenario: recording.scenario.id, source: recording.source, ...replay.stats(), requestMismatch: failed
      })) })
      replay.assertComplete()
    }
  }
})
