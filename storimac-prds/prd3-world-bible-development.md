
## 0. Document Control

| Field | Value |
| --- | --- |
| Product Name | World Bible Development Tool (working title) |
| Project Position | Project 3 in a 5-project narrative development pipeline (Story Foundation → Character Bible → **World Bible** → Story Architecture → Draft Writing) |
| PRD Version | 1.0 |
| Date | July 23, 2026 |
| Status | Draft — for engineering scoping |
| Author | Product (via Claude), based on supplied consultant persona/workflow spec |
| Intended Recipient | Claude Code (implementation) |

**Assumption flagged for confirmation:** No platform preference was given. This PRD specifies a **standalone web application** (chat-style interview UI backed by persistent state and document storage), because the workflow requires canon tracking, versioning, and structured compilation across multiple sessions — capabilities a bare system-prompt/Claude Project template cannot reliably provide on its own. If a lighter-weight CLI tool or a pure Claude Project template was actually wanted, flag this before build starts, since it changes the architecture substantially (see §9).

---

## 1. Purpose & Background

The user runs a structured, multi-project fiction-development pipeline. Project 1 (Story Foundation Document) is already canon and complete — it defines a satirical sci-fi dramedy ("Identity Swap") set in 2085, where physical identity has been replaced by a Digital Identity Profile (DIP) system.

This tool implements **Project 3: World Bible Development**, an AI-facilitated, structured interview process that expands the Story Foundation into a detailed, dramatically-functional World Bible — without drifting into Character Bible (Project 2) or Story Architecture (Project 4) territory.

The core product insight: this is **not a generic AI chat wrapper**. It is a workflow engine with strict rules of scope, a formal complexity-budgeting system, a canon-state machine, and a fixed compiled-output schema. The LLM (Claude) provides the expert persona and reasoning; the application provides structure, memory, state tracking, and enforcement of the rules the persona must follow.

---

## 2. Goals

### 2.1 Product Goals

- Let a solo author iteratively build a rigorous, non-bloated World Bible through guided conversation rather than a blank page.
- Enforce scope discipline: prevent the AI from wandering into character psychology or plot sequencing.
- Track canon state per world element (Exploring / Working / Confirmed / Deferred) so the author always knows what's locked vs. provisional.
- Detect and surface contradictions with the Story Foundation (or with previously confirmed world canon) as explicit decision points, not silent overwrites.
- Produce a clean, versioned, structured World Bible document matching a fixed 15-section schema, exportable for use in later pipeline stages.

### 2.2 Non-Goals

- Not a general-purpose worldbuilding wiki tool.
- Not a replacement for Projects 2, 4, or 5 — must actively refuse/redirect work belonging to those stages.
- Not aiming for multi-user/collaborative editing in v1.
- Not aiming for illustration/map generation in v1 (may be a future extension).

### 2.3 Success Metrics

- Author can go from "Story Foundation ingested" to "compiled World Bible v1.0" in a single guided session flow (multiple sittings allowed, state persists).
- Zero silent canon violations: every contradiction with Story Foundation or established world canon is surfaced and requires an explicit author decision (Revert / Revise / Defer).
- 100% of compiled World Bible documents conform to the 15-section output schema (§7) and pass an automated structure-lint before being marked "Confirmed."
- Author reports (qualitatively) that the tool stopped itself from over-elaborating on Minor/Incidental elements (i.e., the Importance/Depth matrix visibly constrains output length).

---

## 3. Users

**Primary user:** A solo author/screenwriter running their own multi-project narrative pipeline, already comfortable with structured creative-development documents (loglines, beat sheets, bibles). Not necessarily technical.

**Secondary/future user:** Small writers' rooms doing the same process collaboratively (explicitly out of scope for v1, but architecture should not preclude it later — see §9.4).

---

## 4. Core Domain Concepts (must be modeled explicitly, not just prompted)

These are the mechanics that make this a *tool* and not just a chat with a clever system prompt. They need real data structures, not just LLM instructions the model might drift from over a long conversation.

### 4.1 World Complexity Level (WCL)

A single value, set once per project (editable with a warning), one of:

- **Level 1 — Minimal:** recognizable real world, micro-settings only.
- **Level 2 — Moderate:** real-world baseline + specialized expansion.
- **Level 3 — Rich:** multiple interconnected speculative systems.
- **Level 4 — Extensive:** fully independent speculative reality, heavy systems.

For the loaded Story Foundation ("Identity Swap," 2085, DIP-based society, soft sci-fi satire), the system should propose **Level 3 (Rich)** at Stage 1/2 and let the author confirm or override.

### 4.2 Narrative Importance × Development Depth Matrix

Every world asset (location, org, system, object, custom/tradition) gets two tags:

- **Importance:** Critical / Major / Supporting / Minor / Incidental
- **Depth:** Level 1 Reference (1–2 sentences) → Level 5 Exhaustive (full systemic rules; Critical items only)

