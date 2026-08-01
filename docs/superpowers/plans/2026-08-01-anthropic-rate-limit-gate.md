# Shared Anthropic Rate-Limit Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pace every Anthropic API call this app makes against configurable RPM/input-token/output-token ceilings, so a burst degrades into a brief in-process wait instead of a raw error surfaced to an author.

**Architecture:** A new standalone module (`web/src/lib/rateLimit/anthropicGate.ts`) tracks three in-memory sliding 60-second windows (requests, input tokens, output tokens). `extractTurn.ts`'s existing retry loop calls `acquireAnthropicSlot()` before each Anthropic call (waiting if near a ceiling, throwing `RateLimitTimeoutError` if the wait bound is exceeded) and `recordAnthropicUsage()` after, reconciling the pessimistic output-token estimate down to actual usage. `route.ts` catches the new error type and returns a friendly 503 instead of letting it surface as an unhandled failure.

**Tech Stack:** TypeScript, Next.js API routes, `@anthropic-ai/sdk`.

## Global Constraints

- No automated test framework exists in this repo. Verification is `npm run lint && npm run build` from `web/`, plus a throwaway fixture script (run via `npx tsx`, then deleted — never committed).
- In-memory, per-instance state only — no shared store (Firestore, Redis, etc.). Acceptable per the design spec given `apphosting.yaml`'s `maxInstances: 2` and current low traffic; resets on redeploy/restart, which is the safe direction to err on (under-enforces briefly rather than over-blocking).
- Config is env-overridable with conservative hardcoded defaults, explicitly commented as placeholders pending real Anthropic Console numbers: `ANTHROPIC_RPM_LIMIT` (40), `ANTHROPIC_ITPM_LIMIT` (30000), `ANTHROPIC_OTPM_LIMIT` (6000), `ANTHROPIC_GATE_MAX_WAIT_MS` (8000), `ANTHROPIC_GATE_POLL_MS` (250). The sliding-window duration itself is also env-overridable — `ANTHROPIC_GATE_WINDOW_MS` (default 60000) — added so the fixture script in Task 1 can verify pruning behavior in milliseconds instead of waiting a real 60 seconds; production always runs on the 60s default.
- The gate must not add a second network round-trip for token estimation — `estimateInputTokens` uses a `chars/4` heuristic, not a real Anthropic token-count call.
- `recordAnthropicUsage` must reconcile the *pessimistic* `maxOutputTokens` reservation down to the *actual* `response.usage.output_tokens` after each call — this is what keeps the output-token window from permanently over-counting.
- Do not touch `extractTurn.ts`'s existing schema-validation retry logic (`StateDeltaSchema.safeParse`, `StateDeltaValidationError`) — the rate-limit gate is additive, sitting around the existing `anthropic.messages.create()` call, not a replacement for any of it.

---

### Task 1: The rate-limit gate module

**Files:**
- Create: `web/src/lib/rateLimit/anthropicGate.ts`

**Interfaces:**
- Produces: `acquireAnthropicSlot(estimate: { inputTokens: number; maxOutputTokens: number }): Promise<{ outputEntryId: number }>`, `recordAnthropicUsage(reservation: { outputEntryId: number }, actualOutputTokens: number): void`, `estimateInputTokens(system: string, messages: Anthropic.MessageParam[]): number`, `class RateLimitTimeoutError extends Error`. These four are consumed by Task 2.

- [ ] **Step 1: Write the module**

Create `web/src/lib/rateLimit/anthropicGate.ts`:

