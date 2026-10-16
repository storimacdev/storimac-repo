/**
 * Phase 2 — Scene Drafting — GitHub issue #94, PRD refs P5-Prompt5
 * SCREENPLAY EDITION v2.0 §2 (Phase 2), §3 (Screenplay Narrative
 * Execution Standards), §4 (Dynamic Scene Construction Loop).
 *
 * Pure functions only. Several of §3's standards are fundamentally
 * creative-writing judgment calls (is this emotion conveyed through
 * behavior vs. told outright? is this dialogue truly subtextual?) that
 * no regex can safely adjudicate without a high false-positive/negative
 * rate - those stay model self-reported (same division of labor P4 uses
 * for Core-Purpose Validation: the model judges, the app only checks
 * the report isn't empty/contradictory). Two standards genuinely admit
 * deterministic structural checks on the drafted text itself (Lean
 * Action Paragraphs' line-count rule, and a banned-phrase scan for
 * on-the-nose internal-thought/camera-direction language) - those are
 * real app-side checks, kept advisory (findings, not hard failures)
 * because "whenever practical" in the PRD's own wording and the
 * unavoidable false-positive rate of phrase matching against creative
 * prose make a hard block the wrong default. Both kinds surface to the
 * author either way - nothing here is silently dropped.
 */

export type ScreenplayBlockKind = "heading" | "transition" | "dialogue" | "action" | "other";

export interface ScreenplayBlock {
  kind: ScreenplayBlockKind;
  text: string;
  lines: string[];
}

function isCharacterCueLine(line: string): boolean {
  const cleaned = line.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (!cleaned) return false;
  if (cleaned !== cleaned.toUpperCase()) return false;
  if (/[.!?]$/.test(cleaned)) return false;
  const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
  return wordCount > 0 && wordCount <= 5;
}

/** Splits a plain-text screenplay draft (blank-line-delimited blocks,
 * the shape this app stores drafts in - no fixed-width indentation) into
 * typed blocks. A character-cue-first block with more than one line is
 * dialogue; a slugline-first block is a heading; a standard transition
 * keyword is a transition; `BEGIN FLASHBACK:`/`END FLASHBACK.` markers
 * (issue #99) are tagged "other" so neither the lean-paragraph nor the
 * visual-discipline check misclassifies them as ordinary action. */
export function parseScreenplayBlocks(draftText: string): ScreenplayBlock[] {
  const rawBlocks = draftText
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  return rawBlocks.map((blockText) => {
    const lines = blockText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const first = lines[0] ?? "";

    if (/^(INT\.|EXT\.|INT\.\/EXT\.)/i.test(first)) {
      return { kind: "heading" as const, text: blockText, lines };
    }
    if (/^(CUT TO:|DISSOLVE TO:|FADE (IN|OUT)[:.]?|SMASH CUT TO:)/i.test(first)) {
      return { kind: "transition" as const, text: blockText, lines };
    }
    if (/^(BEGIN FLASHBACK|END FLASHBACK)/i.test(first)) {
      return { kind: "other" as const, text: blockText, lines };
    }
    if (lines.length > 1 && isCharacterCueLine(first)) {
      return { kind: "dialogue" as const, text: blockText, lines };
    }
    return { kind: "action" as const, text: blockText, lines };
  });
}

export interface LeanParagraphFinding {
  blockIndex: number;
  lineCount: number;
  excerpt: string;
}

/** AC "Lean Action Paragraphs": 3 lines or fewer whenever practical.
 * Advisory - see module header. */
export function checkLeanActionParagraphs(draftText: string): { ok: boolean; findings: LeanParagraphFinding[] } {
  const blocks = parseScreenplayBlocks(draftText);
  const findings: LeanParagraphFinding[] = [];
  blocks.forEach((b, i) => {
    if (b.kind === "action" && b.lines.length > 3) {
      findings.push({ blockIndex: i, lineCount: b.lines.length, excerpt: b.text.slice(0, 80) });
    }
  });
  return { ok: findings.length === 0, findings };
}

const INTERNAL_THOUGHT_PATTERNS: RegExp[] = [
  /\bthinks? to (himself|herself|themselves)\b/i,
  /\bfeels? (deep )?inside\b/i,
  /\brealizes? internally\b/i,
  /\bwonders? silently\b/i,
  /\bsecretly (believes|hopes|fears|wishes)\b/i,
  /\bin (his|her|their) mind\b/i,
  /\bknows? deep down\b/i,
  /\binwardly\b/i,
];

const CAMERA_DIRECTION_PATTERNS: RegExp[] = [
  /\bCLOSE (ON|UP)\b/i,
  /\bPAN (TO|ACROSS|LEFT|RIGHT)\b/i,
  /\bZOOM (IN|OUT)\b/i,
  /\bANGLE ON\b/i,
  /\bWE SEE\b/i,
  /\bCAMERA (PANS|TILTS|MOVES|PUSHES)\b/i,
  /\bPOV SHOT\b/i,
];

