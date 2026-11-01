import type { IngestedProject4Canon } from "./ingestCanon";

/**
 * Phase 1 — Assignment Confirmation Gate — GitHub issue #93, PRD refs
 * P5-Prompt5 SCREENPLAY EDITION v2.0 §2 (Phase 1).
 *
 * Pure functions only. The actual one-paragraph summary text is
 * model-generated each turn (same division of labor as every other
 * project's structured turn: the model composes natural language, this
 * module supplies the grounding data it must draw from and deterministic
 * format validation of what comes back) — never templated here, since
 * composing "Primary Cast Present" and "Expected Emotional Shift" from a
 * Scene Register paragraph genuinely requires reading/summarizing prose,
 * not a field-for-field template fill.
 */

export type SceneRegisterEntry = IngestedProject4Canon["sceneRegister"][number];

/** AC3: parameters are drawn from Project 4's Scene Register entry for
 * that scene number, never re-invented. Pure lookup — returns null when
 * the scene number doesn't exist in the ingested Scene Register, so the
 * caller can flag a gap rather than let the model invent one. */
export function findSceneRegisterEntry(
  p4: IngestedProject4Canon | null,
  sceneNumber: number
): SceneRegisterEntry | null {
  if (!p4) return null;
  return p4.sceneRegister.find((s) => s.scene_number === sceneNumber) ?? null;
}

/** Builds the internal grounding block instructing the model to draw its
 * Phase 1 summary from this exact Scene Register entry — never
 * re-invented, matching every other project's "computed by the app,
 * trust this over re-deriving it" grounding convention
 * (architecture-chat/route.ts's own grounding blocks are the reference
 * shape). */
export function buildAssignmentGateGroundingMessage(entry: SceneRegisterEntry): string {
  return `\n\n[Scene Register Entry - Scene ${entry.scene_number} - computed by the app, trust this over re-deriving it. Internal grounding only, never narrate this raw data to the author. Slugline: "${entry.slugline}". Critical Beat: ${entry.critical_beat_tag ?? "none"}. Causal Tag: ${entry.causal_tag}. Structural paragraph: "${entry.paragraph}". Compose this scene's Phase 1 one-paragraph assignment summary strictly from this data - never invent a cast member, objective, or turning point not supported by it. Required format, one paragraph with exactly these five pipe-delimited segments in order: [Scene Number & Heading (INT./EXT., Location, Time)] | [Primary Cast Present] | [Dramatic Objective vs. Opposition] | [Turning Point] | [Expected Emotional Shift]. Then stop and wait for explicit author sign-off - produce no draft text in this step.]`;
}

export interface AssignmentSummaryValidation {
  ok: boolean;
  reason: string;
}

/**
 * AC2: deterministic format validation of the model's proposed summary
 * — exactly five non-empty pipe-delimited segments, the first segment
 * naming an INT./EXT. slugline-style heading. Mirrors
 * developmentLoop.ts's checkSceneRegisterFormat precedent: a
 * deterministic structural check the app enforces rather than trusting
 * the model's own self-report.
 */
export function validateAssignmentSummaryFormat(summary: string): AssignmentSummaryValidation {
  const trimmed = summary.trim();
  if (!trimmed) {
    return { ok: false, reason: "Assignment summary is empty." };
  }
  const segments = trimmed.split("|").map((s) => s.trim());
  if (segments.length !== 5) {
    return {
      ok: false,
      reason: `Assignment summary must have exactly 5 pipe-delimited segments (Scene Number & Heading | Primary Cast Present | Dramatic Objective vs. Opposition | Turning Point | Expected Emotional Shift) - found ${segments.length}.`,
    };
  }
  const empty = segments.findIndex((s) => s.length === 0);
  if (empty !== -1) {
    return { ok: false, reason: `Segment ${empty + 1} of the assignment summary is empty.` };
  }
  if (!/\b(INT\.|EXT\.)/i.test(segments[0])) {
    return {
      ok: false,
      reason: `The first segment must be a scene heading containing "INT." or "EXT." - got "${segments[0]}".`,
    };
  }
  return { ok: true, reason: "" };
}

/** AC1: a gap-aware wrapper around findSceneRegisterEntry for the route
 * to call directly — returns a human-facing reason when the scene
 * cannot be gated yet, so the author is told why rather than left to
 * infer it from a silent no-op. */
export function checkAssignmentGateReadiness(
  p4: IngestedProject4Canon | null,
  sceneNumber: number
): { ready: boolean; entry: SceneRegisterEntry | null; reason: string } {
  if (!p4) {
    return { ready: false, entry: null, reason: "The Screenplay Architecture Document has not been compiled yet." };
  }
  const entry = findSceneRegisterEntry(p4, sceneNumber);
  if (!entry) {
    return {
      ready: false,
      entry: null,
      reason: `Scene ${sceneNumber} does not exist in the compiled Scene Register (Project 4 has ${p4.sceneRegister.length} scene(s)).`,
    };
  }
  return { ready: true, entry, reason: "" };
}
