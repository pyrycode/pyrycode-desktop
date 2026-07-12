# Spec #303 — Decouple the `saveDebugBundle` no-byte-leak assertion from temp-path noise

**Ticket:** #303 · `bug` · `size:xs` · `security-sensitive`
**Scope:** test-only. `src/main/saveDebugBundle.test.ts`. Zero production files.

## Files to read first

- `src/main/saveDebugBundle.test.ts:74-85` — the flaky test ("rejects (catchably) when dir does not exist…"). The fix site is the per-byte loop at **:84**. Read the whole `it` block to see the three assertions that stay (`:79-81`) and the one that changes (`:82-84`).
- `src/main/saveDebugBundle.test.ts:24-29` — `missingDir()` builds the failing path from `mkdtemp(join(tmpdir(), 'pyry-bundle-'))`. This is the source of the path noise; extract that the random suffix is what the leaked rejection message embeds.
- `src/main/saveDebugBundle.ts:46-60` — production `saveDebugBundle`. Extract the load-bearing fact this test guards: on a non-`EEXIST` errno it **re-throws the original fs error unchanged** (`:56`), whose message carries only the *path*, never `bytes`. `bytes` never enters an `Error`. Production is **not** touched by this ticket.
- `src/main/debugBundleDownload.test.ts:88-92` — the sibling #118 orchestrator's own content-non-leak assertions (`not.toContain('EACCES')`, `not.toContain('permission denied')`). House idiom for "the surfaced error must not carry X"; mirror its shape and comment density.
- `src/main/fileSecretPersistence.test.ts:16-20` — the sibling `mkdtemp` harness this file's header comment references; confirms the temp-dir-per-test + `afterEach` cleanup pattern is house style (nothing to change there).

## Context

`src/main/saveDebugBundle.test.ts:74` intermittently fails on a green diff. The test writes `bytes = new Uint8Array([0x11, 0x22, 0x33])` — decimals **17, 34, 51** — provokes a rejection by writing into a non-existent directory, then asserts the rejection text leaks none of the byte values via:

```ts
for (const b of bytes) expect(text).not.toContain(String(b))   // checks bare "17" / "34" / "51"
```

`text` is `message + " " + code`, and `message` embeds the full failing path, e.g. `…/pyry-bundle-34GTBc/does-not-exist/…`. **`mkdtemp` appends 6 random `[0-9A-Za-z]` characters** (verified empirically — charset is exactly `[0-9A-Za-z]`, no punctuation). When that suffix — or any digits elsewhere in the OS `tmpdir` path — happens to contain the 2-digit substring `"17"`, `"34"`, or `"51"`, the bare-decimal `not.toContain` fires on **path noise**, not on a real leak. First observed 2026-07-12 during QA on PR #302 (#299), whose diff has zero import-graph overlap with this module — confirming the flake is pre-existing.

