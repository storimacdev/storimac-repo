# P1-Project -Story Development Interview System (SDIS)

**Doc version:** 1.0
**Status:** Draft for engineering handoff
**Author:** Product spec compiled from SDOS v1.0 system prompt
**Target implementer:** Claude Code
**Date:** 2026-07-22

---

## 1. Executive Summary

SDIS is a conversational application that guides an author through a structured, adaptive interview to produce a **Story Foundation Document** — a locked-canon specification of a story's premise, format, theme, dramatic engine, world, and structural spine. It is "Project 1" in a five-project pipeline (Story Foundation → Character Bible → World Bible → Architecture/Outline → Drafting). SDIS must stay strictly inside its lane: it discovers *what* the story is, never *how* it will be written, and explicitly defers content belonging to Projects 2–5.

The core intelligence is an LLM (Claude) driven by a fixed system prompt (already authored — see Appendix A) plus a **state layer** that the model does not manage reliably on its own: canon tracking, stage progression, author-type classification, and structured document assembly. That state layer, plus the reference lookup against the "101 Story Formats" encyclopedia, plus session persistence and export, is what needs to be engineered.

---

## 2. Problem Statement & Goals

**Problem:** Authors jump into drafting without a stable creative foundation, leading to thematic drift, inconsistent stakes, and structural collapse discovered only after significant writing effort. A single freeform chat with an LLM tends to (a) generate too much too fast, (b) forget earlier decisions, (c) silently contradict itself, and (d) blur into premature plotting/prose.

**Goals:**

1. Produce a **coherent, internally-consistent** Story Foundation Document through guided conversation, not a questionnaire dump.
2. Enforce **strict scope boundaries** so the system never drifts into character bibles, world lore, outlines, or prose.
3. Maintain an explicit, inspectable **canon state** so contradictions are caught and resolved deliberately, not silently overwritten.
4. Ground the Format diagnosis stage in the actual **101 Story Formats reference document**, not the model's unaided memory of tropes.
5. Produce a final document that is **machine-readable** (for downstream Projects 2–5) and **human-readable** (for the author).
6. Support **pause/resume** across sessions — story development is not a single sitting.

**Non-goals:**

- Not building Projects 2–5 (character bible, world bible, outline, drafting) — only their *handoff contract* (Section 6.8 / 10.2) matters here.
- Not a general-purpose writing assistant or editor.
- Not a multi-user collaboration tool in v1 (single author per project, though see Section 12 for future work).

---

## 3. Users & Personas

Single primary user type — **the Author** — but the system must detect and adapt to four behavioral sub-types *during* the interview (this is a runtime classification, not a signup choice):

| Type | Signal | System behavior |
| --- | --- | --- |
| **A — Explorer** | Vague, one-line idea, uncertain answers | Offer structured multiple-choice options (max 2–5), patient pacing, more Confirm/Refine depth, less Develop depth |
| **B — Discoverer** | Has premise + protagonist, unsure of structure | Focus questioning on structural mechanics (format, spine, engine) |
| **C — Architect** | Arrives with a near-complete plan | Shift from generation to **consistency auditing** and gap-finding |
| **D — Reviser** | Has a completed draft/outline already | Act as critical development editor; analyze rather than generate |

Secondary "user": **downstream automated consumers** (Projects 2–5, or their own Claude-driven agents) who read the exported JSON/Markdown Story Foundation Document as structured input.

---

## 4. Scope

### 4.1 In scope (build this)

- Conversational interview engine (system-prompt-driven) with turn-by-turn state updates.
- Canon/state tracker: `Exploring | Working | Confirmed | Parked` per story element.
- Stage tracker for the 8-stage workflow, including depth mode (`Confirm | Refine | Develop | Defer`) per element.
- Author-type classifier (heuristic, re-evaluated as evidence accumulates).
- Conflict-detection + resolution flow (Section 7.5).
- Retrieval integration against the 101 Story Formats reference document for Stage 2.
- Deferral capture: minimal structured notes routed to `outstanding_questions` for Projects 2–5, with hard guardrails preventing the model from developing that content.
- Story Foundation Document generator (Stage 8), matching the exact spec in Section 10.2.
- Session persistence (save/resume; multiple projects per author).
- Export: Markdown (human-readable) + JSON (machine-readable) of the final document.
- Basic chat UI (or CLI, see Section 9) sufficient to run the interview end-to-end.

