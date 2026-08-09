# P2 Character Bible Export (Markdown + Word) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement GitHub issue #35 — export the compiled, running Character Bible (every signed-off character so far, issue #34) to Markdown (default, in-session) and Word/.docx (on request).

**Architecture:** Two new pure rendering modules (Markdown and docx, both client-side, mirroring `foundationDoc.ts`'s `renderMarkdown` and `FoundationPdfDocument.tsx`'s client-side-only pattern respectively), one new read-only API route exposing the compiled entries as JSON, and a persistent download panel added to `CharacterInterview.tsx`'s header.

**Tech Stack:** TypeScript, React 19 (client component), `docx` npm package (new dependency), Next.js App Router API routes.

## Global Constraints

- Export scope is the WHOLE Character Bible (every signed-off character, sorted by `signed_off_at` ascending), never a per-character file.
- Both Markdown and docx generation run entirely client-side — no server file-streaming, matching the existing PDF-export precedent (`FoundationPdfDocument.tsx`) and the total absence of any server-file-streaming code elsewhere in this codebase's API routes.
- Both formats must read from the same in-memory `bibleEntries` array already in component state — never trigger an independent fetch per format, so the two exports can never disagree on content.
- Every field on `CharacterBibleEntry` always renders (even an empty string renders as a placeholder), matching `characterBibleCompiler.ts`'s (issue #34) "total function over missing data" posture. Sections themselves are never conditionally omitted, except `ensemble_interconnection_registry`, which renders a "no relationships recorded" placeholder line when its array is empty rather than an empty table.
- No test framework exists in this codebase (established convention) — verification is `npm run lint && npm run build`, plus a manual read-through described per task.

---

### Task 1: Markdown renderer

**Files:**
- Create: `web/src/lib/characterEngine/characterBibleMarkdown.ts`

**Interfaces:**
- Consumes: `type CharacterBibleEntry` from `@/lib/canonEngine/storyStore` (already exists, issue #34).
- Produces: `renderCharacterBibleMarkdown(entries: CharacterBibleEntry[]): string` — consumed by Task 4 (UI wiring).

- [ ] **Step 1: Create the file**

```ts
import type { CharacterBibleEntry } from "@/lib/canonEngine/storyStore";

/**
 * Renders the compiled Character Bible (every signed-off character so
 * far, issue #34) to Markdown - GitHub issue #35. Mirrors
 * foundationDoc.ts's renderMarkdown() in style and its mdValue() empty-
 * value convention, applied here to characterBibleCompiler.ts's already-
 * total CharacterBibleEntry shape (every field is always present, blank
 * string when not yet captured - see that file's own "total over missing
 * data" comment). Pure, no I/O.
 */

function mdValue(v: string): string {
  return v === "" ? "_—_" : v;
}

function fieldLines(fields: [string, string][]): string[] {
  return fields.map(([label, value]) => `- **${label}:** ${mdValue(value)}`);
}

function renderEntry(entry: CharacterBibleEntry): string[] {
  const m = entry.metadata;
  return [
    `## ${m.character_name}`,
    `_${m.story_role || "role not set"} · ${m.narrative_importance || "tier not set"} tier · ${m.development_depth || "depth not set"} depth · ${m.arc_type || "arc type not set"} · ${m.canon_status}_`,
    "",
    `### Story Function & Integration Map`,
    ...fieldLines([
      ["Narrative Purpose", entry.story_function.narrative_purpose],
      ["Protagonist Relationship", entry.story_function.protagonist_relationship],
      ["Conflict Contribution", entry.story_function.conflict_contribution],
      ["Thematic Thesis", entry.story_function.thematic_thesis],
    ]),
    "",
    `### The Psychological Engine`,
    ...fieldLines([
      ["Want", entry.psychological_engine.want],
      ["Personality (How)", entry.psychological_engine.personality_how],
      ["Need", entry.psychological_engine.need],
      ["Values", entry.psychological_engine.values],
      ["Life Experience", entry.psychological_engine.life_experience],
      ["Core Wound", entry.psychological_engine.core_wound],
      ["False Belief", entry.psychological_engine.false_belief],
      ["Core Flaw", entry.psychological_engine.core_flaw],
      ["Dominant Fear", entry.psychological_engine.dominant_fear],
      ["Defense Mechanisms", entry.psychological_engine.defense_mechanisms],
      ["Behavioral Trajectory", entry.psychological_engine.behavioral_trajectory],
    ]),
    "",
    `### Behavior & Audible Voice Profile`,
    ...fieldLines([
      ["Physical Description", entry.behavior_voice_profile.physical_description],
      ["Habits", entry.behavior_voice_profile.habits],
      ["Voice Signature", entry.behavior_voice_profile.voice_signature],
      ["Behavior Under Stress", entry.behavior_voice_profile.behavior_under_stress],
    ]),
    "",
    `### Ensemble Interconnection Registry`,
    ...(entry.ensemble_interconnection_registry.length
      ? [
          `| With | Dynamic | Trust Trajectory | Power Dynamic |`,
          `| --- | --- | --- | --- |`,
          ...entry.ensemble_interconnection_registry.map(
            (r) => `| ${r.with} | ${mdValue(r.dynamic)} | ${mdValue(r.trust_trajectory)} | ${mdValue(r.power_dynamic)} |`
          ),
        ]
      : ["_No relationships recorded._"]),
    "",
    `### Milestone Arc Timeline`,
    ...fieldLines([
      ["Initial Worldview", entry.milestone_arc_timeline.initial_worldview],
      ["Inciting Disruption", entry.milestone_arc_timeline.inciting_disruption],
      ["Failed Resistance", entry.milestone_arc_timeline.failed_resistance],
      ["Midpoint Realization", entry.milestone_arc_timeline.midpoint_realization],
      ["Crisis Choice", entry.milestone_arc_timeline.crisis_choice],
      ["Action-Proven Transformation", entry.milestone_arc_timeline.action_proven_transformation],
      ["New Identity", entry.milestone_arc_timeline.new_identity],
    ]),
    "",
    `### Continuity & Canon Rules`,
    mdValue(entry.continuity_canon_rules),
    "",
    `### Outstanding Character Questions`,
    ...(entry.outstanding_questions.length
      ? entry.outstanding_questions.map(
          (q) => `- ${q.item} _(defer to: ${q.defer_to ?? "TBD"})_${q.notes ? ` — ${q.notes}` : ""}`
        )
      : ["_None — everything resolved._"]),
    "",
  ];
}

