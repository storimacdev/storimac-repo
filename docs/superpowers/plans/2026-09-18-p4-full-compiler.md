# P4 Full Compiler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement GitHub issue #70 (full 7-section Screenplay Architecture Document compiler,
folding in issue #115 as a small prerequisite) — a real, versioned, multi-format-exportable
compile of the P4 structural outline, completing every placeholder issue #60's compiler
deliberately left for this issue to finish.

**Architecture:** Mirrors Project 3's already-shipped World Bible compiler (issues #50/#51) as
closely as possible: a typed JSON document with numbered section keys, an immutable
version-per-Firestore-doc storage pattern, a pure JSON-builder/markdown-renderer split, a
fetch-version-diff-persist orchestrator, and matching docx/pdf export modules. Unlike the World
Bible compiler, this one stays fully deterministic (issue #60's own established "no fabrication"
posture) — no LLM call anywhere in this plan.

**Tech Stack:** Plain TypeScript pure functions, Firestore persistence via `firebase-admin`, the
`docx` and `@react-pdf/renderer` packages (already dependencies, already used by the World Bible
equivalents), and React/TSX.

## Global Constraints

- No test suite exists in this project — verification is `npx tsc --noEmit -p .`, `npm run
  lint`, `npm run build` (all from `web/`), plus a direct code trace.
- Fully deterministic — no `Anthropic` import anywhere in this plan's new/changed files.
- Every new type/function name and Firestore collection name mirrors the World Bible
  precedent's own naming convention as closely as sensible (`StoredScreenplayArchitectureVersion`
  next to `StoredWorldBibleVersion`, `p4ArchitectureVersions` collection next to
  `worldBibleVersions`, etc.) so a future reader can find the parallel structure immediately.