```ts
import type Anthropic from "@anthropic-ai/sdk";

/**
 * Shared Anthropic rate-limit gate — paces every Anthropic API call this
 * app makes against configurable RPM/input-token/output-token ceilings, so
 * a burst degrades into a brief in-process wait instead of a raw error
 * surfaced to an author. See docs/superpowers/specs/2026-08-01-anthropic-
 * rate-limit-gate-design.md for the full rationale.
 *
 * In-memory, per-instance state only (apphosting.yaml's maxInstances: 2
 * means this doesn't coordinate across instances — accepted trade-off for
 * current traffic; resets on redeploy/restart, the safe direction to err
 * on). Not a replacement for the Anthropic SDK's own retry-with-backoff on
 * transient 429s/5xxs — this gate exists to avoid triggering those in the
 * first place; the SDK's reactive retry remains a safety net underneath it.
 */

// Placeholder defaults pending real numbers from the Anthropic Console —
// override via env vars once confirmed, no code change needed.
const RPM_LIMIT = Number(process.env.ANTHROPIC_RPM_LIMIT ?? 40);
const ITPM_LIMIT = Number(process.env.ANTHROPIC_ITPM_LIMIT ?? 30000);
const OTPM_LIMIT = Number(process.env.ANTHROPIC_OTPM_LIMIT ?? 6000);
const MAX_WAIT_MS = Number(process.env.ANTHROPIC_GATE_MAX_WAIT_MS ?? 8000);
const POLL_MS = Number(process.env.ANTHROPIC_GATE_POLL_MS ?? 250);
// Overridable only so the Task 1 fixture script can verify pruning without
// a real 60s wait — production always runs on the 60_000 default.
const WINDOW_MS = Number(process.env.ANTHROPIC_GATE_WINDOW_MS ?? 60_000);

interface WindowEntry {
  id: number;
  amount: number;
  ts: number;
}

class SlidingWindow {
  private entries: WindowEntry[] = [];
  private nextId = 1;

  private prune(now: number): void {
    this.entries = this.entries.filter((e) => now - e.ts < WINDOW_MS);
  }

  sum(now: number): number {
    this.prune(now);
    return this.entries.reduce((total, e) => total + e.amount, 0);
  }

  add(amount: number, now: number): number {
    const id = this.nextId++;
    this.entries.push({ id, amount, ts: now });
    return id;
  }

  adjust(id: number, newAmount: number): void {
    const entry = this.entries.find((e) => e.id === id);
    if (entry) entry.amount = newAmount;
  }
}

const requestWindow = new SlidingWindow();
const inputTokenWindow = new SlidingWindow();
const outputTokenWindow = new SlidingWindow();

export class RateLimitTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitTimeoutError";
  }
}

export interface AnthropicSlotEstimate {
  inputTokens: number;
  maxOutputTokens: number;
}

export interface AnthropicSlotReservation {
  outputEntryId: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Waits (bounded by ANTHROPIC_GATE_MAX_WAIT_MS) until granting `estimate`
 * would not exceed the RPM/ITPM/OTPM ceilings, then reserves that capacity
 * and returns a handle for recordAnthropicUsage to reconcile afterward.
 * Throws RateLimitTimeoutError if capacity never frees up in time.
 */
export async function acquireAnthropicSlot(
  estimate: AnthropicSlotEstimate
): Promise<AnthropicSlotReservation> {
  const deadline = Date.now() + MAX_WAIT_MS;

  for (;;) {
    const now = Date.now();
    const hasRoom =
      requestWindow.sum(now) + 1 <= RPM_LIMIT &&
      inputTokenWindow.sum(now) + estimate.inputTokens <= ITPM_LIMIT &&
      outputTokenWindow.sum(now) + estimate.maxOutputTokens <= OTPM_LIMIT;

    if (hasRoom) {
      requestWindow.add(1, now);
      inputTokenWindow.add(estimate.inputTokens, now);
      const outputEntryId = outputTokenWindow.add(estimate.maxOutputTokens, now);
      return { outputEntryId };
    }

    if (Date.now() + POLL_MS > deadline) {
      throw new RateLimitTimeoutError(
        `Anthropic rate-limit gate: no capacity available after waiting ${MAX_WAIT_MS}ms.`
      );
    }
    await sleep(POLL_MS);
  }
}

/**
 * Reconciles a reservation's pessimistic output-token estimate down to
 * what the call actually used, so later callers see accurate headroom
 * instead of permanent worst-case accounting.
 */
export function recordAnthropicUsage(
  reservation: AnthropicSlotReservation,
  actualOutputTokens: number
): void {
  outputTokenWindow.adjust(reservation.outputEntryId, actualOutputTokens);
}

/**
 * Rough chars/4 token estimate for pre-call pacing — deliberately not an
 * exact count. Calling Anthropic's own token-counting endpoint first would
 * add a second network round-trip and itself count against the very limit
 * being managed, defeating the purpose. The gate is a pacing safety
 * margin, not an exact accounting system.
 */
export function estimateInputTokens(system: string, messages: Anthropic.MessageParam[]): number {
  const messageChars = messages.reduce((sum, m) => {
    if (typeof m.content === "string") return sum + m.content.length;
    if (Array.isArray(m.content)) {
      return (
        sum +
        m.content.reduce((blockSum, block) => {
          if ("text" in block && typeof block.text === "string") {
            return blockSum + block.text.length;
          }
          return blockSum;
        }, 0)
      );
    }
    return sum;
  }, 0);
  return Math.ceil((system.length + messageChars) / 4);
}
```

