# Wire codec

The **serialization layer** of the transport: pure functions that turn the shared wire types into — and back from — the daemon's on-the-wire bytes, using the same wire format as pyrycode-mobile. Desktop supplies its own client identity, feature report and capabilities. The generic codec lives in `src/main/transport/codec.ts`; hosted envelope, discovery/control and resource validation live beside it in `hostedBoundary.ts`, `hostedCodec.ts` and `hostedResourceCodec.ts`. All executable validation stays in the Electron **background process**, never the renderer. Shared wire declarations remain data only.

Introduced in [#5](../codebase/5.md). It sits *on top of* the [relay connection](relay-connection.md) (#21, the opaque byte pipe) and *under* the Noise session (#7, which encrypts the bytes this codec produces). The wire *types* it (de)serializes already existed ([#21 foundation](../codebase/21.md), `src/shared/wire/types.ts`); this ticket adds only the encode/decode. The daemon does not care which client speaks it, so a byte mismatch — a dropped default, an emitted `null`, the wrong base64 alphabet, or a silently-truncated decode — breaks the contract **silently** ([ADR 0002](../decisions/0002-remote-head-over-relay-shared-wire.md); CLAUDE.md).

## What it does

The generic codec turns typed wire values into their exact JSON/base64 byte form and parses them back. It is a **thin serializer** ported field-for-field from the mobile Kotlin codec (`MobileWireCodec.kt`: the `MobileJson` config + `base64Std*` helpers; `MobileWireModels.kt` / `MessagePayload.kt`: field names + defaults). Its `Envelope.payload` stays an **opaque carrier** (`unknown`); consumers validate it at their own edge. The separate [hosted validators](#hosted-discovery-and-control) return narrowed discovery/control or resource payloads after checking the original bytes and envelope.

## How it works

The generic functions below live in `src/main/transport/codec.ts`. The generic codec and hosted validators are pure, synchronous and side-effect-free, with no store, async work, timer or shared mutable state.

### Public surface

```ts
// base64-std alphabet (A–Za–z0–9+/), padded — Go base64.StdEncoding.
export function base64StdEncode(bytes: Uint8Array): string
export function base64StdDecode(data: string): Uint8Array          // STRICT — see Edge cases

// InnerFrameV2 ↔ WS text. Encode → text frame (string). Decode ← inbound bytes (Uint8Array).
export function encodeInnerFrame(frame: InnerFrameV2): string
export function decodeInnerFrame(bytes: Uint8Array): InnerFrameV2

// Envelope ↔ UTF-8 plaintext bytes (the Noise plaintext / handshake early-data).
export function encodeEnvelope(envelope: Envelope): Uint8Array
export function decodeEnvelope(bytes: Uint8Array): Envelope
// Unvalidated JSON-object routing hints; original bytes still require validation.
export function parseJsonObject(bytes: Uint8Array): Record<string, unknown>

// The one default-injecting constructor (see Defaults).
export function makeHelloClientPayload(input: {
  deviceName: string; clientVersion: string; token: string
  capabilities?: readonly string[]; lastSeenTs?: string; lastEventId?: number
}): HelloClientPayload

// Deterministic, catchable decode-failure signal at the trust boundary.
export class WireDecodeError extends Error {}
// Category-only failure for over-cap serialized frames/envelopes.
export class WireEncodeError extends Error {}
```

The **asymmetry** `encodeInnerFrame → string` vs `decodeInnerFrame ← Uint8Array` is intentional and correct: we *send* a WS text frame (a string), and `ws` *delivers* every inbound frame as bytes (`RelayEvent.frame: Uint8Array`). Same for `encodeEnvelope → Uint8Array` / `decodeEnvelope ← Uint8Array` — those bytes are the Noise plaintext #7 encrypts/decrypts.

### The two byte boundaries this codec serves

Taken directly from mobile's `NoiseSessionPump` + `OkHttpRelayTransport`:

1. **`InnerFrameV2` ↔ WS text.** The frame is JSON text on the wire: `{"v":2,"type":"noise_init"|"noise_msg"|…,"data":"<base64-std>"}`. Its `data` field carries base64-std of the **Noise** bytes (ciphertext / handshake material) — those bytes are #7's, not this codec's. This codec only JSON-(de)serializes the frame and provides the base64-std helpers #7 will call on `data`.
2. **`Envelope` ↔ plaintext bytes.** The Envelope is JSON serialized to **UTF-8 bytes**; those bytes become the Noise plaintext (encrypted by #7) or handshake early-data. The Envelope is **not** itself base64-encoded — base64-std wraps the Noise bytes that ride in `InnerFrameV2.data`. #7 inserts the encrypt step between `encodeEnvelope` and `base64StdEncode`, so the codec must **not** fuse Envelope-serialization and base64 into one function. (The `types.ts:20` comment "base64 of the serialized Envelope" collapses that whole `Envelope → JSON → Noise-encrypt → base64` chain.)

### Defaults (the TypeScript-specific problem)

Mobile relies on Kotlin runtime defaults (`encodeDefaults = true`). TS interfaces carry no runtime defaults, so "always emit defaults" (AC #3) is split by how each field is enforced:

- **Literal-typed fields enforce themselves.** `InnerFrameV2.v: 2` and `HelloClientPayload.role: 'client'` are literal types — you cannot construct the object without them, so `JSON.stringify` always emits them. **No runtime injector.**
- **Non-literal defaults need one constructor.** `makeHelloClientPayload` injects `protocol_versions: ['v2']` (reusing `PROTOCOL_VERSION` from `types.ts`) and the fixed `client_features` report below. `capabilities` is a caller argument defaulting to `[]`; production `loadDialConfig` in `daemonConnection` supplies `['interactive', 'multi_agent', 'stop_background_task', 'hosted_apps_v1']` through [hello exchange](hello-exchange.md). `interactive` enables the structured stream; `multi_agent` unlocks Codex conversations, frames and model rows on supporting v0.27.0+ daemons; `stop_background_task` detects support for that verb; `hosted_apps_v1` enables host-scoped discovery/resource negotiation with the background handlers installed. The advertised set belongs at the caller: the [capability probe](real-claude-liveness-e2e.md#capability-gated-skip--the-one-check-that-runs-after-the-daemon-exists) supplies exactly its spec's required set. Optional `lastEventId` and legacy `lastSeenTs` become `last_event_id` and `last_seen_ts` only when provided, never `null`. `HelloClientPayload` is the only encode-side payload with non-literal defaults, so it has one constructor. `Envelope` has no defaulted fields; callers build it directly.
- **`client_version` gets an app-name prefix, added once, here.** `input.clientVersion` is the bare app version (`app.getVersion()`, e.g. `"0.1.0"`); the constructor writes `client_version` as `` `${CLIENT_APP_NAME}/${input.clientVersion}` `` (`CLIENT_APP_NAME = 'pyrycode-desktop'`), the `<app>/<MAJOR>.<MINOR>.<PATCH>` format the daemon parses (pyrycode `docs/protocol-mobile.md` § `hello`, "`client_version` format"; \#1612). The prefix is added inside this constructor rather than by the caller because the same bare `clientVersion` also feeds the relay `User-Agent` header and the session-start log banner, and prefixing it upstream would double-prefix both (see [daemon connection lifecycle](daemon-connection-lifecycle.md) `clientVersion` field). Once a daemon release enforces a minimum `client_version` it cannot parse, an unprefixed hello is rejected — desktop shipped this format ahead of that gate.

### Desktop feature report

`HelloClientPayload.client_features?: string` mirrors the daemon's optional v2
plain-text self-report. `makeHelloClientPayload` always injects its private
module-level `CLIENT_FEATURES` constant; neither its input nor `ClientHelloInput`
offers an override. `buildClientHello` serializes it automatically on the first
dial, supervisor-provider reload and explicit reconnect. The exact current text is:

```text
Markdown links to absolute paths of markdown files under the daemon's served folders open in-app. Paths with spaces need angle brackets: [Note](</Users/me/My Vault/note.md>). Bare paths in backticks do not open. Attached files and photos upload to the daemon; on Send, Claude receives daemon-host paths and instructions to read them, not inline content.
```

The value is one line of 353 UTF-8 bytes, without a trailing newline. It fits the
daemon's independent prompt-admission limit of 512 UTF-8 bytes and contains no C0
(U+0000–U+001F), DEL (U+007F), C1 (U+0080–U+009F) or double quote (U+0022).
These constraints apply to the decoded string, not its JSON field syntax.
The daemon owns admission; the client pins this fixed report in tests rather than
adding a runtime validator or rejection path. See the daemon's
[handshake contract](https://github.com/pyrycode/pyrycode/blob/main/docs/knowledge/features/protocol-package-handshake-control-payloads.md).

The report describes UI behavior for Claude's prompt; it does not negotiate
capabilities or grant file access. Capability defaults and caller-supplied sets
remain independent. Its example path is inert text. The constant and serialization
stay in the main process, with no renderer input or new logging. For independent
encoded-text and production dial-path coverage, see
[hello exchange testing](hello-exchange.md#testing).

### Omit-absent-optionals, without `null` (AC #3)

`JSON.stringify` drops `undefined` keys but **serializes `null`**. Represent absent
optionals as `undefined`/omitted: `Envelope.in_reply_to`, `Envelope.event_id` and
`HelloClientPayload.last_event_id` are optional numbers; the legacy `last_seen_ts`
is an optional string. The constructor adds the hello fields only when supplied,
matching mobile's `explicitNulls = false` without a runtime scrub.

This is an absence rule for optional fields, not a blanket null-removal rule.
Hosted discovery requires explicit nullable fields; see
[null and omission preservation](#hosted-null-and-omission-preservation).

`last_event_id` requests bounded current-conversation replay after a daemon-wide
event position. `last_seen_ts` has no daemon consumer; connection-produced hellos
never send it. The codec passes the numeric position through without validating
its range. [Daemon connection](daemon-connection-lifecycle.md#replay-cursor-lifetime)
owns positive-safe-integer validation and the in-memory cursor; `decodeEnvelope`
keeps payloads opaque and only retains numeric `event_id` values. Observe an
admitted envelope before narrowing its payload, so unknown types and malformed
payloads can still advance replay. Failed size or envelope guards cannot advance
or reset it. An expired or unknown position yields `resync`; the connection clears
that host's cursor without automatically loading history.

### Data flow

```
 encode (outbound)                                   decode (inbound)
 Envelope ──encodeEnvelope──► UTF-8 bytes            relay bytes ──decodeInnerFrame──► InnerFrameV2
                │  (#7 Noise-encrypts)                              │  .data
                ▼                                                   ▼ base64StdDecode
 InnerFrameV2.data ◄──base64StdEncode── Noise bytes     Noise bytes (#7 decrypts) ──► plaintext bytes
                │                                                   │
 encodeInnerFrame──► WS text (string) ──► relay          plaintext ──decodeEnvelope──► Envelope{payload: unknown}
```

The generic `payload` stays opaque at both ends. Hosted callers use the separate
validation boundary below; neither codec adds IPC, preload or renderer wiring.

## Hosted discovery and control

The declarations and validators follow the daemon's
[hosted-app v1 contract at revision `964c5c4bab8e9267ee5e4c374d34a5bb1ebeb6f0`](https://github.com/pyrycode/pyrycode/blob/964c5c4bab8e9267ee5e4c374d34a5bb1ebeb6f0/docs/specs/architecture/3120-hosted-app-contract.md).
`src/shared/wire/types.ts` declares `HostedAppRecord`, the directional `HostedPayloads`
map and the discriminated `HostedControlEnvelope` and `HostedResourceEnvelope`,
reusing `Envelope` and `ErrorPayload`. `EnvelopeType` includes all eleven names through
`keyof HostedPayloads`; hosted bridge errors reuse the existing `error` name.

| Direction | Names | Envelope `in_reply_to` |
| --- | --- | --- |
| Client → daemon | `list_apps`, `app_asset_request`, `app_api_request`, `app_response_credit`, `app_cancel` | Absent |
| Daemon → client replies | `apps`, `app_response`, `app_response_chunk`, `app_cancelled`, hosted `error` | Required |
| Daemon → client notifications | `app_updated`, `app_removed` | Absent |

`HostedResourceEnvelope` covers the five resource members (`app_asset_request`,
`app_api_request`, `app_response_credit`, `app_response`, `app_response_chunk`).
`decodeHostedResource`/`encodeHostedResource` validate their per-frame semantics;
`decodeHostedControl` continues to reject all resource names. Required fields retain
false `navigation`, zero credit/chunk/size values, empty header objects and empty
bodies, never omitting them as falsy defaults. Missing optionals remain absent;
decode preserves a present empty `query`, while encode omits it.

### Hosted API and strict boundary

```ts
// src/main/transport/hostedBoundary.ts: envelope structure; payload still opaque.
decodeHostedEnvelope(bytes: Uint8Array,
  direction: 'client-to-daemon' | 'daemon-to-client'): Envelope

// src/main/transport/hostedCodec.ts: discovery/control semantics.
decodeHostedControl(bytes: Uint8Array,
  direction: 'client-to-daemon' | 'daemon-to-client'): HostedControlEnvelope
encodeHostedControl(envelope: Envelope,
  direction: 'client-to-daemon' | 'daemon-to-client'): Uint8Array
isHostedAppId(value: unknown): value is string
isHostedReleaseVersion(value: unknown): value is string

// src/main/transport/hostedResourceCodec.ts: stateless resource/HTTP semantics.
type Request = Extract<HostedResourceEnvelope,
  { type: 'app_asset_request' | 'app_api_request' }>
decodeHostedResource(bytes: Uint8Array,
  direction: 'client-to-daemon' | 'daemon-to-client',
  originalRequest?: Request): HostedResourceEnvelope
encodeHostedResource(envelope: Envelope,
  direction: 'client-to-daemon' | 'daemon-to-client',
  originalRequest?: Request): Uint8Array
```

`decodeHostedEnvelope` checks the **65519-byte plaintext ceiling** before parsing,
fatal UTF-8 decoding, exactly one JSON object with no trailing values, and duplicate
decoded key names at every nesting depth. Its iterative token scan catches escaped
duplicates and duplicates inside unknown additive objects and arrays without a
recursive scanner. It then requires `id`, a recognized `type`, a calendar-valid
RFC3339 UTC `ts` and an object `payload`. IDs and correlations are nonnegative safe
integers. UTC timestamps retain their original text and precision; `Z`/`z` and
`+00:00` are accepted. The caller supplies the frame direction; the table above
determines correlation presence, including rejection of explicit null correlations.

Hosted envelopes reject the presence of `conversation_id`, `session_id`, `event_id`,
`history_entry_id`, `session_state_cleared` and `payload_encrypted`, even with null
or false values. Validate the original bytes before using the generic decoder:
`decodeEnvelope` projects envelope keys, so checking its output would lose evidence
of forbidden metadata and duplicate keys. The strict boundary projects known
envelope fields while leaving payload semantics to its caller. Host identity comes
from the authenticated connection; additive fields grant no routing or authority.

Both hosted decoders add payload semantics and project only known fields, including
nested control records/error summaries. Both encoders serialize through
`encodeEnvelope`, validate those final bytes through their corresponding hosted
decoder, and return the serialized bytes. Resource encode first omits an empty
optional request query. Outbound additive fields otherwise remain in the returned
bytes and count toward the **65519-byte ceiling**, including JSON escaping;
validating only a projected object could miss oversized additions. Decode applies
the same ceiling to the original bytes. Decode failures use category-only
`WireDecodeError`; any encode failure, including serialization failure, becomes
`WireEncodeError('invalid hosted control encoding')` or
`WireEncodeError('invalid hosted resource encoding')`. Neither path logs daemon content.

### Discovery, cancellation and bridge errors

`isHostedAppId` accepts only canonical lowercase UUIDv4 strings.
`isHostedReleaseVersion` accepts canonical numeric `MAJOR.MINOR.PATCH`, at most
32 ASCII bytes, with no leading zeroes except the component `0` and each component
at most 2147483647. These predicates validate identities as data, without converting
them to paths.

App titles contain 1–128 UTF-8 bytes, no leading/trailing whitespace and no C0,
DEL or C1 controls. `desired` is `available` or `stopped`; `state` is `starting`,
`running`, `stopped` or `failed`. A running record requires a non-null active release.
Record and removal revisions are positive safe integers. An `apps` snapshot revision
is a nonnegative safe integer; its page has at most 16 records, strictly sorted by
`app_id` without duplicates, with each record revision at most the snapshot revision.
Request cursors and non-null response cursors contain 1–256 ASCII bytes.

Cancellation requires a nonnegative safe original `request_id` and, when supplied,
a canonical `app_id`. The cancel envelope ID must differ from the target request
ID. `app_cancelled.in_reply_to` identifies the cancel request and must differ from
the payload's target `request_id`; these are two separate correlations, not an
acknowledgement keyed only by the target.

Hosted `error` and discovery `last_error` summaries use a closed code table and
nonempty messages of at most 160 UTF-8 bytes. Bridge `error.retryable` is required
and must match the table:

| `retryable` | Codes |
| --- | --- |
| `false` | `protocol.unsupported`, `app.invalid_request`, `app.not_found`, `app.release_changed`, `app.limit_exceeded` |
| `true` | `app.unavailable`, `app.busy`, `app.timeout`, `app.io_failed`, `apps.changed` |

Optional bridge `retry_after_s` is an integer from 1 through 30 and is permitted
only when retryable. `min_client_version`, the other known `ErrorPayload` field,
must be absent. A record's non-null `last_error` retains only `code` and `message`.
The parser bounds message text; it cannot establish that its producer used static
copy.

### Hosted null and omission preservation

`active_release`, `pending_release` and `last_error` must be present on every app
record, with null preserved where allowed. `apps.next_cursor` is also required and
nullable. A missing key cannot substitute for null. Conversely, `list_apps.cursor`,
cancel `app_id` and bridge `retry_after_s` remain absent when omitted; supplying null
for one fails validation. Re-encoding the validated control result retains these
distinctions.

### Resource requests and HTTP limits

Resource validation reuses the canonical app/release predicates above. Paths are
escaped origin-relative ASCII text, at most 2048 bytes. They must start with `/`
and reject repeated slashes, raw backslashes, query/fragment delimiters, whitespace,
controls and malformed escapes. Escaped slash, backslash and percent (`%2f`, `%5c`,
`%25`, case-insensitive) are forbidden. One UTF-8 decode checks controls and exact
`.`/`..` segments; invalid UTF-8 escapes fail. The original escaped path is retained.
API paths must begin with literal `/api/`. Assets reject decoded roots `api`,
`_pyry`, `service`, `data`, `builds`, `registry` and `registry.json`, plus exact
`/dist/service` and its descendants. Checking descendants alone would admit the
reserved root: `/dist/%73ervice` must also fail, while neighboring names such as
`/dist/service-worker.js` remain valid. URL admission grants no filesystem authority;
asset-handle containment remains daemon-owned.

Optional queries contain at most 1024 ASCII bytes, valid percent escapes, no leading
`?`, raw fragment delimiter, whitespace or controls. They remain opaque encoded
text: no decoding, reordering or normalization of duplicate parameters, empty
values, `+` or escaped octets, including non-UTF-8 octets. Path containment rules
must not be applied to query escapes.

API methods are `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE` and `OPTIONS`.
GET/HEAD require the empty body string; other methods preserve opaque binary bodies.
API request and response headers are required string maps, with lowercase names
from the following closed tables:

| Headers | Allowed names |
| --- | --- |
| Request | `accept`, `content-type`, `if-none-match` |
| Response | `content-type`, `cache-control`, `etag`, `last-modified` |

Each map permits at most 8 entries, 1024 UTF-8 bytes per value and 4096 serialized
UTF-8 bytes for the whole object, including JSON escaping. Values reject C0, DEL
and C1 controls. Types, names and value bounds are checked before serializing the
narrowed string map; a nested hostile value cannot reach that serialization.

Request bodies and chunk data use canonical padded standard base64, at most
32768 decoded bytes; chunks must be nonempty. Before the allocating
`base64StdDecode` helper runs, validation checks the 43692-character ceiling,
length modulo four, alphabet, padding, pad bits and decoded length implied by
padding. An encoded length of 43692 can still represent 32769 bytes, so the encoded
ceiling alone is insufficient. Validated payloads retain the canonical wire string
without interpreting its binary content.

### Response metadata and original-request correspondence

Metadata uses nonnegative safe integers for `size_bytes`/`total_chunks` and a
lowercase 64-hex `sha256`. Standalone validation uses global maxima; supplied
`originalRequest` narrows them by request kind:

| Context | Status | Maximum body / chunks | Chunk `index` / credit `next_index` |
| --- | --- | --- | --- |
| None | 200–599 | 8 MiB / 256 | 0–255 |
| Asset request | 200–299 or 400–599 | 8 MiB / 256 | 0–255 |
| API request | 200–599 | 1 MiB / 32 | 0–31 |

Zero-byte metadata requires zero chunks and the SHA-256 digest of an empty body;
nonzero size requires a positive bounded chunk count. HTTP 204/205/304 always
declare zero body; HEAD does too when identified by API request context. These
checks allocate no buffer from the declared response size and do not verify a
nonempty body's digest or completion.

The supplied original asset/API request is serialized and revalidated on every
call. Frames must match its `app_id` and, where carried, `release_version`.
Response metadata/chunks use `in_reply_to` equal to its envelope ID; credit uses
payload `request_id` equal to that ID and has no `in_reply_to`. Request frames
checked against context additionally match request kind and ID. Invalid context
serialization/validation yields a static decode category. This establishes
stateless correspondence only, without a pending-operation table or ownership claim.

### Consumer obligations and testing

These validators retain no connection or assembly state. The main-process consumer,
`src/main/transport/hostedResources.ts`, now owns admission, correlation, assembly
and retirement. A trusted caller selects `registry.connectionFor(serverId)`, then
uses `connection.hostedApps.openView(appId)` for a readiness-gated binding. It
returns a view only for an authoritative running record with an active release;
the underlying `hostedResources.openView(appId, release)` supplies the transport
lifetime without establishing discovery readiness. Each view pins the connection,
app, release, unique view scope and generation;
request/credit/cancel IDs come from the connection's existing monotonic allocator.
Only an authenticated named connection whose current acknowledgement includes
`hosted_apps_v1` dispatches requests. Other cases settle locally as `unavailable`.
Completed results contain validated metadata and a `Buffer`, including non-2xx
HTTP status and empty HEAD/204/205/304 bodies. No bytes cross IPC or the renderer,
and no direct HTTP path or separate socket/key is introduced.

The consumer permits eight active requests per connection and sixteen pending
operations per view, including active work. Metadata reserves its declared size
against a connection-wide 16 MiB allowance before buffer allocation. Contextual
validation enforces asset 8 MiB/256 chunks, API 1 MiB/32 chunks, and 32768 decoded
bytes per request body or chunk. Assembly requires exactly one metadata frame,
feasible chunk counts, consecutive granted indices, exact length/count and SHA-256;
validated zero-byte metadata completes immediately. The request grants chunk 0
only. Each consumed nonfinal chunk sends one next credit; queued credits grant
nothing until `SendOutcome` reports them written.

An operation has a fixed thirty-second deadline from enqueue and a five-second
active progress timeout. Other traffic cannot extend them. Abort, view `retire()`
and owner `hostedResources.retire()` settle owned work once; connection lifecycle
resets invalidate all views and discard partial bytes. Connected cancellation uses
its own envelope ID, matched independently of the retired target and checked
against the original request/app. Discovery lists/cancellations and resource
credits/cancellations share sixteen control reservations, counting pending
correlations and held sends separately. Cancellation correlations expire after
five seconds; held-send reservations survive until send observation or connection
reset. Late frames cannot revive work. Failed attempted POST/PUT/PATCH/
DELETE requests report `uncertain: true` and are never replayed. See
[hosted resource lifecycle](daemon-connection-lifecycle.md#hosted-resource-views)
for cleanup, failure categories, bulk discovery-driven retirement and caller lifetimes.

`onDriverEvent` routes hosted responses before `parseInboundMessage`. Using only
`decodeEnvelope` for that routing would both erase forbidden fields and reject
some identifiable malformed replies before their owning operation could retire.
For example, numeric `session_id` or null `history_entry_id`/`session_state_cleared`
must fail the correlated operation immediately, releasing its reservation; a later
valid frame must not rescue it. `parseJsonObject` supplies unvalidated type and
correlation hints solely to locate or retire work. Only contextual hosted validation
of the original plaintext admits metadata/chunks or control replies. Valid fatal
authentication and update-required errors take precedence over hosted correlation
and retain their connection-wide effect. Unrelated traffic follows the existing
parser and remains runnable during held transfers.

Host-wide discovery reconciliation, cursor expiry/restarts and readiness refresh
now belong to `hostedApps`; connection hello construction advertises
`hosted_apps_v1`. Validators remain stateless. See
[hosted readiness and retirement](daemon-connection-hosted-resource-views.md#deadlines-and-retirement)
for atomic snapshots, contiguous updates, fixed deadlines and explicit retry. The
[native viewer](daemon-connection-hosted-resource-views.md#native-viewer) consumes
that readiness-bound service. Fetch adaptation remains with
[#1961](https://github.com/pyrycode/pyrycode-desktop/issues/1961), trusted chrome/placement
with [#1992](https://github.com/pyrycode/pyrycode-desktop/issues/1992),
Apps rows/navigation/stable links with [#1928](https://github.com/pyrycode/pyrycode-desktop/issues/1928), and real paired
round trips/browser interaction/SQL persistence acceptance with
[#1929](https://github.com/pyrycode/pyrycode-desktop/issues/1929). Manifest/build
validation and asset-handle containment remain daemon-owned.

`src/main/transport/hostedCodec.test.ts` keeps the unchanged shared JSON examples
local with the pinned source revision. Negotiation uses the existing codec and
hello facilities; `hosted_apps_v1` there is test data. Resource requests in cancellation
and bridge-error sequences supply context and are explicitly rejected as validated
control frames. Tests assert decoded values and serialized required/null/omitted
keys separately, retain distinct cancel and target IDs, and assign all eleven names
directly to `EnvelopeType` so typecheck can catch missing vocabulary. Adversarial
cases cover bytes, duplicate keys, forbidden fields, direction/correlation, semantic
bounds, additive projection and final serialized size. Repeating frames/IDs tests
stateless validation; it does not prove lifetime uniqueness or pending ownership.

`src/main/transport/hostedResourceCodec.test.ts` keeps unchanged multi-chunk
asset/credit, API POST/204, cancellation-read and bridge-error examples local,
pinned to revision `964c5c4bab8e9267ee5e4c374d34a5bb1ebeb6f0`. Resource members use
the resource validator; cancel/error members use the control validator. Assertions
check decoded values, re-encoded values and required/omitted keys, opaque query and
binary preservation, and separate resource/credit versus cancel correlations.
Adversarial cases cover HTTP, identities, path/query/header bounds, reserved roots
and neighbors, metadata/index limits, HEAD/204/205/304 and supplied-context mismatches.
A base64-helper spy checks rejection before allocating decode, including an
over-limit decoded body whose encoded length fits. Request/chunk size cases measure
final escaping and additive fields on both encode and decode. Repeated frames and
context revalidation prove frame semantics only. Stateful background coverage lives
in `hostedResources.test.ts`: multiframe binary/POST-204, exact bounds and credit
pacing, corruption, fixed deadlines, cleanup, cancellation and host/view isolation.
`daemonConnection.test.ts` adds supplied-ack fake-driver lifecycle and malformed
correlation cases, plus positive message/control processing during a held transfer;
`connectionRegistry.test.ts` checks named-host delegation. The malformed-frame cases
assert immediate settlement, reused active/view/reservation capacity, discarded late
replies and cleared timers. `hostedApps.test.ts` adds authoritative discovery and
readiness-driven retirement; fake-driver tests exercise production advertisement
and fresh per-host negotiation. These background fixtures establish no viewer
interaction or live SQL persistence.

## Configuration and usage

- **Main-process only, imported by relative path.** `src/main/**` cannot use the `@shared/*` alias — the codec imports the shared types via `../../shared/wire/types`. It uses Node `Buffer` (for base64) and `TextEncoder`/`TextDecoder` (for the UTF-8 leg).
- **Consumers.** #7 (the Noise session) calls `encodeEnvelope`/`decodeEnvelope` around its encrypt/decrypt and `base64StdEncode`/`base64StdDecode` on `InnerFrameV2.data`; the relay wiring sends `encodeInnerFrame(...)` (a string → WS text frame, matching mobile's text-frame contract) and feeds inbound `RelayEvent.frame` bytes to `decodeInnerFrame`.
- **`makeHelloClientPayload`** is the one constructor a caller building the client hello must use — do not hand-build `HelloClientPayload` (you would drop the injected defaults).
- **Size limits.** Generic decode relies on upstream transport admission; it has no local byte cap. Generic encode checks `MAX_FRAME_BYTES` for outer frames and `MAX_PLAINTEXT_BYTES` (65519) for envelopes. Hosted validation also checks the plaintext ceiling before decode and validates the final encode bytes.

## Edge cases and limitations

- **Envelope vocabulary needs a direct type assertion.** `Envelope.type` accepts
  `EnvelopeType | string`, so constructing an envelope cannot prove that its name
  belongs to the declared vocabulary. `conversation_deleted` was already parsed
  and consumed while its union member was missing (#1247). In
  `src/shared/wire/types.test.ts`, assign the literal directly to `EnvelopeType`
  without a cast, following the `turn_state` and `conversation_deleted` tests.
  Vitest alone can pass with the member absent; `npm run typecheck` checks this
  file through `tsconfig.node.json`, and `npm run build` runs that check too.
  See [test-tier evidence](development-verification-what-each-test-tier-proves.md#what-each-test-tier-proves).
- **Strict base64, by canonical-form check.** Node's `Buffer.from(s, 'base64')` is **lenient on four axes** — it strips non-alphabet chars, accepts url-safe `-`/`_`, tolerates wrong length, and accepts non-canonical final quanta (`'YQ==garbage'` → only `'YQ=='`, no error; `'YR=='` → the same byte as `'YQ=='`). Any of those would let a malformed frame decode to a silently-truncated or off-contract value (violating AC #4). `base64StdDecode` replicates Go's strict `base64.StdEncoding` with **one comparison**: lenient-decode, then require `base64StdEncode(decoded) === data`. Node's encoder emits only canonical output, so every garbage-bearing, url-safe, wrong-length, or non-canonical-quantum input fails the equality and throws — **no truncation**. Decode accepts a value **iff** it is the canonical encoding of its own bytes. The empty string re-encodes to itself and stays valid.
- **Decode fails closed.** `decodeInnerFrame` / `decodeEnvelope` throw `WireDecodeError` on: malformed base64 (above), malformed UTF-8 (`TextDecoder('utf-8', { fatal: true })` rejects invalid byte sequences rather than substituting U+FFFD), malformed JSON (every `JSON.parse` throw — `SyntaxError` *and* deep-nesting `RangeError` — is caught), a non-object top level, and a missing/mistyped required primitive. They never return a partial value.
- **Generic forward-compatible decode.** Unknown / server-added keys are **tolerated** (e.g. an `ErrorPayload` with `retry_after_s`, or a `payload_encrypted` field) — decode does not throw and `payload` stays opaque. Hosted validation rejects forbidden envelope metadata before projection. `decodeInnerFrame` requires `v === 2` and rejects other versions; additive fields do not enable version negotiation.
- **Encode can fail on size.** Even well-typed values can exceed the serialized byte ceiling and throw `WireEncodeError`. Hosted encode additionally rejects invalid discovery/control or resource semantics. Static declarations alone establish neither byte bounds nor semantic admission.
- **`QrPayload`** round-trips as plain JSON (all string fields) — no dedicated codec function. Its `server_static_pubkey` → validated-32-raw-bytes decode is a **pairing** concern, deferred to the QR/pairing ticket.
- **Prototype pollution is not a live sink here.** `JSON.parse` creates an *own* `__proto__` key and does not pollute `Object.prototype`; the codec does no recursive merge. No wire field is named `__proto__`/`constructor`/`prototype`, so no reviver was added (evidence-based). The documented obligation on consumers: do **not** naïve-deep-merge the opaque `payload`.

## Security posture

The ticket carries the `security-sensitive` label; the architect's review verdict is **PASS** (`docs/specs/architecture/5-wire-codec.md § Security review`).

- **Structural renderer isolation.** The codec handles secret material — device `token` in hello/QR payloads, and message plaintext — plus Node `Buffer`. Living under `src/main/transport/`, the renderer bundle **physically cannot import it** (`src/main/**` is outside the renderer's reachable graph). This is the *deterministic* control that replaced the rev-1 placement under `src/shared/wire/`, where isolation rested only on the *convention* "don't add a barrel" (see [#5 notes](../codebase/5.md)). `types.ts` (which the renderer *does* import) stays in `src/shared/wire/` and `Buffer`-free — keep the types-vs-codec split.
- **Secret-safe error messages.** `WireDecodeError` messages name the **failure category only** (`"malformed base64"`, `"invalid UTF-8"`, `"malformed JSON"`, `"missing required field: type"`) and **never** echo the raw bytes/string or decoded field values — frames and envelopes carry the device `token` and message plaintext. The codec performs **no logging** (`console.*`) whatsoever. (Mirrors mobile's `decodeServerStaticPubkey`, which names the category and never echoes the key.) Restated obligation for #7: do not `console.log` a hello payload.
- **Crypto-free.** No RNG, no hashing, no key handling, no MAC/token comparison — base64 and JSON are not cryptographic. The Noise handshake and AEAD are #7's; the codec must not be extended to compare secrets.

## Related

- **`UnrecognizedMessagePayload`'s doc comment** (`src/shared/wire/types.ts`, above the interface) — the dated census of what the daemon actually forwards for the two lines this codec's `unrecognized_message` frame is *not* emitted for. `system` and `rate_limit_event` both stay unreachable from that frame, but by different routes: `system` holds it because it is the sole member of the daemon's `ignoredLineTypes` map (unreachable **by list membership**), `rate_limit_event` because it has an arm of its own that never falls through to the unrecognized case (unreachable **by matching**, the daemon's stronger guarantee) — the two phrases are not interchangeable, and a comment that applies one to both inverts the distinction. Measured 2026-09-07 against pyrycode `internal/streamsup/parser.go`; re-measure rather than citing that date once the daemon moves again (#1248).
- [Relay connection](relay-connection.md) (#21) — the opaque byte pipe this codec sits on top of; its `maxFrameBytes` bounds relay input upstream.
- [ADR 0002 — Remote head over relay, shared wire](../decisions/0002-remote-head-over-relay-shared-wire.md) — "do not drift the encoded form from mobile without a matching daemon change", and the types→`shared` / codec→`transport` split this ticket enforces.
- [ADR 0001 — Stack: transport in the background process](../decisions/0001-stack-electron-react-typescript.md) — the background-process transport home.
- [#5 codebase notes](../codebase/5.md) · Spec: `docs/specs/architecture/5-wire-codec.md`
- Go/mobile mirror (via QMD `pyrycode-docs`): `knowledge/features/v2-session-manager.md` (`internal/relay` Noise_IK + JSON-decode boundary) and `docs/protocol-mobile.md` (§ Wire shapes / Transport) — the source-of-truth this codec ports.
