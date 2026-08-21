# #635 — Re-anchor the comments that cite the removed screen-snapshot modules

Comment-only sweep at the tail of #604's removal series (#618–#622). No production statement changes,
no test changes, no behaviour change. Every anchor below was **measured on `main` at `c94747b`** —
the commit your branch forks from — so they are exact rather than inherited. Re-grep anyway if you
rebase.

## Design source

N/A — comment-only sweep; nothing user-visible changes. The visual-fidelity check is intentionally
skipped.

## Files to read first

The sweep's own targets are listed in the triage table; these are the files you need for the
**decisions**, not for the edits.

- `src/main/transport/inboundMessage.ts:443-457` — `parseSessionSettingsPayload`'s docstring + body.
  The first of the two security-sensitive sites. Extract: all six fields go through
  `requireString`/`requireBoolean`/`requireNumber`, so "every field is required-present" is TRUE and
  must survive your edit verbatim.
- `src/main/transport/inboundMessage.ts:466-484` — `parseAssistantDeltaPayload`. Same shape, four
  required fields. The second security-sensitive site.
- `src/main/transport/inboundMessage.ts:486-491` — **`parseTurnEndPayload`. Read this one closely.**
  Its docstring already opens `Fail-closed: three required strings (…)` with **no comparative at
  all**. This is the live, in-file, already-committed form the two sites above should converge on.
- `src/main/transport/inboundMessage.ts:1255-1275` — the `session_settings` and `assistant_delta`
  decode arms. Extract: `assistant_delta` (below) narrows before logging exactly as
  `session_settings` does; that is the property the dangling "Mirrors the … arm above" cites.
- `src/renderer/src/store/runConfigStore.ts:50-57` — `setSnapshot`. Extract: its own docstring says
  "replaces the whole `snapshot` object unconditionally … no merge, no dedupe". This is the verified
  target for `announcedModelStore.ts:103` if you re-anchor rather than restate.
- `src/renderer/src/store/queueBridge.ts:76-84` — `QueueData`'s effect. Extract: "the returned off
  handle is the effect cleanup, so a StrictMode double-mount nets exactly one live listener". This is
  the verified target for `announcedModelBridge.test.ts:210`.
- `src/renderer/src/App.tsx:123-129` — the seven mounted headless leaves. Extract:
  `ScreenSnapshotData` is **not** among them; `AnnouncedModelData` sits alongside `QueueData`,
  `RelayLinkData`, `BackgroundTaskRosterData` and three others. This is what makes
  `announcedModelBridge.ts:70` a false fact rather than a dangling name.
- `docs/knowledge/codebase/618.md` — the method and its trap: scope by grepping the removed names,
  never by working a list; verify the re-anchor target for the **property actually cited**.
- `docs/knowledge/codebase/637.md` — the direct precedent: case-insensitive grep, the allowlist, and
  the comment-stripped residue diff.
- `docs/specs/architecture/637-requestsnapshot-comment-reanchor.md:205-215` — #637's residue-diff
  formulation of the comments-only AC.

**Codegraph note:** `codegraph_context` returns symbol locations only — it parses code, not comments,
so it cannot see a single site in this sweep. The grep below is the authoritative scoping tool here,
which is the documented fallback case, not a shortcut.

## Context

#604's removal series took the screen-snapshot feature out consumer-first and is fully landed.
Surviving modules still cite the removed store, bridge, container, wire payload and parser as their
design precedent. Those comments carry real rationale — why `announcedModelStore` is a dedicated
store, why the inbound parsers are required-present — so the fix is to keep the rationale and repair
the citation, not to delete the comments.

The load-bearing distinction, and the reason this ticket is `security-sensitive`: **#622 removed this
client's *modeling* of `screen_snapshot`; it did not remove the verb from the daemon.** A comment that
says the daemon refuses a screen snapshot when there is no terminal is still true and still explains
why a surviving arm exists. A comment that says *this client* still reads it is false. The sweep must
tell those apart rather than applying one blanket rule.

## Design

### The triage rule

Every site falls into one of five classes. Apply the class, not a global find-and-replace.

