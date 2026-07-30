import { getDb } from "@/lib/firebaseAdmin";
import type { CanonElement } from "./types";
import {
  getStory,
  listOutstandingQuestions,
  type Story,
  type StoredOutstandingQuestion,
} from "./storyStore";
import { listElements } from "./canonStore";
import { stripCatalogCodes } from "./stripCatalogCodes";

/**
 * Stage 8 — Story Foundation Document generator — GitHub issues #18 (+#19
 * version history), PRD §5.9/§10.2. Compiles ONLY Confirmed canon into the
 * §10.2 schema exactly (keys, section numbers, order). Parked items appear
 * only in Section 12. retrieval_code (internal catalog codes like "A05") is
 * actively stripped before rendering — never author- or downstream-facing.
 *
 * Numbering note (issue #18 AC, decided 2026-07-23): the compiled document
 * uses §10.2's numbering (Principal Characters = 9, Story Spine = 11), not
 * the system prompt's internal continuation numbering.
 */

export const SCHEMA_VERSION = "1.0";

type ElementMap = Map<string, CanonElement>;

function confirmedValue(byId: ElementMap, id: string): unknown {
  const e = byId.get(id);
  return e && e.status === "Confirmed" ? stripCatalogCodes(e.value) : undefined;
}

function str(byId: ElementMap, id: string): string {
  const v = confirmedValue(byId, id);
  if (v === undefined || v === null) return "";
  return typeof v === "string" ? v : JSON.stringify(v);
}

function arr(byId: ElementMap, id: string): unknown[] {
  const v = confirmedValue(byId, id);
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v) return [v];
  return [];
}

interface FormatEntry {
  name: string;
  reason: string;
}

function formatEntry(byId: ElementMap, id: string): FormatEntry {
  const v = confirmedValue(byId, id);
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    return {
      name: typeof o.name === "string" ? o.name : typeof o.title === "string" ? o.title : "",
      reason: typeof o.reason === "string" ? o.reason : "",
    };
  }
  return { name: typeof v === "string" ? v : "", reason: "" };
}

export interface FoundationDocument {
  schema_version: string;
  "1_story_metadata": {
    id: string; version: string; working_title: string; author: string;
    date: string; status: string; medium: string; target_length: string;
  };
  "2_story_dna": {
    core_story_promise: string; story_identity: string;
    narrative_priorities: unknown[]; always_emphasize: unknown[];
    never_become: unknown[]; comparable_works: unknown[];
  };
  "3_story_format": { primary_format: FormatEntry; supporting_formats: FormatEntry[] };
  "4_premise": string;
  "5_logline": string;
  "6_genre_tone": { genre: string; subgenre: string; tone: string; style: string; audience: string; scale: string };
  "7_thematic_blueprint": {
    external_theme: string; internal_theme: string; core_dramatic_question: string;
    theme_statement: string; narrative_purpose: string;
  };
  "8_dramatic_engine": {
    protagonist: string; antagonistic_force: string; central_conflict: string;
    primary_stakes: string; transformation_arc: string; emotional_journey: string;
  };
  "9_principal_characters": unknown[];
  "10_world_foundation": {
    time_period: string; primary_settings: unknown[]; nature_of_world: string;
    premise_assumptions: unknown[]; environmental_rules: unknown[];
  };
  "11_story_spine": {
    opening_image: string; inciting_incident: string; first_turning_point: string;
    midpoint: string; second_turning_point: string; climax: string; closing_image: string;
  };
  "12_outstanding_questions": { item: string; defer_to: string | null; notes: string }[];
  "13_version_history": { version: string; date: string; summary_of_changes: string }[];
}

