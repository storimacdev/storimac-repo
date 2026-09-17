# P4 Scene Register Format Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement GitHub issue #66 — a `Working`/`Confirmed` scene submission missing its
slugline, carrying a fabricated Critical Beat tag, or whose explanatory paragraph isn't exactly
3-4 sentences is rejected with a revision request, not silently accepted.

**Architecture:** Adds one more deterministic app-side check to the exact combined-gate pattern
#63 (Causality) and #111 (Core-Purpose) already established — a new pure function parses the
already-existing `content` string (no new schema field), and its result is ANDed into the same
`combinedValid`/`combinedReason` the route already builds before the single, unchanged call to
`attemptStatusTransition`.

**Tech Stack:** A plain TypeScript pure function (`developmentLoop.ts`) and its call site in the
Next.js API route (`architecture-chat/route.ts`).

## Global Constraints

- No test suite exists in this project — verification is `npx tsc --noEmit`, `npm run lint`,
  `npm run build`, and a direct code trace.
- `attemptStatusTransition` (already reviewed and shipped in #62/#111) must be completely
  unchanged — the new check is combined into the `valid`/`reason` values the route already
  builds for it, not injected into that function itself.
- No new schema field. The check parses the existing `proposed_unit.content` string directly —
  sp04 Section 5 already instructs the model on the exact required format; this issue is purely
  about adding the missing app-side backstop, not changing what the model is told to produce.
- The check gates both `Working` and `Confirmed` (format is a baseline content bar), unlike
  Causality's narrower Confirmed-only scope — match Core-Purpose validation's scope instead.
- The check never REQUIRES a `[CRITICAL BEAT: <NAME>]` tag to be present — only validates the
  tag's value against `structuralFramework.ts`'s existing `CRITICAL_BEAT_LOOKUP` when the model
  already chose to include one. Determining whether a tag is required for a given scene is left
  entirely to the model (already instructed in sp04 §5) — the app has no reliable, non-fragile
  way to know this itself.
- Design spec: `docs/superpowers/specs/2026-09-17-p4-scene-register-format-design.md`.

---

### Task 1: Scene Register format check, wired into the combined gate

**Files:**
- Modify: `web/src/lib/storyArchitectureEngine/developmentLoop.ts`
- Modify: `web/src/app/api/architecture-chat/route.ts`

**Interfaces:**
- Produces: `checkSceneRegisterFormat(content: string): SceneFormatCheckResult` (`developmentLoop.ts`) — a pure function, no side effects.
- Consumes: `CRITICAL_BEAT_LOOKUP` from `./structuralFramework` (already exists, unchanged).
- Consumes: `attemptStatusTransition(unit, targetStatus, validation: { valid: boolean; reason?: string }, now?): StatusTransitionAttempt` (already exists, unchanged) — this task's only integration point is the third term ANDed into the `valid`/`reason` the route already computes before calling it.

- [ ] **Step 1: Add `checkSceneRegisterFormat` to `developmentLoop.ts`**

  In `web/src/lib/storyArchitectureEngine/developmentLoop.ts`, add `CRITICAL_BEAT_LOOKUP` to
  the existing import from `./structuralFramework` (currently `import { STRUCTURAL_STEPS, type
  StructuralStep } from "./structuralFramework";` — change to `import { STRUCTURAL_STEPS,
  CRITICAL_BEAT_LOOKUP, type StructuralStep } from "./structuralFramework";`).

  Add this new exported interface and function right after `evaluateCausalGate`'s closing brace
  (after the blank line following it, before `export type RoutingChoice`):

  ```ts
  export interface SceneFormatCheckResult {
    ok: boolean;
    reason?: string;
  }

  const SLUGLINE_PATTERN = /^\s*SCENE\s+\S+\s*:\s*(INT\.\s*\/\s*EXT\.|INT\.|EXT\.)/i;
  const CRITICAL_BEAT_TAG_PATTERN = /\[CRITICAL BEAT:\s*([^\]]+)\]/i;

  /**
   * Splits on sentence-ending punctuation (. ! ?) followed by whitespace
   * or end of string - a standard approximation, not a linguistically
   * perfect parser (same disclosed-limitation class as
   * parsePlacementPercent's own regex-based extraction above). Good
   * enough to catch the issue's own test case (a 2-sentence submission)
   * without over-engineering abbreviation handling this module has no
   * real use for.
   */
  function countSentences(text: string): number {
    const trimmed = text.trim();
    if (!trimmed) return 0;
    const matches = trimmed.match(/[^.!?]+[.!?]+(?:\s|$)/g);
    return matches ? matches.length : 1;
  }

  /**
   * Framework v3.0 §3 / P4 Prompt v3.0 §4 (issue #66): every scene must
   * open with a slugline, carry a [CRITICAL BEAT: <NAME>] tag only when
   * it genuinely matches one of the 10 real tags
   * (CRITICAL_BEAT_LOOKUP), and its explanatory paragraph must be
   * exactly 3-4 sentences. Deliberately does NOT require a beat tag to
   * be present at all - the app has no reliable way to know whether
   * THIS scene is supposed to fulfill a Critical Beat without either
   * trusting the model's self-report (which defeats an app-side check)
   * or inferring it from active_step_number in a way that would be
   * fragile for a step with zero or multiple candidate scenes. It only
   * validates a tag's VALUE when the model already chose to include
   * one - sp04 Section 5 already instructs the model on when a tag
   * belongs.
   */
  export function checkSceneRegisterFormat(content: string): SceneFormatCheckResult {
    const trimmed = content.trim();
    const firstNewline = trimmed.search(/\r?\n/);
    const firstLine = firstNewline === -1 ? trimmed : trimmed.slice(0, firstNewline);
    const rest = firstNewline === -1 ? "" : trimmed.slice(firstNewline).trim();

    if (!SLUGLINE_PATTERN.test(firstLine)) {
      return {
        ok: false,
        reason:
          'Missing or malformed slugline - every scene must open with "SCENE [X]: [INT./EXT. LOCATION - TIME OF DAY]".',
      };
    }

    const beatMatch = trimmed.match(CRITICAL_BEAT_TAG_PATTERN);
    if (beatMatch) {
      const tagName = beatMatch[1].trim().toUpperCase();
      if (!CRITICAL_BEAT_LOOKUP[tagName]) {
        return {
          ok: false,
          reason: `"${tagName}" is not one of the 10 recognized Critical Beat tags.`,
        };
      }
    }

    const paragraph = rest.replace(CRITICAL_BEAT_TAG_PATTERN, "").trim();
    const sentenceCount = countSentences(paragraph);
    if (sentenceCount < 3 || sentenceCount > 4) {
      return {
        ok: false,
        reason: `The explanatory paragraph has ${sentenceCount} sentence(s) - it must be exactly 3-4 dense sentences.`,
      };
    }

    return { ok: true };
  }
  ```

- [ ] **Step 2: Wire it into the route's combined gate**

  In `web/src/app/api/architecture-chat/route.ts`, add `checkSceneRegisterFormat` to the
  existing `developmentLoop` import (currently `attemptStatusTransition, checkPlacementDeviation,
  switchRoute, evaluateCausalGate, type StatusTransitionAttempt` — add
  `checkSceneRegisterFormat` to that list).

  Replace this block (inside the ordinary-processing `else` branch):
  ```ts
            const causalGate = evaluateCausalGate(
              proposed.requested_status,
              proposed.causal_tag,
              delta.active_step_number,
              proposed.causal_tag_reason
            );
            const coreValid = delta.validation_result === "passed";
            const combinedValid = coreValid && causalGate.ok;
            const combinedReason = !coreValid ? delta.validation_reason : causalGate.reason;
  ```
  with:
  ```ts
            const causalGate = evaluateCausalGate(
              proposed.requested_status,
              proposed.causal_tag,
              delta.active_step_number,
              proposed.causal_tag_reason
            );
            const formatCheck = checkSceneRegisterFormat(proposed.content);
            const coreValid = delta.validation_result === "passed";
            const combinedValid = coreValid && causalGate.ok && formatCheck.ok;
            const combinedReason = !coreValid
              ? delta.validation_reason
              : !causalGate.ok
                ? causalGate.reason
                : formatCheck.reason;
  ```

  No other line in this block changes - `attemptStatusTransition`'s call, the causal-tag
  persistence logic below it, and everything else stays exactly as it is.

- [ ] **Step 3: Verify**

  From `web/`, run:
  ```bash
  npx tsc --noEmit -p .
  npm run lint
  npm run build
  ```
  All three must be clean. Then trace `checkSceneRegisterFormat` by hand (or a short throwaway
  `tsx` script, your choice) against at least these cases:
  - A well-formed 3-sentence entry with no beat tag → `{ ok: true }`
  - A well-formed 4-sentence entry with a real beat tag (`[CRITICAL BEAT: MIDPOINT]`) → `{ ok: true }`
  - A 2-sentence entry (the issue's own test case) → `{ ok: false, reason: <mentions "2 sentence(s)"> }`
  - Content missing the slugline entirely → `{ ok: false, reason: <mentions slugline> }`
  - Content with a fabricated tag (`[CRITICAL BEAT: FAKE BEAT]`) → `{ ok: false, reason: <mentions "not one of the 10"> }`
  - A 5-sentence entry → `{ ok: false }` (too many, not just too few)

- [ ] **Step 4: Commit**

  ```bash
  git add web/src/lib/storyArchitectureEngine/developmentLoop.ts web/src/app/api/architecture-chat/route.ts
  git commit -m "feat: enforce P4 Scene Register format (slugline, beat tag, sentence count) (issue #66)"
  ```
