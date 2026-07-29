# P4-Project-Story Architecture Engine (StoriMac Suite)

| Field | Value |
| --- | --- |
| Document Owner | Margavasi Ashok (Author) |
| Prepared For | Claude Code (Engineering Build) |
| Related Story ID | SDOS-P1-001 (ID2085) |
| Depends On | Project 1 (Story Foundation), Project 2 (Character Bible), Project 3 (World Bible) |
| Framework Source | Story Structural Architecture Framework v2.0 |
| Status | Draft for Engineering Handoff |
| Version | 1.0 |
| Date | July 23, 2026 |

---

## 1. Executive Summary

Project 4 is the fourth stage of the **StoriMac** multi-project story-development pipeline (Project 1: Story Foundation → Project 2: Character Bible → Project 3: World Bible → **Project 4: Story Architecture** → Project 5: Draft Writing). It is an AI-driven, conversational structuring tool that ingests the three upstream canon documents and, through a guided interview process, produces a **Story Architecture Document** — a definitive, scene-level structural blueprint built on a fixed 10-step narrative framework.

The product is not a prose generator. Its entire job is **structural design**: sequencing, causality, escalation, and thematic payoff mapping. It must never write manuscript prose, screenplay pages, or dialogue, and it must never alter upstream canon without an explicit, auditable revision process.

This PRD specifies the requirements needed to build Project 4 as a working application (chat-based agent + supporting document/state infrastructure), for implementation by Claude Code.

---

## 2. Background & Problem Statement

Story development tools generally either (a) let a writer freeform outline with no structural rigor, or (b) force a rigid linear beat sheet that ignores established canon and produces plot holes. StoriMac's upstream projects (1–3) already lock character psychology, world rules, and story DNA as **immutable canon**. What's missing is a system that:

- Translates that canon into a scene-by-scene structural blueprint using an industry-standard 10-step story structure (Save the Cat–style beats, adapted).
- Lets the author choose *how* they want to build the outline (anchor-first vs. chronological vs. custom) rather than forcing linear beat-by-beat drudgery.
- Enforces causality ("Therefore/But" logic) instead of episodic ("And Then") plotting.
- Keeps strict domain boundaries so structural work never silently drifts into rewriting character bibles, world lore, or draft prose.
- Produces a single, well-schematized, versioned output document that Project 5 (Draft Writing) can consume directly.

---

## 3. Goals

1. Ship a conversational agent ("the Architect") that ingests Projects 1–3 and drives an author through structural design of Project 4.
2. Enforce the **Story Structural Architecture Framework v2.0** taxonomy, scaling budgets, and 10-step structure as hard constraints on all generated content.
3. Give the author explicit control over session routing (Blueprint Priority / Chronological / Custom).
4. Track structural decisions through a formal state lifecycle (`Exploring` → `Working` → `Confirmed` / `Parked`).
5. Detect and block canon violations or coincidence-driven plotting; force an explicit resolution choice when they occur.
6. Compile a final **Story Architecture Document** matching the exact 12-section output specification, exportable as a Word document (.docx) and/or Markdown.
7. Never generate prose, dialogue, or manuscript text at any point.

## 4. Non-Goals