- No confirm/structure-lint flow, no version-browse-by-number route, no partial/incremental
  compile (issue #71's own scope) — all deliberately out of scope, see the design spec's §7.
- The existing issue #65/#91 combined 409/`acknowledged` gate in
  `architecture-chat/document/route.ts` is untouched by this plan except for swapping the actual
  compile call and the success response shape.
- Design spec: `docs/superpowers/specs/2026-09-18-p4-full-compiler-design.md`.

---

### Task 1: Issue #115 — expose Working Title and Genre/Tone through `ingestCanon`

**Files:**
- Modify: `web/src/lib/storyArchitectureEngine/ingestCanon.ts`

**Interfaces:**
- Produces: `IngestedProject1Canon` gains `workingTitle: string` and `genreTone:
  FoundationDocument["6_genre_tone"]`. Task 4 consumes both.

- [ ] **Step 1: Add the two new fields to `IngestedProject1Canon`**

  This interface currently reads:
  ```ts
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
  ```
  Change it to:
  ```ts
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
    /** Issue #115 - already computed by ingestFoundation.ts, just never
     * copied through here until now. */
    workingTitle: string;
    /** Issue #115 - read directly off the fetched document, same
     * pattern as storyDna/format/thematicBlueprint above. */
    genreTone: FoundationDocument["6_genre_tone"];
  }
  ```

- [ ] **Step 2: Populate both fields in `ingestProject1`**

  Inside `ingestProject1`, the `canon` object literal currently reads:
  ```ts
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
  ```
  Change it to:
  ```ts
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
      workingTitle: foundationResult.foundation.workingTitle,
      genreTone: doc["6_genre_tone"],
    };
  ```

- [ ] **Step 3: Verify**

  From `web/`, run:
  ```bash
  npx tsc --noEmit -p .
  npm run lint
  npm run build
  ```
  All three must be clean. Then trace by hand: construct (or find, via a throwaway script) a
  representative `IngestFoundationResult` with `status: "ok"` and a `FoundationDocument`-shaped
  object carrying a non-empty `"1_story_metadata".working_title` and a populated `"6_genre_tone"`
  block; confirm `ingestProject1`'s returned `canon.workingTitle`/`canon.genreTone` match those
  inputs exactly, and that this doesn't alter any of the OTHER fields already being extracted
  (the diff should be purely additive — two new lines, nothing else in the function's control
  flow or existing field extraction changes).

- [ ] **Step 4: Commit**

  ```bash
  git add web/src/lib/storyArchitectureEngine/ingestCanon.ts
  git commit -m "feat: expose Working Title and Genre/Tone through ingestCanon (issue #115)"
  ```

---

### Task 2: New Firestore-backed types and version-persistence functions

**Files:**
- Modify: `web/src/lib/canonEngine/storyStore.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ScreenplayArchitectureDocument { /* full 7-section shape, see Step 1 */ }
  export interface StoredScreenplayArchitectureVersion { /* see Step 1 */ }
  export function listScreenplayArchitectureVersions(storyId: string): Promise<Pick<StoredScreenplayArchitectureVersion, "version" | "date" | "summary_of_changes">[]>;
  export function getLatestScreenplayArchitectureVersion(storyId: string): Promise<StoredScreenplayArchitectureVersion | null>;
  export function saveScreenplayArchitectureVersion(storyId: string, stored: StoredScreenplayArchitectureVersion): Promise<void>;
  ```
  Task 4 and Task 5 both import these.

- [ ] **Step 1: Add the two new types and three new functions**

  In `web/src/lib/canonEngine/storyStore.ts`, find the closing brace of `confirmWorldBibleVersion`
  (the function immediately after it is `appendAuthorTypeAssessment`). Insert this entire block
  between them:
  ```ts

  /**
   * Project 4's Screenplay Architecture Document (issue #70) - the
   * 7-section compiled output (P4 Prompt v3.0 §6). Mirrors
   * WorldBibleDocument/StoredWorldBibleVersion's exact shape and
   * versioning precedent (issue #50) - numbered section keys,
   * immutable-once-written versions, a snapshot of the source data at
   * generation time for diffing the next version. Deterministic
   * template-fill only (issue #60's own "no fabrication" posture) -
   * unlike WorldBibleDocument, no section here is LLM-synthesized.
   */
  export interface ScreenplayArchitectureDocument {
    schema_version: string;
    "1_screenplay_metadata": {
      story_id: string;
      screenplay_architecture_version: string;
      working_title: string;
      date: string;
      status: "Compiled";
      author: string;
      diagnosed_complexity: string;
      projected_scene_count: number;
      estimated_runtime: string;
    };
    "2_story_dna_blueprint": {
      summary_of_core_promise: string;
      genre: string;
      tone: string;
      theme: string;
      core_dramatic_question: string;
    };
    "3_structural_act_set_piece_overview": {
      act_id: string;
      act_name: string;
      step_numbers: number[];
      anchoring_set_pieces: string[];
    }[];
    "4_complete_approved_scene_register": {
      unit_id: string;
      type: string;
      scene_number: number;
      slugline: string;
      critical_beat_tag: string | null;
      paragraph: string;
      causal_tag: string;
    }[];
    "5_critical_beat_earmark_index": {
      tag: string;
      scene_number: number | null;
      unit_id: string | null;
      slugline: string | null;
    }[];
    "6_setup_payoff_ledger": string;
    "7_outstanding_decisions_version_history": {
      outstanding: { unit_id: string; status: string }[];
      version_history: { version: string; date: string; summary_of_changes: string }[];
    };
  }

  export interface StoredScreenplayArchitectureVersion {
    version: number;
    date: string;
    summary_of_changes: string;
    json: ScreenplayArchitectureDocument;
    markdown: string;
    /** Every p4Unit's {status, content} at generation time, not just
     * Confirmed ones - same "snapshot everything" precedent as
     * StoredWorldBibleVersion's own elementsSnapshot, used to diff the
     * next version. */
    unitsSnapshot: Record<string, { status: string; content: unknown }>;
    /** Always false/null in issue #70's scope - no confirm/structure-lint
     * flow is being built here (unlike issue #51's World Bible
     * equivalent). Exists for schema parity and future-proofing only. */
    confirmed: boolean;
    confirmedAt: string | null;
  }

  function p4ArchitectureVersionsCollection(storyId: string) {
    return storiesCollection().doc(storyId).collection("p4ArchitectureVersions");
  }

  export async function listScreenplayArchitectureVersions(
    storyId: string
  ): Promise<Pick<StoredScreenplayArchitectureVersion, "version" | "date" | "summary_of_changes">[]> {
    const snap = await p4ArchitectureVersionsCollection(storyId).orderBy("version", "asc").get();
    return snap.docs.map((d) => {
      const v = d.data() as StoredScreenplayArchitectureVersion;
      return { version: v.version, date: v.date, summary_of_changes: v.summary_of_changes };
    });
  }

  export async function getLatestScreenplayArchitectureVersion(
    storyId: string
  ): Promise<StoredScreenplayArchitectureVersion | null> {
    const snap = await p4ArchitectureVersionsCollection(storyId).orderBy("version", "desc").limit(1).get();
    return snap.empty ? null : (snap.docs[0].data() as StoredScreenplayArchitectureVersion);
  }

  /** Persists a new Screenplay Architecture Document version. Never
   * overwrites a prior version - `stored.version` must already be
   * `(latest?.version ?? 0) + 1`, computed by the caller
   * (screenplayArchitectureCompiler.ts's
   * generateScreenplayArchitectureDocument), same division of
   * responsibility as saveWorldBibleVersion's own. */
  export async function saveScreenplayArchitectureVersion(
    storyId: string,
    stored: StoredScreenplayArchitectureVersion
  ): Promise<void> {
    await p4ArchitectureVersionsCollection(storyId).doc(String(stored.version)).set(stored);
  }
  ```

- [ ] **Step 2: Verify**

  From `web/`, run:
  ```bash
  npx tsc --noEmit -p .
  npm run lint
  npm run build
  ```
  All three must be clean (this step is purely additive — no existing code path changes, so a
  clean typecheck/build is the main signal; there's no meaningful hand-trace beyond confirming
  the new functions' signatures compile and `p4ArchitectureVersionsCollection` correctly reuses
  the existing private `storiesCollection()` helper already used by every sibling function in
  this file).

- [ ] **Step 3: Commit**

  ```bash
  git add web/src/lib/canonEngine/storyStore.ts
  git commit -m "feat: add P4 Screenplay Architecture Document types and version storage (issue #70)"
  ```

---

### Task 3: New scene-parsing function

**Files:**
- Modify: `web/src/lib/storyArchitectureEngine/developmentLoop.ts`

**Interfaces:**
- Consumes: `SLUGLINE_PATTERN`, `CRITICAL_BEAT_TAG_PATTERN` (both already exist in this file,
  the latter already exported per issue #91), `CRITICAL_BEAT_LOOKUP` (already imported into this
  file from `./structuralFramework`).
- Produces:
  ```ts
  export interface ParsedSceneRegisterEntry { slugline: string; criticalBeatTag: string | null; paragraph: string; }
  export function parseSceneRegisterEntry(content: string): ParsedSceneRegisterEntry;
  ```
  Task 4 consumes this directly.

- [ ] **Step 1: Add `parseSceneRegisterEntry`**

  In `web/src/lib/storyArchitectureEngine/developmentLoop.ts`, add this new exported interface
  and function immediately after `checkSceneRegisterFormat`'s closing brace (before `export type
  RoutingChoice`):
  ```ts
  export interface ParsedSceneRegisterEntry {
    slugline: string;
    criticalBeatTag: string | null;
    paragraph: string;
  }

  /**
   * Parses a Scene Register entry's already-validated shape into its
   * separate parts, for the compiler (issue #70) to render structurally
   * - checkSceneRegisterFormat above already isolates the same three
   * pieces internally but only ever returns a pass/fail verdict. Never
   * throws: a unit whose content is malformed (only reachable if the
   * author overrode issue #91's Formatting Check) degrades to
   * disclosed placeholder text rather than crashing the compile.
   */
  export function parseSceneRegisterEntry(content: string): ParsedSceneRegisterEntry {
    const trimmed = content.trim();
    const firstNewline = trimmed.search(/\r?\n/);
    const firstLine = firstNewline === -1 ? trimmed : trimmed.slice(0, firstNewline);
    const rest = firstNewline === -1 ? "" : trimmed.slice(firstNewline).trim();

    const slugline = SLUGLINE_PATTERN.test(firstLine) ? firstLine.trim() : "(malformed - no slugline found)";

    const beatMatch = trimmed.match(CRITICAL_BEAT_TAG_PATTERN);
    const criticalBeatTag =
      beatMatch && CRITICAL_BEAT_LOOKUP[beatMatch[1].trim().toUpperCase()]
        ? beatMatch[1].trim().toUpperCase()
        : null;

    const paragraph = rest ? rest.replace(CRITICAL_BEAT_TAG_PATTERN, "").trim() || trimmed : trimmed;

    return { slugline, criticalBeatTag, paragraph };
  }
  ```

- [ ] **Step 2: Verify**

  From `web/`, run:
  ```bash
  npx tsc --noEmit -p .
  npm run lint
  npm run build
  ```
  All three must be clean. Then trace by hand (or a throwaway `tsx` script) against representative
  inputs:
  - A well-formed entry (`"SCENE 1: INT. KITCHEN - DAY\n[CRITICAL BEAT: MIDPOINT]\nShe confronts him. He denies it. She leaves for good."`)
    → `{ slugline: "SCENE 1: INT. KITCHEN - DAY", criticalBeatTag: "MIDPOINT", paragraph: "She confronts him. He denies it. She leaves for good." }`.
  - The same entry without a beat tag → `criticalBeatTag: null`, `paragraph` unchanged.
  - An entry with a fabricated tag (`[CRITICAL BEAT: FAKE]`) → `criticalBeatTag: null` (not in
    `CRITICAL_BEAT_LOOKUP`), and confirm the fabricated tag text still gets stripped out of
    `paragraph` (the `.replace(CRITICAL_BEAT_TAG_PATTERN, "")` runs regardless of whether the tag
    validated).
  - Content missing a slugline entirely (just a paragraph) → `slugline: "(malformed - no slugline
    found)"`, `paragraph` still correctly extracted from the raw content (not crashed, not empty).
  - Content that's a single line with no newline at all → `paragraph` falls back to the full
    `trimmed` content (confirm this doesn't throw and doesn't return an empty string).
  - Confirm none of these inputs throw.

