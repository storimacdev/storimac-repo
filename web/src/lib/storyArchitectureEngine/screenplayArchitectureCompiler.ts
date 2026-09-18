import {
  getStory,
  getLatestScreenplayArchitectureVersion,
  saveScreenplayArchitectureVersion,
  listScreenplayArchitectureVersions,
  type StoredScreenplayArchitectureVersion,
} from "@/lib/canonEngine/storyStore";
import { ingestCanon } from "./ingestCanon";
import { compileScreenplayArchitectureDocumentJson, renderScreenplayArchitectureMarkdown } from "./compileArchitectureDocument";
import type { StructuralUnit } from "./stateLedger";

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
 * content and status per unit. */
function diffSummary(prev: UnitsSnapshot | null, current: UnitsSnapshot): string {
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
  const summary = diffSummary(prior?.unitsSnapshot ?? null, snapshot);

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