export function renderCharacterBibleMarkdown(entries: CharacterBibleEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.signed_off_at.localeCompare(b.signed_off_at));
  const lines: string[] = [`# Character Bible`, ""];
  for (const entry of sorted) {
    lines.push(...renderEntry(entry));
  }
  return lines.join("\n");
}
```

- [ ] **Step 2: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 3: Manual read-through check**

Confirm by reading the function:
- Two fixture entries with different `signed_off_at` timestamps, passed in reverse-chronological order to `renderCharacterBibleMarkdown`: the output lists the earlier-signed-off character first (the `.sort()` call reorders them).
- A fixture entry where every field is an empty string except `metadata.character_name` and `signed_off_at` (a character compiled before any Stage 1/3/5/6 facts were captured): every section still renders its heading and every field still renders its bullet, each showing `_—_` in place of the value — no section is skipped, no field is silently dropped.
- A fixture entry with an empty `ensemble_interconnection_registry` array: that section renders `_No relationships recorded._` instead of an empty/broken Markdown table.
- A fixture entry with 2 populated `ensemble_interconnection_registry` rows: the table has a header row, a separator row, and exactly 2 data rows, each cell using `mdValue`'s placeholder for any empty sub-field.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/characterEngine/characterBibleMarkdown.ts
git commit -m "feat: add Markdown renderer for the compiled P2 Character Bible (#35)"
```

---

### Task 2: Word (.docx) generator

**Files:**
- Create: `web/src/lib/docx/characterBibleDocx.ts`
- Modify: `web/package.json` (new dependency, via `npm install`, not a manual edit)

**Interfaces:**
- Consumes: `type CharacterBibleEntry` from `@/lib/canonEngine/storyStore`.
- Produces: `generateCharacterBibleDocxBlob(entries: CharacterBibleEntry[]): Promise<Blob>` — consumed by Task 4 (UI wiring). Return shape matches `FoundationPdfDocument.tsx`'s `generateFoundationPdfBlob` exactly (both resolve to a `Blob`), so the calling UI code can pass either straight into the existing `downloadBlob(...)` utility.

Independent of Task 1 (no shared code, only a shared type import) — order between them doesn't matter, but both are prerequisites for Task 4.

- [ ] **Step 1: Add the `docx` npm dependency**