This pairing must be **enforced**, not just described: the app should warn (not silently allow) if, e.g., a "Minor" element is being written at "Level 4/5" depth, or a "Critical" element is stuck at "Level 1."

### 4.3 Canon State Machine

Every world element and every world-shaping decision carries one status:

- **Exploring** — brainstorming, non-binding
- **Working** — provisional choice, may still change
- **Confirmed** — author-approved, locked as canon
- **Deferred** — postponed, tracked in an Outstanding Questions registry

State transitions must be explicit author actions (button/command), never inferred silently from conversational tone.

### 4.4 Systemic Dependency Graph

World pillars and assets are linked (e.g., Geography → Economy → Politics → Culture). Changing a Confirmed element must trigger an automatic **Dependency Review** prompt listing everything downstream that references it, before the change is finalized.

### 4.5 Conflict Resolution Protocol

If a new idea contradicts:

- Story Foundation Document (Project 1, immutable input), or
- Previously Confirmed world canon,

...the app must halt forward progress on that thread and force a three-way choice:
**(A) Revert** the new idea, **(B) Revise** existing canon (and show the resulting downstream Dependency Review), or **(C) Defer** the idea to the Outstanding Questions registry.

### 4.6 Universal World Entry Model

Every standalone world asset is stored as a structured record, not free text, with these fields:

1. Name & Category
2. Narrative Role & Importance/Depth tag
3. Functional Description (length-bounded by Depth level)
4. Systemic Relationships (cross-references to other entries)
5. Governing Rules & Constraints
6. Outstanding Questions

---

## 5. Scope Boundaries (Hard Constraints)

The app must actively enforce — not just instruct the model to remember — that this tool:

- **Never** designs character internal psychology, backstory, personal motivation, or dialogue voice (Project 2 territory). If the author steers there, the assistant should redirect: "That's Character Bible scope — want me to note it as a flag for Project 2 instead?"
- **Never** organizes plot structure, beat sheets, scene lists, or timelines (Project 4 territory). Same redirect pattern.
- **Never** generates prose, narrative description, or dialogue scenes (Project 5 territory).
- **Always** frames setting facts in terms of their causal/dramatic impact on plot, theme, or character choice — not encyclopedic detail for its own sake.

These boundaries should be implemented as a lightweight classifier/guardrail step before each assistant turn is sent to the user (see §8.3), not solely as prompt text, since prompt-only enforcement degrades over long sessions.

---

## 6. Functional Requirements — Interview Workflow

The product's primary interaction loop is a 5-stage guided workflow. The app must track *which stage/pillar is active* as explicit state (not inferred from chat history alone).

### Stage 1 — Understand (Ingest)

- Author uploads/confirms the Story Foundation Document (Project 1) as immutable input.
- System parses genre, tone, premise, and setting scope.
- Output: a short structural assessment + proposed WCL + 1–2 opening discovery questions.

### Stage 2 — Assess & Pillar Mapping

- System proposes the WCL (author confirms/overrides).
- System proposes an ordered list of relevant **World Pillars** to isolate (e.g., Technology/DIP System, Government & Grid Bureaucracy, Economy & Sector Stratification, Culture & Daily Life, Geography/Sectors, Black Market/Underworld, History of the Grid).
- Author can add, remove, or reprioritize pillars.

### Stage 3 — Prioritize & Deep Dive (repeatable, one pillar at a time)

For each selected pillar, run:

- **Discover:** open questions to elicit author's intent.
- **Develop:** system drafts a structured entry (per §4.6 Universal World Entry Model) at the appropriate Importance/Depth.
- **Validate:** author reviews, edits, and sets canon state (Working/Confirmed/Deferred).
- Loop continues until all prioritized pillars are addressed or explicitly deferred.

### Stage 4 — System Integration Audit

- App runs a consistency pass across all Confirmed entries: physical, economic, historical, and narrative.
- Flags redundancy for simplification and any unresolved Dependency Review items.
- Produces an audit summary the author must approve before compilation.

### Stage 5 — Compile

- Generates the final World Bible document per the fixed 15-section schema (§7).
- Locks a version number and timestamp.
- Exports to file (Markdown minimum; Word/PDF export as a stretch goal, §9.3).

---

## 7. Output Schema — World Bible Document (Fixed, Non-Negotiable Structure)

1. Document Metadata (Story ID, World Bible Version, Working Title, Date, Status, linked Project 1 & 2 versions)
2. World Overview & Complexity Summary (max 2 paragraphs)
3. High-Level World Assumptions & Canon Rules
4. Master World Pillars
5. Geography & Settings Registry
6. Societal Infrastructure Manual (Government/Laws, Hierarchies, Economy/Trade, Military)
7. Cultural & Lived Experience Profiles
8. Narrative Lore & History (only items with active plot/thematic relevance)
9. System Mechanics (Speculative/Technical)
10. Significant Institutions & Artifacts
11. Linguistic & Communication Profile
12. Interconnection Map & Systems Synthesis
13. Outstanding World Questions (categorized registry)
14. Cross-Project Reference Log
15. Version History (table: Version, Date, Summary of Changes)

