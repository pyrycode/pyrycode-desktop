# Development verification

Shared lessons for refining, building and reviewing Pyrycode Desktop.
These were brought across from the active local-memory index on 2026-09-11.
Check current code before applying an observation about a particular implementation.

| Topic | Reference |
| --- | --- |
| [What each test tier proves](development-verification-what-each-test-tier-proves.md#what-each-test-tier-proves) | Static, mounted and live proof boundaries, with counted regression evidence. |
| [Evidence that cannot pass too early](development-verification-evidence-that-cannot-pass-too-early.md#evidence-that-cannot-pass-too-early) | Positive processing barriers and nonvacuous absence assertions. |
| [Layout and input](development-verification-layout-and-input.md#layout-and-input) | Measured layout, native input, focus and capture verification. |
| [Live-test diagnosis](development-verification-live-test-diagnosis.md#live-test-diagnosis) | Executable identity, credential ownership and counted live evidence. |

## Source and contract checks

Search the source and its production callers before estimating a change.
Search both `src/` and `e2e/`. If the code graph reports that it is not initialized,
use text search and file reads. An unavailable index is not evidence of no callers.

Comments wrap across lines. Search the concept as well as the identifier.
Removing the final consumer can invalidate comments that never name it.
A contract inherited from another consumer needs checking against the new sinks.
An untrusted string used as a Map key does not have the prototype behaviour of an
ordinary object key. Review the actual data structure.

The daemon's handling of unmatched event types differs from its explicit ignored
list. Read the individual dispatch arms before generalising a phrase across them.
On the client, trace the actual inbound parser rather than trusting an old symbol name.
A shared model-row lookup can govern behaviour as well as display text.
Read all callers before broadening what an empty identifier means.

## Review and document hygiene

The pipeline uses one GitHub identity. A reviewer cannot approve or request changes
on its own account's pull request. Post the verdict as a comment and use the role's
issue labels. Keep the issue number separate from the pull request number.

Scratch directories keyed only by pull request can contain an earlier rework run's
review. Read existing evidence and use a distinct file for the new verdict.

Inspect the end of every added Markdown document for tool-call scaffolding.
The documentation guard scans feature docs and cannot prove that every changed
Markdown file is clean. A successful rendered preview can also hide stray tags.

CodeGraph's existing ignore patterns do not cover every runtime artifact. Check
`.codegraph/codegraph.lock`, `.codegraph/writer.pid`, `.codegraph/codegraph.db-shm`
and `.codegraph/codegraph.db-wal` against both the tracked diff and
`git check-ignore -v`; an ignored file can still be tracked. Repository-local Git
exclusions keep these generated lock/PID and mutable SQLite sidecar files out of
automatic commits while preserving the running index's local files.

A listener-count warning may predate the change. Compare against the base before
calling it the cause. Browser console events need explicit collection when the
existing fixture does not forward them.