export function compileFoundationDocument(
  story: Story,
  elements: CanonElement[],
  outstanding: StoredOutstandingQuestion[],
  version: number,
  versionHistory: { version: string; date: string; summary_of_changes: string }[]
): FoundationDocument {
  const byId: ElementMap = new Map(elements.map((e) => [e.element_id, e]));

  // Section 12: persisted outstanding questions + everything currently
  // Parked (Parked never appears anywhere else — PRD hard rule).
  const parkedNow = elements
    .filter((e) => e.status === "Parked")
    .map((e) => ({
      item: `${e.element_id.replace(/_/g, " ")}: ${e.value === null || e.value === undefined ? "(no value recorded)" : typeof e.value === "string" ? e.value : JSON.stringify(stripCatalogCodes(e.value))}`,
      defer_to: null as string | null,
      notes: "Parked during the interview; unresolved at generation time.",
    }));
  const persisted = outstanding.map((q) => ({
    item: stripCatalogCodes(q.item),
    defer_to: q.defer_to,
    notes: q.notes,
  }));
  const seen = new Set<string>();
  const outstandingAll = [...persisted, ...parkedNow].filter((q) => {
    if (seen.has(q.item)) return false;
    seen.add(q.item);
    return true;
  });

  const supporting = confirmedValue(byId, "supporting_formats");
  const supportingFormats: FormatEntry[] = Array.isArray(supporting)
    ? supporting.map((s) => {
        if (s && typeof s === "object") {
          const o = s as Record<string, unknown>;
          return {
            name: typeof o.name === "string" ? o.name : "",
            reason: typeof o.reason === "string" ? o.reason : "",
          };
        }
        return { name: typeof s === "string" ? s : "", reason: "" };
      })
    : [];

  return {
    schema_version: SCHEMA_VERSION,
    "1_story_metadata": {
      id: story.id,
      version: `v${version}`,
      working_title: story.title,
      author: "",
      date: new Date().toISOString().slice(0, 10),
      status: story.currentStage >= 8 ? "Foundation Complete" : "In Development",
      medium: str(byId, "medium"),
      target_length: str(byId, "target_length"),
    },
    "2_story_dna": {
      core_story_promise: str(byId, "core_story_promise"),
      story_identity: str(byId, "story_identity"),
      narrative_priorities: arr(byId, "narrative_priorities"),
      always_emphasize: arr(byId, "always_emphasize"),
      never_become: arr(byId, "never_become"),
      comparable_works: arr(byId, "comparable_works"),
    },
    "3_story_format": {
      primary_format: formatEntry(byId, "primary_format"),
      supporting_formats: supportingFormats,
    },
    "4_premise": str(byId, "premise") || str(byId, "concept"),
    "5_logline": str(byId, "logline"),
    "6_genre_tone": {
      genre: str(byId, "genre"),
      subgenre: str(byId, "subgenre"),
      tone: str(byId, "tone"),
      style: str(byId, "style"),
      audience: str(byId, "audience") || str(byId, "target_audience"),
      scale: str(byId, "scale"),
    },
    "7_thematic_blueprint": {
      external_theme: str(byId, "external_theme"),
      internal_theme: str(byId, "internal_theme"),
      core_dramatic_question: str(byId, "core_dramatic_question"),
      theme_statement: str(byId, "theme_statement"),
      narrative_purpose: str(byId, "narrative_purpose"),
    },
    "8_dramatic_engine": {
      protagonist: str(byId, "protagonist"),
      antagonistic_force: str(byId, "antagonistic_force"),
      central_conflict: str(byId, "central_conflict"),
      primary_stakes: str(byId, "primary_stakes"),
      transformation_arc: str(byId, "transformation_arc"),
      emotional_journey: str(byId, "emotional_journey"),
    },
    "9_principal_characters": arr(byId, "principal_characters"),
    "10_world_foundation": {
      time_period: str(byId, "time_period"),
      primary_settings: arr(byId, "primary_settings"),
      nature_of_world: str(byId, "nature_of_world"),
      premise_assumptions: arr(byId, "premise_assumptions"),
      environmental_rules: arr(byId, "environmental_rules"),
    },
    "11_story_spine": {
      opening_image: str(byId, "opening_image"),
      inciting_incident: str(byId, "inciting_incident"),
      first_turning_point: str(byId, "first_turning_point"),
      midpoint: str(byId, "midpoint"),
      second_turning_point: str(byId, "second_turning_point"),
      climax: str(byId, "climax"),
      closing_image: str(byId, "closing_image"),
    },
    "12_outstanding_questions": outstandingAll,
    "13_version_history": versionHistory,
  };
}