Run: `cd web && npm install docx`
Expected: `web/package.json`'s `dependencies` gains a `"docx": "^<resolved-version>"` entry, and `web/package-lock.json` updates accordingly. Do not hand-edit `package.json` — let `npm install` write the resolved version.

- [ ] **Step 2: Create the file**

```ts
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } from "docx";
import type { CharacterBibleEntry } from "@/lib/canonEngine/storyStore";

/**
 * Client-side .docx rendering of the compiled Character Bible - GitHub
 * issue #35. Mirrors characterBibleMarkdown.ts's renderCharacterBibleMarkdown()
 * structure and section order exactly, built with the `docx` package's
 * imperative Paragraph/Table API instead of markdown syntax - there's no
 * JSX-declarative equivalent for docx the way @react-pdf/renderer has for
 * PDF (FoundationPdfDocument.tsx's Field/ListField/TableRow components are
 * the closest precedent, translated here to plain functions).
 */

function docxValue(v: string): string {
  return v === "" ? "—" : v;
}

function fieldParagraph(label: string, value: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun(docxValue(value))],
  });
}

function sectionHeading(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2 });
}

function relationshipsSection(rows: CharacterBibleEntry["ensemble_interconnection_registry"]): (Paragraph | Table)[] {
  if (rows.length === 0) {
    return [new Paragraph("No relationships recorded.")];
  }
  const cell = (text: string, bold = false) =>
    new TableCell({
      width: { size: 25, type: WidthType.PERCENTAGE },
      children: [new Paragraph({ children: [new TextRun({ text, bold })] })],
    });
  const headerRow = new TableRow({
    children: ["With", "Dynamic", "Trust Trajectory", "Power Dynamic"].map((h) => cell(h, true)),
  });
  const dataRows = rows.map(
    (r) => new TableRow({ children: [cell(r.with), cell(docxValue(r.dynamic)), cell(docxValue(r.trust_trajectory)), cell(docxValue(r.power_dynamic))] })
  );
  return [new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...dataRows] })];
}

function renderEntry(entry: CharacterBibleEntry): (Paragraph | Table)[] {
  const m = entry.metadata;
  return [
    new Paragraph({ text: m.character_name, heading: HeadingLevel.HEADING_1 }),
    new Paragraph({
      children: [
        new TextRun({
          text: `${m.story_role || "role not set"} · ${m.narrative_importance || "tier not set"} tier · ${m.development_depth || "depth not set"} depth · ${m.arc_type || "arc type not set"} · ${m.canon_status}`,
          italics: true,
        }),
      ],
    }),
    sectionHeading("Metadata"),
    fieldParagraph("Age", m.age),
    fieldParagraph("Occupation", m.occupation),
    sectionHeading("Story Function & Integration Map"),
    fieldParagraph("Narrative Purpose", entry.story_function.narrative_purpose),
    fieldParagraph("Protagonist Relationship", entry.story_function.protagonist_relationship),
    fieldParagraph("Conflict Contribution", entry.story_function.conflict_contribution),
    fieldParagraph("Thematic Thesis", entry.story_function.thematic_thesis),
    sectionHeading("The Psychological Engine"),
    fieldParagraph("Want", entry.psychological_engine.want),
    fieldParagraph("Personality (How)", entry.psychological_engine.personality_how),
    fieldParagraph("Need", entry.psychological_engine.need),
    fieldParagraph("Values", entry.psychological_engine.values),
    fieldParagraph("Life Experience", entry.psychological_engine.life_experience),
    fieldParagraph("Core Wound", entry.psychological_engine.core_wound),
    fieldParagraph("False Belief", entry.psychological_engine.false_belief),
    fieldParagraph("Core Flaw", entry.psychological_engine.core_flaw),
    fieldParagraph("Dominant Fear", entry.psychological_engine.dominant_fear),
    fieldParagraph("Defense Mechanisms", entry.psychological_engine.defense_mechanisms),
    fieldParagraph("Behavioral Trajectory", entry.psychological_engine.behavioral_trajectory),
    sectionHeading("Behavior & Audible Voice Profile"),
    fieldParagraph("Physical Description", entry.behavior_voice_profile.physical_description),
    fieldParagraph("Habits", entry.behavior_voice_profile.habits),
    fieldParagraph("Voice Signature", entry.behavior_voice_profile.voice_signature),
    fieldParagraph("Behavior Under Stress", entry.behavior_voice_profile.behavior_under_stress),
    sectionHeading("Ensemble Interconnection Registry"),
    ...relationshipsSection(entry.ensemble_interconnection_registry),
    sectionHeading("Milestone Arc Timeline"),
    fieldParagraph("Initial Worldview", entry.milestone_arc_timeline.initial_worldview),
    fieldParagraph("Inciting Disruption", entry.milestone_arc_timeline.inciting_disruption),
    fieldParagraph("Failed Resistance", entry.milestone_arc_timeline.failed_resistance),
    fieldParagraph("Midpoint Realization", entry.milestone_arc_timeline.midpoint_realization),
    fieldParagraph("Crisis Choice", entry.milestone_arc_timeline.crisis_choice),
    fieldParagraph("Action-Proven Transformation", entry.milestone_arc_timeline.action_proven_transformation),
    fieldParagraph("New Identity", entry.milestone_arc_timeline.new_identity),
    sectionHeading("Continuity & Canon Rules"),
    new Paragraph(docxValue(entry.continuity_canon_rules)),
    sectionHeading("Outstanding Character Questions"),
    ...(entry.outstanding_questions.length
      ? entry.outstanding_questions.map(
          (q) => new Paragraph(`${q.item} (defer to: ${q.defer_to ?? "TBD"})${q.notes ? ` — ${q.notes}` : ""}`)
        )
      : [new Paragraph("None — everything resolved.")]),
  ];
}

export async function generateCharacterBibleDocxBlob(entries: CharacterBibleEntry[]): Promise<Blob> {
  const sorted = [...entries].sort((a, b) => a.signed_off_at.localeCompare(b.signed_off_at));
  const children: (Paragraph | Table)[] = [new Paragraph({ text: "Character Bible", heading: HeadingLevel.TITLE })];
  for (const entry of sorted) {
    children.push(...renderEntry(entry));
  }
  const doc = new Document({ sections: [{ children }] });
  return Packer.toBlob(doc);
}
```

