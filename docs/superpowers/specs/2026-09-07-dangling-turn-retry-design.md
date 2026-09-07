# Dangling-Turn Retry (Issue #108) — Design

## Problem

`character-chat/route.ts` (Project 2) and `world-chat/route.ts` (Project 3)
both persist the author's message to Firestore *before* calling the model.
If that call fails — a `RateLimitTimeoutError` (503), a `TurnValidationError`
(502), an Anthropic API error, or the generic 500 catch-all — no assistant
reply ever gets appended. The author's message is left "dangling": present
in message history with no reply.

Today the only auto-recovery mechanism either screen has is a one-shot
effect that fires `sendMessage("Let's begin.")` when `messages.length === 0`
— i.e. only for a brand-new, empty session. It's keyed on the list being
*empty*, not on "the last message has no reply", so it can never notice or
recover a dangling message from turn 5, 12, or any turn past the first. On
reload, the author sees their own last message sitting alone with no
indication anything is wrong and no way to make the app try again short of
typing something new (which, since the FSM/turn logic expects a reply to
the *existing* dangling message, may not even make sense to send).

## Scope

This fixes dangling turns generally, not just the opening-turn case named
in the issue title — both share one root cause (message persisted before
the model call) and one fix (detect + retry on resume), so there's no
reason to solve only the first occurrence of the same failure.

## Server-side: a `retry` request mode

Both `POST /api/character-chat` and `POST /api/world-chat` currently
require `{ storyId: string, message: string }`, validate `message` as a
non-empty string, and unconditionally call `appendMessage(storyId, {
role: "user", content: message.trim(), ... }, <COLLECTION>)` before
building turn context and calling the model.

Add a second accepted shape: `{ storyId: string, retry: true }` (no
`message`). When `retry === true`:

1. Skip the `message` presence/type validation entirely (it's not sent).
2. After the existing auth/membership/foundation-gate checks (unchanged —
   a retry goes through every gate a normal turn does), fetch the most
   recent persisted message (`listMessages(storyId, 1, <COLLECTION>)` or
   equivalent) and verify it's role `"user"`. If there is no last message,
   or the last message is role `"assistant"` (nothing dangling), return
   `{ error: "Nothing to retry." }` with status 409 — defends against a
   stale/duplicate retry call finding nothing to do.
3. Skip the `appendMessage(user, ...)` call — the message is already
   there from the failed attempt.
4. Continue through the unchanged remainder of the handler exactly as a
   normal turn does: build context from the full persisted history
   (which already ends with the dangling user message), call the model,
   and on success append only the assistant reply. On failure, return the
   same error responses as today, leaving the message dangling again,
   ready for the next reload's retry.

Every gate that runs before the append step (auth, membership, the
Character Bible completion gate in `world-chat/route.ts`, the Anthropic
rate-limit gate) is unaffected — only the append-user step and the
initial `message` validation become conditional on `!retry`.

## Client-side: generalized resume recovery

Each component's current opening-turn effect:

```ts
useEffect(() => {
  if (resuming || messages.length > 0 || !canvasId) return;
  sendMessage("Let's begin.");
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [resuming, canvasId]);
```

becomes a three-way check on the resumed history:

```ts
useEffect(() => {
  if (resuming || !canvasId) return;
  if (messages.length === 0) {
    sendMessage("Let's begin.");
    return;
  }
  if (messages[messages.length - 1].role === "user") {
    retryLastTurn();
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [resuming, canvasId]);
```

(`WorldInterview.tsx` keeps its existing additional `|| error` guard on
the same line.)

`retryLastTurn()` is a new function alongside `sendMessage`. Unlike
`sendMessage`, it does **not** optimistically append a user bubble (the
dangling message is already visible from the resume fetch) and does not
send `message` text — it POSTs `{ storyId: canvasId, retry: true }`. On
success it appends only the assistant reply and applies the same
post-turn state updates `sendMessage` already applies (context, current
character/stage, sign-off status, etc. — whichever fields that
component's turn response carries). To avoid duplicating that
response-handling logic, each component extracts its existing
success-path tail (everything after `if (!res.ok) { ...; return; }`) into
a small local helper function, called from both `sendMessage` and
`retryLastTurn` — a same-file refactor, not a new shared module, matching
this codebase's existing convention of independent, non-shared
`sendMessage` implementations per interview screen.

While `retryLastTurn()` is in flight, the existing `{loading && <Bubble
role="assistant" content="…" pending />}` bubble renders exactly as it
does for a normal in-flight turn — no new loading UI.

## Failure-of-the-retry case

If the retry itself fails (e.g. a still-ongoing rate-limit gate timeout),
`retryLastTurn` sets the same `error` state `sendMessage` already sets on
failure, and the existing error banner renders exactly as it does for any
failed turn today. The input stays enabled throughout (it isn't disabled
during `resuming`, and by the time the retry effect runs `resuming` is
already false), so the author can just type and send a new message
manually — the same recovery path a live-session failure already offers
today. No new "Resend" button or other UI is introduced.

## Edge cases

- **Both conditions can't fire together**: a session is either brand-new
  (`messages.length === 0`, fires the opening turn) or has history whose
  last entry is either `assistant` (healthy — do nothing) or `user`
  (dangling — retry). Mutually exclusive, no double-fire risk.
- **A retry that resolves after the author navigates away**:
  `retryLastTurn` is a plain async function call, not wrapped in the
  resume effect's own `cancelled` closure — same as `sendMessage` already
  is today. If the component unmounts before the fetch resolves, its
  `setState` calls are silent no-ops in this codebase's React version, not
  a new risk introduced here; existing turns already have this exact
  property.
- **Repeated failures across reloads**: each reload attempts exactly one
  retry (not a loop) and shows the error banner if that retry also fails.
  This matches the existing opening-turn auto-fire's behavior (which also
  blindly fires once per mount with no retry-count cap) — acceptable for
  the same reason: failures are expected to be transient (network blips,
  rate-limit gate timeouts), and a persistent failure is visible via the
  error banner on every reload attempt rather than silently retried in a
  tight loop.

## Out of scope

- No change to the append-then-call ordering itself (the "reorder
  persistence" direction from the issue) — that's a larger structural
  change with its own trade-offs (a message could be lost entirely if the
  client crashes mid-request instead of surviving as a dangling entry)
  and isn't needed once retry exists.
- No retry-count cap or backoff — YAGNI per the "Repeated failures" edge
  case above; add one later if it proves to be a real problem.
- No change to Project 1 (`ChatInterview.tsx`) — it has no equivalent
  auto-fired opening turn (its `WELCOME` message is a static client-side
  bubble, never persisted or sent), so it isn't affected by this failure
  mode.
