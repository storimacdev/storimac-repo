# StoriMac Architecture

**Status:** Decided 2026-07-23. This is the working architecture for Projects 1–5; update this file when a decision here changes, don't let it drift silently.

## 1. One pipeline product, not five separate tools

Projects 1–5 (Story Foundation → Character Bible → World Bible → Screenplay Architecture → Draft Writing) are one connected web app, sharing a single Next.js codebase (`web/`), a single database, and a single canon engine (§2). A **Story** is the top-level entity an author works on; each project is a session scoped to that Story, consuming the prior stage's machine-readable export.

**Revised 2026-07-28:** Project 5 (Draft Writing) **is** part of this app — a chat-based, scene-by-scene screenplay drafting session inside the Story workspace, sharing the same Canon Engine pattern as Projects 1–4 (see issues #92–102). This supersedes the original decision below, which was based on an earlier "Cycle of Stories" spec (a Claude Code repo-scaffold for one specific novel, not a generalized Project 5). That spec's issues (#73–87) were closed as superseded; the repo-scaffold/novel-export concept may return later as a separate, optional export target, but it is not the active Project 5 build.

Also as of 2026-07-28: Project 4 narrowed from a medium-flexible "Story Architecture" to an explicitly **screenplay**-exclusive "Screenplay Architecture" tool (Screenplay Structural Architecture Framework v3.0, superseding v2.0) — see issues #56–58, #60, #66, #70, #91.

```
Story (top-level entity, e.g. "Identity Swap")
 ├─ Foundation session        → story-foundation-v{n}.json    (Project 1)
 ├─ Character Bible session   → consumes P1 JSON               (Project 2)
 ├─ World Bible session       → consumes P1 JSON               (Project 3)
 ├─ Architecture session      → consumes P1 + P2 + P3           (Project 4, screenplay-exclusive)
 └─ Draft Writing session     → consumes P1 + P2 + P3 + P4, scene-by-scene (Project 5)
```

## 2. Shared Canon Engine

Every project in 1–4 is the same shape wearing different content: chat UI + read-only side panel → per-element canon state machine → conflict resolution → scope-boundary guardrails → deterministic document compiler → session persistence. Rather than building this four times (which is what a literal 1:1 read of the filed GitHub issues implies), it's built **once** as a shared library, and each project supplies configuration:

| Engine piece | What it does | What each project supplies |
| --- | --- | --- |
| `CanonElement` state machine | Exploring → Working → Confirmed, with a side branch (Parked/Deferred — naming varies by PRD, values are project-specific) | The element schema (field names, `depends_on` links) |
| `ConflictResolution` flow | Halts on contradiction with a Confirmed element or upstream canon; forces a 3-way choice (revert / accept+cascade / park) | Just the copy — the 3-way shape is identical across all 4 PRDs |
| `GuardrailRunner` | Pre/post-turn check blocking out-of-lane content, redirecting to the correct downstream project | A declarative rule set (e.g. P3: block character psychology; P4: block prose/dialogue) |
| `StructuredDeltaExtractor` | Tool-use call each turn that emits a state-delta JSON alongside the natural-language reply | The delta schema for that project's elements |
| `DocumentCompiler` | Deterministic template-fill from `Confirmed` state into the fixed output schema — LLM used only for prose synthesis inside sections | The output schema (Project 1 §10.2, Project 2's 8-part spec, Project 3's 15-section spec, Project 4's 12-section spec) |
| Session persistence | Save/resume, multi-project dashboard | Nothing extra — generic per Story |

Practical effect on the already-filed issues: Project 1's M2 milestone (issues #6–13) *is* the first build of this engine, not Project-1-specific code. Project 2/3/4's analogous issues (canon state, conflict resolution, guardrails, compiler) become "wire this project's config into the shared engine" rather than independent implementations. This file is the reference for that reframing — the individual issue bodies haven't been rewritten yet (see §5, Open follow-up).

## 3. Data flow contract between projects

Downstream ingestion reads the **upstream project's versioned JSON export**, never re-parses the human-readable `.md`/`.docx`. This was a real gap found and fixed in issues #18, #24, #55 (see commit history / issue threads for the reasoning) — Project 2's and Project 4's PRDs originally assumed prose re-parsing and mismatched section numbers; both now point at the JSON contract instead.

- Project 1 exports `.md` + `.json` (no `.docx`).
- Projects 2 and 3 export `.md` (default) + `.docx` (on request).
- Project 4 exports `.md` + `.docx`.
- Every export's JSON carries a `schema_version` field; breaking changes bump it.
- Document section numbering follows each project's own PRD output-schema numbering exactly (e.g. Project 1 uses §10.2's 1–13 scheme) — **not** any numbering that appears inside a system-prompt/persona document, since those numbers describe prompt structure, not the exported artifact.
- **Internal catalog codes never cross the export boundary (decided 2026-07-23):** Project 1's Stage 2 diagnosis tracks a 101 Story Formats catalog code (e.g. `A05`) purely as internal retrieval-grounding metadata (`retrieval_code` on the state delta — see issue #9) and a Stage 7 Common Mistakes lookup key. It is stripped before compilation (#18) — the JSON contract's `3_story_format` carries only `name`/`reason`, never a code — so no downstream project (2–5) can read, echo, or generate a raw catalog code. Only Project 1 has this concept today, but the rule generalizes: any internal identifier used for retrieval/QA purposes is engine-internal state, not exported content, unless a project's own output schema explicitly calls for it.

## 4. Tech stack

**Deployment decided 2026-07-23** (supersedes the local-only SQLite/no-auth plan below where noted): Firebase (Auth + Firestore + Storage) + Google Cloud Run, single Next.js app, no Python. See §6 for the reasoning and the Firestore data model.

- **Frontend + backend:** Next.js (App Router), same app as the current `web/` scaffold. New top-level routes per project stage (`/foundation` — today's `/interview` — plus `/character-bible`, `/world-bible`, `/architecture`), a shared `/stories` dashboard, and `/api/canon/*` routes implementing the engine from §2. Deployed as a single container to **Cloud Run** (`output: 'standalone'` build), not split into a separate frontend/backend service.
- **LLM:** Anthropic API via `@anthropic-ai/sdk`, same pattern already proven in Project 1 — system prompt (verbatim, per-project) + tool-use call for the structured delta, combined into one round-trip per turn.
- **Database:** **Firestore** (not SQLite/Prisma/Postgres — see §6 for the data model and why this supersedes the original plan). Accessed server-side only, via `firebase-admin`, from Next.js API routes.
- **Auth:** **Firebase Auth.** This was "none for now, revisit before any shared/hosted deployment" (Project 1 §13) — deploying to Cloud Run/Firebase *is* that point, so it's being built now rather than deferred further.
- **Binary exports:** `.docx`/PDF files go to **Firebase Storage** (a Cloud Storage bucket), not Firestore — Firestore has a 1 MiB per-document limit; Firestore holds a download URL/path reference, Storage holds the actual bytes.
- **Export pipelines:** Markdown/JSON generation is native (template-fill, see §2), no library needed. `.docx` export (needed by Projects 2, 3, 4) uses the `docx` npm package (or `docxtemplater`) — confirmed sufficient for this use case (deterministic template-fill, not freeform authoring), no Python/`python-docx` needed.
- **No Python/FastAPI (decided 2026-07-23):** considered and rejected. The two tasks that looked Python-favored — the 101 Story Formats retrieval index (§6.3 of Project 1's PRD; the corpus is 101 records, small enough for an in-memory similarity search or keyword+reranking, no ML framework required) and `.docx` generation (see above) — are both fully coverable in Node. Splitting the stack across two languages would have forked the shared Canon Engine (§2) across both; not worth it for tasks Node already handles.

## 6. Firestore data model for the Canon Engine

Firestore was chosen over Cloud SQL/Postgres despite the Canon Engine's state being naturally relational (dependency links, cascade queries). This is workable, with one real pattern change and one real limitation — both noted below rather than glossed over.

```
/stories/{storyId}
    - ownerUid, title, createdAt, updatedAt, currentProject, currentStage
    /elements/{elementId}            — CanonElement records (Project 1; analogous subcollections per project — see below)
        - element_id, stage, status, depth_mode, value, rationale,
          depends_on: [elementId, ...],
          history: [{status, value, ts, turn_id}, ...]   — embedded array, no join needed for an element's own history
    /messages/{messageId}            — transcript, ordered by turn
    /versions/{versionId}            — compiled document snapshots (Stage 8 etc.), full JSON export inline (well under 1 MiB); .docx/PDF bytes live in Storage, referenced by URL
    /conflicts/{conflictId}          — ConflictResolution log entries
    /outstanding_questions/{id}      — deferred items registry
```

Projects 2–4 get their own analogous subcollections under the same `/stories/{storyId}` doc (e.g. `/stories/{storyId}/characters/{charId}/facts/{factId}` for Project 2, `/stories/{storyId}/worldEntries/{entryId}` for Project 3, `/stories/{storyId}/structuralUnits/{unitId}` for Project 4) — one `Story` document stays the top-level pipeline entity from §1 regardless of which project is active.

- **Dependency/cascade queries (the real pattern change):** "what Confirmed elements reference X" — needed by Project 3's Dependency Review and Project 4's Relational Impact Check — becomes `.where('depends_on', 'array-contains', X)`, a real supported, indexed Firestore query. Combining it with a second filter (e.g. `status == 'Confirmed'`) needs a composite index, declared in `firestore.indexes.json` (Firestore's emulator/console will name the exact index needed on first query failure in dev).
- **Multi-level cascades (the real limitation):** "dependents of dependents" isn't one query the way a SQL recursive CTE would be — it's an app-level BFS, one `array-contains` query per level. Fine at this app's scale (a single Story's element count is in the tens, not millions) but worth knowing going in.
- **Transactions:** `runTransaction` covers a single turn's state-delta application (a handful of element writes + a history append + maybe a conflict-log entry) comfortably — Firestore transactions support up to 500 document writes, far more than one turn needs. Satisfies the "no partial state on crash" requirement from every PRD's NFRs.
- **Security:** Firebase Security Rules keying off `resource.data.ownerUid == request.auth.uid` (checked on the parent `Story` doc for subcollection reads/writes) map cleanly onto the single-author-per-story model — arguably simpler than hand-rolling ownership checks in API route middleware, which is a genuine point in Firestore's favor now that Auth is Firebase too.
- **Prisma is dropped.** The schema-portability plan in the old §4 (SQLite → Postgres via Prisma) no longer applies; Firestore access goes through `firebase-admin` directly from Next.js API routes, server-side only.

## 7. Open follow-up

- **Project 2's four open engineering questions resolved (2026-07-30, issue #37):** Priority matrix is user-editable/overridable by the author before and during interviews — matches §8's "the user is the final authority" NFR and §5.1's requirement that the matrix be recomputable when the user edits/adds characters. Canon conflict detection is LLM-judged, not rule-based — reuses the same `ConflictResolution` flow already built for Project 1 (§2, issue #10), with the Story Foundation JSON supplied in-context per check, per the PRD's own recommendation. The other two questions were already decided elsewhere in this file; restated here for completeness since #37 asked for all four to be recorded together: export is local file only, Markdown (default) + `.docx` (on request) — no external docx-pipeline integration (§3); workspace scope is multi-project, reusing the same Story/Workspace model and dashboard already built for Project 1 (§1, §6, issue #22) rather than a separate single-session tool.
- ~~The individual GitHub issues for Projects 2–4's canon/state/conflict/guardrail/compiler work still read as if built independently.~~ **Done (2026-07-23):** 22 issues now carry an "Architecture note" comment cross-referencing the shared engine and its reference implementation. Reference issues (Project 1): `CanonElement` → #6, `StructuredDeltaExtractor` → #9, `ConflictResolution` → #10, side panel → #11, session persistence → #12, `DocumentCompiler` → #18. Consumers annotated: Project 2 #29/#30/#32/#34/#36, Project 3 #41/#45/#46/#47/#50, Project 4 #60/#62/#64/#68/#69/#70. Note: `GuardrailRunner` has no Project 1 reference implementation (Project 1 has no upstream project to defer to) — its three peer implementations are #32 (P2), #46 (P3), #68 (P4), cross-referenced to each other instead. Project 3 also has no dedicated persistence issue filed; #41's note says to rely on the shared engine (#12) rather than filing a new one.
- `.docx` generation library choice: leaning `docx` (npm) or `docxtemplater` per §4/§6, not yet finalized between the two.
- **Deploy scaffolding done (2026-07-23):** `output: 'standalone'` enabled; `web/Dockerfile` (repo-root build context, fallback path) and `web/apphosting.yaml` (primary path — Firebase App Hosting, chosen over manually wiring Cloud Run) both written; `firebase.json` + `firestore.rules` + `firestore.indexes.json` + `storage.rules` at the repo root implementing the §6 data model; `firebase-admin` bootstrap at `web/src/lib/firebaseAdmin.ts`. See README "Deploying" section for the actual commands. This is scaffolding only — no Firestore/Storage calls are wired into the app yet (still M1: in-memory chat only); that's issue #12.
  - **System-prompt packaging — resolved for real (2026-07-24):** the original fix (§ history) synced `system-prompts/sp01` in from a sibling directory via a `scripts/sync-system-prompts.mjs` prebuild hook. That shipped an actual App Hosting build failure: buildpack detection (`google.nodejs.runtime`, `google.config.entrypoint`) failed outright against that layout — "No buildpack groups passed detection." App Hosting's documented monorepo support is for recognized tooling (Nx/Turborepo with `project.json`/workspace config), not an arbitrary subfolder-plus-sibling-folder repo shape like this one had. Root cause not fully confirmed via raw Cloud Build logs, but the fix addresses the whole class of problem regardless: `sp01-sdos-systemprompt.md` now lives permanently at `web/system-prompts/sp01-sdos-systemprompt.md`, inside the app's own project root. The sync script, its `predev`/`prebuild` hooks, and `web/generated/` are all removed — `web/` has zero build-time dependency on anything outside itself now.
  - **Also confirmed (2026-07-24):** Firebase App Hosting does not support custom Dockerfile builds at all — buildpacks only. `web/Dockerfile` is a manual Cloud Run path outside App Hosting, not a fallback build strategy within it (the earlier "point App Hosting at the Dockerfile instead" plan doesn't exist as an option).
  - Still unverified: the `firestore.get()` cross-service call in `storage.rules` — syntax looks right per current Firebase docs but hasn't been run against the emulator.
- **Repo layout changed again (2026-07-24):** PRDs are no longer in this repo at all — they're planning docs, not needed to build/run the app, and moved to a local-only folder (gitignored via `/storimac-prds/` at repo root, in case anyone re-adds the directory locally). `system-prompts/sp02` and `sp03` (reference docs for Projects 2 and 4, not consumed by any code yet) stay at the repo root; `sp01` (which the running Project 1 app actually reads) lives inside `web/system-prompts/` instead, per the fix above. The earlier note below about the CDRM Priority Budget gap and Appendix A fix still applies to `prd2-character-development-consultant.md` — that file just isn't in this repo anymore, only locally.
