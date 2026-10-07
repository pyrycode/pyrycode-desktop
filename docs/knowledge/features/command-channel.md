# Command channel

The typed renderer-to-main command pipe validates commands in preload and again
at the main boundary. It exposes one `window.pyry.sendCommand` capability while
keeping sockets, transport handles and keys in the background process.

- [Command members](command-channel-members.md): payload shapes and validation decisions.
- [Internals](command-channel-internals.md): constructor, guard, receiver, synchronous preload rejection and message-refusal attribution.
- [Security](command-channel-security.md): trust boundary, structured clone and content-free logging.
- [Related documents](command-channel-related.md): feature consumers, protocol builders and decisions.

## What it does

Gives the renderer **one typed function** (`window.pyry.sendCommand`) to ship a sealed command to the background process, and gives the background process **one typed seam** (`onCommand`) to receive those commands — after validating each at the untrusted→trusted boundary. Every command travels on a single IPC channel; the union carries modeled action payloads and client correlation IDs, with no token, key or raw-frame field. `ipcRenderer` itself never crosses to the window.

## The one way it diverges from the event half

The daemon-event channel flows main → renderer, where the **producer is our own trusted main process**, so it adds **no runtime validation**. The command channel flows renderer → main, and **the renderer is UNTRUSTED relative to the main process** — every IPC message crossing `ipcMain` is untrusted-to-trusted, even though both sides are our code. So this channel ships one thing its mirror does not: **`isRendererCommand`, a runtime guard applied synchronously by preload and independently by the main receiver at the boundary.** The guard is what makes the `RendererCommand` type on the handler **honest** — without it, the handler would claim `RendererCommand` while the runtime value is attacker-controllable `unknown`. Everything downstream of the guard receives a shape-validated command. Do **not** copy the event half's "trusted producer, no validator" reasoning here — there is no transitive trust across this boundary.

## Configuration and usage

- **Import from `src/main` / `src/preload`** by **relative** path: `import { COMMAND_CHANNEL, type RendererCommand } from '../shared/ipc/commands'`. These sides have **no `@shared` alias** (it exists only in `tsconfig.web.json` / the renderer vite block); `@shared/ipc/commands` fails the node typecheck and the main/preload build there. This is the load-bearing gotcha — see [#18 codebase notes](../codebase/18.md) and project memory `shared-alias-not-available-in-main-preload`.
- **Import from `src/renderer` (#11)** by alias: `import { sendMessageCommand } from '@shared/ipc/commands'`, which resolves. Test files (vitest) may also use `@shared/...` regardless of side.
- **Producer (#11):** the composer mints a `message_id`, assembles a `SendMessagePayload`, calls `sendMessageCommand(fields)`, and passes the result to `window.pyry.sendCommand(command)`.
- **Consumer (#11/transport):** the composition root calls `onCommand(ipcMain, handler)` **once** for the app lifetime and invokes the returned unsubscribe on teardown; the handler builds a `send_message` `Envelope` and hands it to the Noise transport.

## Edge cases and limitations

- **Single registration is the composition root's contract.** `onCommand` returns an unsubscribe (exact-listener `removeListener`), but registering it **once** and tearing it down is the caller's job. Registering twice would double-dispatch every command. In #17 the seam is unwired, so returning the handle is hygiene + testability; flag when #11 wires the first handler.
- **The guard must grow with the union — a correctness trap.** When connect/disconnect commands land, extend **both** `RendererCommand` **and** `isRendererCommand` in lockstep. A union member the guard doesn't validate is silently dropped at the boundary. Consider a type-only exhaustiveness tripwire (`Record<RendererCommand['type'], true>`) when the second member arrives, mirroring the renderer bridge's `assertNever` discipline.
- **Shape validation ≠ authorization.** `isRendererCommand` validates structure, not permission. Content authorization (may this user post to this conversation?) is the **daemon's** job over the authenticated Noise session — the guard is not an authz control.
- **Send is stateless.** `sendCommand` validates, issues one IPC message and returns; it has no queue or delivery guarantee. The [connection lifecycle](daemon-connection-lifecycle.md#disconnected-composer-message-delivery) owns the bounded composer payload hold.
- **Handler robustness is the consumer's job.** The receiver is a thin forwarder; it does not wrap `handler` in try/catch. If #11's handler throws, that propagates out of the `ipcMain` listener (Electron logs it; it does not crash main).

