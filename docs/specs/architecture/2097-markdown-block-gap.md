## Files read

- `src/renderer/src/screens/conversation/conversation.css` → `.bubble__markdown`: shared block gap and direct-child margin reset; metadata and attachments have separate margins.
- `src/renderer/src/screens/conversation/StreamingAssistantMarkdown.tsx` → `StreamingAssistantMarkdown`: fragments keep frozen and pending blocks direct children.
- `src/renderer/src/screens/conversation/MarkdownReader.tsx` → `MarkdownReaderView`: reuses the markdown container.
- `e2e/assistant-whitespace.spec.ts` → `readRhythmMetrics`: measures adjacent blocks and container edges; separate nested measurements retain the 8 px contract.
- `e2e/markdown-reader-menu.spec.ts` → reader menu scenario: loaded note provides real reader layout coverage.
- `docs/knowledge/features/assistant-markdown-renderer.md` → rendering boundary: CSS owns block rhythm; static tests cannot measure layout.
- `docs/knowledge/features/development-verification.md` and root `CLAUDE.md` → focused Linux checks and existing fake Electron fixture.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-4443 (Assistant), https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-4441 (User). Assistant design context and screenshot show a column with 16 px between content blocks. Map the markdown gap to `--space-4`; the refined ticket explicitly preserves the separate metadata/attachment margins.

## Change

Change the shared markdown column gap from `--space-2` (8 px) to `--space-4` (16 px), and update the nearby spacing comments. Keep zero direct-child block margins, nested list/quote rhythm and metadata/attachment margins. This one independently useful behavior reaches settled replies, streaming fragments and the reader without new types, state, failure modes or consumer changes. No overlapping in-flight branches were found. Estimated total written work: approximately 100 lines, one production file, two acceptance behaviors; all sizing limits hold.

## Testing strategy

- Update the existing settled block-gap measurement to require 16 px and flush edges; retain nested list/quote measurements at 8 px.
- Add a real streaming multi-block measurement and repeat after settlement; measure the loaded reader's blocks and edges.
- Watch focused spacing checks fail at the old 8 px gap before changing CSS.
- Run focused conversation, markdown, streaming and reader renderer tests, pre-verify and build after the final main merge; run only affected spacing/reader e2e scenarios on Linux.
- Capture streaming/settled messages and the reader at 1280×800 and 800×800, then compare with Figma. Screenshots stay under `/tmp/builder-2097/`.

## Revisions

2026-10-18 — Verifier finding 1: the complete application gate and its branch retry lost
the Electron inspection context while reading `savedReads` and installing its diagnostic
listener. Both launch-fate records show the resumed app alive with clean teardown.
This is the documented inspection-acknowledgement failure, not evidence of a markdown
layout failure; its upstream Electron trigger remains unknown.

Extract the saved-traversal counter setup into `installSavedTraversalReads` in
`e2e/fixtures/savedTraversalReads.ts`. Publish a listener-identity marker and preserve
the counter on repeated/late setup. Confirm actual registration with read-only inspection
before opening the conversation. Permit at most two guarded installations, each followed
by three inspection attempts; only transient acknowledgement loss plus confirmed absence
permits another installation. Unavailable inspection and unrelated errors fail setup.
Use `readMainProcess` in five-second polls for both traversal counters. Keep the release
action single-shot and retain every existing history, scroll, anchor and request assertion.
Attach counted setup evidence to each traversal case.

Controlled tests execute the serialized callbacks with an IPC fake: loss before/after
effect, lost/exhausted confirmation, late setup, missing/changed listeners and fatal errors.
Run the complete thread-activation spec and focused spacing/reader scenarios on Linux;
the dispatcher must obtain a complete accepted application gate before approval.
The repair adds no product behavior, state, exported types or production files. Combined
written work remains below 400 lines, with two acceptance behaviors and no consumer cascade.
The overlap with #2079 changes a different test's subscription; no dependency is needed.

Linux validation: the extracted original setup produced 9 failed and 2 passed controlled
tests; the final setup has 12 passed, with 34 passed across setup/read/held-read helpers.
All 585 focused renderer tests, pre-verify's five checks, docs guard and build passed.
The fresh three-worker browser group executed 37 tests, all passed, no skips/retries.
The reported case then executed 10 repetitions, all passed, no skips/retries; one saved
listener confirmation lost its context and recovered on inspection two with one installation.
All repetition launch-fate records show clean exits and no teardown failures.
Reports: `/tmp/builder-2097/rework-final.json` and `rework-repeat-final.json`.
The preliminary concurrent browser run is retained separately as `rework-specs.json`:
pre-verify's Node ABI rebuild overlapped Electron and caused seven storage failures;
the accepted focused evidence above follows completed Electron native preparation.
Complete dispatcher application acceptance remains pending before approval.
