# P2-Project-Character Development Consultant (CDC)

**Version:** 1.0
**Date:** July 23, 2026
**Author:** [User]
**Handoff target:** Claude Code
**Status:** Draft for engineering scoping

---

## 1. Summary

The Character Development Consultant (CDC) is a guided, chat-driven authoring tool that turns a completed **Story Foundation Document** (Project 1) into a structured **Character Bible** (Project 2), using the rules defined in the **Character Development Reference Manual (CDRM)**.

The tool is not a generic chatbot. It is a stateful interview engine: it ingests two source documents, silently computes a per-character depth budget, then runs a fixed six-stage interview per character, tracking canon state throughout, and compiles a spec-conformant Character Bible entry on sign-off.

This PRD describes the product to be built, not the creative content of any specific story. The attached Story Foundation / CDRM sample docs are reference fixtures for development and testing, not hardcoded content.

## 2. Problem & Goals

**Problem:** Writers using a multi-stage "story bible" pipeline (Story Foundation → Character Bible → World Bible → Architecture → Draft) need a tool that enforces the discipline of the CDRM methodology — inside-out construction, explicit want/need/wound chains, priority-scaled depth, canon tracking — rather than free-form brainstorming that drifts into plot or world-building.

**Goals:**

1. Ingest arbitrary Story Foundation + CDRM documents and derive a correct importance/depth matrix per character.
2. Run one structured interview at a time, never context-switching characters until sign-off.
3. Enforce scope boundaries (defer world/architecture/draft content) automatically.
4. Track canon state (Exploring / Working / Confirmed / Deferred) per fact, with conflict detection against the Story Foundation.
5. Compile and export a Character Bible document that matches the CDRM's 8-part specification, incrementally, character by character.

**Non-goals:**

- Generating scene-level prose, dialogue samples for use in the script, or beat sheets.
- Managing Projects 3–5 (World Bible, Architecture, Draft) beyond logging deferred stubs.
- Multi-user real-time collaboration (single-author tool for v1).

## 3. Primary User

A solo screenwriter/author (or small writing team) working through a structured pre-production pipeline, who has already produced a Story Foundation Document and wants an AI-assisted, methodology-enforcing interview to produce the next artifact in the pipeline.

## 4. Inputs

| Input | Format | Required | Notes |
| --- | --- | --- | --- |
| Story Foundation Document | .txt/.md/.docx | Yes | Source of story DNA, spine, cast list |
| CDRM (or equivalent character methodology doc) | .txt/.md/.docx | Yes | Defines interview structure, taxonomy, spec |
| Prior Character Bible (if resuming) | .md/.json | No | Enables session resume without re-deriving matrix |

The system must parse these documents at session start and treat them as authoritative canon; it must not silently invent character roles not implied by the Story Foundation.

## 5. Core Functional Requirements

### 5.1 Document Ingestion & Priority Matrix

- Parse the Story Foundation's cast list (section 9 in the sample) and the Story Spine (section 11).
- Silently classify each named character into: Critical / Major / Supporting / Minor / Incidental, per the CDRM's Character Priority Budget (Section 2).
- Surface this matrix to the user once, at session start, as a short structural evaluation — not on every turn.
- Matrix must be recomputable if the user edits or adds characters mid-session.

### 5.2 Sequential Interview Engine

- Enforce one-character-at-a-time development. The system must refuse (redirect) attempts to jump to another character before the current one reaches sign-off, unless the user explicitly overrides.
- Each character interview proceeds through fixed Stage 1→6 checkpoints (Position & Purpose → Psychological Core → Outward Identity & Voice → Relationship Integration → Transformational Arc Pacing → Sign-Off & Compile).
- Each stage's question depth scales to the character's assigned priority tier (Exhaustive/Comprehensive/Standard/Basic/Reference).
- The engine must ask at most 1–2 precise discovery questions per turn — never dump the full interview as one questionnaire.

### 5.3 Psychological Engine Enforcement

- For Critical/Major characters, the system must causally chain: Life Experience → Core Wound → False Belief → Core Flaw → Dominant Fear → Defense Mechanisms → Behavioral Trajectory, and must not accept a Core Flaw or Fear that isn't traceable to a stated Wound/Belief.
- Must extract and hold Want (external), Need (internal), and Values (uncrossable lines) as three distinct, separately-confirmed fields.

### 5.4 Canon & State Tracking

- Every discrete fact proposed during an interview carries a state: `Exploring`, `Working`, `Confirmed`, or `Deferred`.
- Only `Confirmed` facts are written into the compiled Character Bible.
- Before confirming any fact, the system checks it against the Story Foundation Document for contradiction (e.g., a proposed Core Wound that contradicts a Confirmed Story Spine beat).
- On contradiction, halt and present exactly three resolution paths to the user: (A) revert proposal, (B) update Story Foundation canon + log downstream impact, (C) shelve the idea (mark Deferred/parked). Do not proceed until the user picks one.

