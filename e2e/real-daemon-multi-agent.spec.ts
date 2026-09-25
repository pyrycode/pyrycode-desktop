import { test, expect, encodePairingPayload } from './fixtures/realDaemon'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'

// #1657 — the APP's own hello advertises `interactive` and `multi_agent`, and a daemon at v0.27.0 or
// later (pyrycode#2643) echoes both in hello_ack. The unit tier pins what loadDialConfig advertises;
// only a real daemon can show it accepts the set.
//
// The capability gate probes with the same two names, so a daemon predating `multi_agent` SKIPS here
// as an environment fault rather than failing. The gate's probe is the harness's own connection,
// though, so this body reads the ack the APP received: a recorder on the existing daemon-event bridge
// catches the `connected` event of a manual reconnect, which re-dials and hands over a fresh ack.
//
// PROVENANCE: the recorder stores a filter over this spec's own two names, never the daemon's
// strings, so nothing the daemon sent can reach a failure message (decideCapabilityGate's rule).
const ADVERTISED = ['interactive', 'multi_agent'] as const
const RECORDER_KEY = '__pyryAckCapabilities'

test.use({ spawnClaude: false, seedPromoted: false, requiredCapabilities: ADVERTISED })

test('a real daemon echoes interactive and multi_agent in the app hello_ack', async ({ relay, daemon, page }) => {
  test.setTimeout(120_000)
  await pairFromUnpairedLaunch(page, encodePairingPayload({
    server: daemon.pairFields.server,
    relay: relay.url + '/v1/client',
    token: daemon.pairFields.token,
    server_static_pubkey: daemon.pairFields.server_static_pubkey
  }))
  await expect(page.locator('.channel-list__row-open')).toHaveCount(1, { timeout: 45_000 })

  await page.evaluate(({ key, names }) => {
    const store = window as unknown as Record<string, unknown>
    window.pyry.onDaemonEvent((event) => {
      if (event.type !== 'connected' || store[key] !== undefined) return
      store[key] = names.filter((name) => event.ack.capabilities.includes(name))
    })
  }, { key: RECORDER_KEY, names: [...ADVERTISED] })

  const info = await page.evaluate(() => window.pyry.serverInfo())
  if (info.status !== 'available') throw new Error('Paired server info unavailable after pairing')
  await page.evaluate((serverId) => window.pyry.reconnectServer(serverId), info.servers[0].serverId)

  await expect
    .poll(() => page.evaluate((key) => (window as unknown as Record<string, unknown>)[key], RECORDER_KEY), {
      timeout: 30_000
    })
    .toEqual([...ADVERTISED])
})