- [ ] **Step 3: Commit**

  ```bash
  git add web/src/lib/storyArchitectureEngine/developmentLoop.ts
  git commit -m "feat: add parseSceneRegisterEntry for structural scene parsing (issue #70)"
  ```

---

### Task 4: Compiler rewrite, orchestrator, and route wiring (one atomic unit)

This task touches three files in one pass rather than three separate tasks, deliberately — they
form a genuine linear dependency chain where the middle state is a broken build: rewriting
`compileArchitectureDocument.ts` removes the function `document/route.ts` currently calls, and
the new orchestrator that replaces it doesn't exist until this same task creates it. Splitting
this into separate tasks would mean an intermediate commit with a real compile error, breaking
this plan's own (and every prior P4 plan's) established "every task leaves `tsc`/`lint`/`build`
clean" convention that task-level review depends on. All three files are rewritten/created/wired
together, verified once, committed once.

**Files:**
- Rewrite: `web/src/lib/storyArchitectureEngine/compileArchitectureDocument.ts`
- Create: `web/src/lib/storyArchitectureEngine/screenplayArchitectureCompiler.ts`
- Modify: `web/src/app/api/architecture-chat/document/route.ts`

**Interfaces:**
- Consumes (Tasks 1-3): `IngestedProject1Canon.workingTitle`/`.genreTone`;
  `ScreenplayArchitectureDocument` type from `@/lib/canonEngine/storyStore`;
  `parseSceneRegisterEntry` from `./developmentLoop`.
- Consumes (Task 2): `getLatestScreenplayArchitectureVersion`, `saveScreenplayArchitectureVersion`,
  `listScreenplayArchitectureVersions`, `type StoredScreenplayArchitectureVersion` from
  `@/lib/canonEngine/storyStore`.
- Consumes (pre-existing, unchanged): `STRUCTURAL_ACTS`, `STRUCTURAL_STEPS`,
  `CRITICAL_BEAT_LOOKUP` from `./structuralFramework`; `getConfirmedUnits`, `type StructuralUnit`
  from `./stateLedger`; `type IngestedCanon` from `./ingestCanon`; `getStory` from
  `@/lib/canonEngine/storyStore`; `ingestCanon` from `./ingestCanon`.
- Produces (within `compileArchitectureDocument.ts`):
  ```ts
  export interface CompileScreenplayArchitectureDocumentParams {
    storyId: string;
    canon: IngestedCanon;
    units: StructuralUnit[];
    version: number;
    versionHistory: { version: string; date: string; summary_of_changes: string }[];
  }
  export function compileScreenplayArchitectureDocumentJson(params: CompileScreenplayArchitectureDocumentParams): ScreenplayArchitectureDocument;
  export function renderScreenplayArchitectureMarkdown(doc: ScreenplayArchitectureDocument): string;
  ```
  Produces (within `screenplayArchitectureCompiler.ts`, consuming both functions above):
  ```ts
  export async function generateScreenplayArchitectureDocument(storyId: string): Promise<StoredScreenplayArchitectureVersion>;
  ```
  Task 6 (UI) consumes the resulting `document/route.ts` response shape. This is a full-file
  rewrite of `compileArchitectureDocument.ts` — the OLD `CompiledDocument` interface and
  `compileScreenplayArchitectureDocument` function are removed entirely, and
  `document/route.ts`'s only call to that old function is replaced within this same task, so no
  dangling reference to the removed code ever exists in a committed state.