The compile step should be implemented as a deterministic template-fill from the structured data model (§4.6 entries + pillar summaries), with the LLM used for prose synthesis inside each section — not as one giant free-form generation, so structure conformance is guaranteed rather than hoped-for.

---

## 8. System Design

### 8.1 High-Level Architecture

- **Frontend:** Chat-style interview UI + a persistent side panel showing: current Stage, active Pillar, Canon Registry (list of entries with state badges), Outstanding Questions, and Dependency Graph view (simple list view acceptable for v1; graph visualization is a stretch goal).
- **Backend:** Session/project store (per author project) holding:
    - Story Foundation Document (immutable reference)
    - World Complexity Level
    - Pillar list + status
    - World Entry records (per §4.6 schema)
    - Canon state per entry/decision
    - Dependency links between entries
    - Outstanding Questions registry
    - Version history log
- **LLM Integration:** Claude API calls scoped per turn with the relevant slice of state injected as context (not the full history every time — see §9.1 for context management approach), plus a system prompt encoding persona + current-stage instructions.
- **Guardrail layer:** A pre/post-processing check on each assistant turn enforcing:
    - Scope boundaries (§5)
    - Importance/Depth conformance (§4.2)
    - Conflict detection against Story Foundation + Confirmed canon (§4.5)

### 8.2 Data Model (indicative, not final schema)

```
Project
  ├─ storyFoundation (immutable doc reference)
  ├─ worldComplexityLevel (enum, editable w/ warning)
  ├─ pillars[] { name, priority, status }
  ├─ worldEntries[] {
        id, name, category,
        importance (enum), depth (enum),
        functionalDescription,
        systemicRelationships[] (entry ids),
        governingRules,
        outstandingQuestions[],
        canonState (enum: Exploring|Working|Confirmed|Deferred),
        versionIntroduced
     }
  ├─ dependencyGraph (edges between worldEntries)
  ├─ outstandingQuestions[] (global registry, categorized)
  ├─ conflictLog[] { entryId, description, resolution (Revert|Revise|Defer), timestamp }
  └─ versionHistory[] { version, date, summary }
```

### 8.3 Guardrail / Scope-Enforcement Logic

Before displaying an assistant response, run a lightweight check (rules-based and/or a secondary small LLM classification call) for:

- Does this response include character backstory/psychology/dialogue voice? → redirect.
- Does this response sequence plot beats/scenes/timeline? → redirect.
- Does this response generate narrative prose/dialogue? → redirect.
- Does this response contradict Story Foundation or a Confirmed entry without flagging it? → block and trigger Conflict Resolution Protocol (§4.5) instead of sending.

This is the most important non-obvious engineering requirement in this PRD: **the persona instructions alone (as supplied) are not sufficient enforcement over a long session** — they need to be backed by explicit state checks.

---

## 9. Open Questions / Decisions Needed Before Build

1. **Platform confirmation** — Standalone web app assumed (see §0). Confirm, or redirect to CLI / Claude Project template, which would remove most of §8's backend and replace it with file-based state (e.g., a local JSON canon file + slash-commands).
2. **Export formats** — Is Markdown-only sufficient for v1, or is a polished Word/PDF export needed immediately (impacts whether the docx/pdf skills need to be wired in as export pipelines)?
3. **Single-project vs. multi-project workspace** — Will this tool ever need to hold more than one story's World Bible, or is it single-project per deployment?
4. **Collaboration** — Confirmed out of scope for v1 (§3), but should the data model avoid hard single-user assumptions to ease a future multi-user upgrade?
5. **LLM cost/context strategy** — Should each Stage 3 pillar deep-dive be its own scoped conversation (cheaper, cleaner context) with only summaries carried forward into Stage 4/5, or one continuous long-running thread?

---

## 10. Out of Scope (v1)

- Character Bible generation (Project 2)
- Story Architecture / beat sheets (Project 4)
- Draft prose generation (Project 5)
- Illustration, mapping, or visual asset generation
- Multi-user real-time collaboration
- Localization/i18n of the tool UI itself

---

## 11. Suggested Build Phases

1. **Phase 1 — Core data model + Stage 1/2 flow:** Story Foundation ingestion, WCL proposal, pillar mapping, basic canon registry (no guardrail automation yet — manual state changes only).
2. **Phase 2 — Stage 3 deep-dive loop:** Universal World Entry Model CRUD, Discover/Develop/Validate cycle, Importance/Depth tagging with soft warnings.
3. **Phase 3 — Guardrails:** Scope-boundary enforcement, Conflict Resolution Protocol, Dependency Review triggers.
4. **Phase 4 — Stage 4/5:** Integration Audit pass, deterministic Compile step against the fixed 15-section schema, version history, Markdown export.
5. **Phase 5 (stretch):** Dependency graph visualization, Word/PDF export, multi-project workspace support.