import { checkLoopClosuresPlanted, type ContinuityMatrix, type ContinuityCheckResult } from "./continuityMatrix";

/**
 * Special Screenplay Processing Paths — GitHub issue #99, PRD refs
 * P5-Prompt5 SCREENPLAY EDITION v2.0 §6. Layers into Phase 2's drafting
 * output (issue #94) - these checks run on the same `draft_text` Phase
 * 2 already validates, as an additional pass for the three special-case
 * constructs the drafting engine must handle correctly.
 *
 * Montage marker formatting (`BEGIN MONTAGE:`/`END MONTAGE.`) is not
 * specified by the PRD - only flashback formatting is
 * (`BEGIN FLASHBACK:`/`END FLASHBACK.`). Decision made here: reuse the
 * identical begin/end marker convention the PRD does specify for
 * flashbacks, rather than inventing a different shape, per the parent
 * task's "smallest reasonable choice consistent with how the rest of
 * the system handles the analogous thing" guidance.
 */

export interface MarkerFinding {
  ok: boolean;
  count: number;
  reason: string;
}

function checkBalancedMarkers(draftText: string, beginPattern: RegExp, endPattern: RegExp, label: string): MarkerFinding {
  const lines = draftText.split("\n");
  let depth = 0;
  let count = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (beginPattern.test(trimmed)) {
      if (depth > 0) {
        return { ok: false, count, reason: `Nested or unclosed ${label} block - a new BEGIN appears before the previous one ends.` };
      }
      depth = 1;
      count += 1;
    } else if (endPattern.test(trimmed)) {
      if (depth === 0) {
        return { ok: false, count, reason: `END ${label} marker with no matching BEGIN.` };
      }
      depth = 0;
    }
  }
  if (depth !== 0) {
    return { ok: false, count, reason: `BEGIN ${label} marker with no matching END.` };
  }
  return { ok: true, count, reason: "" };
}

/** AC "Flashbacks/non-linear timelines": clear BEGIN FLASHBACK:/END
 * FLASHBACK. formatting with visual anchors to prevent reader
 * disorientation. The "visual anchor" requirement is satisfied by
 * requiring the markers themselves to be present and balanced -
 * genuinely checking the anchor's visual clarity is a model judgment,
 * covered by validateFlashbackJustification below. */
export function checkFlashbackMarkers(draftText: string): MarkerFinding {
  return checkBalancedMarkers(draftText, /^BEGIN FLASHBACK:?/i, /^END FLASHBACK\.?/i, "FLASHBACK");
}

/** AC: flashbacks are executed only if they directly alter a
 * character's present decision-making landscape. Model self-report,
 * validated only for presence/completeness - judging whether a given
 * flashback genuinely alters present decision-making is a creative
 * judgment, not something regex-checkable (same division of labor as
 * sceneDrafting.ts's Conflict Mandate/Enter Late-Leave Early). */
export function validateFlashbackJustification(
  flashbackPresent: boolean,
  justification: string
): { ok: boolean; reason: string } {
  if (!flashbackPresent) return { ok: true, reason: "" };
  if (!justification.trim()) {
    return {
      ok: false,
      reason: "A flashback is present but no justification was given for how it alters the present decision-making landscape.",
    };
  }
  return { ok: true, reason: "" };
}

/** AC "Montage sequences": compress routine time while preserving
 * emotional progression. Marker convention chosen above. */
export function checkMontageMarkers(draftText: string): MarkerFinding {
  return checkBalancedMarkers(draftText, /^BEGIN MONTAGE:?/i, /^END MONTAGE\.?/i, "MONTAGE");
}

export interface MontageShotReport {
  description: string;
  evolutionDescription: string;
}

/** AC: every shot in a montage shows clear character or relational
 * evolution, not filler. Deterministic completeness check (at least 2
 * shots, each with both fields non-empty) - whether a given evolution
 * description is genuinely non-filler is, again, a model judgment this
 * function does not second-guess. */
export function validateMontageShots(shots: MontageShotReport[]): { ok: boolean; reason: string } {
  if (shots.length < 2) {
    return { ok: false, reason: `A montage requires at least 2 shots to compress time meaningfully - got ${shots.length}.` };
  }
  const empty = shots.findIndex((s) => !s.description.trim() || !s.evolutionDescription.trim());
  if (empty !== -1) {
    return {
      ok: false,
      reason: `Montage shot ${empty + 1} is missing a description or an evolution description - every shot must show clear character/relational evolution, not filler.`,
    };
  }
  return { ok: true, reason: "" };
}

/** AC "Visual motifs & sound bridges": tracked via the Narrative Loop
 * Controls (issue #97) so a planted motif can be paid off later. This
 * module never mutates the Continuity Matrix itself (that only happens
 * on Confirm, issue #96) - it reuses #97's own
 * `checkLoopClosuresPlanted` so a draft proposing to close a
 * visual-motif/sound-cue loop is held to the same "must have been
 * planted first" rule as any other Open Loop closure. */
export function checkMotifAndSoundBridgeClosures(
  matrix: ContinuityMatrix,
  loopIdsToClose: string[]
): ContinuityCheckResult {
  return checkLoopClosuresPlanted(matrix, loopIdsToClose);
}

export interface SpecialProcessingValidation {
  ok: boolean;
  blockingReasons: string[];
}

export interface SpecialProcessingReports {
  flashback: { present: boolean; justification: string } | null;
  montage: { present: boolean; shots: MontageShotReport[] } | null;
  loopsToClose: string[];
}

/** Composite entry point for Phase 2's drafting route (issue #94) to
 * call alongside `validateSceneDraft`. */
export function validateSpecialProcessingPaths(
  draftText: string,
  matrix: ContinuityMatrix,
  reports: SpecialProcessingReports
): SpecialProcessingValidation {
  const blockingReasons: string[] = [];

  const flashbackMarkers = checkFlashbackMarkers(draftText);
  if (!flashbackMarkers.ok) blockingReasons.push(flashbackMarkers.reason);

  const flashbackJustification = validateFlashbackJustification(
    reports.flashback?.present ?? flashbackMarkers.count > 0,
    reports.flashback?.justification ?? ""
  );
  if (!flashbackJustification.ok) blockingReasons.push(flashbackJustification.reason);

  const montageMarkers = checkMontageMarkers(draftText);
  if (!montageMarkers.ok) blockingReasons.push(montageMarkers.reason);

  if (reports.montage?.present) {
    const montageShots = validateMontageShots(reports.montage.shots);
    if (!montageShots.ok) blockingReasons.push(montageShots.reason);
  }

  const loopClosures = checkMotifAndSoundBridgeClosures(matrix, reports.loopsToClose);
  if (!loopClosures.ok) blockingReasons.push(...loopClosures.violations.map((v) => v.message));

  return { ok: blockingReasons.length === 0, blockingReasons };
}
