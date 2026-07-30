import { listDocumentVersions, getDocumentVersion, type FoundationDocument, type StoredDocumentVersion } from "@/lib/canonEngine/foundationDoc";

/**
 * Project 2 Story Foundation ingestion (issue #24, narrowed scope 2026-07-30).
 * Reads Project 1's existing Foundation Document JSON - never modifies
 * foundationDoc.ts. CDRM ingestion and prose-fallback parsing are explicitly
 * out of scope (see docs/superpowers/specs/2026-07-30-p2-foundation-ingestion-design.md);
 * "prior Character Bible for resume" is deferred to issue #36.
 */

export interface CastMember {
  name: string;
  story_role: string;
  description: string;
}

export interface IngestedFoundation {
  storyId: string;
  version: number;
  workingTitle: string;
  cast: CastMember[];
  storySpine: FoundationDocument["11_story_spine"];
}

export type IngestFoundationResult =
  | { status: "ok"; foundation: IngestedFoundation }
  | { status: "missing" }
  | { status: "incomplete"; reason: string; foundation: IngestedFoundation };

function extractCast(raw: unknown[]): { cast: CastMember[]; skippedCount: number } {
  const cast: CastMember[] = [];
  let skippedCount = 0;
  for (const entry of raw) {
    if (entry && typeof entry === "object") {
      const o = entry as Record<string, unknown>;
      if (typeof o.name === "string" && o.name.trim()) {
        cast.push({
          name: o.name,
          story_role: typeof o.story_role === "string" ? o.story_role : "",
          description: typeof o.description === "string" ? o.description : "",
        });
        continue;
      }
    } else if (typeof entry === "string" && entry.trim()) {
      cast.push({ name: entry, story_role: "", description: "" });
      continue;
    }
    skippedCount++;
  }
  return { cast, skippedCount };
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

  const foundation: IngestedFoundation = {
    storyId,
    version: version.version,
    workingTitle: doc["1_story_metadata"].working_title,
    cast,
    storySpine: doc["11_story_spine"],
  };

  if (cast.length === 0) {
    const reason =
      skippedCount > 0
        ? `Found ${skippedCount} cast entr${skippedCount === 1 ? "y" : "ies"} in the Story Foundation, but none had a usable name.`
        : "The Story Foundation's Principal Characters section is empty.";
    return { status: "incomplete", reason, foundation };
  }

  return { status: "ok", foundation };
}

/** Public entry point: fetches the Story's latest Foundation Document version and ingests it. */
export async function ingestFoundation(storyId: string): Promise<IngestFoundationResult> {
  const versions = await listDocumentVersions(storyId);
  if (versions.length === 0) {
    return { status: "missing" };
  }
  const latest = versions[versions.length - 1].version;
  const full = await getDocumentVersion(storyId, latest);
  if (!full) {
    return { status: "missing" };
  }
  return extractIngestedFoundation(full, storyId);
}