- [ ] **Step 3: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass. If the build fails on a `docx` type mismatch (e.g. an exported name changed between package versions), read the installed package's type definitions at `web/node_modules/docx/build/index.d.ts` to find the correct export names and adjust the imports/usage accordingly — the overall structure (Document → sections → children of Paragraph/Table, `Packer.toBlob`) is stable across recent `docx` versions, but exact helper names occasionally shift.

- [ ] **Step 4: Manual read-through check**

Confirm by reading the function, using the same 4 fixture scenarios as Task 1's Step 3 (empty-field entry, empty-relationships entry, populated-relationships entry, out-of-order `signed_off_at` values) — the section order, field labels, and empty-value handling (`docxValue` mirroring `mdValue`) should be structurally identical to Task 1's Markdown output, just built with `docx` API calls instead of markdown template strings.

- [ ] **Step 5: Commit**

```bash
git add web/package.json web/package-lock.json web/src/lib/docx/characterBibleDocx.ts
git commit -m "feat: add .docx generator for the compiled P2 Character Bible (#35)"
```

---

### Task 3: Read-only API route for compiled entries

**Files:**
- Create: `web/src/app/api/character-chat/bible/route.ts`

**Interfaces:**
- Consumes: `getStory`, `listCharacterBibleEntries` from `@/lib/canonEngine/storyStore` (both already exist); `requireUser` from `@/lib/session`; `errorResponse` from `@/lib/apiErrors`; `getMembership` from `@/lib/workspace/workspaceStore` — all four already used identically in `web/src/app/api/character-chat/route.ts`.
- Produces: `GET /api/character-chat/bible?storyId=<id>` → `{ entries: CharacterBibleEntry[] }` JSON — consumed by Task 4 (UI wiring).

Independent of Tasks 1/2. Can be done in any order relative to them, but is a prerequisite for Task 4.

- [ ] **Step 1: Create the file**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory, listCharacterBibleEntries } from "@/lib/canonEngine/storyStore";

export const runtime = "nodejs";