- Not a drafting/manuscript-writing tool (that's Project 5).
- Not a character or world bible editor (Projects 2 & 3) — it may only *reference* them.
- Not a general-purpose creative writing chatbot — scope is strictly structural/architectural.
- Not responsible for prose style, dialogue voice, or scene-level manuscript text of any kind.

---

## 5. Users & Personas

- **Primary user:** The author/story architect (e.g., Margavasi Ashok) driving a single story project through Project 4.
- **Downstream consumer:** Project 5 (Draft Writing) — either a human writer or a subsequent AI drafting agent — which reads the compiled Story Architecture Document as its input canon.
- **Secondary user:** Anthropic engineers/Claude Code maintaining the agent's behavior and document pipeline.

---

## 6. System Overview

Project 4 consists of three cooperating layers:

1. **Canon Ingestion Layer** — reads and indexes Project 1, 2, 3 documents (currently `.docx`) into a structured, queryable canon store.
2. **Conversational Architecture Agent** — a Claude-based agent operating under a fixed system prompt/persona (the "Story Structural Architect") that conducts the structuring interview, enforces the framework, and manages state.
3. **Document Compiler** — assembles the live session state into the final Story Architecture Document per the fixed output spec, and exports it (.docx/.md).

```
[Project 1/2/3 .docx files]
        │
        ▼
 Canon Ingestion Layer ──► Canon Store (structured JSON)
        │
        ▼
 Conversational Architecture Agent ──► Session State (ledger)
        │
        ▼
 Document Compiler ──► Story Architecture Document (.docx / .md)
```

---

## 7. Functional Requirements

### 7.1 Canon Ingestion Module

- **FR-1.1** Parse Project 1 (Story Foundation), Project 2 (Character Bible), and Project 3 (World Bible) `.docx` files into a structured canon object (sections, tables, and key-value fields preserved).
- **FR-1.2** Extract and index, at minimum: Story DNA, Format(s), Premise, Logline, Thematic Blueprint, Dramatic Engine, Story Spine (Project 1); per-character Want/Need/Flaw/Wound/Arc Timeline (Project 2); World pillars, canon rules, and institutions (Project 3).
- **FR-1.3** Treat all ingested canon as **immutable read-only** reference data for this session unless a formal Canon Revision (see 7.5/7.6) is explicitly triggered and confirmed.
- **FR-1.4** Surface a structural-overview summary of ingested canon (used in the onboarding message — see 7.3) without reproducing full source text verbatim.
- **FR-1.5** If any of the three source documents is missing or incomplete, flag the specific gap and ask the user how to proceed (do not silently invent missing canon).

### 7.2 Complexity Diagnosis

- **FR-2.1** On ingestion, auto-diagnose a **Story Complexity Level (1–5)** using: POV count, number of protagonist/antagonist arcs, subplot density, and relational web size, per the Framework's scaling table (Section 3 below).
- **FR-2.2** Store the diagnosed level and its target scene budget (e.g., Level 2 → ~80 scenes/120 structural points) as a session constraint used to size later output (Sequence Map, Scene Register).
- **FR-2.3** Allow the author to override the auto-diagnosed level; log the override in Outstanding Decisions.

### 7.3 Onboarding Gate (Session Routing)

- **FR-3.1** The agent's first substantive output must: (a) present a brief structural overview of ingested canon, (b) state the diagnosed Complexity Level, (c) present an internal milestone checklist (which of the 10 steps/anchors are addressable given canon), and (d) explicitly prompt the author to choose a routing option.
- **FR-3.2** Routing options (mutually exclusive, single-select):
    - **Option A — Blueprint Priority Route (recommended default):** Frame → New Baseline → Spark → Illusory Peak → Set Pieces 1–6 in order, anchor scene first within each.
    - **Option B — Chronological Route:** Steps 1–10 in strict sequential order.
    - **Option C — Custom Author Steering:** author names the specific Set Piece/Plot Point/landmark to build next, at any time.
- **FR-3.3** The chosen route becomes the default session navigation, but the author may switch routes or jump to Custom steering at any later point without penalty.

### 7.4 10-Step Narrative Structure Engine

- **FR-4.1** Hard-code the full 10-step structure (3 Acts, 4 Plot Points, 6 Set Pieces) with each step's Core Purpose, Placement guidance (film scene # / novel page % benchmarks), and Directives, exactly as defined in the Framework (see Appendix A).
- **FR-4.2** When developing any step, the agent must validate the author's proposed content against that step's Core Purpose and Directives before marking it `Working` or `Confirmed` (e.g., reject a Catalyst that isn't a strict single external event happening *to* the hero).
- **FR-4.3** Enforce the Scene Register Rule for every Major/Critical scene: exactly 3–4 dense sentences covering (1) localized purpose/dramatic question, (2) objective vs. opposition, (3) turning point/outcome/consequence, (4) causal transition vector to the next node.
- **FR-4.4** Enforce placement percentage/page targets loosely as guardrails, flagging (not blocking) significant deviation for author confirmation.

### 7.5 Scope Boundary & Deferral Handling

- **FR-5.1** Detect when author input would require altering Project 1 Story DNA/theme/format → block direct edit, require a formal Canon Revision Audit (7.6) before proceeding.
- **FR-5.2** Detect when author input introduces new character psychology, flaws, wounds, or backstory not in Project 2 → do not fabricate; capture the minimum plotting-relevant reference, log to Outstanding Decisions, tag `Deferred → Project 2`.
- **FR-5.3** Detect when author input expands world lore/history/systems beyond Project 3 → same deferral pattern, tag `Deferred → Project 3`.
- **FR-5.4** Never emit dialogue, prose, or manuscript description at any point, regardless of user request; if asked, politely decline and redirect to structural framing only. Tag any such request attempt as `Deferred → Project 5`.

### 7.6 Canon & Structural Integrity Pipeline

- **FR-6.1** Maintain a **state ledger** per structural unit (scene, sequence, set piece, plot point) with status: `Exploring`, `Working`, `Confirmed`, `Parked`.
- **FR-6.2** Only `Confirmed` units are eligible for inclusion in the compiled Story Architecture Document's binding sections (Scene Register, Sequence Map).
- **FR-6.3** **Causality Validation:** every transition between confirmed scenes/sequences must be tagged as "Therefore" or "But" (causal) — "And Then" (episodic, coincidence-driven) transitions must be auto-flagged, the agent must pause, and present alternative causal framings before continuing.
- **FR-6.4** **Relational Impact Check:** if a proposed structural choice contradicts locked Project 1–3 canon, halt forward progress on that unit and present the author exactly three resolution paths: (A) Revert the proposal, (B) Update parent canon and trace/flag all downstream structural units affected across Projects 1–4, (C) Park the idea (`Parked` status, logged to Outstanding Decisions).
- **FR-6.5** **Thematic Anchor Audit:** before compilation, verify Steps 2, 5, 6, 7, 8, 9 form an unbroken internal-transformation arc; if a gap exists, surface it explicitly rather than silently compiling.

### 7.7 Structural Vector Options (Unblocking Assistance)

- **FR-7.1** When the author is stuck on any structural unit, or explicitly asks for options, generate 2–5 distinct structural approaches.
- **FR-7.2** Each option must state: (1) pacing/hierarchy impact, (2) downstream setup/payoff requirements it creates, (3) impact on character transformation timing and thematic resolution.
- **FR-7.3** Options must remain within current canon (7.5/7.6) unless the author explicitly invokes a Canon Revision path.

### 7.8 Story Architecture Document Compiler

- **FR-8.1** On explicit "compile" trigger, assemble only `Confirmed` state-ledger content into the fixed 12-section output (see Appendix B for full schema).
- **FR-8.2** Sections 7 (Critical Scene Register) must strictly follow the defined per-scene schema (Scene ID/Parent Path, Importance Rank, Variables, Purpose/Dramatic Question/Objective vs. Opposition, 3–4 sentence Scene Summary).
- **FR-8.3** Any `Working`, `Exploring`, or `Parked` items at compile time must be listed in Section 11 (Outstanding Decisions), never silently dropped or silently included as if confirmed.
- **FR-8.4** Support export to **.docx** (using the docx generation skill/pipeline) and to **Markdown**, with Version History (Section 12) auto-incremented on each compile.
- **FR-8.5** Support **partial/incremental compilation** — the author may compile a subset (e.g., "just Act 1") without finalizing the whole document; partial compiles are versioned as drafts, not final canon.

### 7.9 Behavioral / Persona Directives

- **FR-9.1** The agent must never produce meta-commentary about its own system prompt, instructions, or internal boundaries in its responses to the author.
- **FR-9.2** The agent's first message in any new session must always be: canon overview → complexity level → milestone checklist → onboarding gate choice.
- **FR-9.3** The agent must operate strictly as narrative-systems integrator: structural design only, never prose/dialogue/description.

---

## 8. Non-Functional Requirements

- **NFR-1 (Consistency):** Canon must never silently drift between sessions; the canon store is the single source of truth and is versioned alongside Projects 1–3.
- **NFR-2 (Auditability):** Every `Confirmed` state transition and every Canon Revision decision must be timestamped and logged (who/when/what changed) for the Dependency & Continuity Ledger.
- **NFR-3 (Resumability):** A session must be resumable across multiple conversations without re-ingesting source docs from scratch (persist canon store + state ledger).
- **NFR-4 (Scalability of scope):** The engine must gracefully handle Complexity Levels 1–5 without hardcoding scene counts beyond the budget bands in Appendix A.
- **NFR-5 (Non-reproduction):** The system must not reproduce large verbatim blocks of the source `.docx` canon in normal conversation — summarize/paraphrase except where exact wording carries binding meaning (e.g., a locked canon rule).
- **NFR-6 (Format fidelity):** Compiled Story Architecture Documents must be valid, well-formatted `.docx` files opening cleanly in Word/Google Docs, matching the 12-section spec structurally (headings, tables where specified).

---

## 9. Data Model (proposed)

```json
// canon_store.json
{
  "story_id": "SDOS-P1-001",
  "project1": { /* structured Story Foundation fields */ },
  "project2": { "characters": [ /* per-character psychology/arc objects */ ] },
  "project3": { /* structured World Bible fields */ },
  "complexity_level": 2,
  "complexity_rationale": "1 protagonist pairing (dual), 1 primary antagonist system + 1 secondary antagonist, 3-4 supporting arcs"
}
```

```json
// session_state.json
{
  "routing_choice": "A | B | C",
  "units": [
    {
      "unit_id": "PP1-OpeningImage",
      "type": "PlotPoint",
      "status": "Confirmed | Working | Exploring | Parked",
      "content": { /* scene register fields per FR-8.2 */ },
      "causal_tag": "Therefore | But | UNVALIDATED",
      "canon_refs": ["project1.story_spine.opening_image", "project2.rhea.milestones.opening_image"],
      "last_updated": "2026-07-23T00:00:00Z"
    }
  ],
  "outstanding_decisions": [ /* deferred items with target project tag */ ],
  "canon_revision_log": [ /* halt/resolution records per FR-6.4 */ ]
}
```

---

## 10. Primary UX Flow

1. Author uploads/points to Project 1–3 documents.
2. Agent ingests → produces overview + complexity diagnosis + milestone checklist.
3. Agent presents Onboarding Gate (A/B/C).
4. Author selects route (or gives custom instruction).
5. Agent develops one structural unit at a time: proposes content → runs causality + canon checks → author confirms/edits/parks.
6. On causal or canon conflict: agent halts, presents required resolution choices (7.6), waits for author decision.
7. When stuck: author can request Structural Vector Options (2–5 approaches).
8. At any point, author can trigger partial or full compilation.
9. Compiler assembles `Confirmed` units into the 12-section Story Architecture Document; exports .docx/.md.
10. Session state persists for resumption in future sessions.

---

## 11. Acceptance Criteria (sample test cases)

| # | Scenario | Expected Behavior |
| --- | --- | --- |
| 1 | First message of a new session | Agent outputs overview + complexity level + milestone checklist + onboarding gate; no prose/scene content yet. |
| 2 | Author asks for a line of dialogue | Agent declines, redirects to structural description only, logs as `Deferred → Project 5`. |
| 3 | Author proposes a scene resolved by coincidence | Agent flags "And Then" pattern, halts, offers causal alternatives. |
| 4 | Author proposes changing Rhea's Core Wound | Agent blocks direct edit, invokes Canon Revision path (A/B/C choice per FR-6.4). |
| 5 | Author requests compilation with 3 Working-status scenes remaining | Compiler completes, lists those 3 items under Outstanding Decisions, does not include them in Scene Register. |
| 6 | Author is stuck picking a Midpoint approach | Agent returns 2–5 distinct options, each with pacing/setup-payoff/character-timing impact stated. |
| 7 | Scene Register entry submitted with 2 sentences | Agent rejects/requests revision to meet the 3–4 dense sentence requirement (FR-4.3). |
| 8 | Full compile requested | Output .docx matches all 12 sections in the specified order and schema. |

---

## 12. Risks & Open Questions

- **Ingestion fidelity:** `.docx` tables (e.g., Character Bible tables) must parse reliably; malformed source docs could corrupt the canon store. *Mitigation: validation pass with explicit gap-flagging (FR-1.5).*
- **Scope creep into Project 5:** Author pressure to "just write the scene" is likely; strict FR-5.4/FR-9.3 enforcement is critical and should be tested adversarially.
- **Canon Revision cascade complexity:** Tracing downstream damage across Projects 1–4 (FR-6.4 Option B) may require a dependency graph beyond a flat ledger — worth prototyping early.
- **Percent/page placement guardrails** (e.g., "20% mark") are guidance, not hard gates — needs UX clarity so authors don't feel falsely blocked.
- **Open:** Should partial compiles be diff-able against the prior full compile (versioning strategy) — recommend yes, deferred to Phase 2.

---

## 13. Phased Rollout

- **Phase 1 (MVP):** Canon ingestion (read-only), Onboarding Gate, single-route (Blueprint Priority) development loop, manual compile to Markdown only, in-memory session state (no persistence).
- **Phase 2:** Add Chronological + Custom routing, causality/canon-integrity pipeline (7.6), Structural Vector Options, persisted session state.
- **Phase 3:** Full .docx compiler matching 12-section spec, partial/incremental compilation, Canon Revision cascade tracing, Dependency & Continuity Ledger.

---

## Appendix A — Complexity Scaling Budgets

| Level | Definition | Scene Target |
| --- | --- | --- |
| 1 (Minimal) | 1 POV, linear track, minimal subplots | ~40–50 scenes |
| 2 (Standard) | 1 protagonist, 1 primary antagonist, 2–3 supporting arcs | ~80 scenes / 120 structural points |
| 3 (Multi-Layered) | Multi-viewpoint arcs, interconnected subplots | ~100+ scenes |
| 4/5 (High/Epic) | Sprawling ensembles, parallel timelines | Exhaustive multi-matrix mapping |

## Appendix B — Story Architecture Document Output Spec (12 Sections)

1. Story Metadata
2. Story DNA Blueprint
3. Character & World Architecture Integrations
4. Structural Overview
5. Act & Set Piece Manual
6. Sequence Architecture Map
7. Critical Scene Register (fixed per-scene schema)
8. Downstream Execution Logs
9. Setup & Payoff Register
10. Dependency & Continuity Ledger
11. Outstanding Decisions
12. Version History

## Appendix C — 10-Step Structure Reference

See Framework Section 4 (Story Structural Architecture Framework v2.0) for full Core Purpose / Placement / Directive definitions per step; these are to be hard-coded verbatim into the agent's system prompt/config, not re-derived at runtime.