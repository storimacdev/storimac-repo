# Shared Anthropic Rate-Limit Gate — Design Spec

**Status:** Approved for planning
**Date:** 2026-08-01

## Problem

`web/src/app/api/chat/route.ts` calls Anthropic directly (`new Anthropic({ apiKey })` → `extractTurn()` → `anthropic.messages.create()`) with no shared pacing across requests. Every author's turn competes directly for the same account-wide RPM/input-tokens-per-minute/output-tokens-per-minute budget, with nothing coordinating between concurrent authors across different workspaces. Today, a burst that trips Anthropic's actual rate limit surfaces as a raw error to whichever request loses the race — there is no graceful degradation. This gets more likely as more routes call Anthropic (P4/P5, not yet built) and as usage grows.

The Anthropic SDK's own default retry-with-backoff (unconfigured/untouched in this codebase) is a safety net for a rejected call, but it's purely reactive — it does nothing to prevent bursts from colliding in the first place, and doesn't help the cross-user fairness problem.

## Decisions (confirmed during brainstorming, 2026-08-01)

1. **In-process, in-memory token-bucket gate — not an external queue/job service.** `apphosting.yaml` has `maxInstances: 2` and `minInstances: 0` (low current traffic); a Redis/Cloud-Tasks-backed queue would correctly coordinate across instances but is real new infrastructure for a coordination gap (two instances, occasionally) that doesn't yet justify it. In-memory per-instance under-counts by at most 2x in the rare case both instances are simultaneously active and saturated — acceptable at current traffic, and the module boundary stays swappable to a shared store later without touching call sites.
2. **Hold-and-delay, not queue-and-poll.** When near the limit, the API route waits in-process (bounded) before calling Anthropic, then completes normally — matching today's synchronous chat request/response UX with no client changes. If the bound is exceeded, fail with a distinct, friendly error rather than a raw 5xx. (A queue+poll job pattern is better suited to P5's much-longer scene-drafting calls, if/when P5 is built — out of scope here.)
3. **Conservative, env-tunable default limits — not researched real account numbers.** The real Anthropic Console tier/limits for this account are unknown from this environment. Ship with cautious hardcoded defaults, overridable via env vars, so they can be raised once confirmed in the console without a code change.
4. **Scope: the gate itself, not P5's context-budget module.** P5 (screenplay drafting) doesn't exist yet — no route, no data model, no scene storage — so a context-budget module for it would be speculative. The principle (reuse P1's `contextBudget.ts` window-plus-summary pattern instead of naive full-history replay) is noted here as a requirement to carry forward whenever P5 is actually built, not designed in this spec.

## Architecture

New module: `web/src/lib/rateLimit/anthropicGate.ts`. Exposes two functions rather than a single wrapping function, because `extractTurn.ts`'s existing retry loop (`web/src/lib/canonEngine/extractTurn.ts:100-127`) makes multiple separate Anthropic calls per invocation on schema-validation failure — each needs its own gate check, and a higher-order wrapper wouldn't nest cleanly into that `for` loop:

```ts
export async function acquireAnthropicSlot(estimate: {
  inputTokens: number;
  maxOutputTokens: number;
}): Promise<AnthropicSlotReservation>;

export function recordAnthropicUsage(
  reservation: AnthropicSlotReservation,
  actualOutputTokens: number
): void;

export class RateLimitTimeoutError extends Error {}
```

## Components

- **`SlidingWindow`** (internal, not exported): tracks `{ id: number; amount: number; ts: number }` entries in an array. `add(amount): id` appends an entry and returns its id. `sum(nowMs): number` prunes entries older than 60s, then returns the total of what remains. `adjust(id, newAmount): void` finds an entry by id and replaces its `amount` (used to reconcile the output-token estimate down to actual usage after a call completes).
- **`acquireAnthropicSlot(estimate)`**: checks three module-level `SlidingWindow` instances (requests, input tokens, output tokens) against configured ceilings. If granting `estimate` would exceed any ceiling, polls every `ANTHROPIC_GATE_POLL_MS` and re-checks, up to a total of `ANTHROPIC_GATE_MAX_WAIT_MS`. Once all three have headroom, records one request (`amount: 1`) in the requests window, `estimate.inputTokens` in the input window, and `estimate.maxOutputTokens` (the pessimistic ceiling, since real usage isn't known yet) in the output window — and returns a `reservation` object carrying the output window's entry id. If the max wait elapses without headroom, throws `RateLimitTimeoutError`.
- **`recordAnthropicUsage(reservation, actualOutputTokens)`**: calls the output window's `adjust(reservation.outputEntryId, actualOutputTokens)`, replacing the pessimistic `maxOutputTokens` reservation with what the call actually used (from the Anthropic response's `usage.output_tokens`), so later callers see accurate remaining headroom rather than permanent worst-case accounting.
- **Config** (env-overridable, conservative hardcoded defaults — explicitly commented in code as placeholders pending real Console numbers):
  - `ANTHROPIC_RPM_LIMIT` (default: 40)
  - `ANTHROPIC_ITPM_LIMIT` (default: 30000)
  - `ANTHROPIC_OTPM_LIMIT` (default: 6000)
  - `ANTHROPIC_GATE_MAX_WAIT_MS` (default: 8000)
  - `ANTHROPIC_GATE_POLL_MS` (default: 250)

## Data flow

`route.ts`'s `POST` handler → `extractTurn()`'s attempt loop (`web/src/lib/canonEngine/extractTurn.ts:100-127`) → for each attempt: `acquireAnthropicSlot({ inputTokens: estimateInputTokens(params.system, params.messages), maxOutputTokens: params.maxTokens ?? 4096 })` (may wait) → `anthropic.messages.create()` (unchanged) → `recordAnthropicUsage(reservation, response.usage.output_tokens)` → continue exactly as today (schema validation, retry-on-invalid-output logic unchanged).

`estimateInputTokens(system, messages)` (a small exported helper in the same module) computes `Math.ceil(totalChars / 4)`, where `totalChars` is the length of `system` plus the length of every message's `content` string concatenated. This is a heuristic, not an exact pre-call count — deliberately so: calling Anthropic's own token-counting endpoint before the real call would add a second network round-trip (and itself count against the rate limit being managed), defeating the purpose. The gate is a pacing safety margin, not an exact accounting system, so a `chars/4` approximation is sufficient — `recordAnthropicUsage`'s post-call reconciliation (for the output side) is what keeps the windows from drifting too far from reality over time.

## Error handling

- `RateLimitTimeoutError` is caught in `route.ts` alongside the existing `StateDeltaValidationError` catch block, and mapped to a distinct response: HTTP 503, `{ error: "StoriMac is handling a lot of requests right now — please try again in a moment." }`. Distinct from the existing 502 (model produced invalid structured output) so the two failure modes are distinguishable in logs and to the client.
- The Anthropic SDK's own default retry-with-backoff for transient 429s/5xxs is untouched underneath this gate — the gate's job is to avoid triggering those in the first place by pacing proactively; the SDK's reactive retry remains a safety net for whatever it doesn't catch (e.g., another process outside this app's control hitting the same key).
- In-memory state is process-local and resets on redeploy or instance restart/cold-start. This is the safe direction to err on: worst case, the gate briefly under-enforces right after a restart (no memory of recent usage) — it never over-blocks a healthy app.
- No client-side (`ChatInterview.tsx`) auto-retry is added for this error. The server-side hold-and-delay already absorbs short bursts; a client-visible failure should be rare (only when the bound itself is exceeded), and the existing generic error-display path already shows `data.error` to the author — the 503's friendly message flows through that unchanged.

## Testing

No automated test framework exists in this repo (established convention) — verification is `npm run lint && npm run build`, plus a throwaway fixture script (written, run, then deleted, never committed) directly exercising `SlidingWindow`/`acquireAnthropicSlot`/`recordAnthropicUsage`: ceiling enforcement (a call requesting more than the configured limit in one shot is rejected/waits correctly), pruning (entries older than 60s stop counting), wait-then-succeed (a call that must wait for headroom eventually proceeds once earlier entries age out), and timeout-after-max-wait (`RateLimitTimeoutError` thrown when headroom never frees up within the bound). There is no live Anthropic account access in this sandbox for an end-to-end test — same constraint that applied to `priorityMatrix.ts` earlier this session.