- [ ] **Step 2: Write and run the throwaway fixture script**

Create a temporary file `web/src/lib/rateLimit/tmp-fixture.ts` (this file is deleted at the end of this step — never committed):

```ts
process.env.ANTHROPIC_RPM_LIMIT = "100";
process.env.ANTHROPIC_ITPM_LIMIT = "10000";
process.env.ANTHROPIC_OTPM_LIMIT = "50";
process.env.ANTHROPIC_GATE_MAX_WAIT_MS = "1200";
process.env.ANTHROPIC_GATE_POLL_MS = "100";

const { acquireAnthropicSlot, recordAnthropicUsage, estimateInputTokens, RateLimitTimeoutError } = await import(
  "./anthropicGate"
);

let failed = false;
function assert(cond: boolean, message: string): void {
  if (!cond) {
    console.error(`FAIL: ${message}`);
    failed = true;
  } else {
    console.log(`PASS: ${message}`);
  }
}

// estimateInputTokens: chars/4, system + all message content.
const tokens = estimateInputTokens("0123456789", [
  { role: "user", content: "01234567890123456789" },
]);
assert(tokens === Math.ceil((10 + 20) / 4), `estimateInputTokens returned ${tokens}, expected 8`);

// First acquire (5 input, 40 of the 50 OTPM ceiling) succeeds immediately.
const r1 = await acquireAnthropicSlot({ inputTokens: 5, maxOutputTokens: 40 });
assert(typeof r1.outputEntryId === "number", "first acquire succeeds, returns a reservation");

// Second acquire needs 40 more output tokens (40+40=80 > OTPM_LIMIT=50) - must wait,
// nothing frees up within MAX_WAIT_MS, so it times out.
const start = Date.now();
try {
  await acquireAnthropicSlot({ inputTokens: 5, maxOutputTokens: 40 });
  assert(false, "second acquire should have thrown RateLimitTimeoutError");
} catch (err) {
  const elapsed = Date.now() - start;
  assert(err instanceof RateLimitTimeoutError, `second acquire threw the right error type (got ${err})`);
  assert(elapsed >= 1200, `second acquire waited at least MAX_WAIT_MS before failing (waited ${elapsed}ms)`);
}

// Reconcile r1's pessimistic 40-token reservation down to 5 actual output tokens -
// frees enough OTPM headroom (5 + 40 = 45 <= 50) for the same request to now succeed.
recordAnthropicUsage(r1, 5);
const r2 = await acquireAnthropicSlot({ inputTokens: 5, maxOutputTokens: 40 });
assert(typeof r2.outputEntryId === "number", "acquire succeeds immediately after reconciliation frees headroom");

if (failed) {
  console.error("\nFixture script FAILED.");
  process.exitCode = 1;
} else {
  console.log("\nAll fixture checks passed.");
}
```

Run it from `web/`:

```bash
npx tsx src/lib/rateLimit/tmp-fixture.ts
```

Expected output: five `PASS:` lines and `All fixture checks passed.` — if any line reads `FAIL:`, fix `anthropicGate.ts` before continuing (do not fix the fixture script to hide a real bug).

This first script covers ceiling enforcement, timeout, and reconciliation, but deliberately uses a long window relative to its wait budget so the timeout case is genuine (nothing frees up in time) — which means it can't also demonstrate pruning (an entry aging out naturally) without the two behaviors racing each other. Write a second, separate temporary file `web/src/lib/rateLimit/tmp-fixture-pruning.ts` for that, using a short window instead:

```ts
process.env.ANTHROPIC_RPM_LIMIT = "100";
process.env.ANTHROPIC_ITPM_LIMIT = "10000";
process.env.ANTHROPIC_OTPM_LIMIT = "50";
process.env.ANTHROPIC_GATE_WINDOW_MS = "400";
process.env.ANTHROPIC_GATE_MAX_WAIT_MS = "2000";
process.env.ANTHROPIC_GATE_POLL_MS = "100";

const { acquireAnthropicSlot } = await import("./anthropicGate");

let failed = false;
function assert(cond: boolean, message: string): void {
  if (!cond) {
    console.error(`FAIL: ${message}`);
    failed = true;
  } else {
    console.log(`PASS: ${message}`);
  }
}

// Fill the OTPM ceiling (50) with a single reservation. No reconciliation
// happens here, so the only way this frees up is the entry aging out past
// ANTHROPIC_GATE_WINDOW_MS (400ms) - this isolates pruning specifically,
// separate from the reconciliation path the other fixture script covers.
await acquireAnthropicSlot({ inputTokens: 1, maxOutputTokens: 50 });

const start = Date.now();
await acquireAnthropicSlot({ inputTokens: 1, maxOutputTokens: 50 });
const elapsed = Date.now() - start;

assert(elapsed >= 400, `second acquire waited for the first entry to prune out (waited ${elapsed}ms, window is 400ms)`);
assert(elapsed < 2000, `second acquire succeeded via pruning, well before MAX_WAIT_MS (waited ${elapsed}ms, budget was 2000ms)`);

if (failed) {
  console.error("\nPruning fixture FAILED.");
  process.exitCode = 1;
} else {
  console.log("\nPruning fixture passed.");
}
```

Run it from `web/`:

```bash
npx tsx src/lib/rateLimit/tmp-fixture-pruning.ts
```

Expected output: two `PASS:` lines and `Pruning fixture passed.`

- [ ] **Step 3: Delete both fixture scripts**

```bash
rm web/src/lib/rateLimit/tmp-fixture.ts web/src/lib/rateLimit/tmp-fixture-pruning.ts
```

- [ ] **Step 4: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass. (Nothing imports this new module yet, so this only confirms the module itself is well-typed and lint-clean in isolation.)

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/rateLimit/anthropicGate.ts
git commit -m "feat: add shared Anthropic rate-limit gate"
```

---

### Task 2: Wire the gate into `extractTurn`

**Files:**
- Modify: `web/src/lib/canonEngine/extractTurn.ts`

**Interfaces:**
- Consumes: `acquireAnthropicSlot`, `recordAnthropicUsage`, `estimateInputTokens`, `RateLimitTimeoutError` from `web/src/lib/rateLimit/anthropicGate.ts` (Task 1).
- Produces: `extractTurn()` now throws `RateLimitTimeoutError` (uncaught inside this function, propagating to its caller) when the gate's wait bound is exceeded — consumed by Task 3.

- [ ] **Step 1: Add the import**

In `web/src/lib/canonEngine/extractTurn.ts`, the current imports (lines 1-2) are:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { StateDeltaSchema, type StateDelta } from "./stateDelta";
```