- [ ] **Step 1: Replace the entire `compileArchitectureDocument.ts` file**

  Replace the full contents of `web/src/lib/storyArchitectureEngine/compileArchitectureDocument.ts`
  with:
  ```ts
  import type { IngestedCanon } from "./ingestCanon";
  import { STRUCTURAL_ACTS, STRUCTURAL_STEPS, CRITICAL_BEAT_LOOKUP } from "./structuralFramework";
  import { getConfirmedUnits, type StructuralUnit } from "./stateLedger";
  import { parseSceneRegisterEntry } from "./developmentLoop";
  import type { ScreenplayArchitectureDocument } from "@/lib/canonEngine/storyStore";

  /**
   * Screenplay Architecture Document compile — GitHub issue #70,
   * completing every placeholder issue #60's own compiler deliberately
   * left for this issue. Split into a pure JSON builder (this function)
   * and a pure markdown renderer, mirroring
   * worldEngine/worldBibleCompiler.ts's compileWorldBibleDocument/
   * renderWorldBibleMarkdown split exactly (issue #50) - the
   * versioning/persistence orchestration lives in the sibling
   * screenplayArchitectureCompiler.ts, not here. Fully deterministic
   * (issue #60's own "no fabrication" posture, unlike the World Bible
   * compiler's LLM-synthesized sections) - two fields (`author`,
   * `estimated_runtime`) have no real data source anywhere in this app
   * yet and stay honest disclosed placeholders rather than fabricated
   * values.
   */

  const NOT_TRACKED_AUTHOR = "(not tracked - no per-user authorship exists in this app yet)";
  const NOT_TRACKED_RUNTIME = "(not tracked - no runtime-estimation model exists yet)";
  const NOT_TRACKED_LEDGER =
    "Not yet tracked - no issue currently owns Setup & Payoff tracking (see the filed follow-up).";

  export interface CompileScreenplayArchitectureDocumentParams {
    storyId: string;
    canon: IngestedCanon;
    units: StructuralUnit[];
    version: number;
    versionHistory: { version: string; date: string; summary_of_changes: string }[];
  }

  export function compileScreenplayArchitectureDocumentJson(
    params: CompileScreenplayArchitectureDocumentParams
  ): ScreenplayArchitectureDocument {
    const { storyId, canon, units, version, versionHistory } = params;
    const confirmed = getConfirmedUnits(units);
    const outstanding = units.filter((u) => u.status !== "Confirmed");
    const date = new Date().toISOString().slice(0, 10);

    const sceneRegister = confirmed.map((unit, index) => {
      const content = typeof unit.content === "string" ? unit.content : "";
      const parsed = parseSceneRegisterEntry(content);
      return {
        unit_id: unit.unitId,
        type: unit.type,
        scene_number: index + 1,
        slugline: parsed.slugline,
        critical_beat_tag: parsed.criticalBeatTag,
        paragraph: parsed.paragraph,
        causal_tag: unit.causalTag,
      };
    });

    const earmarkIndex = Object.keys(CRITICAL_BEAT_LOOKUP).map((tag) => {
      const entry = sceneRegister.find((s) => s.critical_beat_tag === tag);
      return {
        tag,
        scene_number: entry?.scene_number ?? null,
        unit_id: entry?.unit_id ?? null,
        slugline: entry?.slugline ?? null,
      };
    });

    const actOverview = STRUCTURAL_ACTS.map((act) => ({
      act_id: act.id,
      act_name: act.name,
      step_numbers: act.stepNumbers,
      anchoring_set_pieces: STRUCTURAL_STEPS.filter(
        (step) => act.stepNumbers.includes(step.stepNumber) && step.type === "Set Piece"
      ).map((step) => step.title),
    }));

    return {
      schema_version: "1.0",
      "1_screenplay_metadata": {
        story_id: storyId,
        screenplay_architecture_version: `v${version}`,
        working_title: canon.p1?.workingTitle || "(not yet Confirmed)",
        date,
        status: "Compiled",
        author: NOT_TRACKED_AUTHOR,
        diagnosed_complexity: "N/A",
        projected_scene_count: confirmed.length,
        estimated_runtime: NOT_TRACKED_RUNTIME,
      },
      "2_story_dna_blueprint": {
        summary_of_core_promise: canon.p1?.storyDna.core_story_promise || "(not yet Confirmed)",
        genre: canon.p1?.genreTone.genre || "(not yet Confirmed)",
        tone: canon.p1?.genreTone.tone || "(not yet Confirmed)",
        theme:
          canon.p1?.thematicBlueprint.theme_statement ||
          canon.p1?.thematicBlueprint.external_theme ||
          "(not yet Confirmed)",
        core_dramatic_question: canon.p1?.thematicBlueprint.core_dramatic_question || "(not yet Confirmed)",
      },
      "3_structural_act_set_piece_overview": actOverview,
      "4_complete_approved_scene_register": sceneRegister,
      "5_critical_beat_earmark_index": earmarkIndex,
      "6_setup_payoff_ledger": NOT_TRACKED_LEDGER,
      "7_outstanding_decisions_version_history": {
        outstanding: outstanding.map((u) => ({ unit_id: u.unitId, status: u.status })),
        version_history: versionHistory,
      },
    };
  }

  function mdValue(v: string): string {
    return v || "—";
  }

  export function renderScreenplayArchitectureMarkdown(doc: ScreenplayArchitectureDocument): string {
    const sections: string[] = [];
    const meta = doc["1_screenplay_metadata"];
    sections.push(
      "## 1. Screenplay Metadata\n" +
        `- ID: ${meta.story_id}\n` +
        `- Version: ${meta.screenplay_architecture_version}\n` +
        `- Working Title: ${mdValue(meta.working_title)}\n` +
        `- Date: ${meta.date}\n` +
        `- Status: ${meta.status}\n` +
        `- Author: ${meta.author}\n` +
        `- Diagnosed Complexity: ${meta.diagnosed_complexity}\n` +
        `- Projected Scene Count: ${meta.projected_scene_count} (target range: 75-150 scenes)\n` +
        `- Estimated Runtime: ${meta.estimated_runtime}`
    );

    const dna = doc["2_story_dna_blueprint"];
    sections.push(
      "## 2. Story DNA Blueprint\n" +
        `- Summary of Core Promise: ${mdValue(dna.summary_of_core_promise)}\n` +
        `- Genre: ${mdValue(dna.genre)}\n` +
        `- Tone: ${mdValue(dna.tone)}\n` +
        `- Theme: ${mdValue(dna.theme)}\n` +
        `- Core Dramatic Question: ${mdValue(dna.core_dramatic_question)}`
    );

    sections.push(
      "## 3. Structural Act & Set Piece Overview\n" +
        doc["3_structural_act_set_piece_overview"]
          .map(
            (act) =>
              `- Act ${act.act_id} (${act.act_name}): Steps ${act.step_numbers.join(", ")}${
                act.anchoring_set_pieces.length > 0
                  ? ` (anchoring Set Piece${act.anchoring_set_pieces.length > 1 ? "s" : ""}: ${act.anchoring_set_pieces.join("; ")})`
                  : ""
              }`
          )
          .join("\n")
    );

    const sceneRegister = doc["4_complete_approved_scene_register"];
    sections.push(
      "## 4. Complete Approved Scene Register\n" +
        (sceneRegister.length > 0
          ? sceneRegister
              .map(
                (s) =>
                  `${s.scene_number}. ${s.slugline}${s.critical_beat_tag ? ` [CRITICAL BEAT: ${s.critical_beat_tag}]` : ""} - causal tag: ${s.causal_tag}\n   ${s.paragraph}`
              )
              .join("\n")
          : "_No units are Confirmed yet._")
    );

    sections.push(
      "## 5. Critical Beat Earmark Index\n" +
        "| Critical Beat | Scene Number | Slugline |\n|---|---|---|\n" +
        doc["5_critical_beat_earmark_index"]
          .map((e) => `| ${e.tag} | ${e.scene_number ?? "_missing_"} | ${e.slugline ?? "_missing_"} |`)
          .join("\n")
    );

    sections.push("## 6. Setup & Payoff Ledger\n" + doc["6_setup_payoff_ledger"]);

    const outstandingSection = doc["7_outstanding_decisions_version_history"];
    sections.push(
      "## 7. Outstanding Decisions & Version History\n" +
        (outstandingSection.outstanding.length > 0
          ? outstandingSection.outstanding.map((u) => `- [${u.unit_id}] status: ${u.status}`).join("\n")
          : "_No outstanding items._") +
        "\n\n### Version History\n" +
        outstandingSection.version_history.map((v) => `- ${v.version} (${v.date}): ${v.summary_of_changes}`).join("\n")
    );

    return sections.join("\n\n");
  }
  ```

