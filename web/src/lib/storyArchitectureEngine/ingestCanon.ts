import {
  listDocumentVersions,
  getDocumentVersion,
  type FoundationDocument,
} from "@/lib/canonEngine/foundationDoc";
import { extractIngestedFoundation, type CastMember } from "@/lib/characterEngine/ingestFoundation";
import {
  getStory,
  StoryAccessError,
  listCharacterBibleEntries,
  type CharacterBibleEntry,
  type Story,
  type P2State,
  type P2CharacterProgress,
} from "@/lib/canonEngine/storyStore";
import { listElements, WORLD_ELEMENTS_COLLECTION } from "@/lib/canonEngine/canonStore";
import type { CanonStatus } from "@/lib/canonEngine/types";
import { normalizeP3 } from "@/lib/canonEngine/storyStore";
import { pillarElementId } from "@/lib/worldEngine/pillarElementId";

/**
 * Canon Ingestion Module — GitHub issue #55, PRD §7.1 (FR-1.1-1.5).
 * Reads Projects 1-3's already-finished canon directly from Firestore via
 * each project's own existing typed accessors (never via `.docx` parsing
 * — see docs/superpowers/specs/2026-09-09-canon-ingestion-design.md for
 * why this corrects issue #55's currently-stated AC). Read-only: never
 * imports any of Projects 1-3's own write functions.
 */

export interface CanonGap {
  project: "P1" | "P2" | "P3";
  field: string;
  reason: string;
}

export interface IngestedProject1Canon {
  storyDna: FoundationDocument["2_story_dna"];
  format: FoundationDocument["3_story_format"];
  premise: string;
  logline: string;
  thematicBlueprint: FoundationDocument["7_thematic_blueprint"];
  dramaticEngine: FoundationDocument["8_dramatic_engine"];
  storySpine: FoundationDocument["11_story_spine"];
  principalCharacters: CastMember[];
  version: number;
}

/**
 * Reuses `ingestFoundation.ts`'s already-tested `extractIngestedFoundation`
 * for cast (with stable charId), story spine, and dramatic engine, so this
 * module never re-derives charId assignment itself. The remaining P1
 * fields FR-1.2 requires (Story DNA, Format, Premise, Logline, Thematic
 * Blueprint) are read directly from the same already-fetched document by
 * their own stable field-name keys.
 */
async function ingestProject1(
  storyId: string
): Promise<{ canon: IngestedProject1Canon | null; gaps: CanonGap[] }> {
  const versions = await listDocumentVersions(storyId);
  if (versions.length === 0) {
    return {
      canon: null,
      gaps: [{ project: "P1", field: "document", reason: "Story Foundation Document has not been generated yet." }],
    };
  }
  const latest = Math.max(...versions.map((v) => v.version));
  const version = await getDocumentVersion(storyId, latest);
  if (!version) {
    return {
      canon: null,
      gaps: [
        {
          project: "P1",
          field: "document",
          reason: `Story Foundation Document version ${latest} is listed but could not be fetched.`,
        },
      ],
    };
  }

  const foundationResult = extractIngestedFoundation(version, storyId);
  const gaps: CanonGap[] = [];

  if (foundationResult.status === "error") {
    return { canon: null, gaps: [{ project: "P1", field: "document", reason: foundationResult.reason }] };
  }
  if (foundationResult.status === "missing") {
    // Cannot happen here (a version was just fetched successfully), but
    // handled for type exhaustiveness over IngestFoundationResult's union.
    return {
      canon: null,
      gaps: [{ project: "P1", field: "document", reason: "Story Foundation Document has not been generated yet." }],
    };
  }
  if (foundationResult.status === "incomplete") {
    gaps.push({ project: "P1", field: "principal_characters_or_story_spine", reason: foundationResult.reason });
  }

  const doc = version.json;
  const canon: IngestedProject1Canon = {
    storyDna: doc["2_story_dna"],
    format: doc["3_story_format"],
    premise: doc["4_premise"],
    logline: doc["5_logline"],
    thematicBlueprint: doc["7_thematic_blueprint"],
    dramaticEngine: foundationResult.foundation.dramaticEngine,
    storySpine: foundationResult.foundation.storySpine,
    principalCharacters: foundationResult.foundation.cast,
    version: version.version,
  };

  return { canon, gaps };
}

