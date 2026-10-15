import { describe, expect, it } from 'vitest'
import { parseHostedAppLink } from './hostedAppLink'

const host = '11111111-1111-4111-8111-111111111111'
const app = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const link = `pyrycode://hosts/${host}/apps/${app}`
describe('stable hosted app link grammar', () => {
  it('accepts only the entire canonical lowercase UUIDv4 target', () => {
    expect(parseHostedAppLink(link)).toEqual({ serverId: host, appId: app })
    for (const value of [undefined, null, {}, '', link + '\n', '\t' + link, link + '\0',
      link + '/', link + '/extra', link + '?x=1', link + '#x', link.replace('hosts/', 'hosts:80/'),
      link.replace('hosts/', 'user@hosts/'), link.replace('hosts', 'HOSTS'), link.replace('pyrycode', 'PYRYCODE'),
      link.replace('pyrycode', 'https'), link.replace(host, host.replace('-4', '-5')),
      link.replace(app, app.toUpperCase()), link.replace('/apps/', '/x/../apps/'),
      link.replace('aaaaaaaa', '%61aaaaaa'), link.replace('hosts/', 'hosts\\/'),
      link.replace('hosts/', 'hosts./'), link.replace('/apps/', '/apps//')]) {
      expect(parseHostedAppLink(value), String(value)).toBeNull()
    }
  })
})
