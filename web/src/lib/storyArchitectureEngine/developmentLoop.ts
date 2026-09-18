import { STRUCTURAL_STEPS, CRITICAL_BEAT_LOOKUP, type StructuralStep } from "./structuralFramework";
import type { CanonStatus } from "@/lib/canonEngine/types";
import { setUnitStatus, type StructuralUnit } from "./stateLedger";

/**
 * The single- and multi-route development loop's deterministic pieces —
 * GitHub issues #59 (Blueprint Priority route, placement guardrail,
 * status-transition gate) and #61 (Chronological/Custom routes, route
 * switching), PRD §7.3 FR-3.2/FR-3.3, §7.4 FR-4.2/FR-4.4, Framework v3.0
 * §5. The actual semantic Core-Purpose judgment (AC2) is NOT implemented
 * here — see docs/superpowers/specs/2026-09-10-development-loop-design.md's
 * "Decision" section for why a deterministic function can't honestly do
 * that; `attemptStatusTransition` below only enforces that a validation
 * result was supplied before a Working/Confirmed transition, leaving the
 * judgment itself to a future live agent's system-prompt-driven turn.
 */

/**
 * Framework v3.0 §5, Option A: Frame -> Final Image -> Spark -> Midpoint
 * -> Set Pieces 1-6 in order (anchor-first). "The Final Image" is v3.0's
 * routing-menu name for Step 10 (Plot Point 4, "The New Baseline") - same
 * step, per issue #58's own note. This same ordering fact is also
 * described in prose in onboardingGate.ts's `ROUTING_PROMPT` (issue
 * #57) - the two are not derived from each other, so check both if this
 * order ever changes.
 */
export const BLUEPRINT_PRIORITY_ORDER: number[] = [1, 10, 3, 6, 2, 4, 5, 7, 8, 9];

export interface PlacementDeviationCheck {
  flagged: boolean;
  message: string | null;
}

/**
 * No source document (PRD, Framework doc, or issue #59's own AC) states
 * a numeric deviation threshold - PRD §12 explicitly lists this as an
 * open UX question ("needs UX clarity"). This value is a chosen
 * default, not a sourced one - the knob to tune once BA/UX settles the
 * open question, matching this module's own "never invent an
 * unspecified rule silently" convention (see onboardingGate.ts's
 * addressable-flag disclosure, issue #57).
 */
const DEVIATION_THRESHOLD_PERCENT = 10;

function parsePlacementPercent(placementMark: string | null): number | null {
  if (!placementMark) return null;
  const match = placementMark.match(/(\d+)%/);
  return match ? Number(match[1]) : null;
}

/**
 * AC3: placement percentage marks are a loose guardrail - flagged, never
 * blocked. Checks the step's own `placementMark` first, falling back to
 * its nested critical beat's `placementMark` (issue #58's data model:
 * most Set Pieces carry their percent mark on the nested beat, not the
 * step itself) - together these cover all 7 of the framework's real
 * percent-bearing marks (5%, 10%, 20%, 22%, 50%, 75%, 80%). A step/beat
 * with no percent-bearing mark anywhere (Steps 1, 9, 10) has nothing to
 * deviate from and is never flagged.
 */
export function checkPlacementDeviation(step: StructuralStep, proposedPositionPercent: number): PlacementDeviationCheck {
  const mark = step.placementMark ?? step.criticalBeats[0]?.placementMark ?? null;
  const target = parsePlacementPercent(mark);
  if (target === null) {
    return { flagged: false, message: null };
  }
  const deviation = Math.abs(proposedPositionPercent - target);
  if (deviation > DEVIATION_THRESHOLD_PERCENT) {
    return {
      flagged: true,
      message: `${step.title} is targeted around the ${mark}, but the proposed position (${proposedPositionPercent}%) deviates by ${deviation} percentage points. This is a loose guardrail, not a hard block - confirm with the author before proceeding.`,
    };
  }
  return { flagged: false, message: null };
}

export interface ContentValidationResult {
  valid: boolean;
  reason?: string;
}

export interface StatusTransitionAttempt {
  unit: StructuralUnit;
  accepted: boolean;
  reason?: string;
}

const STATUSES_REQUIRING_VALIDATION: CanonStatus[] = ["Working", "Confirmed"];

