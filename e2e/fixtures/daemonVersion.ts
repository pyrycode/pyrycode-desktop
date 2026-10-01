// What the real-claude specs record as the tested daemon: the build identity that `pyry version`
// prints. A dev build prints its source revision; a release build prints its semver, which names
// the build just as exactly. Either is accepted, and the spec logs it as `daemon-revision`.
// Anything else fails the spec before the app launches, so no run can claim an unidentified daemon
// passed. The rejection message is a constant and never echoes the binary's output.

export const DAEMON_IDENTITY_REJECTION =
  'the tested daemon must identify its build: expected `pyry version` to print ' +
  '`pyry dev-<hex>` / `pyry <hex>` (7-40 hex digits) or `pyry <major>.<minor>.<patch>` ' +
  '(optional leading v, optional pre-release/build suffix)'

const REVISION = /^pyry (?:dev-)?([a-f0-9]{7,40})\s*$/
const RELEASE = /^pyry v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\s*$/

/** The revision or release version in `pyry version` stdout; throws DAEMON_IDENTITY_REJECTION otherwise. */
export function daemonIdentity(stdout: string): string {
  const identity = REVISION.exec(stdout)?.[1] ?? RELEASE.exec(stdout)?.[1]
  if (identity === undefined) throw new Error(DAEMON_IDENTITY_REJECTION)
  return identity
}