| Class | Shape | Action |
|---|---|---|
| **A** | Dead name sits beside a **live co-exemplar** | Drop the dead name. Keep the survivor. Invent nothing. |
| **B** | Dead name is the only exemplar, but the sentence **already states the property in full** | Drop the dangling comparative; keep the substance. Preferred over swapping. |
| **C** | Dead name is the **only statement** of the property | Re-anchor to a target *verified at the target* to carry that property. |
| **D** | Comment asserts a **fact about this client** that is now false | Correct the fact. |
| **E** | Comment names the **verb** as daemon behaviour or history | Leave byte-identical. |

**Class A carries a trap:** where a citation pairs names with issue refs positionally
(`the screenSnapshotStore / runConfigStore precedent, #323 / #187`), dropping the name must drop
**its** ref too. `#323` was the screen-snapshot ticket; `#187` is runConfigStore's. Leaving `#323 / #187`
behind a single surviving name silently mis-attributes it.

**Prefer B over C.** Where the sentence already carries the property, a swapped-in name adds nothing
and risks a false claim. #637 reached the same outcome from the opposite direction — its comparative
was un-re-anchorable by construction and had to be restated. Here restatement is not a fallback; for
the two decode sites it is strictly the better answer, because it converges the docstrings on
`parseTurnEndPayload:487`, which already has exactly that form.

### The 20 sites

Edit candidates, all measured at `c94747b`.

| # | Site | Cited text (abbreviated) | Class | Resolution |
|---|---|---|---|---|
| 1 | `store/announcedModelStore.ts:7` | `the screenSnapshotStore / runConfigStore precedent, #323 / #187` | A | Keep runConfigStore + `#187`; drop the dead name **and `#323`** |
| 2 | `store/announcedModelStore.ts:76` | `the screenSnapshotStore / runConfigStore idiom` | A | → `the runConfigStore idiom` |
| 3 | `store/announcedModelStore.ts:103` | `(exactly as screenSnapshotStore behaves; #560 memoises…)` | B | Sentence already states fresh-identity-per-write → drop the comparative, keep `#560 memoises…`. If you re-anchor instead, `runConfigStore.ts:50-51` is verified |
| 4 | `store/announcedModelBridge.ts:5` | `sessionIdBridge (#259) / queueBridge (#293) / screenSnapshotBridge (#323)` | A | Drop `/ screenSnapshotBridge (#323)`; two survivors remain |
| 5 | `store/announcedModelBridge.ts:27` | `(the screenSnapshotBridge / queueBridge idiom…)` | A | → `(the queueBridge idiom…)` |
| 6 | `store/announcedModelBridge.ts:32` | `the sessionIdBridge / queueBridge / screenSnapshotBridge posture` | A | Drop the dead name; two survivors remain |
| 7 | `store/announcedModelBridge.ts:70` | `mounted app-level in App.tsx, alongside ScreenSnapshotData` | **D** | False as of #618 — `App.tsx:123-129` has seven leaves, none of them `ScreenSnapshotData`. Name a live sibling (`QueueData`, already cited at `:74`) or drop the `alongside` clause |
| 8 | `store/announcedModelBridge.test.ts:13` | `(the screenSnapshotBridge / sessionIdBridge idiom)` | A | → `(the sessionIdBridge idiom)` |
| 9 | `store/announcedModelBridge.test.ts:207` | `the ScreenSnapshotData / QueueData idiom` | A | → `the QueueData idiom` |
| 10 | `store/announcedModelBridge.test.ts:210` | `against the ScreenSnapshotData off-handle-as-cleanup idiom` | **C** | Only statement of the property → re-anchor to `QueueData`, **verified** at `queueBridge.ts:76-84` |
| 11 | `store/announcedModelStore.test.ts:10` | `screenSnapshotStore.test / runConfigStore.test idiom` | A | → `runConfigStore.test idiom` |
| 12 | `store/serverInfoLoader.ts:49` | `the modalBridge / screenSnapshotBridge precedent` | A | → `the modalBridge precedent` |
| 13 | `shared/wire/types.ts:216` | `reading these values off \`ScreenSnapshotPayload\`, which still carries copies` | **D** | The dead name is a removed *client type*; the daemon's reply genuinely still carries copies. Convert the citation to the **verb** — "off the daemon's `screen_snapshot` reply" — which keeps the history true and drops the dead export |
| 14 | `shared/wire/types.ts:249` | `unlike \`screen_snapshot.text\` it is NOT dropped downstream` | **D** | See "The one open call" below |
| 15 | `transport/inboundMessage.ts:445` | `Fail-closed like parseScreenSnapshotPayload: every field is required-present…` | **B** ⚠ | Drop `like parseScreenSnapshotPayload`, keep `Fail-closed:` + the entire following clause verbatim. Matches `parseTurnEndPayload:487` |
| 16 | `transport/inboundMessage.ts:469` | same opener, `assistant_delta` | **B** ⚠ | Identical treatment |
| 17 | `transport/inboundMessage.ts:1259` | `Mirrors the screen_snapshot arm above.` | **D** | No arm above — asserts something about this client that is false. The `assistant_delta` arm **below** carries the identical narrow-before-log posture (`:1268-1274`, verified) → `Mirrors the assistant_delta arm below.` |
| 18 | `screens/conversation/runConfigSnapshot.ts:9` | `#491 moved it off \`screen_snapshot\`. That reply is a picture of the terminal…` | **E** | **Leave byte-identical.** Daemon behaviour + history, still true |
| 19 | `screens/conversation/runConfigSnapshot.ts:14` | `The live-screen view still uses \`screen_snapshot\`; only the sheet moved.` | **D** | False — the live-screen view was removed by #618. Correct the fact; do not tidy the surrounding sentence |
| 20 | `shared/ipc/events.ts:87` | `a screen_snapshot is refused outright whenever there is no terminal to photograph` | **E** | **Leave byte-identical.** Still true of the daemon, and it is the reason the surviving `session_settings` arm exists |