/**
 * AC2: validates before marking Working/Confirmed. The validation
 * judgment itself is supplied by the caller (a future live agent's
 * semantic turn) - this function only enforces that a passing result
 * was supplied before allowing the transition. It does NOT enforce
 * lifecycle legality (e.g. Confirmed -> Exploring/Working, which
 * `canonEngine/transitions.ts`'s `isValidTransition` would reject for a
 * canon element) - that guard now lives in architecture-chat/route.ts's
 * Canon Revision Path (issue #64), checked with `isValidTransition`
 * directly before this function is ever called for a given turn,
 * matching issue #62's own already-accepted scope note on
 * `setUnitStatus`. A rejected
 * attempt returns the ORIGINAL unit unchanged, never a partial update.
 */
export function attemptStatusTransition(
  unit: StructuralUnit,
  targetStatus: CanonStatus,
  validation: ContentValidationResult,
  now?: string
): StatusTransitionAttempt {
  const requiresValidation = STATUSES_REQUIRING_VALIDATION.includes(targetStatus);
  if (requiresValidation && !validation.valid) {
    return {
      unit,
      accepted: false,
      reason: validation.reason ?? "Proposed content does not satisfy this step's Core Purpose.",
    };
  }
  return { unit: setUnitStatus(unit, targetStatus, now), accepted: true };
}

export interface CausalGateResult {
  ok: boolean;
  reason?: string;
}

/**
 * FR-6.3: gates Confirmed only - unlike attemptStatusTransition's
 * Core-Purpose gate (which blocks both Working and Confirmed), issue
 * #63's own acceptance criteria only says a unit "cannot reach
 * Confirmed status" while its causal tag is unvalidated/episodic.
 * Step 1 (The Frame) is the screenplay's one unit with no causal
 * predecessor - the null-tag exemption below cross-checks that claim
 * against activeStepNumber, another field the model self-reports, not
 * a value the app independently derives (no per-unit story position is
 * tracked yet - that's #70/#71's territory). This narrows the exemption
 * to a two-field bypass rather than verifying it outright; final
 * whole-branch review for #63 judged that acceptable because the
 * consequence (Confirmed status) is still owned entirely by this
 * deterministic gate, and a misfired exemption still surfaces as
 * `causalTag: "UNVALIDATED"` in the compiled document rather than as a
 * false "Therefore"/"But" certification.
 */
export function evaluateCausalGate(
  targetStatus: CanonStatus,
  reportedTag: "Therefore" | "But" | "And Then" | null,
  activeStepNumber: number | null,
  reason?: string
): CausalGateResult {
  if (targetStatus !== "Confirmed") {
    return { ok: true };
  }
  if (reportedTag === "Therefore" || reportedTag === "But") {
    return { ok: true };
  }
  if (reportedTag === null && activeStepNumber === 1) {
    return { ok: true };
  }
  // The model's own `reason` only ever explains an "And Then" report -
  // for the null-outside-Step-1 case it explains the (wrong) null claim
  // instead, which reads as a non-sequitur next to this rejection. Only
  // surface it for the case it actually applies to; every other
  // rejection gets the actionable default (also the floor for an
  // empty/whitespace-only reason, final whole-branch review findings
  // M1/M2).
  const defaultReason =
    "This transition reads as coincidence-driven (\"And Then\") rather than causal - propose a Therefore/But alternative before confirming.";
  return {
    ok: false,
    reason: reportedTag === "And Then" && reason && reason.trim() ? reason : defaultReason,
  };
}

export interface SceneFormatCheckResult {
  ok: boolean;
  reason?: string;
}

