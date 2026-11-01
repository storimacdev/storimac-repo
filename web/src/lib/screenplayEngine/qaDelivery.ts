import type { LeanParagraphFinding, VisualDisciplineFinding } from "./sceneDrafting";
import type { ContinuityMatrix, OpenLoop } from "./continuityMatrix";

/**
 * Phase 3 — QA & Delivery — GitHub issue #95, PRD refs P5-Prompt5
 * SCREENPLAY EDITION v2.0 §2 (Phase 3), §8 (Screenplay Delivery
 * Specification). Pure, deterministic template-fill only - this module
 * never calls the model itself. It composes the already-computed
 * Phase 2 findings (sceneDrafting.ts), the Continuity Matrix (issue
 * #97), and one model self-report field (Dialogue & Voice Audit, the
 * one Compliance Report item that is a genuine creative judgment call,
 * same division of labor as every other subjective standard in this
 * build) into the exact two-block delivery format AC3 requires.
 */

/** The exact divider used around both blocks (AC3: "delivery format
 * matches the exact section markers from the prompt spec"). The PRD
 * text itself only shows `=====...` generically - this is the concrete
 * literal string chosen for it, documented here as the single source
 * of truth other code should import rather than re-typing the
 * divider. */
export const SCREENPLAY_SECTION_DIVIDER = "=====";

export interface DialogueVoiceAuditReport {
  subtextPresent: boolean;
  notes: string;
}

export interface ComplianceReportSections {
  visualStorytellingCheck: string;
  leanActionWhiteSpaceAudit: string;
  dialogueVoiceAudit: string;
  openClosedLoopsRegister: string;
  revisionInvitation: string;
}

/** AC compliance item (1): Visual Storytelling Check - confirmation
 * internal emotions were translated into filmable behavior/action.
 * Deterministic from sceneDrafting.ts's own findings. */
export function buildVisualStorytellingCheck(findings: VisualDisciplineFinding[]): string {
  if (findings.length === 0) {
    return "Confirmed: all emotion in this scene is conveyed through filmable behavior, props, body language, or environment - no internal-thought or camera-direction language detected.";
  }
  const lines = findings.map(
    (f) => `- ${f.kind === "internal_thought" ? "Internal-thought language" : "Camera-direction language"} ("${f.matchedPhrase}") in: "${f.excerpt}..."`
  );
  return `${findings.length} potential Visual Discipline concern(s) flagged for author review:\n${lines.join("\n")}`;
}

/** AC compliance item (2): Lean Action & White Space Audit. */
export function buildLeanActionWhiteSpaceAudit(findings: LeanParagraphFinding[]): string {
  if (findings.length === 0) {
    return "Confirmed: every action paragraph is 3 lines or fewer.";
  }
  const lines = findings.map((f) => `- Block ${f.blockIndex + 1}: ${f.lineCount} lines ("${f.excerpt}...")`);
  return `${findings.length} action paragraph(s) exceed 3 lines:\n${lines.join("\n")}`;
}

/** AC compliance item (3): Dialogue & Voice Audit (subtext present, no
 * on-the-nose exposition). Whether dialogue is genuinely subtextual is
 * a creative judgment no deterministic check can safely make - this
 * function only renders the model's own self-report, matching the
 * Conflict Mandate/Enter Late-Leave Early precedent elsewhere in this
 * build (the model judges, the app only requires the report isn't
 * empty). */
export function buildDialogueVoiceAudit(report: DialogueVoiceAuditReport): string {
  const headline = report.subtextPresent
    ? "Subtext present - no on-the-nose exposition detected."
    : "Flagged - dialogue may be stating emotion/plot information too directly rather than through subtext.";
  const notes = report.notes.trim() || "(no additional notes)";
  return `${headline} ${notes}`;
}

/** AC compliance item (4): Open/Closed Loops Register. Lists this
 * scene's own opened/closed loops plus every loop still open overall,
 * reusing issue #97's Continuity Matrix state directly rather than
 * re-deriving it. */
export function buildOpenClosedLoopsRegister(matrix: ContinuityMatrix, sceneNumber: number): string {
  const openedThisScene = matrix.openLoops.filter((l) => l.plantedSceneNumber === sceneNumber);
  const closedThisScene = matrix.openLoops.filter((l) => l.closedSceneNumber === sceneNumber);
  const stillOpen = matrix.openLoops.filter((l) => l.status === "open");

  const describe = (l: OpenLoop) => `[${l.id}] (${l.kind}) ${l.description}`;

  const lines: string[] = [];
  lines.push(
    openedThisScene.length > 0
      ? `Opened this scene: ${openedThisScene.map(describe).join("; ")}`
      : "Opened this scene: none."
  );
  lines.push(
    closedThisScene.length > 0
      ? `Closed this scene: ${closedThisScene.map(describe).join("; ")}`
      : "Closed this scene: none."
  );
  lines.push(
    stillOpen.length > 0
      ? `Still open overall (${stillOpen.length}): ${stillOpen.map(describe).join("; ")}`
      : "No Open Loops remain outstanding."
  );
  return lines.join("\n");
}

/** AC compliance item (5): Revision Invitation. Fixed template - the
 * PRD's own AC spells out the exact four topics verbatim, so this is
 * genuinely deterministic, not model-authored. */
export function buildRevisionInvitation(): string {
  return "This scene is open for your revision notes on visual clarity, dialogue rhythm, scene pacing, or subtext intensity - or any other change you'd like.";
}

export interface BuildComplianceReportParams {
  visualDisciplineFindings: VisualDisciplineFinding[];
  leanParagraphFindings: LeanParagraphFinding[];
  dialogueVoiceAudit: DialogueVoiceAuditReport;
  matrix: ContinuityMatrix;
  sceneNumber: number;
}

export function buildComplianceReport(params: BuildComplianceReportParams): ComplianceReportSections {
  return {
    visualStorytellingCheck: buildVisualStorytellingCheck(params.visualDisciplineFindings),
    leanActionWhiteSpaceAudit: buildLeanActionWhiteSpaceAudit(params.leanParagraphFindings),
    dialogueVoiceAudit: buildDialogueVoiceAudit(params.dialogueVoiceAudit),
    openClosedLoopsRegister: buildOpenClosedLoopsRegister(params.matrix, params.sceneNumber),
    revisionInvitation: buildRevisionInvitation(),
  };
}

function renderComplianceReport(sections: ComplianceReportSections): string {
  return [
    `1. Visual Storytelling Check\n${sections.visualStorytellingCheck}`,
    `2. Lean Action & White Space Audit\n${sections.leanActionWhiteSpaceAudit}`,
    `3. Dialogue & Voice Audit\n${sections.dialogueVoiceAudit}`,
    `4. Open/Closed Loops Register\n${sections.openClosedLoopsRegister}`,
    `5. Revision Invitation\n${sections.revisionInvitation}`,
  ].join("\n\n");
}

/**
 * AC3: the exact two-block delivery format. THE SCREENPLAY block is
 * `screenplayText` verbatim - never anything else interpolated into
 * it, per the AC's "zero author notes, formatting meta-explanations,
 * process commentary, or structural labels inside this block."
 */
export function formatScreenplayDelivery(screenplayText: string, compliance: ComplianceReportSections): string {
  const d = SCREENPLAY_SECTION_DIVIDER;
  return [
    d,
    "THE SCREENPLAY",
    d,
    "",
    screenplayText.trim(),
    "",
    d,
    "COMPLIANCE REPORT",
    d,
    "",
    renderComplianceReport(compliance),
  ].join("\n");
}