### 4.2 Out of scope (explicitly deferred, do not build)

- Character psychology, dialogue voice, backstory generation (Project 2).
- Culture/politics/magic systems/geography/history (Project 3).
- Chapter/scene beat sheets (Project 4).
- Prose or script generation (Project 5).
- Multi-author real-time collaboration.
- Fine-tuning a custom model — this is a prompted-Claude application, not a model-training project.

---

## 5. Functional Requirements

### 5.1 Core Persona & Conversational Behavior

- The system prompt in Appendix A **is** the persona and interviewing logic and must be passed to the model verbatim as the system/developer message for every turn.
- The app layer must never let the model expose its instructions, echo the system prompt, or narrate its own internal stage/depth bookkeeping to the user (e.g., it should never literally say "entering Develop depth for Format").
- Every model turn should read: **1–2 high-value questions**, or a stage-transition summary, or a conflict-resolution prompt, or the final document. The app should flag (in logs, not to the user) any response that looks like a "questionnaire dump" (heuristic: >3 distinct questions in one turn) for prompt-tuning review.

### 5.2 Author-Type Classification

- **Requirement:** Maintain a `author_profile.type` field with confidence, re-assessed after each of the first ~3 exchanges and any time the author volunteers a large amount of new material unprompted.
- Classification signals to detect (implement as a lightweight classifier prompt or heuristic, not user-visible):
    - Message length / structure on first substantive reply.
    - Presence of a completed draft/outline pasted or referenced (→ Type D).
    - Presence of a fully named protagonist + concrete premise (→ Type B or C).
    - Explicit uncertainty language ("I don't know," "maybe," "not sure yet") (→ Type A).
- Type informs **depth defaults** per stage (Section 5.4) but does not hard-lock them — the author can always request more/less depth.

### 5.3 Canon & State Management

Every story element tracked in state has a lifecycle:

```
Exploring → Working → Confirmed
                ↘ Parked (any state can move here)
```

