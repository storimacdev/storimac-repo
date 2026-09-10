# P3 Open Platform/Architecture Decisions (Issue #54)

Records the decision for each of #54's five sub-questions, so the
remaining Project 3 build (issues #42-53) isn't built against the wrong
assumption. Four of five were already decided elsewhere in this repo;
this doc is where they're gathered and cross-referenced for #54's own
closure, and where the one genuinely open question gets resolved.

## 1. Standalone web app, or CLI/Claude Project template?

**Already decided, unchanged:** standalone web app. `ARCHITECTURE.md`
§1/§4 — single Next.js app (`web/`), one codebase across all five
projects, deployed to Firebase App Hosting. Not a CLI; nothing about
Project 3's remaining build changes this.

## 2. Markdown-only for v1, or polished Word/PDF immediately?

**Decided:** Markdown ships with the compiler itself (issue #50, whose
own AC already says "Exports to Markdown at minimum"); Word/PDF is the
separate, already-filed follow-on (issue #52) — not blocking #50. This
matches the exact precedent already shipped for Projects 1 and 2: both
compile to structured JSON server-side first, then render Markdown/
`.docx`/PDF as separate client-side steps from that same payload
(`characterEngine/characterBibleMarkdown.ts`, `web/src/lib/docx/characterBibleDocx.ts`,
`web/src/lib/pdf/FoundationPdfDocument.tsx`) — World Bible should follow
the identical split when #50 and #52 are built, not a combined pipeline.

The `docx` npm package vs. `docxtemplater` choice `ARCHITECTURE.md` §4/§7
called "not yet finalized" **is now settled by precedent**: `docx` is
already in production use for Project 2's `.docx` export
(`characterBibleDocx.ts`, imperative Paragraph/Table API). Project 3's
future `.docx` export (#52) should use the same package rather than
introducing a second templating library for one project. `ARCHITECTURE.md`
updated to reflect this.

## 3. Single-project, or multi-project workspace?

**Already decided and built, unchanged:** multi-project. One `Story`/
Workspace model shared across all five projects, one dashboard
(`ARCHITECTURE.md` §1/§6/§7; confirmed live in code —
`web/src/lib/workspace/workspaceStore.ts`, `/api/workspaces/*` routes).

## 4. Should the data model avoid hard single-user assumptions?

**Already true in the live code — `ARCHITECTURE.md` §6 was stale, now
fixed.** The doc's own text said Firestore security rules "map cleanly
onto the single-author-per-story model," but the actual shipped code
(`workspaceStore.ts`, `/api/workspaces/[workspaceId]/members/[uid]`,
`/invites` routes, `getMembership` checked on every Project 3 route
already) already supports real multi-member workspace membership. This
was a documentation/code drift, not an open question — corrected in
`ARCHITECTURE.md` alongside this decision record.

## 5. Should each Stage 3 pillar deep-dive be its own scoped session, or one continuous thread?

**This is the one genuinely open question — decided here.**

**Decision: one continuous World Bible thread for all of Stage 3,
tracking the active pillar via a lock field on `Story.p3` (an
`activePillar: string | null`, mirroring `P2State.activeCharacterId`
exactly) — not separate per-pillar conversation sessions.**

Rationale: Project 2 already solved the identical problem — "develop N
sub-entities within one project, one at a time, with the ability to
switch and resume" — for its own N characters, entirely within one
continuous `character-chat` thread, using exactly this lock-field
pattern (`P2State.activeCharacterId` plus `characterFsm.ts`'s
`resolveCharacterTurn`) rather than spinning up a separate session per
character. Reusing that already-proven pattern for Stage 3's pillars
means:
- No new session-boundary/handoff infrastructure to design — the
  lock-and-switch mechanics, the "which sub-entity is active" grounding
  block, and the FSM-clamp-on-resume behavior are all directly portable
  from Project 2's implementation to Project 3's `activePillar`.
- The stated cost concern behind the "separate sessions" alternative
  (cheaper context, only summaries carried forward) is already solved
  differently and proven at this app's scale: Project 2 bounds its
  replayed transcript per turn (`CHARACTER_MESSAGE_WINDOW`) rather than
  replaying the entire session — the same bounding technique keeps a
  single long Stage 3 thread's per-turn cost manageable without needing
  separate sessions at all.
- Switching pillars becomes a request to lock a different `activePillar`
  (the same shape as switching characters in Project 2), not a session
  handoff with its own summarization pipeline to design and maintain.

This decision governs issue #43's design (the Discover/Develop/Validate
cycle needs to read/write `activePillar` the same way #59/#61's
`RoutingChoice`/lock fields work for Project 4, and the same way P2's
`activeCharacterId` already works) — #43 should NOT design its own
session-scoping mechanism from scratch.
