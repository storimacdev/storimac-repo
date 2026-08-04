import { PROJECT1_STAGES } from "./stageDefinitions";

/**
 * Canonical element-ID vocabulary for Project 1 - the single source of
 * truth combining every element ID any part of Project 1 reads or writes.
 * Built as a union of two existing sources so it can never drift from what
 * the app actually uses:
 *   - stage-gated IDs: stageDefinitions.ts's PROJECT1_STAGES[].requiredElementIds
 *   - document-only IDs: read directly by foundationDoc.ts's
 *     compileFoundationDocument but never required by any stage gate
 *
 * Used by stateDelta.ts's EMIT_TURN_TOOL as the element_id enum (steers the
 * model away from inventing non-canonical IDs) and by chat/route.ts and the
 * audit script (web/scripts/audit-stage-drift.ts) to detect any that slip
 * through anyway.
 *
 * Adding a new field to foundationDoc.ts's compileFoundationDocument? Add
 * its element_id here too (to DOCUMENT_ONLY_ELEMENT_IDS if no stage
 * requires it), or the model is never steered toward populating it.
 */

// IDs foundationDoc.ts reads directly but no PROJECT1_STAGES entry requires.
// Kept in sync manually - verified against every str()/arr()/formatEntry()
// call in foundationDoc.ts's compileFoundationDocument as of 2026-08-04.
const DOCUMENT_ONLY_ELEMENT_IDS: string[] = [
  "medium",
  "target_length",
  "core_story_promise",
  "story_identity",
  "narrative_priorities",
  "always_emphasize",
  "never_become",
  "comparable_works",
  "supporting_formats",
  "premise",
  "logline",
  "external_theme",
  "internal_theme",
  "narrative_purpose",
  "emotional_journey",
  "principal_characters",
  "nature_of_world",
];

const STAGE_GATED_ELEMENT_IDS: string[] = PROJECT1_STAGES.flatMap((s) => s.requiredElementIds);

export const PROJECT1_ELEMENT_IDS: string[] = Array.from(
  new Set([...STAGE_GATED_ELEMENT_IDS, ...DOCUMENT_ONLY_ELEMENT_IDS])
);

export function isKnownElementId(id: string): boolean {
  return PROJECT1_ELEMENT_IDS.includes(id);
}