- [ ] **Step 2: Trace the JSON builder and markdown renderer**

  Trace `compileScreenplayArchitectureDocumentJson` and `renderScreenplayArchitectureMarkdown` by
  hand (or a throwaway script, constructing minimal fake `IngestedCanon`/`StructuralUnit[]`
  inputs) against these cases — do not run `tsc`/`lint`/`build` yet, since `document/route.ts`
  still references the now-removed old function until Step 5 below rewires it:
  - Zero Confirmed units → `"4_complete_approved_scene_register"` is `[]`,
    `"5_critical_beat_earmark_index"` has all 10 entries with `scene_number`/`unit_id`/`slugline`
    all `null`, `projected_scene_count: 0`.
  - Three Confirmed units at different Acts, one carrying a valid `[CRITICAL BEAT: MIDPOINT]` tag
    → the Scene Register has 3 entries numbered 1-3 in ledger order, the Earmark Index's
    `"MIDPOINT"` entry correctly cross-references the SAME `scene_number`/`unit_id`/`slugline` as
    that unit's own Scene Register entry (not a separately-computed, potentially-divergent value).
  - A Confirmed unit whose content carries TWO valid beat tags — confirm only the array's
    `.find()`-based single-match approach in `earmarkIndex` correctly finds each tag once (this
    reuses the non-global single-tag extraction already inside `parseSceneRegisterEntry`, so a
    unit with two tags will only have ONE recorded in `critical_beat_tag` — trace which one wins
    and confirm this doesn't crash; this is a known, disclosed simplification, not a bug to fix
    in this task).
  - `canon.p1` being `null` (Project 1 not yet complete) → every Section 1/2 field that reads off
    `canon.p1?...` falls back to `"(not yet Confirmed)"` without crashing.
  - `renderScreenplayArchitectureMarkdown` on a non-trivial JSON object → confirm the output is a
    non-empty string containing all 7 `##` headings in order.

- [ ] **Step 3: Create the orchestrator file**

  Create `web/src/lib/storyArchitectureEngine/screenplayArchitectureCompiler.ts`:
  ```ts
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
  ```

- [ ] **Step 4: Trace the orchestrator**

  Trace by hand: two successive calls to `generateScreenplayArchitectureDocument` against the
  same `storyId` (using a throwaway script against a real or emulated Firestore, OR by tracing
  the logic purely on paper if no emulator is convenient here) — confirm the first call produces
  `version: 1`, `summary_of_changes: "Initial generation."`, and a `version_history` with exactly
  one entry; confirm the second call (with at least one unit's content or status changed in
  between) produces `version: 2`, a `summary_of_changes` naming the specific change, and a
  `version_history` with exactly two entries (both the v1 and v2 summaries, in order). Still no
  `tsc`/`lint`/`build` run yet — `document/route.ts` isn't rewired until Step 6 below.

