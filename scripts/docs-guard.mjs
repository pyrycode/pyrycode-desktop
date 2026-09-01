// Bounds the size of the package overviews under docs/knowledge/features and keeps
// their heading structure honest.
//
//   npm run check:docs
//
// Scans every .md file under docs/knowledge/features and exits non-zero on either of
// two faults: a file over the size cap, and a line that markdown reads as a heading
// only because a wrapped paragraph put a ticket reference first.
//
// Ported from pyrycode's cmd/docs-guard (Go) on 2026-09-01, rule-for-rule. Keep the
// two in step: the cap and the heading pattern are the same numbers and the same
// regex, and the dispatcher's src/docs-size.ts flags the same files to the
// documentation agent before it writes.
//
// **Why the size cap.** QMD is the search surface every agent uses. It cuts a document
// into roughly 900-token chunks and prefers to break at a heading, but it only looks
// for that boundary inside a narrow window around each cut point. When a document's
// sections run much larger than one chunk, no heading falls inside the window, the cut
// lands on a paragraph break, and the chunk carries no heading with it. Measured on
// pyrycode 2026-08-31: a 315KB overview was not returned by semantic, hybrid or
// keyword search for a topic whose canonical home was one of its own sections.
//
// **Why the heading check.** A paragraph line that wraps with a ticket reference
// first, "#834 gave the sidebar's host row...", is a top-level heading as far as
// markdown is concerned. It corrupts the document outline and moves the boundaries
// the chunker prefers to cut on.
//
// **Why code and not a rule in a prompt.** Both faults are produced by the
// documentation phase, which already carries a prose rule against them. A prose rule
// is advisory. A safety net for one must be a different fabric: deterministic code,
// not a second rule that shares the first one's blind spot.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// The only directory scanned. Decisions and the frozen per-ticket archive are
// deliberately out of scope: a decision record is written once and read by the ticket
// that owns it, and the archive is closed to writes, so flagging it would report a
// fault nobody is allowed to fix.
const FEATURES_DIR = 'docs/knowledge/features'

// The largest acceptable overview. Must agree with FEATURE_DOCS_CAP_BYTES in the
// dispatcher's src/docs-size.ts, which flags the same files to the documentation
// agent before it writes.
const CAP_BYTES = 50_000

// Matches a line markdown reads as a heading because it opens with a hash and a
// digit. A real heading always has a space after its hashes, so this cannot match one.
const FALSE_HEADING = /^#[0-9]/

function markdownFilesIn(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isDirectory() || !entry.name.endsWith('.md')) continue
    out.push(join(entry.parentPath ?? dir, entry.name))
  }
  return out.sort()
}

const problems = []

for (const path of markdownFilesIn(FEATURES_DIR)) {
  const bytes = statSync(path).size
  if (bytes > CAP_BYTES) {
    problems.push(
      `${path}: ${bytes} bytes, over the ${CAP_BYTES}-byte cap — split it at its ## headings, keeping the parent as a map`
    )
  }

  const lines = readFileSync(path, 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (FALSE_HEADING.test(line)) {
      problems.push(
        `${path}:${i + 1}: parses as a heading because it opens with a ticket reference — join it to the line above, or escape the hash`
      )
    }
  })
}

if (problems.length > 0) {
  console.error(`docs-guard: ${problems.length} problem(s)\n`)
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}