function mdValue(v: unknown): string {
  if (v === undefined || v === null || v === "") return "_—_";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function mdList(items: unknown[]): string {
  if (!items.length) return "_—_";
  return items.map((i) => `- ${typeof i === "string" ? i : JSON.stringify(i)}`).join("\n");
}

export function renderMarkdown(doc: FoundationDocument): string {
  const m = doc["1_story_metadata"];
  const dna = doc["2_story_dna"];
  const fmt = doc["3_story_format"];
  const gt = doc["6_genre_tone"];
  const tb = doc["7_thematic_blueprint"];
  const de = doc["8_dramatic_engine"];
  const wf = doc["10_world_foundation"];
  const sp = doc["11_story_spine"];

  const lines: string[] = [
    `# Story Foundation Document — ${m.working_title}`,
    "",
    `## 1. Story Metadata`,
    `| Field | Value |`,
    `| --- | --- |`,
    `| ID | ${m.id} |`,
    `| Version | ${m.version} |`,
    `| Working Title | ${mdValue(m.working_title)} |`,
    `| Author | ${mdValue(m.author)} |`,
    `| Date | ${m.date} |`,
    `| Status | ${m.status} |`,
    `| Medium | ${mdValue(m.medium)} |`,
    `| Target Length | ${mdValue(m.target_length)} |`,
    "",
    `## 2. Story DNA`,
    `**Core Story Promise:** ${mdValue(dna.core_story_promise)}`,
    `**Story Identity:** ${mdValue(dna.story_identity)}`,
    `**Narrative Priorities:**\n${mdList(dna.narrative_priorities)}`,
    `**Always Emphasize:**\n${mdList(dna.always_emphasize)}`,
    `**Never Become:**\n${mdList(dna.never_become)}`,
    `**Comparable Works:**\n${mdList(dna.comparable_works)}`,
    "",
    `## 3. Story Format`,
    `**Primary Format:** ${mdValue(fmt.primary_format.name)}`,
    `**Why:** ${mdValue(fmt.primary_format.reason)}`,
    ...(fmt.supporting_formats.length
      ? [
          `**Supporting Formats:**`,
          ...fmt.supporting_formats.map((f) => `- ${f.name}${f.reason ? ` — ${f.reason}` : ""}`),
        ]
      : []),
    "",
    `## 4. Premise`,
    mdValue(doc["4_premise"]),
    "",
    `## 5. Logline`,
    mdValue(doc["5_logline"]),
    "",
    `## 6. Genre & Tone`,
    `| Field | Value |`,
    `| --- | --- |`,
    `| Genre | ${mdValue(gt.genre)} |`,
    `| Subgenre | ${mdValue(gt.subgenre)} |`,
    `| Tone | ${mdValue(gt.tone)} |`,
    `| Style | ${mdValue(gt.style)} |`,
    `| Audience | ${mdValue(gt.audience)} |`,
    `| Scale | ${mdValue(gt.scale)} |`,
    "",
    `## 7. Thematic Blueprint`,
    `**External Theme:** ${mdValue(tb.external_theme)}`,
    `**Internal Theme:** ${mdValue(tb.internal_theme)}`,
    `**Core Dramatic Question:** ${mdValue(tb.core_dramatic_question)}`,
    `**Theme Statement:** ${mdValue(tb.theme_statement)}`,
    `**Narrative Purpose:** ${mdValue(tb.narrative_purpose)}`,
    "",
    `## 8. Dramatic Engine`,
    `**Protagonist:** ${mdValue(de.protagonist)}`,
    `**Antagonistic Force:** ${mdValue(de.antagonistic_force)}`,
    `**Central Conflict:** ${mdValue(de.central_conflict)}`,
    `**Primary Stakes:** ${mdValue(de.primary_stakes)}`,
    `**Transformation Arc:** ${mdValue(de.transformation_arc)}`,
    `**Emotional Journey:** ${mdValue(de.emotional_journey)}`,
    "",
    `## 9. Principal Characters`,
    doc["9_principal_characters"].length
      ? doc["9_principal_characters"]
          .map((c) => {
            if (c && typeof c === "object") {
              const o = c as Record<string, unknown>;
              return `- **${o.name ?? "?"}** (${o.story_role ?? "role TBD"}) — ${o.description ?? ""}${o.primary_function ? ` _Function: ${o.primary_function}_` : ""}`;
            }
            return `- ${String(c)}`;
          })
          .join("\n")
      : "_—_",
    "",
    `## 10. World Foundation`,
    `**Time Period:** ${mdValue(wf.time_period)}`,
    `**Primary Settings:**\n${mdList(wf.primary_settings)}`,
    `**Nature of World:** ${mdValue(wf.nature_of_world)}`,
    `**Premise Assumptions:**\n${mdList(wf.premise_assumptions)}`,
    `**Environmental Rules:**\n${mdList(wf.environmental_rules)}`,
    "",
    `## 11. Story Spine`,
    `1. **Opening Image:** ${mdValue(sp.opening_image)}`,
    `2. **Inciting Incident:** ${mdValue(sp.inciting_incident)}`,
    `3. **First Turning Point:** ${mdValue(sp.first_turning_point)}`,
    `4. **Midpoint:** ${mdValue(sp.midpoint)}`,
    `5. **Second Turning Point:** ${mdValue(sp.second_turning_point)}`,
    `6. **Climax:** ${mdValue(sp.climax)}`,
    `7. **Closing Image:** ${mdValue(sp.closing_image)}`,
    "",
    `## 12. Outstanding Questions`,
    doc["12_outstanding_questions"].length
      ? doc["12_outstanding_questions"]
          .map((q) => `- ${q.item} _(defer to: ${q.defer_to ?? "TBD"})_${q.notes ? ` — ${q.notes}` : ""}`)
          .join("\n")
      : "_None — everything resolved._",
    "",
    `## 13. Version History`,
    `| Version | Date | Summary of Changes |`,
    `| --- | --- | --- |`,
    ...doc["13_version_history"].map((v) => `| ${v.version} | ${v.date} | ${v.summary_of_changes} |`),
    "",
  ];

  return lines.join("\n");
}

// ---------- Version persistence (issue #19) ----------

interface ElementSnapshot {
  [elementId: string]: { status: string; value: unknown };
}

export interface StoredDocumentVersion {
  version: number;
  date: string;
  summary_of_changes: string;
  json: FoundationDocument;
  markdown: string;
  /** Canon snapshot at generation time, used to diff the next version. */
  elementsSnapshot: ElementSnapshot;
}

function versionsCollection(storyId: string) {
  return getDb().collection("stories").doc(storyId).collection("versions");
}

export async function listDocumentVersions(
  storyId: string
): Promise<Pick<StoredDocumentVersion, "version" | "date" | "summary_of_changes">[]> {
  const snap = await versionsCollection(storyId).orderBy("version", "asc").get();
  return snap.docs.map((d) => {
    const v = d.data() as StoredDocumentVersion;
    return { version: v.version, date: v.date, summary_of_changes: v.summary_of_changes };
  });
}

export async function getDocumentVersion(
  storyId: string,
  version: number
): Promise<StoredDocumentVersion | null> {
  const snap = await versionsCollection(storyId).doc(String(version)).get();
  return snap.exists ? (snap.data() as StoredDocumentVersion) : null;
}

function diffSummary(prev: ElementSnapshot | null, current: ElementSnapshot): string {
  if (!prev) return "Initial generation.";
  const changes: string[] = [];
  for (const [id, cur] of Object.entries(current)) {
    const old = prev[id];
    if (!old) {
      changes.push(`added ${id}`);
    } else if (JSON.stringify(old.value) !== JSON.stringify(cur.value)) {
      changes.push(`changed ${id}`);
    } else if (old.status !== cur.status) {
      changes.push(`${id}: ${old.status} → ${cur.status}`);
    }
  }
  for (const id of Object.keys(prev)) {
    if (!current[id]) changes.push(`removed ${id}`);
  }
  return changes.length ? changes.join("; ") : "No canon changes since previous version.";
}

/**
 * Generates the next document version for a Story: compiles Confirmed canon,
 * computes the diff summary vs the prior version's snapshot, and persists it
 * (prior versions are never overwritten — issue #19 AC).
 */
export async function generateFoundationDocument(storyId: string): Promise<StoredDocumentVersion> {
  const story = await getStory(storyId);
  if (!story) throw new Error(`Story "${storyId}" not found.`);

  const [elements, outstanding, priorVersions] = await Promise.all([
    listElements(storyId),
    listOutstandingQuestions(storyId),
    versionsCollection(storyId).orderBy("version", "desc").limit(1).get(),
  ]);

  const prior = priorVersions.empty ? null : (priorVersions.docs[0].data() as StoredDocumentVersion);
  const version = (prior?.version ?? 0) + 1;

  const snapshot: ElementSnapshot = {};
  for (const e of elements) snapshot[e.element_id] = { status: e.status, value: e.value };

  const date = new Date().toISOString().slice(0, 10);
  const summary = diffSummary(prior?.elementsSnapshot ?? null, snapshot);

  const historyRows = [
    ...(prior ? (await listDocumentVersions(storyId)).map((v) => ({ version: `v${v.version}`, date: v.date, summary_of_changes: v.summary_of_changes })) : []),
    { version: `v${version}`, date, summary_of_changes: summary },
  ];

  const json = compileFoundationDocument(story, elements, outstanding, version, historyRows);
  const markdown = renderMarkdown(json);

  const stored: StoredDocumentVersion = {
    version,
    date,
    summary_of_changes: summary,
    json,
    markdown,
    elementsSnapshot: snapshot,
  };
  await versionsCollection(storyId).doc(String(version)).set(stored);
  return stored;
}