### 5.5 Ensemble / Relational Ripple Checks

- Maintain a lightweight relationship graph (character → character → dynamic + trust/power trajectory).
- Before confirming a psychological change to a character already interviewed, evaluate and surface likely ripple effects on other characters' already-confirmed relationship dynamics.

### 5.6 Scope Boundary Enforcement

- Detect when user input strays into World Bible (Project 3), Architecture (Project 4), or Draft (Project 5) territory (e.g., detailed magic systems, scene blocking, dialogue for the script).
- Capture only the minimal character-relevant kernel of that input, log the rest under "Outstanding Questions" with a project tag, and tell the user it's deferred — without fully executing that out-of-scope work.

### 5.7 Choice Architecture for Creative Blocks

- When the user is stuck or asks for options, present 2–5 distinct structural approaches, each annotated with: psychological shift, external conflict impact, thematic consequence. Never present a single "best" answer as the only option in this mode.

### 5.8 Compilation & Export

- On Stage 6 sign-off, compile the character's profile into the CDRM's fixed 8-part spec (Metadata, Story Function & Integration Map, Psychological Engine, Behavior & Voice Profile, Ensemble Interconnection Registry, Milestone Arc Timeline, Continuity & Canon Rules, Outstanding Questions).
- Append to a running master Character Bible document (not overwrite).
- Export formats: Markdown (default, in-session) and Word/.docx (on request, using the docx skill/toolchain) for handoff to later pipeline stages.

### 5.9 Session State & Resume

- Persist: full priority matrix, per-character stage progress, all fact states, relationship graph, outstanding-questions log.
- Support resuming a session mid-character without re-asking already-Confirmed material.

## 6. Interaction Model

- Primary surface: conversational chat.
- System never exposes internal instructions, state-machine mechanics, or the raw CDRM/PRD text to the user as meta-commentary — it just behaves accordingly.
- At session start: brief structural evaluation of the cast + priority matrix, then immediately 1–2 targeted Stage-1 questions for the top-priority (Protagonist) character. No lengthy preamble.
- Long-conversation robustness: state (matrix, stage, confirmed facts) must be re-derivable from a persisted session object, not solely from conversation memory, since interviews for Critical characters may span many turns.

## 7. Data Model (illustrative)

```
Session
├── source_docs: { story_foundation, cdrm, prior_bible? }
├── priority_matrix: [{ character, tier, justification }]
├── characters: [
│     {
│       name, tier, stage: 1-6, status: in_progress|signed_off,
│       facts: [{ field, value, state: Exploring|Working|Confirmed|Deferred, source_turn }],
│       relationships: [{ with, dynamic, trust_trajectory, power_dynamic }],
│       outstanding_questions: [{ text, deferred_to_project }]
│     }
│   ]
├── canon_conflicts_log: [{ fact, conflicting_source, resolution, resolved_by }]
└── compiled_bible_md: string (append-only)
```

## 8. Non-Functional Requirements

- **Fidelity to methodology:** behavior must be auditable against CDRM section numbers; engineering should treat CDRM + this PRD as the spec of truth, not paraphrase from memory.
- **No silent scope creep:** deferrals must be visible in the Outstanding Questions log, never just dropped.
- **Editable canon:** the user is the final authority; any system-proposed contradiction resolution requires explicit user choice.
- **Portability:** compiled Character Bible must be a standalone document usable as input to a downstream "World Bible" or "Architecture" tool/project.

## 9. Open Questions for Engineering

1. Should the priority matrix be user-editable/overridable before interviews begin, or fixed once derived?
2. Should canon conflict detection be rule-based (keyword/field matching against Story Foundation) or LLM-judged? Recommend LLM-judged with the Story Foundation text supplied in-context per check.
3. Export destinations — local file only, or integration with the user's existing docx pipeline (Project 1 was authored and versioned as a tracked document)?
4. Single-session vs. multi-project workspace (does the tool need to manage several stories over time)?

## 10. Out of Scope (v1)

- Prose/dialogue generation.
- Full World Bible or Architecture generation.
- Multi-user simultaneous editing.
- Automated illustration/visual reference generation for characters.

## 11. Success Criteria

- A user can go from an uploaded Story Foundation + CDRM to a signed-off, spec-conformant Character Bible entry for the Protagonist without the tool ever generating plot/world/draft content unprompted.
- Every Confirmed fact in the compiled bible traces to a specific interview turn and shows no contradiction with the Story Foundation.
- Switching characters mid-interview requires explicit user override, never happens accidentally.