export interface IngestedCharacterCanon {
  charId: string;
  name: string;
  want: string;
  need: string;
  coreFlaw: string;
  coreWound: string;
  arcTimeline: CharacterBibleEntry["milestone_arc_timeline"];
}

export interface IngestedProject2Canon {
  characters: IngestedCharacterCanon[];
}

/**
 * Matches a Project 1 cast member to its Project 2 progress the same way
 * `characterBibleGate.ts`'s `checkCharacterBibleComplete` already does:
 * charId first (the normal case, since `p2State.characterProgress` is
 * keyed by charId), falling back to a case-insensitive name match for a
 * sign-off recorded under `character-chat/route.ts`'s raw-slugify
 * fallback key. Returns null when the character has no P2 progress at
 * all (never started).
 */
function resolveCharacterProgress(
  member: CastMember,
  p2State: P2State | null | undefined
): P2CharacterProgress | null {
  const progress = p2State?.characterProgress ?? {};
  const byId = progress[member.charId];
  if (byId?.status === "signed_off") return byId;
  const byName = Object.values(progress).find(
    (entry) =>
      entry.status === "signed_off" &&
      entry.characterName.trim().toLowerCase() === member.name.trim().toLowerCase()
  );
  return byName ?? byId ?? null;
}

/**
 * Project 2 canon is every signed-off character's compiled
 * `CharacterBibleEntry` (issue #34) - unconditional, regardless of
 * whether it matches a Project 1 principal character by name. Gaps are
 * computed separately: any Project 1 principal character without a
 * `signed_off` P2 status, via `resolveCharacterProgress` above.
 */
async function ingestProject2(
  storyId: string,
  story: Story,
  principalCharacters: CastMember[]
): Promise<{ canon: IngestedProject2Canon; gaps: CanonGap[] }> {
  const entries = await listCharacterBibleEntries(storyId);
  const characters: IngestedCharacterCanon[] = entries.map((e) => ({
    charId: e.charId,
    name: e.metadata.character_name,
    want: e.psychological_engine.want,
    need: e.psychological_engine.need,
    coreFlaw: e.psychological_engine.core_flaw,
    coreWound: e.psychological_engine.core_wound,
    arcTimeline: e.milestone_arc_timeline,
  }));

  const gaps: CanonGap[] = [];
  for (const member of principalCharacters) {
    const progress = resolveCharacterProgress(member, story.p2);
    if (progress?.status === "signed_off") continue;
    gaps.push({
      project: "P2",
      field: member.name,
      reason: progress ? `${progress.status} - not yet signed off.` : "Never started in Character Development.",
    });
  }

  return { canon: { characters }, gaps };
}

export interface IngestedPillarCanon {
  name: string;
  elementId: string;
  status: CanonStatus;
  value: unknown;
}

export interface IngestedProject3Canon {
  worldComplexityLevel: 1 | 2 | 3 | 4 | null;
  pillars: IngestedPillarCanon[];
}

/**
 * `p3.pillars: null` (not yet adopted) and `p3.pillars: []` (deliberately
 * cleared to zero) are distinct per `normalizeP3`'s own documented
 * convention - only `null` is a gap. Each adopted pillar's canon comes
 * from its `CanonElement` (looked up via the same `pillarElementId`
 * derivation the rest of Project 3 already uses); only a `Confirmed`
 * element counts as ingested canon, matching every other project's rule
 * that only Confirmed canon is authoritative.
 */
