import {
  ingestCanon as ingestUpstreamCanon,
  type IngestedProject1Canon,
  type IngestedProject2Canon,
  type IngestedProject3Canon,
  type CanonGap as UpstreamCanonGap,
} from "@/lib/storyArchitectureEngine/ingestCanon";
import {
  getLatestScreenplayArchitectureVersion,
  type ScreenplayArchitectureDocument,
} from "@/lib/canonEngine/storyStore";

/**
 * Project 5 Canon Ingestion — GitHub issue #92, PRD refs P5-Prompt5 §1
 * (Core Persona & Screenwriting Objective), §9 (Operational Response
 * Directive).
 *
 * Architecture note (ARCHITECTURE.md §2): this is "wire this project's
 * config into the shared engine," not a new ingestion pipeline. Project
 * 4's own `storyArchitectureEngine/ingestCanon.ts` (issue #55) already
 * ingests Projects 1-3 directly from Firestore via each project's own
 * typed accessors - never by re-parsing `.docx`/`.md`, per
 * ARCHITECTURE.md §3's "downstream ingestion reads the versioned JSON
 * export, never re-parses the human-readable doc" rule, which issue #55's
 * own implementation comment already corrected its stated AC to follow.
 * This module reuses that call wholesale for Projects 1-3, and adds
 * Project 4's own compiled Screenplay Architecture Document (issue #70)
 * as the fourth upstream canon source - read via its existing typed
 * Firestore accessor (`getLatestScreenplayArchitectureVersion`), same
 * reasoning, never via its `.docx`/Markdown export.
 */

export interface CanonGap {
  project: "P1" | "P2" | "P3" | "P4";
  field: string;
  reason: string;
}

function tagUpstreamGap(gap: UpstreamCanonGap): CanonGap {
  return { project: gap.project, field: gap.field, reason: gap.reason };
}

export interface IngestedProject4Canon {
  version: number;
  storyDnaBlueprint: ScreenplayArchitectureDocument["2_story_dna_blueprint"];
  actOverview: ScreenplayArchitectureDocument["3_structural_act_set_piece_overview"];
  sceneRegister: ScreenplayArchitectureDocument["4_complete_approved_scene_register"];
  /** Surfaced verbatim from Section 5 of the compiled document (AC4) so
   * scene-by-scene drafting can be checked against it without
   * re-deriving which scene earns which Critical Beat. */
  criticalBeatEarmarkIndex: ScreenplayArchitectureDocument["5_critical_beat_earmark_index"];
}

/**
 * Pure: evaluates gaps in an already-fetched Screenplay Architecture
 * Document. Split out from `ingestProject4` below so this logic is
 * unit-testable without a Firestore fixture (ingestCanon.ts upstream has
 * no dedicated test file for the same reason - Firestore-fetching glue
 * isn't worth mocking, but the gap-detection rule itself is).
 */
export function evaluateProject4Gaps(doc: ScreenplayArchitectureDocument): CanonGap[] {
  const gaps: CanonGap[] = [];
  if (doc["4_complete_approved_scene_register"].length === 0) {
    gaps.push({
      project: "P4",
      field: "scene_register",
      reason: "Screenplay Architecture Document has no Confirmed scenes in its Scene Register yet.",
    });
  }
  const missingBeats = doc["5_critical_beat_earmark_index"].filter((e) => e.scene_number === null);
  if (missingBeats.length > 0) {
    gaps.push({
      project: "P4",
      field: "critical_beat_earmark_index",
      reason: `${missingBeats.length} Critical Beat(s) not yet earmarked to a Confirmed scene: ${missingBeats
        .map((b) => b.tag)
        .join(", ")}.`,
    });
  }
  return gaps;
}

/** Pure: builds the ingested Project 4 canon shape from an already-fetched
 * document - no fabrication, every field read straight off the compiled
 * JSON (FR-style "never invent canon" rule shared with issue #55). */
export function buildIngestedProject4Canon(
  doc: ScreenplayArchitectureDocument,
  version: number
): IngestedProject4Canon {
  return {
    version,
    storyDnaBlueprint: doc["2_story_dna_blueprint"],
    actOverview: doc["3_structural_act_set_piece_overview"],
    sceneRegister: doc["4_complete_approved_scene_register"],
    criticalBeatEarmarkIndex: doc["5_critical_beat_earmark_index"],
  };
}