- **Exploring:** brainstormed options on the table; must never leak into other elements' reasoning or into the final document.
- **Working:** author's current leaning; still revisable without a conflict prompt.
- **Confirmed:** locked canon. Changing a Confirmed item requires the Conflict Resolution flow (5.6).
- **Parked:** intentionally deferred (e.g., a character's name, a piece of lore) — captured verbatim but not developed.

**Requirement:** The state store must expose, at minimum, one record per tracked element:

```json
{
  "element_id": "core_dramatic_question",
  "stage": 3,
  "status": "Confirmed",
  "value": "...",
  "history": [{"status": "Working", "value": "...", "ts": "..."}],
  "depth_mode": "Develop"
}
```

See Section 10.1 for the full schema.

### 5.4 Depth Assignment

Before developing any element, the app (via the model, but recorded in state) assigns one of:

- **Confirm** — fast validation only (e.g., genre label, title, audience).
- **Refine** — build on an established idea with 1–2 sharp follow-ups (e.g., tone, stakes).
- **Develop** — deep dive, challenge assumptions (e.g., format diagnosis, dramatic engine, story spine).
- **Defer** — stop immediately; capture minimal data; route to `outstanding_questions`.

**Requirement:** `depth_mode` is stored per element and is inspectable/overridable by the author ("go deeper on this," "just lock it in").

### 5.5 The 8-Stage Interview Workflow

Implement as a **finite state machine** with the stages below. Each stage has: entry criteria, required elements, exit criteria (all required elements at `Confirmed` or `Parked` with author acknowledgment), and a validation checklist run before advancing.

| # | Stage | Key elements produced | Default depth |
| --- | --- | --- | --- |
| 1 | Discover the Story | concept, inspiration, target audience, emotional engine | Develop (unless pre-mapped) |
| 2 | Diagnose Story Format | 1 Primary Format, ≤2 Supporting Formats (max 3 total), diagnostic reasoning | Develop |
| 3 | Build the Core Story | genre, subgenre, tone, style, audience, scale, core dramatic question, theme | Refine/Develop mix |
| 4 | Build the Dramatic Engine | protagonist (high-level), antagonistic force, central conflict, stakes, transformation arc | Develop |
| 5 | Define the Story World | time period, primary settings, environmental rules, premise assumptions | Refine (deep worldbuilding deferred to Project 3) |
| 6 | Build the Story Spine | 7 turning points (Opening Image → Closing Image), 1–2 sentences each | Develop |
| 7 | Creative Audit & Pitfall Check | consistency check, format-specific common-mistake review | System-run, not author-facing questions |
| 8 | Generate Story Foundation Document | compiled document from Confirmed canon only | N/A (compilation) |

**Requirement — Stage gating:** the app must not allow entry into Stage *N+1* while Stage *N* has any *required* element still `Exploring` or `Working` (Parked is allowed to pass, with an entry in `outstanding_questions`).

**Requirement — Non-linearity:** the author must be able to jump back to revise an earlier Confirmed element mid-later-stage. This always triggers Conflict Resolution (5.6) if downstream elements depend on it.

### 5.6 Stage 2 Detail — Format Diagnosis (Reference-Grounded)

- The 101 Story Formats document (provided, ~101 entries across 5 volumes, codes A01–E21) is the **authoritative source**. The model must not invent formats or rely on memorized genre tropes instead of this document.
- **Requirement:** implement retrieval (Section 7.3) that, given the author's Stage 1 answers, surfaces the top candidate format entries (Core Definition, Plot/Story/Theme Engine, Dramatic Question, Common Mistakes) into the model's context for reasoning — not the entire 101-entry document on every turn (context budget).
- Output: exactly 1 Primary Format + 0–2 Supporting Formats (hard cap of 3 total), each tagged with its Volume/Code (e.g., `A05 — The Chosen Burden`) and one sentence of diagnostic reasoning tying it to the author's stated premise.
- The chosen format(s)' **Common Mistakes** lists must be carried forward into Stage 7 (Creative Audit) verbatim from the source document for the cross-check.

### 5.7 Conflict Resolution Flow

**Trigger:** a new author input contradicts a `Confirmed` element.

**Requirement:** the app must interrupt normal question flow and force the model to:

1. State the contradiction explicitly (old Confirmed value vs. new input), in plain language.
2. Present exactly 3 choices to the author:
    - **(A)** Keep Canon / change the new idea to fit.
    - **(B)** Accept the new idea / update Canon (and cascade-flag any elements downstream that depended on the old value).
    - **(C)** Put it on ice (→ `Parked`, revisit later).
3. Record the resolution and the author's choice in `history` for that element, with timestamp.
4. On (B), the app must produce a list of potentially-invalidated downstream Confirmed elements (any element whose stored rationale references the changed element) for the author to re-confirm or re-open — do not silently leave stale dependents.

### 5.8 Stage 7 — Creative Audit & Pitfall Check

System-run validation, not a free-form question stage. Must programmatically check and report:

- Does the Climax (Story Spine) directly answer the Core Dramatic Question (Stage 3)? Flag if no explicit link exists.
- Does the Transformation Arc (Stage 4) align with the Theme Statement (Stage 3)?
- Cross-check the finalized Story Spine and Dramatic Engine against the **Common Mistakes** list(s) pulled from the diagnosed Format(s) in Stage 2 — surface each one as a yes/no/unsure prompt to the author rather than asserting a verdict unprompted.
- Output a short pass/fail-per-check summary before the author authorizes Stage 8 generation.

### 5.9 Stage 8 — Document Generation

- **Hard rule:** only `Confirmed` values may appear in the generated document body. `Parked` items appear only in Section 12 (Outstanding Questions) of the output, never fabricated into other sections.
- Output must match the structure in Section 10.2 **exactly** (section numbers, headers, field names) so downstream projects can parse it reliably.
- Generate both:
    - `story-foundation-v{n}.md` — human-readable.
    - `story-foundation-v{n}.json` — machine-readable, same content, structured per Section 10.1.
- Every regeneration increments `Version` and appends a row to the Version History table (Section 13 of the doc spec) with a diff summary.

### 5.10 Session Persistence & Resume

- One **Project** = one story-in-development, containing: full state store, conversation transcript, current stage/depth pointers, author-type history, and all generated document versions.
- Author can have multiple Projects; must be able to list, resume, rename, and export/delete a Project.
- Resuming a Project restores full state and gives the model a compact **state summary** (not the full transcript) as grounding context on the next turn, to control token cost (see Section 8).

### 5.11 Export & Downstream Handoff

- Export formats: Markdown, JSON, and (nice-to-have) PDF of the human-readable doc.
- JSON export is the contract for Projects 2–5. It must be stable and versioned (`schema_version` field) since those projects (not built here) will consume it later.
- `outstanding_questions` in the export must be tagged by which downstream project they belong to (`"defer_to": "Project 2"` etc.) so a future agent can route them automatically.

---

## 6. System Architecture (Recommended)

*These are recommended defaults, not hard requirements — flag any deviation to the product owner, but proceed with these unless blocked.*

### 6.1 High-level shape

```
[Chat UI (web, React)] <-> [App Server (Node or Python)] <-> [Claude API]
                                     |
                          [State Store: Postgres or SQLite]
                                     |
                     [Retrieval index over 101 Story Formats doc]
```

- **Frontend:** simple single-page chat UI. Minimum viable: message list + input box + a collapsible "Story Canon" side panel showing current Confirmed/Working/Parked elements per stage (read-only, for author transparency — this also doubles as a debugging aid).
- **Backend:** stateless request handler per turn. On each user message:
    1. Load Project state.
    2. Build model context = system prompt (Appendix A, static) + compact state summary + retrieved format entries (if in Stage 2) + last N raw turns.
    3. Call Claude with tool-use/structured-output for **state deltas** (see 6.4) alongside the natural-language reply.
    4. Apply deltas to state store transactionally; run conflict-check before committing.
    5. Return natural-language reply to UI; update side panel from new state.
- **State store:** Postgres in production, SQLite acceptable for local/dev or single-user deployments. One row per element per Project, plus a `projects` table and a `messages` table for transcript.

### 6.2 LLM Orchestration & Structured State Updates

- Do **not** rely on parsing the model's prose to infer state changes. Instead, use a **secondary structured-output call** (or a tool-call within the same turn) where the model emits a small JSON patch describing which elements changed status/value this turn, e.g.:

```json
{
  "updates": [
    {"element_id": "primary_format", "status": "Confirmed", "value": "A05 — The Chosen Burden"},
    {"element_id": "supporting_formats", "status": "Working", "value": ["B08 — The Last Stand"]}
  ],
  "conflict_detected": false,
  "stage_ready_to_advance": false
}
```

- This keeps the conversational reply free-form and natural (per Section 5.1) while giving the app a reliable machine signal to update state — avoids fragile regex/prose-parsing.
- The app, not the model, enforces stage-gating and depth defaults; the model proposes, the app validates against the rules in Section 5.5–5.9 before persisting.

### 6.3 Reference Document Retrieval (101 Story Formats)

- Pre-process the source document once at build/deploy time into 101 structured records (one per format code A01–E21), each with: Code, Title, One-line tagline, Core Definition, Core Dramatic Question, Plot/Story/Theme Engine, Themes block, Hero/Antagonist Archetypes, Master Examples, Typical Plot Structure, Common Mistakes.
- Build a lightweight retrieval index (embedding-based similarity search is sufficient; a vector DB like pgvector, sqlite-vss, or even an in-memory cosine-similarity index over 101 records is fine — this corpus is small enough that a full-text/keyword match plus a small reranking prompt would also work adequately).
- At Stage 2, retrieve top ~8–10 candidate format records based on the author's Stage 1 answers (premise, protagonist situation, conflict type, desired emotional engine) and pass their structured fields into the model's context for it to reason over and narrow to 1 Primary + ≤2 Supporting.
- Store the **Common Mistakes** text for the confirmed format(s) verbatim in state for reuse in Stage 7.

### 6.4 Conflict Detection Implementation

- On each structured update from the model (6.2), the app checks: is any `element_id` in the patch currently `Confirmed` with a different `value`?
- If yes, do not apply the patch. Instead, force the next model turn to run the Conflict Resolution flow (5.7) with both old and new values injected into context, and require the model's next structured output to include one of `{keep_canon, accept_and_update, park}` plus (if `accept_and_update`) a `cascade_review` list of dependent elements.

### 6.5 Token/Context Budget Management

- Never send the full transcript on every turn once a Project exceeds ~15–20 turns. Replace with the **state summary** (all Confirmed values, current stage, current depth) + last 4–6 raw turns for conversational continuity.
- Never send the full 101 Story Formats document as raw text in every turn — only the retrieved subset (6.3), and only during Stage 2 (plus the confirmed format's Common Mistakes during Stage 7).

---

## 7. UX Requirements

- Chat-first; no multi-page wizard/form UI — the conversational pacing (1–2 questions per turn) is a core product requirement, not just a prompt-engineering nicety.
- Read-only "Story Canon" panel: shows the 8 stages, current stage highlighted, and for the current + prior stages, each element's status badge (`Exploring` grey / `Working` amber / `Confirmed` green / `Parked` blue).
- A visible "current mode" indicator is **not** required to be shown to the author (per 5.1, the model shouldn't narrate it), but the debug/dev panel may show `depth_mode` for QA purposes.
- Conflict Resolution prompts must render as a distinct, visually flagged UI element (e.g., a warning-styled card with the 3 lettered choices as buttons), not buried in normal chat flow.
- Stage 8 output should render as a downloadable document (Markdown preview + download buttons for .md/.json/.pdf), not just dumped as chat text.
- Support resuming a Project from a project list/dashboard view.

---

## 8. Non-Functional Requirements

- **Latency:** conversational turns should return in a time consistent with normal chat UX; the secondary structured-output call (6.2) should be combined into a single model call where possible (e.g., via tool use) rather than doubling round-trips.
- **Reliability:** state updates must be transactional — a crash mid-turn must not leave a partially-applied canon state.
- **Auditability:** every status change must be logged with old value, new value, timestamp, and triggering turn ID (supports the `history` array in 10.1).
- **Portability of output:** the JSON export schema is a versioned contract; breaking changes require a `schema_version` bump, since Projects 2–5 (built later, possibly by different agents/sessions) will depend on it.
- **Data retention:** Projects and transcripts persist until the author deletes them; no automatic expiry in v1.

---

## 9. Deployment Target

Recommend a simple web app (single Node/Python service + Postgres + static frontend) deployable to a single container/instance for v1. A CLI-only version (terminal chat + local SQLite + local file export) is an acceptable, lower-effort v1 alternative if a UI is out of scope for this milestone — confirm which before implementation begins, but default to **web app** if unspecified, since the Story Canon side panel (Section 7) meaningfully improves usability.

---

## 10. Data Schemas

### 10.1 Canon State Element (per-element record)

```json
{
  "project_id": "uuid",
  "element_id": "core_dramatic_question",
  "stage": 3,
  "status": "Confirmed",
  "depth_mode": "Develop",
  "value": "Will the hero accept the price of greatness?",
  "rationale": "Derived from Format A05 diagnosis and author's stated theme of sacrifice.",
  "depends_on": ["primary_format", "theme_statement"],
  "history": [
    {"status": "Working", "value": "...", "ts": "2026-07-22T10:03:00Z", "turn_id": 12},
    {"status": "Confirmed", "value": "...", "ts": "2026-07-22T10:05:00Z", "turn_id": 14}
  ]
}
```

### 10.2 Story Foundation Document (export schema — mirrors Section 7 of the source spec)

Top-level JSON keys, in this exact order, matching the human-readable Markdown section-for-section:

```json
{
  "schema_version": "1.0",
  "1_story_metadata": {"id":"", "version":"", "working_title":"", "author":"", "date":"", "status":"", "medium":"", "target_length":""},
  "2_story_dna": {
    "core_story_promise": "",
    "story_identity": "",
    "narrative_priorities": ["..."],
    "always_emphasize": ["..."],
    "never_become": ["..."],
    "comparable_works": ["..."]
  },
  "3_story_format": {"primary_format": {"code":"", "name":"", "reason":""}, "supporting_formats": [{"code":"", "name":"", "reason":""}]},
  "4_premise": "",
  "5_logline": "",
  "6_genre_tone": {"genre":"", "subgenre":"", "tone":"", "style":"", "audience":"", "scale":""},
  "7_thematic_blueprint": {
    "external_theme": "", "internal_theme": "", "core_dramatic_question": "",
    "theme_statement": "", "narrative_purpose": ""
  },
  "8_dramatic_engine": {
    "protagonist": "", "antagonistic_force": "", "central_conflict": "",
    "primary_stakes": "", "transformation_arc": "", "emotional_journey": ""
  },
  "9_principal_characters": [
    {"name":"", "story_role":"", "description":"", "primary_function":""}
  ],
  "10_world_foundation": {
    "time_period": "", "primary_settings": [], "nature_of_world": "",
    "premise_assumptions": [], "environmental_rules": []
  },
  "11_story_spine": {
    "opening_image": "", "inciting_incident": "", "first_turning_point": "",
    "midpoint": "", "second_turning_point": "", "climax": "", "closing_image": ""
  },
  "12_outstanding_questions": [
    {"item": "", "defer_to": "Project 2 | Project 3 | Project 4 | Project 5", "notes": ""}
  ],
  "13_version_history": [
    {"version": "", "date": "", "summary_of_changes": ""}
  ]
}
```

---

## 11. Success Metrics

- **Structural completion rate:** % of started Projects that reach a Stage-8-generated document without abandonment.
- **Contradiction rate:** number of Conflict Resolution triggers per Project (a very high rate may indicate the interview is moving too fast / not confirming enough early).
- **Format-diagnosis grounding:** % of Stage 2 outputs that cite a real, retrieved format code vs. a hallucinated one (should be 100%; add an automated check that every cited code exists in the source index).
- **Scope adherence:** zero instances (spot-checked) of Projects 2–5 content (character psych, hard magic systems, scene beats, prose) appearing inside a generated Story Foundation Document body.
- **Resume reliability:** % of resumed Projects that restore full state with no data loss.

---

## 12. Milestones / Suggested Phasing

1. **M1 — Core interview loop:** system prompt wired to Claude API, basic chat UI, in-memory/session-only state (no persistence), stages 1–4 functional, no format-retrieval yet (model reasons from the doc text pasted in-context for Stage 2 only, accept this is not scalable long-term).
2. **M2 — Canon/state layer:** structured-output state deltas, conflict detection/resolution flow, Story Canon side panel, Postgres/SQLite persistence, save/resume.
3. **M3 — Format retrieval:** pre-process 101 Story Formats into structured records + retrieval index; wire into Stage 2 and Stage 7.
4. **M4 — Document generation & export:** Stage 8 compiler, Markdown/JSON export, version history tracking.
5. **M5 — Polish:** author-type classifier refinement, audit/pitfall-check automation (5.8), PDF export, multi-project dashboard.

*(Future, out of scope for this PRD: building Projects 2–5 as consumers of the JSON contract; multi-user collaboration; a shared library of author "voice" preferences across Projects.)*

---

## 13. Risks & Open Questions

- **Risk:** Model may not reliably emit clean structured state deltas alongside natural prose every turn — needs prompt-engineering + validation/retry logic (reject and re-prompt if the delta JSON fails schema validation).
- **Risk:** Context budget creep as Projects grow long (Section 6.5 mitigations should be load-tested against a realistically long interview, e.g., 60+ turns).
- **Open question:** Web app vs. CLI for v1 — default assumed **web app** (Section 9); confirm before M1.
- **Open question:** Should the 101 Story Formats document be treated as a static, versioned asset (re-embedded on deploy) or should the app support the author/operator swapping in an updated/extended format library later? Recommend designing the retrieval index to be rebuildable from a source file, not hardcoded, for future-proofing.
- **Open question:** Authentication/multi-tenancy — this PRD assumes single-author local/private use; add an auth layer before any shared/hosted deployment.

---

## Appendix A: Source System Prompt (Reference — Do Not Modify)

The full "SDOS PROJECT 1" system prompt (persona, operating principles, adaptive styles, scope boundaries, canon/state rules, 8-stage workflow, output spec, and response-writing rule) as provided by the product owner is the authoritative conversational specification and should be passed to the model verbatim as the system prompt for every interview turn. It is not reproduced in full here to avoid duplication/drift — treat the original document supplied alongside this PRD as Appendix A, version-locked, and reference it directly rather than re-deriving behavior from this summary.

## Appendix B: Reference Data Asset

The "101 Story Formats" encyclopedia (Volumes 1–5, codes A01–E21, 101 total formats) supplied alongside this PRD is the required source-of-truth data asset for Section 6.3 (retrieval) and must be pre-processed into structured records as described there before Stage 2 functionality is considered complete.