import { listDocumentVersions, getDocumentVersion, type FoundationDocument, type StoredDocumentVersion } from "@/lib/canonEngine/foundationDoc";

/**
 * Project 2 Story Foundation ingestion (issue #24, narrowed scope 2026-07-30).
 * Reads Project 1's existing Foundation Document JSON - never modifies
 * foundationDoc.ts. CDRM ingestion and prose-fallback parsing are explicitly
 * out of scope (see docs/superpowers/specs/2026-07-30-p2-foundation-ingestion-design.md);
 * "prior Character Bible for resume" is deferred to issue #36.
 *
 * Scope note: this directory (characterEngine/) holds Project-2-specific
 * glue/ingestion code only. Per ARCHITECTURE.md §2/§7, canon state tracking,
 * conflict resolution, scope guardrails, and document compilation for
 * Project 2 belong in the shared Canon Engine (canonEngine/) that every
 * project wires its own config into - they are NOT to be reimplemented as
 * new parallel machinery in this directory.
 */

export interface CastMember {
  name: string;
  story_role: string;
  description: string;
  primary_function: string;
}

export interface IngestedFoundation {
  storyId: string;
  version: number;
  workingTitle: string;
  cast: CastMember[];
  storySpine: FoundationDocument["11_story_spine"];
  dramaticEngine: FoundationDocument["8_dramatic_engine"];
}

export type IngestFoundationResult =
  | { status: "ok"; foundation: IngestedFoundation }
  | { status: "missing" }
  | { status: "incomplete"; reason: string; foundation: IngestedFoundation }
  | { status: "error"; reason: string };

function extractCast(raw: unknown[]): { cast: CastMember[]; skippedCount: number } {
  const cast: CastMember[] = [];
  let skippedCount = 0;
  for (const entry of raw) {
    if (entry && typeof entry === "object") {
      const o = entry as Record<string, unknown>;
      if (typeof o.name === "string" && o.name.trim()) {
        cast.push({
          name: o.name.trim(),
          story_role: typeof o.story_role === "string" ? o.story_role : "",
          description: typeof o.description === "string" ? o.description : "",
          primary_function: typeof o.primary_function === "string" ? o.primary_function : "",
        });
        continue;
      }
    } else if (typeof entry === "string" && entry.trim()) {
      cast.push({ name: entry.trim(), story_role: "", description: "", primary_function: "" });
      continue;
    }
    skippedCount++;
  }
  return { cast, skippedCount };
}

const EMPTY_STORY_SPINE: FoundationDocument["11_story_spine"] = {
  opening_image: "",
  inciting_incident: "",
  first_turning_point: "",
  midpoint: "",
  second_turning_point: "",
  climax: "",
  closing_image: "",
};

/** Guards against a missing/malformed `11_story_spine` at runtime (unchecked Firestore cast). */
function extractStorySpine(raw: unknown): { spine: FoundationDocument["11_story_spine"]; missing: boolean } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { spine: EMPTY_STORY_SPINE, missing: true };
  }
  return { spine: raw as FoundationDocument["11_story_spine"], missing: false };
}

/**
 * Pure extraction from an already-fetched document version - no I/O, so this
 * is testable with fixtures alone. `ingestFoundation` below is the thin
 * async wrapper that does the actual fetch.
 */
export function extractIngestedFoundation(version: StoredDocumentVersion, storyId: string): IngestFoundationResult {
  const doc = version.json;
  const rawCast = doc["9_principal_characters"];
  const { cast, skippedCount } = extractCast(Array.isArray(rawCast) ? rawCast : []);

  const workingTitle =
    typeof doc["1_story_metadata"]?.working_title === "string" ? doc["1_story_metadata"].working_title : "";

  const { spine: storySpine, missing: spineMissing } = extractStorySpine(doc["11_story_spine"]);

  const foundation: IngestedFoundation = {
    storyId,
    version: version.version,
    workingTitle,
    cast,
    storySpine,
    dramaticEngine: doc["8_dramatic_engine"],
  };

  const reasons: string[] = [];
  if (cast.length === 0) {
    reasons.push(
      skippedCount > 0
        ? `Found ${skippedCount} cast entr${skippedCount === 1 ? "y" : "ies"} in the Story Foundation, but none had a usable name.`
        : "The Story Foundation's Principal Characters section is empty."
    );
  }
  if (spineMissing) {
    reasons.push("The Story Foundation's Story Spine section is missing or malformed.");
  }

  if (reasons.length > 0) {
    return { status: "incomplete", reason: reasons.join(" "), foundation };
  }

  return { status: "ok", foundation };
}

/** Public entry point: fetches the Story's latest Foundation Document version and ingests it. */
export async function ingestFoundation(storyId: string): Promise<IngestFoundationResult> {
  const versions = await listDocumentVersions(storyId);
  if (versions.length === 0) {
    return { status: "missing" };
  }
  const latest = Math.max(...versions.map((v) => v.version));
  const full = await getDocumentVersion(storyId, latest);
  if (!full) {
    // A version was listed but could not be fetched - a real data
    // inconsistency, not "no Foundation Document yet" (status: "missing").
    return {
      status: "error",
      reason: `Story Foundation Document version ${latest} is listed but could not be fetched.`,
    };
  }
  return extractIngestedFoundation(full, storyId);
}