async function ingestProject4(storyId: string): Promise<{ canon: IngestedProject4Canon | null; gaps: CanonGap[] }> {
  const latest = await getLatestScreenplayArchitectureVersion(storyId);
  if (!latest) {
    return {
      canon: null,
      gaps: [
        {
          project: "P4",
          field: "document",
          reason: "Screenplay Architecture Document has not been compiled yet.",
        },
      ],
    };
  }
  return { canon: buildIngestedProject4Canon(latest.json, latest.version), gaps: evaluateProject4Gaps(latest.json) };
}

export interface IngestedScreenplayCanon {
  storyId: string;
  p1: IngestedProject1Canon | null;
  p2: IngestedProject2Canon;
  p3: IngestedProject3Canon;
  p4: IngestedProject4Canon | null;
  gaps: CanonGap[];
  /** A brief, professional developmental acknowledgment of the ingested
   * materials (AC3) - never a verbatim reproduction of any source
   * document, and always confirms the screenplay medium. Deterministic
   * templating only, same posture as storyArchitectureEngine's own
   * `computeStructuralOverview` (issue #55). */
  acknowledgment: string;
}

/**
 * Pure: builds the session-open acknowledgment paragraph (AC3). Counts
 * and short excerpts only - never full canon text. Explicitly names any
 * gap so the author is asked how to proceed rather than the gap being
 * silently absorbed into an upbeat-sounding summary (AC2).
 */
export function computeAcknowledgment(canon: {
  p1: IngestedProject1Canon | null;
  p4: IngestedProject4Canon | null;
  gaps: CanonGap[];
}): string {
  const lines: string[] = [];

  if (canon.p1) {
    lines.push(
      `Ingested "${canon.p1.workingTitle || "this story"}" (${canon.p1.format?.primary_format?.name || "format unconfirmed"}) through its full Project 1-4 canon.`
    );
  } else {
    lines.push("Project 1 (Story Foundation) canon is not yet available.");
  }

  if (canon.p4) {
    const sceneCount = canon.p4.sceneRegister.length;
    const beatsEarmarked = canon.p4.criticalBeatEarmarkIndex.filter((b) => b.scene_number !== null).length;
    const totalBeats = canon.p4.criticalBeatEarmarkIndex.length;
    lines.push(
      `The Screenplay Architecture Document (v${canon.p4.version}) confirms ${sceneCount} scene${sceneCount === 1 ? "" : "s"} in the Scene Register, with ${beatsEarmarked} of ${totalBeats} Critical Beats earmarked to a scene.`
    );
  } else {
    lines.push("The Screenplay Architecture Document (Project 4) is not yet available.");
  }

  lines.push("This session will draft the screenplay scene by scene, in strict industry screenplay format.");

  if (canon.gaps.length > 0) {
    lines.push(
      `${canon.gaps.length} gap${canon.gaps.length === 1 ? "" : "s"} in the ingested canon need your direction before (or during) drafting: ${canon.gaps
        .map((g) => `${g.project} ${g.field}`)
        .join("; ")}.`
    );
  }

  return lines.join(" ");
}

/**
 * Public entry point (issue #92). Read-only: never writes to any Story
 * field or any upstream project's own canon collections - all four
 * source projects are immutable reference data for this session unless a
 * formal Canon Revision/Conflict Intercept is explicitly triggered (see
 * the Conflict Intercept issue, #98).
 */
export async function ingestScreenplayCanon(storyId: string): Promise<IngestedScreenplayCanon> {
  const upstream = await ingestUpstreamCanon(storyId);
  const { canon: p4, gaps: p4Gaps } = await ingestProject4(storyId);

  const gaps: CanonGap[] = [...upstream.gaps.map(tagUpstreamGap), ...p4Gaps];
  const acknowledgment = computeAcknowledgment({ p1: upstream.p1, p4, gaps });

  return { storyId, p1: upstream.p1, p2: upstream.p2, p3: upstream.p3, p4, gaps, acknowledgment };
}
