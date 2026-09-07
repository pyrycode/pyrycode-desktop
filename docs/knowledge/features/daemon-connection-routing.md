# Daemon connection — per-server routing

Part of [Daemon connection](daemon-connection.md); see that document for what the package does, its
edge cases and its links.

Until #1117 the composition root held exactly **one** `DaemonConnection` for the whole app. #1117 made
the *set* of live connections follow the set of paired records; #1118, #1119, #1120 and #1129 then
routed everything that used to reach `registry.active` (whichever server was paired most recently) to
the specific connection each one actually belongs to. #1129 was the last consumer —
`uploadAttachment`, arriving on its own IPC channel rather than through the command switch — and its
landing retires the stand-in outright: `const connection = registry.active`
(`src/main/index.ts`) no longer exists anywhere in the composition root.

**One command left this family after ship: [#1092](https://github.com/pyrycode/pyrycode-desktop/issues/1092)
moved `interrupt` off #1120's server-scoped router onto #1118's conversation-to-server index**, once the
daemon could carry a conversation id on the frame (pyrycode#2103) — see [Server-scoped command routing
(#1120)](daemon-connection-server-scoped-routing.md) § The four plain call sites for the departure, and
[Interrupt envelope § Naming the conversation (#1092)](interrupt-envelope.md#naming-the-conversation-1092)
for where it landed.

## Where the detail lives

Each child document below keeps the heading it had here, so an existing `#anchor` into this document
still resolves once the link points at the right file. Split out 2026-09-07 to keep this document under
the size cap.

- [The connection registry (#1117)](daemon-connection-registry.md) — one `DaemonConnection` per stored
  paired record, reconciled against the store on every pairing/unpair signal; the `registry.active`
  stand-in every later router closes a gap on.
- [Conversation routing (#1118)](daemon-connection-conversation-routing.md) — the
  `Map<conversation id, server id>` index, learned off stamped daemon events, that routes the ten (now
  eleven, since #1092) entry points naming a conversation.
- [Correlation routing (#1119)](daemon-connection-correlation-routing.md) — the sibling index routing
  the five commands keyed by a modal, question-batch or session id instead of a conversation id.
- [Server-scoped command routing (#1120)](daemon-connection-server-scoped-routing.md) — `serverRouter.ts`,
  the stateless resolver for commands about a *whole server*; five members today, after `interrupt` left
  in #1092.
- [The attachment upload names its server, and the stand-in retires (#1129)](daemon-connection-attachment-upload-routing.md) —
  the last consumer of `registry.active`, and the ticket that deletes the stand-in.

## Related

- [Daemon connection](daemon-connection.md) — the parent document.
- [Command channel](command-channel.md) — the `RendererCommand` union members these routers dispatch.
- [Interrupt envelope](interrupt-envelope.md) — the one command that moved between two of these routers
  after ship (#1092).
