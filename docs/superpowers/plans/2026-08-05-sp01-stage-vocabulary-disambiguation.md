# sp01 Stage-Vocabulary Disambiguation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix one confirmed, evidence-backed naming collision in `sp01-sdos-systemprompt.md`'s Stage 3 blurb (it says "Target Audience," but Stage 3's actual canonical element ID is `audience`, distinct from Stage 1's `target_audience`) and one internal inconsistency in Stage 6's blurb (it says "Plot Point 1"/"Plot Point 2," while the same file's own §7 taxonomy already calls these "First Turning Point"/"Second Turning Point," matching the canonical IDs `first_turning_point`/`second_turning_point`).

**Architecture:** Two content-only edits to two lines (well, one line plus one new sentence, and one line) inside §6 of a single file. No code changes — nothing else in the codebase references these prose strings.

**Tech Stack:** Markdown prompt file.

## Global Constraints

- Both edits land in `web/system-prompts/sp01-sdos-systemprompt.md`'s §6 only — no other section of the file changes.
- No code changes anywhere in this plan.
- Replacement text must be used verbatim — this is a transcription task, not a paraphrase task.

---

### Task 1: Disambiguate Stage 3's "Target Audience" and Stage 6's "Plot Point" naming

**Files:**
- Modify: `web/system-prompts/sp01-sdos-systemprompt.md` (Stage 3 and Stage 6 entries inside §6, "THE 8-STAGE INTERVIEW WORKFLOW")

**Interfaces:**
- None — this is a content-only change to a prompt file with no code interface.

- [ ] **Step 1: Fix Stage 3's wording**

Find this exact text (currently 2 lines, immediately after the `STAGE 3: BUILD THE CORE STORY` heading):
```
Focus: Establish Genre, Subgenre, Tone, Style, Target Audience, and Scale. Develop the Core Dramatic Question and Theme.
```
If this doesn't match exactly what's in the file, stop and report the discrepancy rather than guessing which version is current.

Replace with:
```
Focus: Establish Genre, Subgenre, Tone, Style, Audience, and Scale. Develop the Core Dramatic Question and Theme.
Audience here is formal audience/market positioning alongside Genre and Tone (e.g. age category, demographic) - distinct from Stage 1's initial Target Audience impression. Confirm or refine that impression into this more specific categorization; don't treat Stage 1's answer as already covering it.
```

- [ ] **Step 2: Fix Stage 6's wording**

Find this exact text (currently 1 line, immediately after the `STAGE 6: BUILD THE STORY SPINE` heading):
```
Focus: Define 7 structural turning points in 1–2 sentences each: Opening Image, Inciting Incident, Plot Point 1, Midpoint, Plot Point 2, Climax, Closing Image. Defer outlines.
```
If this doesn't match exactly what's in the file, stop and report the discrepancy rather than guessing which version is current. Note the en-dash in "1–2" — copy it exactly, don't substitute a hyphen.

Replace with:
```
Focus: Define 7 structural turning points in 1–2 sentences each: Opening Image, Inciting Incident, First Turning Point, Midpoint, Second Turning Point, Climax, Closing Image. Defer outlines.
```

- [ ] **Step 3: Verify internal consistency**

Read the full file after both edits. Confirm:
- Stage 3's new wording ("Audience") now matches §7 item 6's existing text: `Genre & Tone Specification: [Genre, Subgenre, Tone, Style, Audience, Scale]` — before this fix, §6 said "Target Audience" while §7 already said "Audience," a pre-existing inconsistency this fix also resolves as a side effect.
- Stage 6's new wording ("First Turning Point", "Second Turning Point") now matches §7 item 11's existing text: `Story Spine: [Opening Image, Inciting Incident, First Turning Point, Midpoint, Second Turning Point, Climax, Closing Image - Max 2 sentences each]` exactly.
- No other line in the file mentions "Target Audience," "Plot Point 1," or "Plot Point 2" (grep for these three exact strings across the file — none should remain outside this task's own edit, and none should have existed elsewhere before it either).

- [ ] **Step 4: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass (this is a markdown-only change with no code impact, but this project's convention runs both after every change touching `web/`).

- [ ] **Step 5: Commit**

```bash
git add web/system-prompts/sp01-sdos-systemprompt.md
git commit -m "fix: disambiguate sp01's Stage 3 audience and Stage 6 turning-point naming"
```
