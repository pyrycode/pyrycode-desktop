# Conversation shell — tool row layout

The later redraw of the tool row: the shell command code block, the full-width bordered row, the header's
groups and run routing, and the expanded body's own drawing. Split 2026-09-05 into the six documents below
— each section had already grown past a single search chunk — to keep every one under the size cap.

Part of [Conversation shell](conversation-shell.md); see that document for what the screen does, its edge
cases and its links.

- [Shell command code block](conversation-shell-tool-row-code-block.md) — #780 promotes a `Bash` call's
  `command` into a `.code-block` leading the body, carved out of #706's field list on an exact tool-name
  test.
- [Full-width bordered tool row](conversation-shell-tool-row-box.md) — #722 restyles the chip from the
  mobile mock's hug-width pill to the desktop design's full-width bordered box.
- [Tool row header groups](conversation-shell-tool-row-header-groups.md) — #854 splits the chip into
  `.tool-row__left`/`.tool-row__right` and draws the chevron; also covers subagent nesting,
  retained expansion, descendant counts and visible-neighbour joins, plus the
  default-on conversation “Using tools: N” fold over adjacent roots.
- [Tool row header run routing](conversation-shell-tool-row-run-routing.md) — #855 makes the lead and
  subject runs independently switchable per call.
- [Tool row result count](conversation-shell-tool-row-result-count.md) — #856 draws the daemon's short
  result précis in the header's right group, bounded against a hostile string.
- [Tool row body: the box and its contents](conversation-shell-tool-row-body.md) — #1102 moves the box
  treatment onto the row itself; #1103 then draws the design's field-value box and bare-text result inside
  it.