async function ingestProject3(
  storyId: string,
  story: Story
): Promise<{ canon: IngestedProject3Canon; gaps: CanonGap[] }> {
  const p3 = normalizeP3(story.p3);
  const gaps: CanonGap[] = [];

  if (p3.worldComplexityLevel === null) {
    gaps.push({ project: "P3", field: "worldComplexityLevel", reason: "World Complexity Level has not been set yet." });
  }

  if (p3.pillars === null) {
    gaps.push({ project: "P3", field: "pillars", reason: "World Bible pillar list has not been adopted yet." });
    return { canon: { worldComplexityLevel: p3.worldComplexityLevel, pillars: [] }, gaps };
  }

  const elements = await listElements(storyId, WORLD_ELEMENTS_COLLECTION);
  const byElementId = new Map(elements.map((e) => [e.element_id, e]));

  const pillars: IngestedPillarCanon[] = [];
  for (const name of p3.pillars) {
    const elementId = pillarElementId(name);
    const element = byElementId.get(elementId);
    if (!element) {
      gaps.push({ project: "P3", field: name, reason: "Not started." });
      continue;
    }
    if (element.status !== "Confirmed") {
      gaps.push({ project: "P3", field: name, reason: `${element.status} - not yet Confirmed.` });
      continue;
    }
    pillars.push({ name, elementId, status: element.status, value: element.value });
  }

  return { canon: { worldComplexityLevel: p3.worldComplexityLevel, pillars }, gaps };
}

/**
 * FR-1.4: a structural-overview summary for onboarding (issue #57
 * decides how/when it's shown - this module only produces the string).
 * Deterministic templating from fields already extracted above - no LLM
 * call. Names counts and short excerpts of what exists; never reproduces
 * a full Story Spine or arc timeline verbatim.
 */
function computeStructuralOverview(canon: {
  p1: IngestedProject1Canon | null;
  p2: IngestedProject2Canon;
  p3: IngestedProject3Canon;
}): string {
  const lines: string[] = [];

  if (!canon.p1) {
    lines.push("Project 1 (Story Foundation) is not yet complete.");
  } else {
    const primaryFormat = canon.p1.format.primary_format.name || "an unspecified format";
    lines.push(`"${canon.p1.logline || "No logline recorded"}" — primary format: ${primaryFormat}.`);
    lines.push(`Protagonist: ${canon.p1.dramaticEngine.protagonist || "not yet defined"}.`);
  }

  const signedOffNames = canon.p2.characters.map((c) => c.name);
  lines.push(
    signedOffNames.length > 0
      ? `${signedOffNames.length} character${signedOffNames.length === 1 ? "" : "s"} fully developed: ${signedOffNames.join(", ")}.`
      : "No characters fully developed yet."
  );

  const confirmedPillarCount = canon.p3.pillars.length;
  lines.push(
    confirmedPillarCount > 0
      ? `${confirmedPillarCount} world pillar${confirmedPillarCount === 1 ? "" : "s"} confirmed.`
      : "No world pillars confirmed yet."
  );

  return lines.join(" ");
}

export interface IngestedCanon {
  storyId: string;
  p1: IngestedProject1Canon | null;
  p2: IngestedProject2Canon;
  p3: IngestedProject3Canon;
  gaps: CanonGap[];
  structuralOverview: string;
}

/**
 * Public entry point (issue #55). Fetches the Story once, ingests all
 * three upstream projects directly from Firestore, and returns one
 * structured object plus every gap found (FR-1.5 - canon is never
 * silently invented). Read-only: never writes to any Story field or any
 * project's own canon collections.
 */
export async function ingestCanon(storyId: string): Promise<IngestedCanon> {
  const story = await getStory(storyId);
  if (!story) {
    throw new StoryAccessError(`Story "${storyId}" not found.`);
  }

  const { canon: p1, gaps: p1Gaps } = await ingestProject1(storyId);
  const { canon: p2, gaps: p2Gaps } = await ingestProject2(storyId, story, p1?.principalCharacters ?? []);
  const { canon: p3, gaps: p3Gaps } = await ingestProject3(storyId, story);

  const gaps = [...p1Gaps, ...p2Gaps, ...p3Gaps];
  const structuralOverview = computeStructuralOverview({ p1, p2, p3 });

  return { storyId, p1, p2, p3, gaps, structuralOverview };
}
