#!/usr/bin/env node
/**
 * Read-only audit for stage-gate drift (2026-08-04) - scans every Project 1
 * story for two independent signals that its currentStage pointer may be
 * stuck behind what the canon substantively supports:
 *
 *   1. Elements whose element_id isn't in the canonical registry (direct
 *      drift evidence - the only signal that can catch already-drifted
 *      data from before this fix; the tool-schema enum and the catch-up
 *      loop only help going forward).
 *   2. A story where the highest `stage` number tagged on any element is
 *      well ahead of the stored currentStage - the model itself asserting
 *      later-stage progress the FSM pointer never caught up to.
 *
 * Makes no writes. Prints a report for human triage - the same kind of
 * judgment call the one-off repair for story NtEdq7hZfyaW33eN2DCE needed
 * (deciding Parked-vs-Confirmed, writing honest rationale for anything with
 * no real captured content) isn't something this script should automate.
 *
 * Usage (from web/): npx tsx scripts/audit-stage-drift.ts
 * Requires the same Firestore credentials the running app needs - see
 * web/src/lib/firebaseAdmin.ts's header comment.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getDb } from "../src/lib/firebaseAdmin";
import { listElements } from "../src/lib/canonEngine/canonStore";
import { isKnownElementId } from "../src/lib/canonEngine/elementRegistry";

// tsx doesn't auto-load .env.local the way `next dev`/`next build` do, so
// load it by hand. This runs before main() below calls getDb() (the only
// place any of the imports above actually read process.env - none of them
// touch it at module-load time), so ordering here is safe despite import
// declarations always being hoisted ahead of this code.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "../.env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

interface StoryRow {
  id: string;
  currentStage: number;
  currentProject: string;
}

interface FlaggedStory {
  storyId: string;
  currentStage: number;
  maxElementStage: number;
  unknownElementIds: string[];
}

async function listAllStories(): Promise<StoryRow[]> {
  const db = getDb();
  const snap = await db.collection("stories").get();
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      currentStage: typeof data.currentStage === "number" ? data.currentStage : 1,
      currentProject: typeof data.currentProject === "string" ? data.currentProject : "project1",
    };
  });
}

function auditStory(storyId: string, currentStage: number, elements: Awaited<ReturnType<typeof listElements>>): FlaggedStory | null {
  const unknownElementIds = elements.map((e) => e.element_id).filter((id) => !isKnownElementId(id));
  const maxElementStage = elements.reduce((max, e) => Math.max(max, e.stage ?? 0), 0);
  const stageMismatch = maxElementStage > currentStage + 1;

  if (unknownElementIds.length === 0 && !stageMismatch) return null;
  return { storyId, currentStage, maxElementStage, unknownElementIds };
}

async function main() {
  const stories = (await listAllStories()).filter((s) => s.currentProject === "project1");
  console.log(`Scanning ${stories.length} Project 1 stories for stage-gate drift...\n`);

  const flagged: FlaggedStory[] = [];
  for (const story of stories) {
    const elements = await listElements(story.id);
    const result = auditStory(story.id, story.currentStage, elements);
    if (result) flagged.push(result);
  }

  if (flagged.length === 0) {
    console.log("No drift signals found - no stories flagged.");
    return;
  }

  console.log(`${flagged.length} of ${stories.length} stories flagged:\n`);
  for (const f of flagged) {
    console.log(`Story ${f.storyId}`);
    console.log(`  currentStage: ${f.currentStage}`);
    console.log(`  highest element-tagged stage: ${f.maxElementStage}`);
    if (f.unknownElementIds.length > 0) {
      console.log(`  non-canonical element_ids (${f.unknownElementIds.length}): ${f.unknownElementIds.join(", ")}`);
    }
    console.log("");
  }
}

main().catch((err) => {
  console.error("Audit failed:", err);
  process.exit(1);
});