export interface VisualDisciplineFinding {
  blockIndex: number;
  kind: "internal_thought" | "camera_direction";
  matchedPhrase: string;
  excerpt: string;
}

/** AC "Strict Visual Discipline": zero internal thoughts or camera
 * directions. Scans only `action` blocks - a `transition` block's own
 * "CUT TO:" is a legitimate structural transition, not the directive
 * mid-action camera language this check targets. Advisory - see module
 * header for why a phrase scan can't safely hard-block. */
export function checkVisualDiscipline(draftText: string): { ok: boolean; findings: VisualDisciplineFinding[] } {
  const blocks = parseScreenplayBlocks(draftText);
  const findings: VisualDisciplineFinding[] = [];
  blocks.forEach((b, i) => {
    if (b.kind !== "action") return;
    for (const pattern of INTERNAL_THOUGHT_PATTERNS) {
      const m = b.text.match(pattern);
      if (m) findings.push({ blockIndex: i, kind: "internal_thought", matchedPhrase: m[0], excerpt: b.text.slice(0, 80) });
    }
    for (const pattern of CAMERA_DIRECTION_PATTERNS) {
      const m = b.text.match(pattern);
      if (m) findings.push({ blockIndex: i, kind: "camera_direction", matchedPhrase: m[0], excerpt: b.text.slice(0, 80) });
    }
  });
  return { ok: findings.length === 0, findings };
}

/** AC "Conflict Mandate": model self-report, validated for completeness
 * only - judging whether the opposition is genuinely dramatically
 * active is the model's job (same division as P4's Core-Purpose
 * Validation); this function only refuses an empty or self-contradictory
 * report, the same way developmentLoop.ts's evaluateCausalGate refuses
 * an empty causal_tag_reason rather than judging the reasoning itself. */
export interface ConflictMandateReport {
  present: boolean;
  oppositionDescription: string;
  permanentShiftDescription: string;
}

export function validateConflictMandateReport(report: ConflictMandateReport): { ok: boolean; reason: string } {
  if (!report.present) {
    return {
      ok: false,
      reason:
        "No active opposition reported for this scene - every scene requires one (competing goals, social pressure, time limits, or environmental barriers).",
    };
  }
  if (!report.oppositionDescription.trim()) {
    return { ok: false, reason: "Opposition reported present but no description given." };
  }
  if (!report.permanentShiftDescription.trim()) {
    return {
      ok: false,
      reason:
        "No permanent shift in plot, power dynamics, or character knowledge described - a scene where nothing changes fails the Conflict Mandate.",
    };
  }
  return { ok: true, reason: "" };
}

/** AC "Enter Late, Leave Early": same self-report-validated-for-
 * completeness pattern as the Conflict Mandate above. */
export interface EnterLateLeaveEarlyReport {
  enteredLate: boolean;
  leftEarly: boolean;
  reason: string;
}

export function validateEnterLateLeaveEarlyReport(report: EnterLateLeaveEarlyReport): {
  ok: boolean;
  reason: string;
} {
  if (!report.reason.trim()) {
    return { ok: false, reason: "No justification given for Enter Late, Leave Early compliance." };
  }
  if (!report.enteredLate || !report.leftEarly) {
    return {
      ok: false,
      reason: `Scene does not enter late / leave early (enteredLate: ${report.enteredLate}, leftEarly: ${report.leftEarly}) - ${report.reason}`,
    };
  }
  return { ok: true, reason: "" };
}

export interface SceneDraftingValidation {
  ok: boolean;
  blockingReasons: string[];
  advisoryFindings: {
    leanParagraphs: LeanParagraphFinding[];
    visualDiscipline: VisualDisciplineFinding[];
  };
}

/**
 * Composite Phase 2 validation (issue #94). The Conflict Mandate and
 * Enter Late/Leave Early reports are blocking - a scene cannot register
 * as drafted (Working) without both - since those are binary, checkable
 * commitments the model itself makes. Lean Action Paragraphs and Visual
 * Discipline are advisory findings surfaced to the author (and to Phase
 * 3's Compliance Report, issue #95) rather than blocking, per the module
 * header's reasoning.
 */
export function validateSceneDraft(
  draftText: string,
  reports: { conflictMandate: ConflictMandateReport; enterLateLeaveEarly: EnterLateLeaveEarlyReport }
): SceneDraftingValidation {
  const lean = checkLeanActionParagraphs(draftText);
  const visual = checkVisualDiscipline(draftText);
  const conflict = validateConflictMandateReport(reports.conflictMandate);
  const enterLate = validateEnterLateLeaveEarlyReport(reports.enterLateLeaveEarly);

  const blockingReasons = [conflict, enterLate].filter((r) => !r.ok).map((r) => r.reason);

  return {
    ok: blockingReasons.length === 0,
    blockingReasons,
    advisoryFindings: { leanParagraphs: lean.findings, visualDiscipline: visual.findings },
  };
}