- [ ] **Step 5: Update the imports in `document/route.ts`**

  This block currently reads:
  ```ts
  import { getStory } from "@/lib/canonEngine/storyStore";
  import { ingestCanon } from "@/lib/storyArchitectureEngine/ingestCanon";
  import { compileScreenplayArchitectureDocument } from "@/lib/storyArchitectureEngine/compileArchitectureDocument";
  ```
  Change it to:
  ```ts
  import { getStory } from "@/lib/canonEngine/storyStore";
  import { generateScreenplayArchitectureDocument } from "@/lib/storyArchitectureEngine/screenplayArchitectureCompiler";
  ```
  (Both `ingestCanon` and `compileScreenplayArchitectureDocument` imports are removed entirely —
  the new orchestrator does its own `ingestCanon` call internally, and the old compile function
  no longer exists after Task 4's rewrite.)

- [ ] **Step 6: Swap the compile call and response**

  This block currently reads:
  ```ts
      const canon = await ingestCanon(storyId);
      const compiled = compileScreenplayArchitectureDocument(storyId, canon, units);
      return NextResponse.json({ ...compiled, thematicAnchorAudit, preCompilationAudit });
  ```
  Change it to:
  ```ts
      const version = await generateScreenplayArchitectureDocument(storyId);
      return NextResponse.json({
        version: version.version,
        date: version.date,
        summary_of_changes: version.summary_of_changes,
        markdown: version.markdown,
        json: version.json,
        confirmed: version.confirmed,
        confirmedAt: version.confirmedAt,
        outstandingCount: version.json["7_outstanding_decisions_version_history"].outstanding.length,
        thematicAnchorAudit,
        preCompilationAudit,
      });
  ```
  Nothing else in this file changes — the API-key check, auth, story/membership lookups, the
  `preCompilationAudit`/`thematicAnchorAudit` computation, and the combined `409` gate are all
  untouched by this task.

- [ ] **Step 7: Verify — the whole task, all three files at once**

  From `web/`, run:
  ```bash
  npx tsc --noEmit -p .
  npm run lint
  npm run build
  ```
  All three must now be fully clean — this is the first point in this task where a clean build is
  expected, since all three files (the rewritten compiler, the new orchestrator, and the rewired
  route) are now in place together. Then trace by hand:
  - A story that passes both audits cleanly → `200` response includes `version: 1` (or whatever
    the next number is), `json` is the full typed document, `outstandingCount` matches
    `json["7_outstanding_decisions_version_history"].outstanding.length` exactly, and
    `thematicAnchorAudit`/`preCompilationAudit` are present and unchanged in shape from before
    this task.
  - A story that fails `preCompilationAudit` → confirm the `409` path is completely unaffected
    (it returns before ever reaching the new orchestrator call — `generateScreenplayArchitectureDocument`
    must never be invoked, and therefore no new Firestore version document gets written, on a
    blocked attempt).
  - Two successive successful compiles against the same story → confirm the second response's
    `version` is one higher than the first's, matching Step 4's own auto-increment trace.

- [ ] **Step 8: Commit — all three files together**

  ```bash
  git add web/src/lib/storyArchitectureEngine/compileArchitectureDocument.ts web/src/lib/storyArchitectureEngine/screenplayArchitectureCompiler.ts web/src/app/api/architecture-chat/document/route.ts
  git commit -m "feat: rewrite the P4 compiler, add the version orchestrator, and wire it into the compile route (issue #70)"
  ```

---

### Task 5: docx and PDF export modules

**Files:**
- Create: `web/src/lib/docx/screenplayArchitectureDocx.ts`
- Create: `web/src/lib/pdf/ScreenplayArchitecturePdfDocument.tsx`

**Interfaces:**
- Consumes (Task 2): `type ScreenplayArchitectureDocument` from `@/lib/canonEngine/storyStore`.
- Produces:
  ```ts
  export async function generateScreenplayArchitectureDocxBlob(doc: ScreenplayArchitectureDocument): Promise<Blob>;
  export function ScreenplayArchitecturePdfDocument({ doc }: { doc: ScreenplayArchitectureDocument }): JSX.Element;
  export async function generateScreenplayArchitecturePdfBlob(doc: ScreenplayArchitectureDocument): Promise<Blob>;
  ```
  Task 6 (UI) dynamically imports both generator functions.

  Before writing either file, read `web/src/lib/docx/worldBibleDocx.ts` and
  `web/src/lib/pdf/WorldBiblePdfDocument.tsx` in full — this task's code below is a complete,
  working implementation, but those two files are the established visual/structural precedent
  (heading levels, spacing conventions, table styling) this issue is explicitly meant to match as
  closely as sensible. If anything in this task's code conflicts with a clear convention in those
  files (e.g. a specific style constant, a specific heading-level choice), prefer matching the
  sibling files' convention over this task's exact code, and note the deviation in your report.

- [ ] **Step 1: Create the docx module**

  Create `web/src/lib/docx/screenplayArchitectureDocx.ts`:
  ```ts
  import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } from "docx";
  import type { ScreenplayArchitectureDocument } from "@/lib/canonEngine/storyStore";

  /**
   * Screenplay Architecture Document .docx export - GitHub issue #70.
   * Mirrors docx/worldBibleDocx.ts's exact imperative, per-section-in-order
   * pattern (issue #50) - walks the typed JSON document directly, one
   * heading + body per section, in the same order
   * renderScreenplayArchitectureMarkdown already establishes.
   */

  function docxValue(v: string): string {
    return v || "—";
  }

  function sectionHeading(text: string): Paragraph {
    return new Paragraph({ text, heading: HeadingLevel.HEADING_1 });
  }

  function fieldParagraph(label: string, value: string): Paragraph {
    return new Paragraph({
      children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun(docxValue(value))],
    });
  }

  export async function generateScreenplayArchitectureDocxBlob(doc: ScreenplayArchitectureDocument): Promise<Blob> {
    const children: (Paragraph | Table)[] = [];

    children.push(new Paragraph({ text: "Screenplay Architecture Document", heading: HeadingLevel.TITLE }));

    const meta = doc["1_screenplay_metadata"];
    children.push(sectionHeading("1. Screenplay Metadata"));
    children.push(fieldParagraph("ID", meta.story_id));
    children.push(fieldParagraph("Version", meta.screenplay_architecture_version));
    children.push(fieldParagraph("Working Title", meta.working_title));
    children.push(fieldParagraph("Date", meta.date));
    children.push(fieldParagraph("Status", meta.status));
    children.push(fieldParagraph("Author", meta.author));
    children.push(fieldParagraph("Diagnosed Complexity", meta.diagnosed_complexity));
    children.push(fieldParagraph("Projected Scene Count", String(meta.projected_scene_count)));
    children.push(fieldParagraph("Estimated Runtime", meta.estimated_runtime));

    const dna = doc["2_story_dna_blueprint"];
    children.push(sectionHeading("2. Story DNA Blueprint"));
    children.push(fieldParagraph("Summary of Core Promise", dna.summary_of_core_promise));
    children.push(fieldParagraph("Genre", dna.genre));
    children.push(fieldParagraph("Tone", dna.tone));
    children.push(fieldParagraph("Theme", dna.theme));
    children.push(fieldParagraph("Core Dramatic Question", dna.core_dramatic_question));

    children.push(sectionHeading("3. Structural Act & Set Piece Overview"));
    for (const act of doc["3_structural_act_set_piece_overview"]) {
      children.push(
        new Paragraph(
          `Act ${act.act_id} (${act.act_name}): Steps ${act.step_numbers.join(", ")}${
            act.anchoring_set_pieces.length > 0 ? ` — ${act.anchoring_set_pieces.join("; ")}` : ""
          }`
        )
      );
    }

    children.push(sectionHeading("4. Complete Approved Scene Register"));
    if (doc["4_complete_approved_scene_register"].length === 0) {
      children.push(new Paragraph("No units are Confirmed yet."));
    } else {
      for (const s of doc["4_complete_approved_scene_register"]) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: `${s.scene_number}. ${s.slugline}`, bold: true }),
              ...(s.critical_beat_tag
                ? [new TextRun({ text: `  [CRITICAL BEAT: ${s.critical_beat_tag}]`, italics: true })]
                : []),
            ],
          })
        );
        children.push(new Paragraph(s.paragraph));
      }
    }

    children.push(sectionHeading("5. Critical Beat Earmark Index"));
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Critical Beat", bold: true })] })] }),
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Scene #", bold: true })] })] }),
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Slugline", bold: true })] })] }),
            ],
          }),
          ...doc["5_critical_beat_earmark_index"].map(
            (e) =>
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph(e.tag)] }),
                  new TableCell({ children: [new Paragraph(e.scene_number !== null ? String(e.scene_number) : "missing")] }),
                  new TableCell({ children: [new Paragraph(e.slugline ?? "missing")] }),
                ],
              })
          ),
        ],
      })
    );

    children.push(sectionHeading("6. Setup & Payoff Ledger"));
    children.push(new Paragraph(doc["6_setup_payoff_ledger"]));

    const outstandingSection = doc["7_outstanding_decisions_version_history"];
    children.push(sectionHeading("7. Outstanding Decisions & Version History"));
    if (outstandingSection.outstanding.length > 0) {
      for (const u of outstandingSection.outstanding) {
        children.push(new Paragraph(`${u.unit_id} - status: ${u.status}`));
      }
    } else {
      children.push(new Paragraph("No outstanding items."));
    }
    children.push(new Paragraph({ text: "Version History", heading: HeadingLevel.HEADING_2 }));
    for (const v of outstandingSection.version_history) {
      children.push(new Paragraph(`${v.version} (${v.date}): ${v.summary_of_changes}`));
    }

    const document = new Document({ sections: [{ children }] });
    return Packer.toBlob(document);
  }
  ```

- [ ] **Step 2: Create the PDF module**

  Create `web/src/lib/pdf/ScreenplayArchitecturePdfDocument.tsx`:
  ```tsx
  "use client";

  import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer";
  import type { ScreenplayArchitectureDocument } from "@/lib/canonEngine/storyStore";

  const styles = StyleSheet.create({
    page: { padding: 32, fontSize: 10 },
    title: { fontSize: 18, marginBottom: 16 },
    h2: { fontSize: 14, marginTop: 12, marginBottom: 6 },
    h3: { fontSize: 12, marginTop: 8, marginBottom: 4 },
    label: { fontWeight: 700 },
    text: { marginBottom: 4 },
    li: { marginBottom: 2 },
    row: { flexDirection: "row", marginBottom: 2 },
    rowLabel: { width: 120, fontWeight: 700 },
    rowValue: { flex: 1 },
  });

  function pdfValue(v: string): string {
    return v || "—";
  }

  function Field({ label, value }: { label: string; value: string }) {
    return (
      <View style={styles.row}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue}>{pdfValue(value)}</Text>
      </View>
    );
  }

  export function ScreenplayArchitecturePdfDocument({ doc }: { doc: ScreenplayArchitectureDocument }) {
    const meta = doc["1_screenplay_metadata"];
    const dna = doc["2_story_dna_blueprint"];
    const outstandingSection = doc["7_outstanding_decisions_version_history"];

    return (
      <Document>
        <Page size="A4" style={styles.page}>
          <Text style={styles.title}>Screenplay Architecture Document</Text>

          <Text style={styles.h2}>1. Screenplay Metadata</Text>
          <Field label="ID" value={meta.story_id} />
          <Field label="Version" value={meta.screenplay_architecture_version} />
          <Field label="Working Title" value={meta.working_title} />
          <Field label="Date" value={meta.date} />
          <Field label="Status" value={meta.status} />
          <Field label="Author" value={meta.author} />
          <Field label="Diagnosed Complexity" value={meta.diagnosed_complexity} />
          <Field label="Projected Scene Count" value={String(meta.projected_scene_count)} />
          <Field label="Estimated Runtime" value={meta.estimated_runtime} />

          <Text style={styles.h2}>2. Story DNA Blueprint</Text>
          <Field label="Summary of Core Promise" value={dna.summary_of_core_promise} />
          <Field label="Genre" value={dna.genre} />
          <Field label="Tone" value={dna.tone} />
          <Field label="Theme" value={dna.theme} />
          <Field label="Core Dramatic Question" value={dna.core_dramatic_question} />

          <Text style={styles.h2}>3. Structural Act & Set Piece Overview</Text>
          {doc["3_structural_act_set_piece_overview"].map((act) => (
            <Text key={act.act_id} style={styles.li}>
              Act {act.act_id} ({act.act_name}): Steps {act.step_numbers.join(", ")}
              {act.anchoring_set_pieces.length > 0 ? ` — ${act.anchoring_set_pieces.join("; ")}` : ""}
            </Text>
          ))}

          <Text style={styles.h2}>4. Complete Approved Scene Register</Text>
          {doc["4_complete_approved_scene_register"].length === 0 ? (
            <Text style={styles.text}>No units are Confirmed yet.</Text>
          ) : (
            doc["4_complete_approved_scene_register"].map((s) => (
              <View key={s.unit_id} style={{ marginBottom: 6 }}>
                <Text style={styles.label}>
                  {s.scene_number}. {s.slugline}
                  {s.critical_beat_tag ? `  [CRITICAL BEAT: ${s.critical_beat_tag}]` : ""}
                </Text>
                <Text style={styles.text}>{s.paragraph}</Text>
              </View>
            ))
          )}

          <Text style={styles.h2}>5. Critical Beat Earmark Index</Text>
          {doc["5_critical_beat_earmark_index"].map((e) => (
            <Text key={e.tag} style={styles.li}>
              {e.tag} — Scene {e.scene_number ?? "missing"} — {e.slugline ?? "missing"}
            </Text>
          ))}

          <Text style={styles.h2}>6. Setup & Payoff Ledger</Text>
          <Text style={styles.text}>{doc["6_setup_payoff_ledger"]}</Text>

          <Text style={styles.h2}>7. Outstanding Decisions & Version History</Text>
          {outstandingSection.outstanding.length === 0 ? (
            <Text style={styles.text}>No outstanding items.</Text>
          ) : (
            outstandingSection.outstanding.map((u) => (
              <Text key={u.unit_id} style={styles.li}>
                {u.unit_id} - status: {u.status}
              </Text>
            ))
          )}
          <Text style={styles.h3}>Version History</Text>
          {outstandingSection.version_history.map((v) => (
            <Text key={v.version} style={styles.li}>
              {v.version} ({v.date}): {v.summary_of_changes}
            </Text>
          ))}
        </Page>
      </Document>
    );
  }

  export async function generateScreenplayArchitecturePdfBlob(doc: ScreenplayArchitectureDocument): Promise<Blob> {
    return pdf(<ScreenplayArchitecturePdfDocument doc={doc} />).toBlob();
  }
  ```

- [ ] **Step 3: Verify**

  From `web/`, run:
  ```bash
  npx tsc --noEmit -p .
  npm run lint
  npm run build
  ```
  All three must be clean. Then trace by hand: construct a small representative
  `ScreenplayArchitectureDocument` object (2-3 scenes, a couple of Acts, one earmark hit, one
  outstanding item, two version-history entries) and confirm `generateScreenplayArchitectureDocxBlob`
  and `generateScreenplayArchitecturePdfBlob` both resolve to a non-empty `Blob` without throwing
  (this can be run in a Node script for the docx generator; the PDF generator's `pdf(...).toBlob()`
  call may need to run in a browser-like environment — if it can't run standalone in this
  environment, trace the JSX structure by hand instead, confirming every field of the sample
  document is referenced somewhere in the component and no `undefined` access is possible for any
  of the document's own required fields).

- [ ] **Step 4: Commit**

  ```bash
  git add web/src/lib/docx/screenplayArchitectureDocx.ts web/src/lib/pdf/ScreenplayArchitecturePdfDocument.tsx
  git commit -m "feat: add P4 Screenplay Architecture Document docx and pdf export (issue #70)"
  ```

---

### Task 6: UI — four download formats

**Files:**
- Modify: `web/src/components/ArchitectureInterview.tsx`

**Interfaces:**
- Consumes (Task 4): the compile route's new `200` response shape (`version`, `date`,
  `summary_of_changes`, `markdown`, `json`, `confirmed`, `confirmedAt`, `outstandingCount`, plus
  the unchanged `thematicAnchorAudit`/`preCompilationAudit`).
- Consumes (Task 2, type-only): `ScreenplayArchitectureDocument` from
  `@/lib/canonEngine/storyStore` (type-only import — safe from a client component since it's
  erased at build time, matching this file's own existing convention of importing only what it
  needs).
- Consumes (Task 5): `generateScreenplayArchitectureDocxBlob`,
  `generateScreenplayArchitecturePdfBlob` (both dynamically `import()`ed on click, matching
  `WorldInterview.tsx`'s own established pattern for its equivalent buttons).

- [ ] **Step 1: Add the type-only import**

  Add this import near the top of the file, alongside the existing imports:
  ```ts
  import type { ScreenplayArchitectureDocument } from "@/lib/canonEngine/storyStore";
  ```

- [ ] **Step 2: Extend the `downloadText`/`downloadBlob` import**

  This line currently reads:
  ```ts
  import { downloadText } from "@/lib/download";
  ```
  Change it to:
  ```ts
  import { downloadText, downloadBlob } from "@/lib/download";
  ```

- [ ] **Step 3: Update the `compiled` state's type**

  This line currently reads:
  ```ts
    const [compiled, setCompiled] = useState<{ markdown: string; outstandingCount: number } | null>(null);
  ```
  Change it to:
  ```ts
    const [compiled, setCompiled] = useState<{
      markdown: string;
      outstandingCount: number;
      json: unknown;
      version: number;
    } | null>(null);
  ```
  (`json` stays loosely `unknown` here, matching this file's existing convention of not importing
  full server-side shapes into component state — it's cast to the real
  `ScreenplayArchitectureDocument` type only at the two call sites that actually need its
  structure, in Step 5 below.)

- [ ] **Step 4: Add docx/pdf generating state**

  Right after the existing:
  ```ts
    const [compileNeedsAcknowledgment, setCompileNeedsAcknowledgment] = useState(false);
  ```
  add:
  ```ts
    const [docxGenerating, setDocxGenerating] = useState(false);
    const [pdfGenerating, setPdfGenerating] = useState(false);
  ```

- [ ] **Step 5: Add the download handlers**

  Add these two new functions right after `compileDocument`'s closing brace:
  ```ts
    async function downloadArchitectureDocx() {
      if (!compiled) return;
      setDocxGenerating(true);
      setCompileError(null);
      try {
        const { generateScreenplayArchitectureDocxBlob } = await import("@/lib/docx/screenplayArchitectureDocx");
        const blob = await generateScreenplayArchitectureDocxBlob(compiled.json as ScreenplayArchitectureDocument);
        downloadBlob(`screenplay-architecture-v${compiled.version}.docx`, blob);
      } catch {
        setCompileError("Couldn't generate the .docx file.");
      } finally {
        setDocxGenerating(false);
      }
    }

    async function downloadArchitecturePdf() {
      if (!compiled) return;
      setPdfGenerating(true);
      setCompileError(null);
      try {
        const { generateScreenplayArchitecturePdfBlob } = await import("@/lib/pdf/ScreenplayArchitecturePdfDocument");
        const blob = await generateScreenplayArchitecturePdfBlob(compiled.json as ScreenplayArchitectureDocument);
        downloadBlob(`screenplay-architecture-v${compiled.version}.pdf`, blob);
      } catch {
        setCompileError("Couldn't generate the .pdf file.");
      } finally {
        setPdfGenerating(false);
      }
    }
  ```

- [ ] **Step 6: Add the three new buttons**

  The existing success banner's button currently reads:
  ```tsx
          <button
            onClick={() => downloadText("screenplay-architecture.md", compiled.markdown, "text/markdown")}
            className="rounded-lg border border-purple-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-purple-200 hover:bg-purple-900/40"
          >
            Download .md
          </button>
  ```
  Change the filename to include the version (matching the new buttons' own naming), and add the
  three new buttons immediately after it, inside the same wrapping `<div>`:
  ```tsx
          <button
            onClick={() => downloadText(`screenplay-architecture-v${compiled.version}.md`, compiled.markdown, "text/markdown")}
            className="rounded-lg border border-purple-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-purple-200 hover:bg-purple-900/40"
          >
            Download .md
          </button>
          <button
            onClick={() =>
              downloadText(
                `screenplay-architecture-v${compiled.version}.json`,
                JSON.stringify(compiled.json, null, 2),
                "application/json"
              )
            }
            className="rounded-lg border border-purple-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-purple-200 hover:bg-purple-900/40"
          >
            Download .json
          </button>
          <button
            onClick={downloadArchitectureDocx}
            disabled={docxGenerating}
            className="rounded-lg border border-purple-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-purple-200 hover:bg-purple-900/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {docxGenerating ? "Generating…" : "Download .docx"}
          </button>
          <button
            onClick={downloadArchitecturePdf}
            disabled={pdfGenerating}
            className="rounded-lg border border-purple-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-purple-200 hover:bg-purple-900/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pdfGenerating ? "Generating…" : "Download .pdf"}
          </button>
  ```

- [ ] **Step 7: Verify**

  From `web/`, run:
  ```bash
  npx tsc --noEmit -p .
  npm run lint
  npm run build
  ```
  All three must be clean. Then trace by hand: a hand-constructed `compiled` state object with a
  representative `json` payload → confirm all four buttons render, the `.md`/`.json` buttons call
  `downloadText` with the correct filename/content/mime-type synchronously, and the `.docx`/`.pdf`
  buttons' `disabled` state correctly reflects `docxGenerating`/`pdfGenerating` independently (one
  generating shouldn't disable the other).

- [ ] **Step 8: Commit**

  ```bash
  git add web/src/components/ArchitectureInterview.tsx
  git commit -m "feat: add .json/.docx/.pdf download buttons for the P4 compiled document (issue #70)"
  ```
