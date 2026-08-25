import { listDocumentVersions, getDocumentVersion, type FoundationDocument, type StoredDocumentVersion } from "@/lib/canonEngine/foundationDoc";

/**
 * Project 3 Story Foundation ingestion (issue #38). Reads Project 1's
 * existing Foundation Document JSON - never modifies foundationDoc.ts.
 * Mirrors characterEngine/ingestFoundation.ts's shape exactly (issue #24):
 * pulls the fields Stage 1's own assessment needs (genre/tone, premise,
 * world foundation) plus storySpine/dramaticEngine now even though only
 * Conflict Resolution (issue #47) will use them - cheap to grab once from
 * the same already-fetched document, matches Project 2's own precedent.
 *
 * Scope note: this directory (worldEngine/) holds Project-3-specific
 * glue/ingestion code only. Per ARCHITECTURE.md §2/§7, canon state
 * tracking, conflict resolution, scope guardrails, and document compilation
 * for Project 3 belong in the shared Canon Engine (canonEngine/) that every
 * project wires its own config into - they are NOT to be reimplemented as
 * new parallel machinery in this directory.
 */

export interface IngestedWorldFoundation {
  storyId: string;
  version: number;
  workingTitle: string;
  genreTone: FoundationDocument["6_genre_tone"];
  premise: string;
  worldFoundation: FoundationDocument["10_world_foundation"];
  storySpine: FoundationDocument["11_story_spine"];
  dramaticEngine: FoundationDocument["8_dramatic_engine"];
}

export type IngestFoundationResult =
  | { status: "ok"; foundation: IngestedWorldFoundation }
  | { status: "missing" }
  | { status: "incomplete"; reason: string; foundation: IngestedWorldFoundation }
  | { status: "error"; reason: string };

const EMPTY_GENRE_TONE: FoundationDocument["6_genre_tone"] = {
  genre: "",
  subgenre: "",
  tone: "",
  style: "",
  audience: "",
  scale: "",
};

const EMPTY_WORLD_FOUNDATION: FoundationDocument["10_world_foundation"] = {
  time_period: "",
  primary_settings: [],
  nature_of_world: "",
  premise_assumptions: [],
  environmental_rules: [],
};

const EMPTY_STORY_SPINE: FoundationDocument["11_story_spine"] = {
  opening_image: "",
  inciting_incident: "",
  first_turning_point: "",
  midpoint: "",
  second_turning_point: "",
  climax: "",
  closing_image: "",
};

const EMPTY_DRAMATIC_ENGINE: FoundationDocument["8_dramatic_engine"] = {
  protagonist: "",
  antagonistic_force: "",
  central_conflict: "",
  primary_stakes: "",
  transformation_arc: "",
  emotional_journey: "",
};

/** Guards against a missing/malformed section at runtime (unchecked
 * Firestore cast) - generalizes characterEngine/ingestFoundation.ts's
 * extractStorySpine into a reusable helper since this file needs the same
 * guard for three different sections, not just one. */
function extractSection<T>(raw: unknown, empty: T): { value: T; missing: boolean } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { value: empty, missing: true };
  }
  return { value: raw as T, missing: false };
}

/**
 * Pure extraction from an already-fetched document version - no I/O, so
 * this is testable with fixtures alone. `ingestFoundation` below is the
 * thin async wrapper that does the actual fetch.
 */
export function extractIngestedWorldFoundation(version: StoredDocumentVersion, storyId: string): IngestFoundationResult {
  const doc = version.json;

  const workingTitle =
    typeof doc["1_story_metadata"]?.working_title === "string" ? doc["1_story_metadata"].working_title : "";
  const premise = typeof doc["4_premise"] === "string" ? doc["4_premise"] : "";

  const { value: genreTone, missing: genreToneMissing } = extractSection(doc["6_genre_tone"], EMPTY_GENRE_TONE);
  const { value: worldFoundation, missing: worldFoundationMissing } = extractSection(
    doc["10_world_foundation"],
    EMPTY_WORLD_FOUNDATION
  );
  const { value: storySpine } = extractSection(doc["11_story_spine"], EMPTY_STORY_SPINE);
  const { value: dramaticEngine } = extractSection(doc["8_dramatic_engine"], EMPTY_DRAMATIC_ENGINE);

  const foundation: IngestedWorldFoundation = {
    storyId,
    version: version.version,
    workingTitle,
    genreTone,
    premise,
    worldFoundation,
    storySpine,
    dramaticEngine,
  };

  const reasons: string[] = [];
  if (genreToneMissing) {
    reasons.push("The Story Foundation's Genre & Tone section is missing or malformed.");
  }
  if (worldFoundationMissing) {
    reasons.push("The Story Foundation's World Foundation section is missing or malformed.");
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
  return extractIngestedWorldFoundation(full, storyId);
}
