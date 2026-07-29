# 5 PRD — "The Cycle of Stories" Progressive Drafting System

**For handoff to: Claude CodeDoc owner:** Author / Project Lead
**Status:** Draft v1.0

---

## 1. Summary

The author has a complete story bible (Character Sheet, Worldbuilding Sheet, 12-chapter Outline) for a novel, *The Cycle of Stories*, and a detailed authoring workflow (persona, drafting phases, style rules, continuity tracking, output format) currently living inside a single giant chat prompt.

This PRD specifies converting that prompt into a **repo-based, stateful Claude Code project**: a folder structure + `CLAUDE.md` instructions + lightweight tracking files that let the author generate the novel one chapter at a time, in any Claude Code session, without re-pasting the canon or losing track of continuity between sessions.

The deliverable is **infrastructure for a workflow**, not the novel itself. Claude Code should build the scaffolding; the author (with Claude's help inside that scaffolding) writes the book.

---

## 2. Goals

- Persist canon (character/world/outline) and drafting rules as project files Claude Code reads automatically, not re-supplied per session.
- Persist **state between sessions**: which chapters are Confirmed, what's Working/Exploring/Parked, and a continuity ledger (knowledge roster, physical tracking, open loops).
- Enforce the existing phase gate (Assignment Confirmation → Draft → QA/Present → Revise/Canonize) as a repeatable procedure, not something re-explained each time.
- Keep manuscript text (what the reader sees) cleanly separated from editorial/continuity metadata (what the author and Claude use to stay consistent).
- Make contradictions with prior canon **detectable and blocking** (a "Conflict Intercept" step) rather than silently drifting.

## 3. Non-Goals

- Not building a GUI, publishing pipeline, or export-to-EPUB tooling.
- Not automating chapter generation without author sign-off — every chapter still requires explicit human confirmation at the gate before drafting, and after drafting before canonization.
- Not modifying plot, character psychology, or world rules — the existing Project 1–4 material is canon and out of scope for this PRD to alter.
- Not multi-book / series tooling — scoped to this one novel.

## 4. Primary User

A single author, working solo across multiple Claude Code sessions (possibly days/weeks apart), who needs the system to "remember" where the book stands without manual re-briefing.

---

## 5. Repo Structure

```
cycle-of-stories/
├── CLAUDE.md                     # persona, workflow rules, hierarchy of authority
├── canon/                        # immutable source-of-truth (read, never auto-edited)
│   ├── characters.md             # = Project 2 (Character Sheet, verbatim)
│   ├── world.md                  # = Project 3 (Worldbuilding Sheet, verbatim)
│   └── outline.md                # = Project 4 (Chapter Outline, verbatim)
├── manuscript/
│   ├── chapter-01.md             # Confirmed canon text only — no notes
│   ├── chapter-02.md
│   └── ...
├── state/
│   ├── continuity-ledger.yaml    # knowledge roster, secrets, physical tracking
│   ├── open-loops.yaml           # active/closed narrative loops
│   ├── canon-log.md              # append-only log of confirmed decisions
│   └── project-status.yaml       # which chapter/phase is active, draft counters
└── working/
    ├── draft-current.md          # in-progress chapter, phase = Working
    └── notes/
        ├── exploring.md          # alternative paths under discussion
        └── parked.md             # postponed decisions
```

**Rules:**

- `canon/` is loaded at the start of every session and never edited by Claude without an explicit "revision audit" request from the author.
- `manuscript/` only ever contains **Confirmed** text. Nothing goes in there until Phase 4 (Canonization).
- `state/` is the machine-readable memory that replaces "re-explain the whole book to Claude" every session.

---

## 6. `CLAUDE.md` Contents (what Claude Code loads automatically)

`CLAUDE.md` should encode, near-verbatim, the rules already authored, reorganized as operating procedure rather than prose:

1. **Role & Directive** — persona (novelist/editor/continuity custodian), and the standing restriction: no plot/psychology/world-rule changes without an explicit revision audit.
2. **Hierarchy of Authority** (for conflict resolution, in order): Author's live instruction → `manuscript/` (Confirmed) → `canon/outline.md` → `canon/characters.md` + `canon/world.md`.
3. **Workflow phases**, mapped to file actions (see §7).
4. **Style rules** (Deep POV, show-don't-tell, per-character voice, sensory restraint) — kept as a checklist Claude runs during QA (Phase 3), not just prose guidance.
5. **State-file protocol**: read `state/*.yaml` before drafting; propose updates to them at Phase 4; never edit them silently mid-draft.
6. **Conflict Intercept protocol** (see §9).

---

## 7. Functional Requirements — the Phase Loop

The four phases from the existing workflow map to concrete file operations:

### Phase 1 — Assignment Confirmation Gate

- **Trigger:** author says "next chapter" / "draft chapter N" / names a chapter.
- **Action:** Claude reads `canon/outline.md` for that chapter's beat, `state/continuity-ledger.yaml` for current character/knowledge states, and `state/open-loops.yaml`.
- **Output:** one paragraph — `[Unit # & Title] | [POV] | [Cast Present] | [Setting/Time] | [Dramatic Objective] | [Expected Emotional Shift]` — using current state, not just the static outline (e.g., if Avva's condition has degraded in `continuity-ledger.yaml`, that shows up here).
- **Gate:** Claude stops and waits for author sign-off. No draft is produced in this step.

### Phase 2 — Drafting

- **Trigger:** author confirms.
- **Action:** Claude writes prose into `working/draft-current.md`, applying style rules from `CLAUDE.md` and constraints from the continuity ledger (who knows what, what's physically true right now).
- Chapter text must satisfy the **Dynamic Section Structure** (Opening Lock → Development → Escalation → Turning Point → Resolution/Transition) and the **Conflict Mandate** (no static-agreement scenes).

### Phase 3 — QA & Presentation

- **Action:** Claude self-checks the draft against:
    - Deep POV lock (no head-hopping / narrator filtering)
    - Voice fidelity per character (checked against `canon/characters.md` dialogue-style notes)
    - No contradiction with `state/continuity-ledger.yaml` or Confirmed chapters in `manuscript/`
- **Output to author**, always split into two blocks:
    - **Manuscript Text** — pure story, goes to `working/draft-current.md`
    - **Editorial Notes** — continuity note, canon-update ledger, self-assessment, revision questions (per the existing output spec) — stays in chat / a scratch file, never in `manuscript/`

### Phase 4 — Revision & Canonization

- **Action:** author gives feedback, tagged by type (Style / Dialogue / Character / Emotion / Pacing / Continuity / Structure). Claude edits at the smallest necessary scope (sentence → paragraph → scene), not full rewrites, unless asked.
- **On approval:** Claude
    1. Moves the final text from `working/draft-current.md` → `manuscript/chapter-NN.md`
    2. Appends a dated entry to `state/canon-log.md`
    3. Updates `state/continuity-ledger.yaml` and `state/open-loops.yaml` (new facts established, loops opened/closed)
    4. Updates `state/project-status.yaml` (marks chapter Confirmed, advances the pointer)

---

## 8. State File Schemas

**`state/continuity-ledger.yaml`** (illustrative shape)

```yaml
characters:
  arjun:
    knows: [avva_forgetting_pattern, meera_notebook_exists]
    suspects: [mother_reached_temple]
    physical: {age: 24, location: village, satchel_contents: [transcription_notebook]}
  avva:
    knows: [river_story_gap]
    lost_memories: [river_story_middle_section]
    physical: {condition: stable_declining}
secrets:
  - fact: "Arjun's mother's notebooks are in a box Avva kept"
    known_by: []
    revealed_in: null   # chapter number once revealed
timeline:
  current_day: 14
  days_since_opening: 14
```

**`state/open-loops.yaml`**

```yaml
loops:
  - id: mother_disappearance
    opened_ch: 1
    status: open
  - id: yaksha_first_riddle
    opened_ch: 7
    status: open
  - id: river_story_gap
    opened_ch: 2
    status: closed
    closed_ch: 12
```

**`state/project-status.yaml`**

```yaml
current_chapter: 5
phase: assignment_confirmation   # assignment_confirmation | drafting | qa | revision
confirmed_through_chapter: 4
```

---

## 9. Conflict Intercept Protocol

If a live author instruction, or a drafted scene, would contradict:

- a Confirmed chapter,
- `canon/outline.md`, or
- `state/continuity-ledger.yaml` / `state/open-loops.yaml`,

Claude must **stop drafting**, and output:

1. The specific contradiction (what was said vs. what's already true)
2. Downstream continuity damage (which later beats/loops this affects)
3. A request for explicit authorization to override, with the override logged in `state/canon-log.md` if granted.

This should be implemented as a standing instruction in `CLAUDE.md`, not a script — Claude Code should check this by reading the state files before every drafting action.

---

## 10. Out of Scope / Explicitly Static

`canon/characters.md`, `canon/world.md`, `canon/outline.md` are copied in verbatim from the author's existing Project 2/3/4 documents and are **not to be regenerated or "improved"** by Claude Code during setup — only reformatted into clean Markdown if needed for readability.

---

## 11. Milestones

| Milestone | Deliverable |
| --- | --- |
| M1 | Repo scaffold created; `canon/` populated verbatim; `CLAUDE.md` written and tested with a trivial "status" query |
| M2 | `state/` files initialized with Chapter 1 baseline (opening world state, empty ledgers/loops) |
| M3 | End-to-end dry run: Phase 1–4 loop executed for Chapter 1, producing `manuscript/chapter-01.md` + updated state files |
| M4 | Author validates the loop across 2–3 more chapters; adjust `CLAUDE.md` based on friction points |
| M5 | Full 12-chapter run to Confirmed status |

## 12. Open Questions for Author

1. Should Editorial Notes (Phase 3 output) be persisted to disk at all (e.g. `working/notes/chapter-NN-editorial.md`), or are they transient/chat-only?
2. Word-count or pacing targets per chapter — should these be tracked in `project-status.yaml` and flagged if a draft over/undershoots?
3. Should `state/canon-log.md` be structured (YAML/JSON) for querying, or is a human-readable append-only Markdown log sufficient?