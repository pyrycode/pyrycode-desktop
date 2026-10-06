# #1774 — One command publishes the Windows installer and its update feed

## Files read

- `electron-builder.yml` — the NSIS target for x64 and arm64, `files` allowlist, `extraMetadata`, and
  `publish: null`, which this ticket replaces with the GitHub provider.
- `package.json` → `scripts.dist:win`, `version` — the dev version `0.1.0` that main keeps.
- `electron.vite.config.ts` → `appVersion` — `__APP_VERSION__` is read from `package.json` at build
  time, so the version stamp has to land before `npm run build`, not only at packaging.
- `node_modules/app-builder-lib/out/publish/PublishManager.js` — `latest.yml` and `app-update.yml` are
  written whenever a provider is configured, independent of `isPublish`; an unset `--publish` turns
  into `onTagOrDraft` under CI detection, which is why every build passes `--publish never`.
- `docs/knowledge/features/windows-packaging.md` — the build-host-arch trap and the Apple Silicon
  `makensis` failure that moved the build to pyrybox.
- `pyrycode-agents/container/deploy.sh` — the re-exec under `automation-access with-pyrybox-key` with
  the temporary agent passed as `IdentityAgent`.
- The daemon's `release-daemon.py` (`pyry-release`) — isolated clone, receipts per source SHA, draft,
  download and verify, publish; a rerun resumes.

## Design

One new script, `scripts/release-win.mjs`, run on the Mac as `npm run release:win -- X.Y.Z`. It is plain
Node ESM so it runs without a build step. All side effects go through four injected boundaries, so the
tests drive the whole transaction against fakes:

- `exec(cmd, args, opts)` — every local command.
- `fs` — the work directory and its state files.
- `host` — files and the Wine build on pyrybox. The real one runs over `ssh` through `exec`.
- `github` — a small REST client. The real one runs `gh api` on pyrybox over SSH, so publishing uses
  pyrybox's existing GitHub login and no token crosses to the Mac, the container or a file.

### Flow

1. **Validate** `X.Y.Z`: digits only, no `v`, no leading zeroes, no suffix. List every release through
   paginated REST. A published release with tag `vX.Y.Z` means done: print and exit 0 without
   touching anything. Otherwise the version must exceed every published stable release, or, before
   the first release, the `package.json` version on the source commit. All of this happens before any
   state is written.
2. **Pin the source.** The work directory `~/.cache/pyrycode-desktop-releases/X.Y.Z/` keeps
   `state.json` with the source SHA. A first run records current `main`. A retry reuses the recorded
   SHA even when main has moved. An existing draft for the tag must target the same SHA, and an
   existing tag must resolve to it, or the run fails without publishing.
3. **Prepare** in an isolated clone from GitHub under the work directory, never the developer checkout:
   detach at the SHA, `npm ci`, `npm test`, then stamp the version with `npm version
   --no-git-tag-version` in that clone only and run `npm run build`. The tests run before the stamp
   because the settings screen's spec pins the dev version that `vitest.config.ts` reads from
   `package.json`; the stamp is packaging metadata, so testing the unmodified source is the right
   evidence. A receipt keyed by SHA and version skips this on retry.
4. **Build the installer** on pyrybox: stream the prepared tree, without `node_modules` and `.git`, to
   `~/pyrycode-desktop-release/X.Y.Z/project`, then run one Podman call of
   `electronuserland/builder:wine`, pinned by digest, doing `npm ci` and
   `electron-builder --win --publish never`. Afterwards check `latest.yml` names the installer and
   version and matches the installer's sha512, and both `app-update.yml` files name the repo.
5. **Draft.** Create draft `vX.Y.Z` targeting the SHA, or reuse the existing one. Upload the
   installer, `.blockmap` and `latest.yml`. An existing asset is kept only when it finished uploading
   and its size and digest match the local file; anything else is deleted and uploaded again.
6. **Verify.** Download all three assets back by asset id, check each is byte-identical to the build,
   and check the installer's base64 sha512 against the downloaded `latest.yml`.
7. **Publish** only after step 6 passes, by updating the draft with the tag, the SHA and
   `draft: false`. Then re-read the release and the tag and fail loudly if the tag does not resolve to
   the SHA.

`--dry-run` swaps the boundaries for a recorder: it prints every command of steps 3 and 4, ending with
the Podman invocation, and never calls SSH, Podman, `with-pyrybox-key` or GitHub. Without `--dry-run`
the script re-enters itself under `automation-access with-pyrybox-key`.

`dist:win` gains `--publish never` too, so a local build cannot publish through CI or tag detection.

## Testing

`scripts/release-win.test.ts`, added to vitest's `include`. Fake `exec`, `fs`, pyrybox files and GitHub REST
state:

- version syntax and ordering, and that rejection happens before any command, write or GitHub write;
- the published-version no-op makes no command and no write;
- dry run never touches the source checkout or main and never calls ssh, podman or the helper;
- publish never fires before verification; a failed upload or hash mismatch leaves the draft
  unpublished; a retry repairs the incomplete draft, re-verifies and publishes;
- a retry keeps the recorded SHA after main advances; a draft or tag on another SHA fails.

The real Wine build and the first real publish are the ticket's operator acceptance.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings. The only inputs are the operator's version argument, validated by
  `parseVersion` before any other step, and GitHub REST responses, read in `release` and
  `parseLatestYml`. Asset names are fixed by the script from the validated version, never taken from
  a response, so no response field becomes a path or a shell word.
- [Tokens] No findings. The GitHub token never leaves pyrybox's `gh` keyring: the Mac sends
  `gh api` commands over SSH and receives JSON. The container gets no `GH_TOKEN` and no environment
  passthrough, so the Wine build has no credential. The SSH key stays in the helper's temporary agent,
  referenced only by `IdentityAgent=$SSH_AUTH_SOCK`; the script writes no key or token to a file,
  argument or log.
- [File and storage] SHOULD FIX, done in Phase B. Every remote path is built from the validated
  version under a fixed root and passed through `shellQuote`; the remote `rm -rf` targets only
  `pyrycode-desktop-release/<version>/project`. The local work directory is created with mode 0700.
- [Electron attack surface] No findings. The app's runtime code is unchanged; `app-update.yml` is
  inert until #1775 wires the updater.
- [Cryptographic primitives] No findings. sha512 via `openssl dgst` and sha256 via `sha256sum` on
  pyrybox; no custom crypto. The hash proves integrity of the upload, not authenticity: the build is
  unsigned by decision, and signing stays out of scope.
- [Network and I/O] SHOULD FIX, done in Phase B. SSH uses `BatchMode=yes` and `ConnectTimeout=15`
  so a missing key fails rather than prompting. The Wine image is pinned by digest so a changed
  upstream image cannot run unnoticed with the source.
- [Errors and logs] No findings. Command output is the build's own; `gh api` errors carry no token.
- [Concurrency] OUT OF SCOPE. Two simultaneous runs of one version could race on the draft; the
  command has one operator and no lock, matching `pyry-release`'s single-operator use. Revisit only if
  it happens.
- [Threat model] A compromised npm dependency runs during `npm ci` on the Mac and in the container.
  This is the same exposure as every dev build; the lockfile pins versions. Release signing, which
  would let the updater reject a tampered feed, is out of scope per the ticket.

**Reviewer:** builder (self-review per `builder/security-review.md`), run by hand in an interactive
Claude Code session
**Date:** 2026-10-06