Net: **18 sites edited, 2 triaged-to-leave**, across 9 files.

### The two security-sensitive sites (#15, #16)

Both open `Fail-closed like parseScreenSnapshotPayload:` in the inbound decode path. A swap to a
parser that is *not* required-present would put a false security claim in a decode docstring — that
risk is the whole reason for the label.

The resolution avoids the risk rather than managing it: **delete the two dangling words, change
nothing else.** The clause that follows the colon is the actual security statement, it is verified
true against both bodies, and it must survive verbatim:

- `parseSessionSettingsPayload` — six fields via `requireString` ×3, `requireBoolean` ×1,
  `requireNumber` ×2. No defaulting, no truthiness check. "Every field is required-present" is TRUE.
- `parseAssistantDeltaPayload` — four fields via `requireString` ×3, `requireNumber` ×1. TRUE.

Do **not** cross-anchor these two to each other. Each currently cites the same dead ancestor, so a
mutual swap yields "A is fail-closed like B" / "B is fail-closed like A" — circular, and neither
carries independent authority.

### The one open call (#14)

`types.ts:249` reads: `` `text` is the render payload (#203), carried verbatim; unlike
`screen_snapshot.text` it is NOT dropped downstream. See #199. ``

This is the only site where the class is genuinely arguable, and it was named by neither the original
body nor #622's handoff — it exists because the sweep is grep-scoped rather than list-scoped.

The contrast is a claim about **this client's** handling: `screen_snapshot.text` *was* dropped
downstream here, and that path no longer exists, so a reader cannot verify the contrast against
anything in the tree. **Recommended:** drop the contrast clause, keeping
`` `text` is the render payload (#203), carried verbatim. See #199. `` The clause's job was to say
"this one is not dropped", which the surviving text already says.

If you judge otherwise, the alternative is to keep it as explicit history by attributing it — but do
not leave it in its current form, where it reads as a live comparison to code that is gone.

### Final-state grep contract

AC1 cannot be "the grep returns zero" — two triage-to-leave sites and seventeen deliberate test pins
legitimately still name the verb. Split the assertion in two:

1. **Export names → zero, with one allowed hit.** Case-insensitively grep `screenSnapshotStore`,
   `createScreenSnapshotStore`, `selectScreenSnapshot`, `initialScreenSnapshotState`,
   `useScreenSnapshotStore`, `ScreenSnapshotData`, `ScreenSnapshotState`, `screenSnapshotBridge`,
   `translateScreenSnapshot`, `subscribeScreenSnapshot`, `ScreenSnapshotPayload`,
   `parseScreenSnapshotPayload`, `snapshotReceived`, `screenSnapshotReceived`, `requestSnapshot`,
   `buildRequestSnapshot`, `RequestSnapshotEnvelope` over `src/` and `e2e/`. Expected: exactly one
   hit, `src/shared/ipc/commands.test.ts:156` (allowlisted — see below).
2. **The verb → an enumerated survivor set.** Grep `screen_snapshot` separately. Expected survivors:
   `runConfigSnapshot.ts:9`, `events.ts:87`, `types.ts:216` (converted to the verb per #13),
   `inboundMessage.test.ts` ×11, `daemonConnection.test.ts` ×6. Anything else is a miss.

Baseline for the whole sweep: **38 case-insensitive hits across 12 files on `c94747b`** — 20 edit
candidates in 9 files, 18 allowlisted in 3.

### Allowlist — must be byte-identical to `main`

Assert this **separately** from the sweep grep, per AC3. A grep-driven sweep walks straight into all
eighteen.

- `src/shared/ipc/commands.test.ts:156` — **not a comment.** The dead name is the test's own literal,
  asserting `isRendererCommand({ type: 'requestSnapshot', … })` is `false`. #620 left it deliberately;
  #637 allowlisted the same line.
- `src/main/transport/inboundMessage.test.ts` (11 sites) and `src/main/daemonConnection.test.ts`
  (6 sites) — #622's regression pins. They name the verb **on purpose**, to prove it is no longer
  modeled, and their comments already describe the removal ("Retained after #622 unmodeled the…").
  Editing them destroys the pin.

Suggested assertion: `git diff main -- <the three files>` is empty.

## Error handling

Not applicable in the runtime sense — no code path changes. The failure modes are editorial:

- **False security claim** — a re-anchored comparative pointing at a parser that defaults a field.
  Prevented structurally by resolving #15/#16 as deletions rather than swaps.
- **Destroyed regression pin** — an allowlisted test comment swept. Prevented by asserting the
  allowlist separately.
- **Deleted true history** — applying the blanket rule to a Class E verb site. Prevented by the
  triage table naming both E sites explicitly.
- **Mis-attributed issue ref** — dropping a name but leaving its paired `#NNN`. Prevented by the
  Class A trap note.

## Testing strategy

No new tests. This ticket adds no assertions and changes no behaviour; the existing suite is the
regression net and must stay green with nothing skipped.

- `npm test`, `npm run build`, and the fake-daemon e2e gate — all green, nothing skipped (AC5).
- **Allowlist byte-identity** (AC3) — asserted as its own step, separately from the sweep grep.
- **Comment-stripped residue diff** (AC4) — the measurement that turns "comments only" from an
  assertion into evidence. Strip `//` line comments, `/* */` blocks and leading ` * ` lines from every
  changed file at both `main` and `HEAD`, then diff the residue. An empty residue is the deliverable.

  Two hard-won constraints on the stripper, both from #637:

  1. **Do not use `ts.createScanner` as the "rigorous" stripper.** With no parser driving
     `reScanTemplateToken`, backticks desync it — it leaked 24 comment lines into its own residue and
     reported a false positive on an all-comment diff. A string-aware **line** stripper leaked zero
     and needs no `node_modules`.
  2. **Validate the stripper before believing an empty residue** — an empty result is vacuous if the
     stripper emits nothing. Mutate a code line → the residue must detect it. Mutate a comment → it
     must not. Cross-check with a machinery-free one-liner: every `+`/`-` line in `git diff -U0`
     starts with `//`, `*`, or `/*`.

  `noUnusedLocals` is off in this repo, but the residue diff catches an orphaned import for free —
  import lines survive stripping.

## Open questions

1. **#14 (`types.ts:249`)** — the recommendation is to drop the contrast clause. Resolve at
   implementation time against the surviving sentence; the one unacceptable outcome is leaving it
   unchanged.
2. **#7 and #17 wording** — both need a live sibling named or the comparative dropped. Either is
   correct; pick one and stay consistent. Do not introduce an exemplar that appears nowhere else in
   the file.

## Scope self-check

Production source files with modified content: **7** — `announcedModelStore.ts`,
`announcedModelBridge.ts`, `serverInfoLoader.ts`, `types.ts`, `inboundMessage.ts`,
`runConfigSnapshot.ts`, `events.ts`. This trips the ≥5-file gate and the >3-file red line.

**Held at S as an explicit irreducible-S exemption, not a rationalization of the count.** The count is
7; it is not being re-counted downward. Two independent grounds:

1. **No valid split exists.** AC1 is a tree-wide grep assertion. Any child scoped to a subset of files
   cannot state it, so a file-wise split yields children none of which carry the deliverable, plus a
   fourth ticket to assert AC1 over the union — strictly worse than one ticket, and PO would return it.
   The red lines assume a split that bounds edit cost; here the split bounds nothing and destroys the
   acceptance criterion.
2. **Measured precedent, larger, same shape, same repo.** #637 was verified for this spec by direct
   measurement rather than taken from the body: `git diff --stat 8737dea 4404a47` = **13 files,
   31 insertions / 31 deletions**, shipped as a single S with a clean review. This ticket is smaller:
   9 files, ~18 single-line edits.

The cost structure the red lines proxy for is absent — zero new types, zero new tests, zero reject
branches, zero call-site cascade, zero behaviour. The turn cost is ~18 triage decisions, and this spec
pre-resolves all 18 with targets already verified at the target, which is the documented
push-work-upstream pattern rather than a deferral.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The sweep touches two docstrings on the inbound decode path
  (`parseSessionSettingsPayload`, `parseAssistantDeltaPayload`) but changes no guard body, no
  `require*` call, and no `throw`. The renderer↔main boundary is untouched. The residue diff (AC4) is
  the enforcing evidence: every guard in this file returns a value `typecheck` cannot distinguish, so
  the type-checker alone cannot prove no guard moved — the residue diff can, and is therefore a
  security control here, not a tidiness check.
- **[Tokens, secrets, credentials]** Not applicable — no token, key, or credential is named, stored,
  logged or moved. No storage decision is made or changed.
- **[File / storage operations]** Not applicable — no filesystem path is constructed or read.
- **[Inter-process / Electron attack surface]** No findings. No `contextBridge` API, no `ipcMain`
  channel, no `webPreferences`, no protocol handler is added or altered. `events.ts` is edited only in
  the sense that site #20 is triaged **to leave**, so the IPC event union is byte-identical.
- **[Cryptographic primitives]** Not applicable — no crypto, no RNG, no Noise code in scope.
- **[Network & I/O]** Not applicable — no socket, timeout, frame cap or URL validation in scope.
- **[Error messages, logs, telemetry]** **Reviewed, one deliberate constraint.** Site #17 sits in the
  `session_settings` decode arm's comment, which documents the content-free logging discipline
  ("Narrow BEFORE logging so a malformed reply throws first and leaves no record. No decoded field is
  ever logged"). That discipline is enforced by the code below the comment, which is untouched. The
  re-anchor must not weaken the comment's description of it: `assistant_delta` was chosen as the new
  target specifically because it carries the *same* narrow-before-log posture (verified at
  `:1268-1274`), so the comparative stays accurate. Pointing it at an arm that logs before narrowing
  would document a discipline the code does not have.
- **[Concurrency]** Not applicable — no async task, listener, timer or `AbortController` in scope.
- **[Threat model alignment]** **The label's actual finding, resolved by design.** The hostile-daemon
  threat is met in this file by fail-closed parsing, and sites #15/#16 are the docstrings that record
  it. A re-anchor to a parser that defaults any field would leave a docstring asserting a fail-closed
  posture the parser does not have — a future reader (or reviewer) would then trust a guarantee that
  is not enforced. This is a documentation-integrity failure with a security consequence, and it is
  the reason for the `security-sensitive` label. Resolved **structurally rather than by care**: the
  design deletes the two dangling words instead of swapping in a name, so there is no target whose
  posture could be wrong, and the surviving clause was verified true against both parser bodies
  (six and four required fields respectively, no defaulting). The circular A↔B cross-anchor is
  explicitly ruled out for the same reason.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-21
