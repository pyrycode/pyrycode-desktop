import { expect, it } from 'vitest'
import { isHostedAppsDisplayCommand } from './hostedAppsDisplay'
import { MAX_SERVER_ID_LENGTH } from './unpair'

it('accepts only bounded named-host display commands', () => {
  for (const type of ['watch', 'unwatch', 'refresh']) {
    const command = { type, serverId: 'paired-host', token: 1 }
    expect(isHostedAppsDisplayCommand(command)).toBe(true)
    for (const invalid of [null, [], {}, { ...command, serverId: '' }, { ...command, serverId: 'x'.repeat(MAX_SERVER_ID_LENGTH + 1) },
      { ...command, token: -1 }, { ...command, token: NaN }, { ...command, token: 1.5 },
      { ...command, release: '1.0.0' }, { ...command, type: 'open' }]) {
      expect(isHostedAppsDisplayCommand(invalid)).toBe(false)
    }
  }
})
