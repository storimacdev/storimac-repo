import { confirmScene, type SceneRecord } from "./sceneLedger";
import { applyContinuityMatrixUpdate, type ContinuityMatrix, type ContinuityMatrixUpdate } from "./continuityMatrix";

/**
 * Phase 4 — Revision & Canonization — GitHub issue #96, PRD refs
 * P5-Prompt5 SCREENPLAY EDITION v2.0 §2 (Phase 4), §7 (State Rules &
 * Canon Management). Pure functions only.
 */

export type FeedbackType = "Visuals" | "Dialogue" | "Pacing" | "Subtext" | "Continuity" | "Structure";
export type EditScope = "Line" | "Action Paragraph" | "Full Scene";

export interface RevisionClassification {
  feedbackType: FeedbackType;
  scope: EditScope;
  description: string;
}

/**
 * AC1/AC2: author adjustments are classified by type, and edits are
 * executed at the smallest local level possible - never a full
 * rewrite unless explicitly requested. This function only enforces
 * the completeness/scope-discipline rule; it does not (and cannot)
 * judge whether a given edit genuinely needed a wider scope than it
 * used - that remains a model/author judgment.
 */
export function validateRevisionClassification(
  classification: RevisionClassification,
  fullRewriteExplicitlyRequested: boolean
): { ok: boolean; reason: string } {
  if (!classification.description.trim()) {
    return { ok: false, reason: "Revision classification requires a description of what changed." };
  }
  if (classification.scope === "Full Scene" && !fullRewriteExplicitlyRequested) {
    return {
      ok: false,
      reason:
        "A Full Scene rewrite requires the author to have explicitly requested one - edit at the smallest necessary scope (Line -> Action Paragraph -> Full Scene) otherwise.",
    };
  }
  return { ok: true, reason: "" };
}

/** AC4: no scene is treated as Confirmed before explicit author
 * approval. Trivial in isolation, but kept as its own named, tested
 * gate rather than an inline boolean check at the call site - the
 * same "name the gate" convention issue #93's signOffAssignment and
 * issue #98's Conflict Intercept both follow. */
export function validateApprovalGate(explicitApproval: boolean): { ok: boolean; reason: string } {
  if (!explicitApproval) {
    return { ok: false, reason: "No explicit author approval has been given - this scene cannot be Confirmed yet." };
  }
  return { ok: true, reason: "" };
}

export interface CanonizeSceneParams {
  scene: SceneRecord;
  finalText: string;
  matrix: ContinuityMatrix;
  explicitApproval: boolean;
}

export interface CanonizeSceneResult {
  ok: boolean;
  reason: string;
  scene: SceneRecord | null;
  matrix: ContinuityMatrix | null;
}

/**
 * AC3: on approval, freezes the scene's text as immutable Confirmed
 * canon (via sceneLedger.ts's confirmScene, which already throws on an
 * attempt to re-confirm with different text) and, in the same
 * operation, applies that scene's captured `pendingMatrixUpdate` to
 * the Continuity Matrix - issue #97 AC5's "updated when a scene is
 * Confirmed," using exactly the outcomes captured at draft time
 * (sceneLedger.ts's setPendingMatrixUpdate), never re-asking the model
 * to repeat itself on the approval turn. Gated by validateApprovalGate
 * first - a scene with no explicit approval is returned unchanged.
 */
export function canonizeScene(params: CanonizeSceneParams): CanonizeSceneResult {
  const approval = validateApprovalGate(params.explicitApproval);
  if (!approval.ok) {
    return { ok: false, reason: approval.reason, scene: null, matrix: null };
  }

  const confirmed = confirmScene(params.scene, params.finalText);
  const update: ContinuityMatrixUpdate = {
    sceneNumber: params.scene.sceneNumber,
    ...(params.scene.pendingMatrixUpdate ?? {}),
  };
  const matrix = applyContinuityMatrixUpdate(params.matrix, update);

  return { ok: true, reason: "", scene: confirmed, matrix };
}