const SLUGLINE_PATTERN = /^\s*SCENE\s+\S+\s*:\s*(INT\.\s*\/\s*EXT\.|INT\.|EXT\.)/i;
export const CRITICAL_BEAT_TAG_PATTERN = /\[CRITICAL BEAT:\s*([^\]]+)\]/i;

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
  // Final whole-branch review finding I1: a closing quote/paren right
  // after the terminal punctuation (dialogue, a parenthetical) used to
  // break the match and swallow that sentence into its neighbor - a
  // real false-rejection risk since this gates Working, the most
  // common status on every routine turn, and quoted dialogue is
  // ordinary for a scene built around a Thematic Core or Midpoint
  // declaration.
  const matches = trimmed.match(/[^.!?]+[.!?]+["'”’)\]]*(?:\s|$)/g);
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

export interface ParsedSceneRegisterEntry {
  slugline: string;
  criticalBeatTag: string | null;
  paragraph: string;
}

/**
 * Parses a Scene Register entry's already-validated shape into its
 * separate parts, for the compiler (issue #70) to render structurally
 * - checkSceneRegisterFormat above already isolates the same three
 * pieces internally but only ever returns a pass/fail verdict. Never
 * throws: a unit whose content is malformed (only reachable if the
 * author overrode issue #91's Formatting Check) degrades to
 * disclosed placeholder text rather than crashing the compile.
 */
export function parseSceneRegisterEntry(content: string): ParsedSceneRegisterEntry {
  const trimmed = content.trim();
  const firstNewline = trimmed.search(/\r?\n/);
  const firstLine = firstNewline === -1 ? trimmed : trimmed.slice(0, firstNewline);
  const rest = firstNewline === -1 ? "" : trimmed.slice(firstNewline).trim();

  const slugline = SLUGLINE_PATTERN.test(firstLine) ? firstLine.trim() : "(malformed - no slugline found)";

  const beatMatch = trimmed.match(CRITICAL_BEAT_TAG_PATTERN);
  const criticalBeatTag =
    beatMatch && CRITICAL_BEAT_LOOKUP[beatMatch[1].trim().toUpperCase()]
      ? beatMatch[1].trim().toUpperCase()
      : null;

  const paragraph = rest ? rest.replace(CRITICAL_BEAT_TAG_PATTERN, "").trim() || trimmed : trimmed;

  return { slugline, criticalBeatTag, paragraph };
}

export type RoutingChoice = "A" | "B" | "C";

/**
 * Option A: `BLUEPRINT_PRIORITY_ORDER` (issue #59). Option B: every
 * `STRUCTURAL_STEPS` step number in its own already-sorted order (PRD
 * FR-3.2B) - derived, not hand-duplicated, so it can't desync from
 * issue #58's canonical step list. Option C: no fixed order - `null`
 * signals "the author names the next step," not an error or an empty
 * route. All three options' descriptions are also stated in prose in
 * onboardingGate.ts's `ROUTING_PROMPT` (issue #57) - the two are not
 * derived from each other, so check both if any option's behavior ever
 * changes.
 *
 * The return type is `readonly number[] | null` because Option A hands
 * out the actual `BLUEPRINT_PRIORITY_ORDER` reference (not a copy) -
 * marking it read-only prevents a caller from mutating that shared
 * array and corrupting Option A process-wide for every later caller.
 *
 * `routingChoice` is expected to always be one of the three literal
 * `RoutingChoice` values - if this is ever called with an invalid
 * runtime string that TypeScript didn't catch (e.g. an un-guarded value
 * parsed from an author's free-text reply, a future LLM/user boundary
 * this function has no visibility into), the switch has no `default`
 * and would return `undefined` at runtime despite the `| null`
 * signature. TypeScript's own exhaustiveness check only protects
 * well-typed callers; validating an untrusted string is out of this
 * issue's scope and is the responsibility of whatever future code
 * parses the author's actual choice.
 */
export function getRouteOrder(routingChoice: RoutingChoice): readonly number[] | null {
  switch (routingChoice) {
    case "A":
      return BLUEPRINT_PRIORITY_ORDER;
    case "B":
      return STRUCTURAL_STEPS.map((step) => step.stepNumber);
    case "C":
      return null;
  }
}

export interface RoutingState {
  routingChoice: RoutingChoice;
}

/**
 * FR-3.3: switching carries no penalty or data loss. `RoutingState`
 * holds only the choice itself, never `StructuralUnit`/ledger data, so
 * there is nothing for THIS function to lose today - but the spread
 * (rather than a hand-written literal) keeps that guarantee true even
 * if `RoutingState` ever grows a second field, instead of silently
 * dropping whatever a future caller added.
 */
export function switchRoute(state: RoutingState, newChoice: RoutingChoice): RoutingState {
  return { ...state, routingChoice: newChoice };
}