/**
 * Read-only export of Project 2's compiled Character Bible entries -
 * GitHub issue #35. Returns the raw CharacterBibleEntry[] as JSON; both
 * Markdown and .docx rendering happen client-side from this same payload
 * (characterBibleMarkdown.ts / characterBibleDocx.ts), so the two export
 * formats can never disagree on content. Mirrors character-chat/route.ts's
 * auth pattern exactly (requireUser -> getStory -> getMembership).
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const storyId = req.nextUrl.searchParams.get("storyId");
    if (!storyId) {
      return NextResponse.json({ error: "Request must include `storyId`." }, { status: 400 });
    }

    const story = await getStory(storyId);
    if (!story) {
      return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
    }
    const membership = await getMembership(story.workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }

    const entries = await listCharacterBibleEntries(storyId);
    return NextResponse.json({ entries });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 2: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass, and the build's route listing includes `ƒ /api/character-chat/bible`.

- [ ] **Step 3: Manual read-through check**

Confirm by reading `web/src/app/api/character-chat/route.ts`'s own auth block (its `getStory`/`getMembership`/404/403 sequence) side by side with this new file — same status codes (400 missing storyId, 404 story not found, 403 not a member), same error message text style, same `errorResponse(err)` catch-all.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/api/character-chat/bible/route.ts
git commit -m "feat: add read-only API route for the compiled P2 Character Bible (#35)"
```

---

### Task 4: Wire the download panel into the P2 chat UI

**Files:**
- Modify: `web/src/components/CharacterInterview.tsx`

**Interfaces:**
- Consumes: `renderCharacterBibleMarkdown` (Task 1), `generateCharacterBibleDocxBlob` (Task 2, lazy-imported), `GET /api/character-chat/bible` (Task 3), `downloadText`/`downloadBlob` from `@/lib/download` (already exists, used identically by `ChatInterview.tsx`), `type CharacterBibleEntry` from `@/lib/canonEngine/storyStore`.

- [ ] **Step 1: Add imports**

Find:
```tsx
import Markdown from "@/components/Markdown";
import UserMenu from "@/components/UserMenu";
```
Replace:
```tsx
import Markdown from "@/components/Markdown";
import UserMenu from "@/components/UserMenu";
import { downloadText, downloadBlob } from "@/lib/download";
import type { CharacterBibleEntry } from "@/lib/canonEngine/storyStore";
import { renderCharacterBibleMarkdown } from "@/lib/characterEngine/characterBibleMarkdown";
```

- [ ] **Step 2: Add state**

Find:
```tsx
  const [leftWidth, setLeftWidth] = useState(380);
  const listEndRef = useRef<HTMLDivElement | null>(null);
```
Replace:
```tsx
  const [leftWidth, setLeftWidth] = useState(380);
  const [bibleEntries, setBibleEntries] = useState<CharacterBibleEntry[] | null>(null);
  const [docxGenerating, setDocxGenerating] = useState(false);
  const listEndRef = useRef<HTMLDivElement | null>(null);
```

- [ ] **Step 3: Fetch compiled entries on mount**

Find:
```tsx
  // Fires the opening turn (sp02 §8: structural cast/priority-matrix
  // evaluation + first Protagonist questions) automatically, once, the
  // first time a genuinely new session loads - otherwise the session sits
  // waiting for the author to type something before the model ever speaks.
  useEffect(() => {
    if (resuming || messages.length > 0 || !canvasId) return;
    sendMessage("Let's begin.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resuming, canvasId]);
```
Replace:
```tsx
  // Fires the opening turn (sp02 §8: structural cast/priority-matrix
  // evaluation + first Protagonist questions) automatically, once, the
  // first time a genuinely new session loads - otherwise the session sits
  // waiting for the author to type something before the model ever speaks.
  useEffect(() => {
    if (resuming || messages.length > 0 || !canvasId) return;
    sendMessage("Let's begin.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resuming, canvasId]);

  // Compiled Character Bible entries (issue #35) - fetched once on mount
  // so a resumed session with prior sign-offs shows the panel immediately,
  // and refetched after every turn that completes a fresh sign-off (see
  // sendMessage below). fetchBibleEntries is a plain function declaration,
  // hoisted within this component body the same way sendMessage already
  // is (called above, at line ~82, before its own textual definition).
  useEffect(() => {
    if (!canvasId) return;
    fetchBibleEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasId]);

  async function fetchBibleEntries() {
    if (!canvasId) return;
    try {
      const res = await fetch(`/api/character-chat/bible?storyId=${canvasId}`);
      if (!res.ok) return;
      const data = await res.json();
      setBibleEntries((data.entries ?? []) as CharacterBibleEntry[]);
    } catch {
      // Enhancement panel only - silently skip on failure, no user-facing error.
    }
  }
```

- [ ] **Step 4: Refetch after a fresh sign-off**

Find:
```tsx
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      setContext(data.context ?? null);
      setCurrentCharacter(data.current_character ?? null);
      setCurrentStage(typeof data.current_stage === "number" ? data.current_stage : null);
      setCharacterSignedOff(Boolean(data.character_signed_off));
    } catch {
```
Replace:
```tsx
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      setContext(data.context ?? null);
      setCurrentCharacter(data.current_character ?? null);
      setCurrentStage(typeof data.current_stage === "number" ? data.current_stage : null);
      setCharacterSignedOff(Boolean(data.character_signed_off));
      if (data.character_signed_off) {
        fetchBibleEntries();
      }
    } catch {
```

- [ ] **Step 5: Add download handlers**

Find:
```tsx
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
```
Replace:
```tsx
  function downloadBibleMarkdown() {
    if (!bibleEntries) return;
    downloadText("character-bible.md", renderCharacterBibleMarkdown(bibleEntries), "text/markdown");
  }

  async function downloadBibleDocx() {
    if (!bibleEntries || docxGenerating) return;
    setDocxGenerating(true);
    setError(null);
    try {
      const { generateCharacterBibleDocxBlob } = await import("@/lib/docx/characterBibleDocx");
      const blob = await generateCharacterBibleDocxBlob(bibleEntries);
      downloadBlob("character-bible.docx", blob);
    } catch {
      setError("Couldn't generate the .docx file.");
    } finally {
      setDocxGenerating(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
```

- [ ] **Step 6: Add the panel to the right-panel header**

Find:
```tsx
              <div className="shrink-0 border-b border-red-900/40 px-5 py-2.5">
                <span className="text-[11px] uppercase tracking-widest text-neutral-500">
                  preview · {currentCharacter ?? "Cast overview"}
                </span>
              </div>
```
Replace:
```tsx
              <div className="flex shrink-0 items-center justify-between border-b border-red-900/40 px-5 py-2.5">
                <span className="text-[11px] uppercase tracking-widest text-neutral-500">
                  preview · {currentCharacter ?? "Cast overview"}
                </span>
                {bibleEntries && bibleEntries.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-neutral-400">
                      Character Bible ({bibleEntries.length} {bibleEntries.length === 1 ? "character" : "characters"})
                    </span>
                    <button
                      onClick={downloadBibleMarkdown}
                      className="rounded-lg bg-gradient-to-r from-red-600 to-orange-500 px-3 py-1.5 text-[11px] font-semibold text-white hover:from-red-500 hover:to-orange-400"
                    >
                      Download .md
                    </button>
                    <button
                      onClick={downloadBibleDocx}
                      disabled={docxGenerating}
                      className="rounded-lg bg-gradient-to-r from-red-600 to-orange-500 px-3 py-1.5 text-[11px] font-semibold text-white hover:from-red-500 hover:to-orange-400 disabled:opacity-40"
                    >
                      {docxGenerating ? "Generating…" : "Generate .docx"}
                    </button>
                  </div>
                )}
              </div>
```

- [ ] **Step 7: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 8: Manual read-through check**

Confirm by reading the edited component:
- On a fresh session with zero signed-off characters, `bibleEntries` is `[]` (from the mount-time fetch) or `null` (if the fetch hasn't resolved yet) — either way `bibleEntries && bibleEntries.length > 0` is falsy, so the panel doesn't render and the header looks exactly as it did before this change.
- After a turn response with `character_signed_off: true`, `fetchBibleEntries()` re-runs and (once it resolves) the panel appears/updates with the new count — no page reload needed.
- Clicking "Download .md" is synchronous (no loading state) and doesn't touch `docxGenerating`.
- Clicking "Generate .docx" disables that button (shows "Generating…") until the lazy import + blob generation + download trigger completes, then re-enables it — mirrors `ChatInterview.tsx`'s `downloadPdf`/`pdfGenerating` pattern exactly.
- `fetchBibleEntries` is referenced inside a `useEffect` (Step 3) before its own textual definition later in the component body — confirm this is safe because it's a plain hoisted function declaration, not a `const` arrow function (which would throw a temporal-dead-zone error) — same pattern the file already uses for `sendMessage`.

- [ ] **Step 9: Commit**

```bash
git add web/src/components/CharacterInterview.tsx
git commit -m "feat: add Character Bible download panel to the P2 chat UI (#35)"
```