Change to:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { StateDeltaSchema, type StateDelta } from "./stateDelta";
import { acquireAnthropicSlot, recordAnthropicUsage, estimateInputTokens } from "@/lib/rateLimit/anthropicGate";
```

- [ ] **Step 2: Gate the call inside the retry loop**

The current loop body (lines 104-122) is:

```ts
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await params.anthropic.messages.create({
      model: params.model,
      // 1536 was too tight for a substantial natural-language reply plus the
      // structured updates payload in the same forced tool call - the model
      // would truncate mid-JSON (reply complete, updates/conflict_detected/
      // stage_ready_to_advance left undefined), failing schema validation on
      // both retry attempts and surfacing as a slow 502 in production
      // (2026-07-30: 4 failures, ~44-48s each, same session). `context` (the
      // long-form reasoning field) is deliberately ordered last in
      // EMIT_TURN_TOOL's properties/required, after updates/conflict_detected/
      // stage_ready_to_advance, so a similar mid-JSON truncation drops the
      // free-text field instead of the short required ones again.
      max_tokens: params.maxTokens ?? 4096,
      system: params.system,
      messages: params.messages,
      tools: [EMIT_TURN_TOOL],
      tool_choice: { type: "tool", name: "emit_turn" },
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse) {
      lastError = new Error("Model response contained no tool_use block for emit_turn.");
      continue;
    }
```

Change to:

```ts
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const maxOutputTokens = params.maxTokens ?? 4096;
    const reservation = await acquireAnthropicSlot({
      inputTokens: estimateInputTokens(params.system, params.messages),
      maxOutputTokens,
    });

    const response = await params.anthropic.messages.create({
      model: params.model,
      // 1536 was too tight for a substantial natural-language reply plus the
      // structured updates payload in the same forced tool call - the model
      // would truncate mid-JSON (reply complete, updates/conflict_detected/
      // stage_ready_to_advance left undefined), failing schema validation on
      // both retry attempts and surfacing as a slow 502 in production
      // (2026-07-30: 4 failures, ~44-48s each, same session). `context` (the
      // long-form reasoning field) is deliberately ordered last in
      // EMIT_TURN_TOOL's properties/required, after updates/conflict_detected/
      // stage_ready_to_advance, so a similar mid-JSON truncation drops the
      // free-text field instead of the short required ones again.
      max_tokens: maxOutputTokens,
      system: params.system,
      messages: params.messages,
      tools: [EMIT_TURN_TOOL],
      tool_choice: { type: "tool", name: "emit_turn" },
    });

    recordAnthropicUsage(reservation, response.usage.output_tokens);

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse) {
      lastError = new Error("Model response contained no tool_use block for emit_turn.");
      continue;
    }
```

(`acquireAnthropicSlot` can throw `RateLimitTimeoutError`. This function has no try/catch around the loop body, so that error propagates straight out of `extractTurn()` to its caller — exactly like any other unexpected error already does today. Task 3 adds the catch for it in `route.ts`.)

- [ ] **Step 3: Verify**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/canonEngine/extractTurn.ts
git commit -m "feat: gate extractTurn's Anthropic calls through the rate-limit gate"
```

---

### Task 3: Friendly error response in the chat route

**Files:**
- Modify: `web/src/app/api/chat/route.ts`

**Interfaces:**
- Consumes: `RateLimitTimeoutError` from `web/src/lib/rateLimit/anthropicGate.ts` (Task 1); `extractTurn()` now possibly throwing it (Task 2).

- [ ] **Step 1: Add the import**

In `web/src/app/api/chat/route.ts`, the current import (line 30) is:

```ts
import { extractTurn, StateDeltaValidationError } from "@/lib/canonEngine/extractTurn";
```

Change to:

```ts
import { extractTurn, StateDeltaValidationError } from "@/lib/canonEngine/extractTurn";
import { RateLimitTimeoutError } from "@/lib/rateLimit/anthropicGate";
```

- [ ] **Step 2: Catch it and return a 503**

The current catch block around the `extractTurn()` call (lines 232-249) is:

```ts
    let delta;
    try {
      delta = await extractTurn({
        anthropic,
        model: "claude-sonnet-5",
        system,
        messages,
      });
    } catch (err) {
      if (err instanceof StateDeltaValidationError) {
        console.error("State delta extraction failed:", err);
        return NextResponse.json(
          { error: "The interview couldn't produce a valid response. Please try again." },
          { status: 502 }
        );
      }
      throw err;
    }
```

Change to:

```ts
    let delta;
    try {
      delta = await extractTurn({
        anthropic,
        model: "claude-sonnet-5",
        system,
        messages,
      });
    } catch (err) {
      if (err instanceof RateLimitTimeoutError) {
        console.warn("Anthropic rate-limit gate timed out:", err);
        return NextResponse.json(
          { error: "StoriMac is handling a lot of requests right now — please try again in a moment." },
          { status: 503 }
        );
      }
      if (err instanceof StateDeltaValidationError) {
        console.error("State delta extraction failed:", err);
        return NextResponse.json(
          { error: "The interview couldn't produce a valid response. Please try again." },
          { status: 502 }
        );
      }
      throw err;
    }
```

- [ ] **Step 3: Verify**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/api/chat/route.ts
git commit -m "feat: return a friendly 503 when the rate-limit gate times out"
```
