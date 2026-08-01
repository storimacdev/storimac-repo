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

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(`[anthropicGate] ${name}="${raw}" is not a valid positive number - using default ${fallback}.`);
    return fallback;
  }
  return parsed;
}

// Placeholder defaults pending real numbers from the Anthropic Console —
// override via env vars once confirmed, no code change needed.
const RPM_LIMIT = envNumber("ANTHROPIC_RPM_LIMIT", 40);
const ITPM_LIMIT = envNumber("ANTHROPIC_ITPM_LIMIT", 30000);
// 32000 gives ~7 concurrent 4096-token (the current extractTurn.ts default
// max_tokens) reservations headroom before this gate itself becomes the
// binding constraint - reconciliation/pruning take 45-60s to free capacity
// (see the max_tokens comment in extractTurn.ts), far longer than
// ANTHROPIC_GATE_MAX_WAIT_MS, so the *ratio* between this ceiling and
// max_tokens matters more than the absolute number until real Anthropic
// Console limits are confirmed.
const OTPM_LIMIT = envNumber("ANTHROPIC_OTPM_LIMIT", 32000);
const MAX_WAIT_MS = envNumber("ANTHROPIC_GATE_MAX_WAIT_MS", 8000);
const POLL_MS = envNumber("ANTHROPIC_GATE_POLL_MS", 250);
// Overridable only so the Task 1 fixture script can verify pruning without
// a real 60s wait — production always runs on the 60_000 default.
const WINDOW_MS = envNumber("ANTHROPIC_GATE_WINDOW_MS", 60_000);

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
  let hasWarned = false;

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

    if (!hasWarned) {
      hasWarned = true;
      console.warn(
        `[anthropicGate] waiting for capacity - requests: ${requestWindow.sum(now)}/${RPM_LIMIT}, ` +
          `input tokens: ${inputTokenWindow.sum(now)}/${ITPM_LIMIT}, ` +
          `output tokens: ${outputTokenWindow.sum(now)}/${OTPM_LIMIT}`
      );
    }

    if (Date.now() >= deadline) {
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
