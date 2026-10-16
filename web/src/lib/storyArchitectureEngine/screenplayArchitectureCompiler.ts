import {
  getStory,
  getLatestScreenplayArchitectureVersion,
  saveScreenplayArchitectureVersion,
  listScreenplayArchitectureVersions,
  listScreenplayArchitectureDrafts,
  getLatestScreenplayArchitectureDraft,
  saveScreenplayArchitectureDraft,
  type StoredScreenplayArchitectureVersion,
  type StoredScreenplayArchitectureDraft,
} from "@/lib/canonEngine/storyStore";
import { ingestCanon } from "./ingestCanon";
import { compileScreenplayArchitectureDocumentJson, renderScreenplayArchitectureMarkdown } from "./compileArchitectureDocument";
import type { StructuralUnit } from "./stateLedger";
import { STRUCTURAL_ACTS, type ActId } from "./structuralFramework";

/**
 * Generates the next Screenplay Architecture Document version for a
 * Story - GitHub issue #70. Fetches canon and the structural-unit
 * ledger, computes the next version number, builds the compiled JSON
 * and rendered markdown, and persists it as a new immutable version
 * (prior versions are never overwritten). Mirrors
 * worldBibleCompiler.ts's own generateWorldBibleDocument orchestration
 * shape exactly (issue #50) - unlike that function, this one makes no
 * Anthropic call at all, since this compiler is fully deterministic.
 */

type UnitsSnapshot = Record<string, { status: string; content: unknown }>;

/** Byte-for-byte the same shape as worldBibleCompiler.ts's own
 * diffSummary - added/changed/removed, comparing JSON.stringify'd
 * content and status per unit. Exported (issue #71) so
 * generatePartialScreenplayArchitectureDraft below reuses it verbatim
 * for a scope's own draft history, instead of duplicating it. */
export function diffUnitsSnapshot(prev: UnitsSnapshot | null, current: UnitsSnapshot): string {
  if (!prev) return "Initial generation.";
  const changes: string[] = [];
  for (const [id, cur] of Object.entries(current)) {
    const old = prev[id];
    if (!old) {
      changes.push(`added ${id}`);
    } else if (JSON.stringify(old.content) !== JSON.stringify(cur.content)) {
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

export async function generateScreenplayArchitectureDocument(
  storyId: string
): Promise<StoredScreenplayArchitectureVersion> {
  const story = await getStory(storyId);
  if (!story) throw new Error(`Story "${storyId}" not found.`);

  const units: StructuralUnit[] = story.p4Units ?? [];
  const [canon, prior] = await Promise.all([
    ingestCanon(storyId),
    getLatestScreenplayArchitectureVersion(storyId),
  ]);

  const version = (prior?.version ?? 0) + 1;
  const snapshot: UnitsSnapshot = {};
  for (const u of units) snapshot[u.unitId] = { status: u.status, content: u.content };

  const date = new Date().toISOString().slice(0, 10);
  const summary = diffUnitsSnapshot(prior?.unitsSnapshot ?? null, snapshot);

  const priorHistory = prior
    ? (await listScreenplayArchitectureVersions(storyId)).map((v) => ({
        version: `v${v.version}`,
        date: v.date,
        summary_of_changes: v.summary_of_changes,
      }))
    : [];
  const versionHistory = [...priorHistory, { version: `v${version}`, date, summary_of_changes: summary }];

  const json = compileScreenplayArchitectureDocumentJson({ storyId, canon, units, version, versionHistory });
  const markdown = renderScreenplayArchitectureMarkdown(json);

  const stored: StoredScreenplayArchitectureVersion = {
    version,
    date,
    summary_of_changes: summary,
    json,
    markdown,
    unitsSnapshot: snapshot,
    confirmed: false,
    confirmedAt: null,
  };
  await saveScreenplayArchitectureVersion(storyId, stored);
  return stored;
}

export interface GeneratePartialScreenplayArchitectureDraftParams {
  storyId: string;
  /** The caller's already-fetched FULL units snapshot - same
   * "caller already has it" convention issue #174 established for
   * the full compiler above. This function does the Act-filtering
   * itself; the caller never pre-filters. */
  units: StructuralUnit[];
  actId: ActId;
}

/**
 * Issue #71: compiles ONE named Act as a versioned DRAFT - never
 * touches `p4ArchitectureVersions`/its counter above (see
 * docs/superpowers/specs/2026-10-16-p4-partial-compile-design.md §3).
 * Each Act gets its own independent `draftVersion` sequence, looked up
 * and persisted entirely separately from the full document's own
 * version history and counter.
 */
export async function generatePartialScreenplayArchitectureDraft(
  params: GeneratePartialScreenplayArchitectureDraftParams
): Promise<StoredScreenplayArchitectureDraft> {
  const { storyId, units, actId } = params;
  const act = STRUCTURAL_ACTS.find((a) => a.id === actId);
  if (!act) throw new Error(`Unknown Act id "${actId}".`);

  const scopeKey = `act-${actId}`;
  const scopedUnits = units.filter((u) => u.stepNumber !== null && act.stepNumbers.includes(u.stepNumber));

  const [canon, priorDraft] = await Promise.all([
    ingestCanon(storyId),
    getLatestScreenplayArchitectureDraft(storyId, scopeKey),
  ]);

  const draftVersion = (priorDraft?.draftVersion ?? 0) + 1;
  const snapshot: UnitsSnapshot = {};
  for (const u of scopedUnits) snapshot[u.unitId] = { status: u.status, content: u.content };

  const date = new Date().toISOString().slice(0, 10);
  const summary = diffUnitsSnapshot(priorDraft?.unitsSnapshot ?? null, snapshot);

  const priorHistory = priorDraft
    ? (await listScreenplayArchitectureDrafts(storyId, scopeKey)).map((d) => ({
        version: `draft-v${d.draftVersion}`,
        date: d.date,
        summary_of_changes: d.summaryOfChanges,
      }))
    : [];
  const versionHistory = [...priorHistory, { version: `draft-v${draftVersion}`, date, summary_of_changes: summary }];

  const json = compileScreenplayArchitectureDocumentJson({
    storyId,
    canon,
    units: scopedUnits,
    version: draftVersion,
    versionHistory,
    status: "Draft",
    scopeLabel: `Act ${act.id} (${act.name}) - partial compile, draft only, not final canon`,
    versionLabel: `draft-v${draftVersion}`,
    actScope: act.id,
  });
  const markdown = renderScreenplayArchitectureMarkdown(json);

  const stored: StoredScreenplayArchitectureDraft = {
    draftId: `${scopeKey}-${draftVersion}`,
    scopeKey,
    scope: { type: "act", act_id: act.id },
    draftVersion,
    date,
    summaryOfChanges: summary,
    json,
    markdown,
    unitsSnapshot: snapshot,
    createdAt: new Date().toISOString(),
  };
  await saveScreenplayArchitectureDraft(storyId, stored);
  return stored;
}