The property the test legitimately guards is a **content-blindness invariant**: reassembled debug-bundle bytes (#116 — relay/daemon-originated, untrusted) must never leak into the rejection error the caller (#118) surfaces. Today production honours it (it re-throws the path-only fs error). The test is a **regression guard** against a *future* change that interpolates `bytes` into the thrown error. This ticket makes the guard robust — it must keep its teeth, not lose them.

**Rejected non-fix (from the ticket, do not do this):** widening the `mkdtemp` prefix. `mkdtemp` appends 6 random alphanumerics for *any* prefix, so digit collisions remain possible. The prefix is not the lever.

## Design

The root defect is the *representation* being checked, not the byte values. A bare 1–2 digit decimal (`"34"`) is a subset of the `mkdtemp` charset `[0-9A-Za-z]`, so it can coincidentally appear in an OS-generated path segment. **No single-byte decimal (0–255 → 1–3 digits, all in `[0-9]`) is ever structurally immune** — which is exactly why the "widen the prefix" and "pick different byte values" levers both fail. Immunity requires checking a rendering that carries a **non-alphanumeric delimiter** a temp path can never contain.

The natural string coercion of a `Uint8Array` is the comma-joined decimal list:

```
String(new Uint8Array([0x11, 0x22, 0x33]))  ===  "17,34,51"
```

This is *precisely* the string a `` `…${bytes}…` `` interpolation produces (`Uint8Array.prototype.toString` → `Array.prototype.toString` → comma-join) — i.e. the exact leak AC-2 names ("a future change that interpolated `bytes` into the thrown error"). It contains commas, and commas cannot appear in a `mkdtemp` suffix (or any path segment produced here), so it can never collide with path noise.

**The change — replace `saveDebugBundle.test.ts:82-84` only.** Contract sketch (the developer writes the final form in-file; keep the load-bearing comment):

```ts
const text = `${(err as Error).message} ${(err as NodeJS.ErrnoException).code}`
// A leaked bundle surfaces as the bytes' natural coercion (comma-joined decimals),
// the exact output of a `${bytes}` interpolation. mkdtemp suffixes are [0-9A-Za-z] only,
// so this comma-delimited rendering can never collide with OS temp-path noise — unlike the
// old bare per-byte "34" check, which matched e.g. "pyry-bundle-34GTBc". Guards message AND code.
expect(text).not.toContain(String(bytes))            // String(bytes) === "17,34,51"
```

- The three prior assertions (`:79` `instanceof Error`, `:81` `code` truthy, and the `text = message + " " + code` concatenation) are **unchanged** — the guard still covers both `message` and the errno `code` per AC-2.
- **Keep the byte fixture `[0x11, 0x22, 0x33]`.** Minimal diff, and `String(bytes)` is already delimiter-bearing. It is load-bearing that the fixture stays **≥ 2 bytes** so the coercion contains ≥ 1 comma; a single-byte fixture would coerce to a bare decimal and reintroduce the collision. State this in the comment or keep the array at three bytes as-is.

**Positive control (prescribed — the deterministic "teeth" proof).** Because this is a `security-sensitive` no-leak guard and the whole ticket risk is *fixing the flake while silently gutting the guard*, add one assertion proving the predicate discriminates — that `String(bytes)` is a real, non-empty needle a leak would trip:

```ts
// Positive control: the same predicate DOES fire when the rendering is present, so the
// negative assertion above is not vacuous (e.g. a future edit to `String(bytes)`).
expect(`bundle bytes: ${bytes}`).toContain(String(bytes))
```

This is the "different fabric" belt for the label's stochastic suspender: a deterministic in-test check that the no-leak assertion has teeth. It costs one line and directly discharges AC-2's "still genuinely fails if the byte values were to appear."

**Why not preserve a literal per-byte loop.** A per-byte check that stays immune is not expressible: a real `${bytes}` leak renders the array contiguously (`"17,34,51"`), and no per-element delimiter-wrapped token (`,17,`, `,51,`) matches the boundary elements of that contiguous string, while a bare-decimal token is exactly the collision we are removing. The whole-array contiguous rendering *is* the per-byte information, delimited and immune — it detects the byte values without the path coupling. Per the pipeline's Evidence-Based Fix Selection principle, we do **not** add speculative hex/space-joined-rendering checks: the observed and AC-specified leak shape is `${bytes}` (comma decimals); hex would require a deliberate `.toString('hex')` that has never been observed and is a different, out-of-scope defence.

## State + concurrency model

N/A — test-only assertion change. No store slice, no async task, no subscription, no teardown path is touched. The existing `afterEach` temp-dir cleanup (`:11-13`) is unchanged.

## Error handling

N/A for production — `saveDebugBundle.ts` is not modified. The test continues to exercise the real reject path: writing under `missingDir()` (a non-existent child of a real temp root) makes `writeFile(flag: 'wx')` fail with `ENOENT` (parent dir absent → not `EEXIST`), so production falls through to `throw err` at `saveDebugBundle.ts:56`. The rejection therefore carries a truthy errno `code` (`ENOENT`) and a path-only `message`. If the developer discovers an *actual* production leak while here, per AC-3 it is filed as a **separate ticket**, not fixed in this diff.

## Testing strategy

- Framework: `vitest`. The single edited `it` block (`saveDebugBundle.test.ts:74`) keeps its structure; only the no-leak assertion changes, plus the one positive-control line.
- Scenarios the edited test must still assert:
  - Rejection is an `Error` with a truthy errno `code` (unchanged).
  - `message + " " + code` does **not** contain `String(bytes)` (`"17,34,51"`) — the decoupled no-leak guard.
  - Positive control: a synthetic string embedding `${bytes}` **does** contain `String(bytes)` — proves the guard is non-vacuous.
- Determinism check the developer should reason through (no new test needed): the assertion outcome is now a function of `text` and `bytes` only, never of the `mkdtemp` suffix — a suffix containing `"17"`/`"34"`/`"51"` can no longer fail it.
- Regression teeth: mentally substitute a hypothetical `throw new Error(\`… ${bytes} …\`)` in production → `message` contains `"17,34,51"` → the negative assertion fails. Guard retained.
- QA gate (AC-4): `npm test`, `npm run typecheck`, `npm run build` all green. No new imports, no type surface change, so typecheck/build are unaffected by construction.

## Open questions

None. The fix is confined to one assertion + one comment + one positive-control line in one test file. No interface, no production behaviour, no fixture-value change required.

## Design source

N/A — not UI-visible; a test-assertion robustness fix with no rendered surface.

## Security review

**Verdict:** PASS

This ticket's entire subject *is* a security invariant (no relay/daemon-originated bytes leak into a surfaced error), so the pass centres on categories 7 and 9; the rest are structurally inapplicable to a test-only diff and are dispositioned below rather than waved through.

**Findings:**

- **[Error messages, logs, telemetry] No MUST/SHOULD FIX — the change *strengthens* this category.** The guarded invariant is that the bundle bytes never reach the caller-surfaced rejection (`message` + errno `code`). The old assertion had a false-negative-under-noise flaw (path collision) but *also* a latent weakness: bare per-byte decimals are a poor needle. The new needle (`String(bytes)` = the exact `${bytes}` coercion) is both collision-immune and a faithful model of the real leak shape, and the prescribed positive control makes the guard's teeth deterministic rather than assumed. Coverage of `code` as well as `message` is preserved (the `text` concatenation is unchanged). Concrete scenario walked: a future `throw new Error(\`…${bytes}…\`)` → `text` contains `"17,34,51"` → negative assertion fails. Guard holds.

- **[Threat model alignment — content-blindness] No findings.** The threat is a hostile-daemon / on-path-relay byte value surfacing in a client-visible error (the #116→#118 path handles untrusted bundle bytes). The design keeps a deterministic regression guard on that exact boundary and explicitly declines to weaken it. Per AC-3, an *actual* production leak (out of scope here) routes to a new ticket — named as out of scope, not silently absorbed.

- **[File / storage operations] No findings — production untouched.** `saveDebugBundle.ts`'s exclusive-create write (`flag: 'wx'`, `mode: 0o600`), its no-`mkdir` / no-overwrite guarantees, and its path-segments-are-module-constants (no untrusted input in the path) invariants are unchanged by this test-only diff. The test's own `mkdtemp` temp dirs are throwaway and `afterEach`-cleaned; no sensitive data at rest.

- **[Trust boundaries] No findings.** No boundary moves. `bytes` remains untrusted input to production; the test asserts it stays out of the trusted error channel.

- **[Tokens/secrets · Electron/IPC · Crypto · Network/I-O · Concurrency] Not applicable.** No token/secret, no IPC channel or `webPreferences`, no cryptographic primitive, no socket/frame/timeout, and no async task or shared-state mutation is introduced or altered — this is a one-file test-assertion edit with no new imports and no production change. Each category is inapplicable by construction, not merely unreviewed.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-12
