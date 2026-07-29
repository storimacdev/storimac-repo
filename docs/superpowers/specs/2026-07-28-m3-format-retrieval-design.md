# M3 — Format Retrieval Design Spec

Date: 2026-07-28
Status: approved
Covers: GitHub issues #14, #15, #16 (milestone "M3 — Format retrieval")

## Goal

Ground Stage 2 (Diagnose Story Format) in the actual "101 Story Formats" reference
document instead of the model's unaided memory of tropes, and carry the diagnosed
format's Common Mistakes forward into Stage 7's Creative Audit. Today Stage 2 has
**zero real grounding**: the system prompt tells the model to "map the premise against
the standard 101 Story Formats reference document," but no document is ever attached —
confirmed by reading `web/src/lib/systemPrompt.ts` and `web/src/app/api/chat/route.ts`.

## Source data (#14)

The reference document lives at
`project-docs/storimac-refdocs/P1-R1- 101 Story Formats....md` (moved there during the
2026-07-28 doc reconciliation; content unchanged — verified via git's rename detection,
99% similarity to the version already analyzed).

**100 of the intended 101 formats are usable.** Direct inspection (a script scanning
every `**Core Definition**` block and tracing it back to its code) found:

- 98 formats cleanly labeled.
- `B19` and `C10` are present with full records but mislabeled — written as bare "19"
  and "10" without their volume letter. Fixed during parsing by inferring the letter
  from surrounding context (both sit correctly ordered between their volume's other
  entries).
- `C20` is genuinely absent — no mention anywhere in the source, not even a stub. This
  matches the BA's own spec (confirmed with the user directly). Proceed with 100
  formats; `C20` stays absent from the index until supplied later.

### Structured record schema

```ts
interface StoryFormat {
  code: string;              // "A05"
  title: string;              // "The Chosen Burden"
  tagline: string;             // one-liner from the intro list
  coreDefinition: string;
  coreDramaticQuestion: string;
  engines: { plot: string; story: string; theme: string };
  themes: { external: string; internal: string; fear: string; desire: string };
  category: string;
  genres: string[];            // normalizes "Probable Genre(s)"/"Possible Genres" label drift
  heroArchetypes: string[];
  antagonistArchetypes: string[];
  heroArc: { beginning: string; end: string; external: string };
  masterExamples: { novels: string[]; films: string[] };
  plotStructure: { actI: string; actII: string; actIII: string; templateScenes: string[] };
  commonMistakes: string[];    // split on " • "
}
```

### Pipeline shape — deliberate deviation from #14's literal wording

#14's acceptance criteria calls for "a build/deploy-time script." This is built instead
as a **manual dev-time script**, run once now and re-run only if the source document
changes later.

Reason: the source document lives outside `web/`, at
`project-docs/storimac-refdocs/...`. `ARCHITECTURE.md` §7 documents a real production
outage from exactly this shape of mistake — a prebuild step that read a sibling
directory broke Cloud Build's buildpack detection ("No buildpack groups passed
detection"). The fix at the time was "web/ has zero build-time dependency on anything
outside itself now." A script invoked during `npm run build` that reads outside `web/`
would reintroduce that exact landmine.

Instead: `scripts/build-format-index.mjs` at the repo root (never invoked by the
deployed build) parses the source doc and writes committed output to
`web/src/data/storyFormats.json`. `web/`'s own build stays fully self-contained,
matching the existing `sp01` precedent (`web/system-prompts/sp01-sdos-systemprompt.md`
lives inside the app's own root for the same reason).

## Retrieval index & Stage 2 wiring (#15)

### Index build

`web/src/data/storyFormats.json` loads once into memory on first use (same caching
pattern as `getSystemPrompt()` in `web/src/lib/systemPrompt.ts`). For each format, a
searchable text blob is built from `title + coreDefinition + coreDramaticQuestion +
engines.* + themes.*` — deliberately excluding Common Mistakes, Master Examples, and
Plot Structure, since those add noise rather than topical signal.

### Scoring

Pure keyword/phrase overlap (TF-IDF-style term weighting — rarer words count more)
between that blob and a query string built from the author's Stage 1 Confirmed answers
(`concept`, `inspiration`, `target_audience`, `emotional_engine`). No embeddings, no
external API — matches `ARCHITECTURE.md`'s decision that this 100-record corpus needs
no ML framework. The top **10** scored candidates are returned (within the AC's "~8-10"
range; pinned to an exact number so the implementation has no ambiguity).

### Wiring into `/api/chat`

In `web/src/app/api/chat/route.ts`, right after the existing system-prompt assembly
block (~line 134): if `story.currentStage === 2`, run retrieval against the Stage 1
elements, then inject only the AC-specified fields (Core Definition, the 3 Engines,
Dramatic Question, Common Mistakes) for those ~10 candidates as a new system-prompt
block — never the full 100-record set, never on any other stage.

**New requirement (from the BA's P1 prompt v1.3, not in the original #15 AC):** the
injected block's framing text must instruct the model to reason over the candidates'
Core Definition/Engines/Common Mistakes internally without speaking their names or
codes aloud in its conversational reply — the format name only surfaces in the final
Stage 8 document. See "Companion task: sp01 version bump" below.

### Closing the `retrieval_code` gap

The state-delta schema already has `retrieval_code` (`web/src/lib/canonEngine/stateDelta.ts`
— issue #9 anticipated this), but `toElementUpdate()` in `chat/route.ts` silently drops
it before persisting — confirmed by reading the code, not assumed. Fix:

- Add `retrieval_code?: string | string[] | null` to `CanonElement` and
  `CanonElementPatch` (`web/src/lib/canonEngine/types.ts`). Single string for
  `primary_format`, string array for `supporting_formats` — matching how
  `web/src/lib/canonEngine/foundationDoc.ts` already expects those two elements' value
  shapes (`{name, reason}` / `{name, reason}[]`).
- Thread it through `toElementUpdate()` (`chat/route.ts`) and `applyStateDelta()`
  (`web/src/lib/canonEngine/canonStore.ts`), which currently constructs the persisted
  `CanonElement` field-by-field rather than spreading the patch.
- Validate each code against the real 100-entry set before trusting it — the AC's "no
  hallucinated codes" grounding check. Logged server-side, never shown to the author.

## Common Mistakes carry-forward (#16)

**Simplification vs. the issue's literal wording.** #16 asks to copy Common Mistakes
text into state when the format reaches `Confirmed`, and to keep it in sync if the
format later changes via Conflict Resolution. Since the format index is a static,
in-memory JSON lookup (not a database call or LLM query), there's no cost to skip
persistence entirely and no staleness risk to manage:

At Stage 7 entry (`chat/route.ts`, where `runStage7Audit()` is already called with an
empty `commonMistakes` array — see `web/src/lib/canonEngine/stage7Audit.ts`, which was
already written to accept this as an injectable parameter, anticipating M3), look up the
*current* `primary_format` and `supporting_formats` elements' `retrieval_code`, pull
their Common Mistakes straight from the in-memory index at that moment, and pass the
combined list into `runStage7Audit(elements, commonMistakes)`.

This automatically satisfies "stays in sync if the format changes" for free — there is
no stale snapshot to go stale, since it's read fresh every time Stage 7 runs. If the
format was never Confirmed with a valid `retrieval_code` (e.g. Stage 2 was skipped via
the new non-linear stage-order allowance — see companion task below), the list is empty
and `stage7Audit.ts`'s existing "skipped, not silently passed" behavior applies
unchanged.

## Companion task: `sp01` version bump (v1.0 → v1.3)

Not part of #14/#15/#16's original scope, but directly coupled to this work: the
deployed `web/system-prompts/sp01-sdos-systemprompt.md` is v1.0; the BA's supplied
prompt is v1.3. Two behavior changes in v1.3 interact with M3 and are bundled into this
plan rather than filed as a separate issue, since M3 already touches Stage 2's
system-prompt assembly:

1. Stage 2 rule: never mention a format's name or code in conversation, only in the
   final document. This is the source of the new requirement in the "Wiring into
   `/api/chat`" section above.
2. Non-linear stage order: authors may tackle stages out of sequence (Architect/Reviser
   types), as long as all 7 finish before Stage 8. **Out of scope for this plan** — it's
   a `stageFsm.ts` gating change unrelated to format retrieval, and is called out here
   only so it isn't lost; it should be scoped as its own follow-up (M5 polish, or a new
   issue).

Updating `sp01` to v1.3 is a direct text replacement (the file is loaded verbatim, no
parsing) plus verifying the two behavior changes don't conflict with any other
already-shipped Stage-specific logic (spot-checked: they don't — stage-order gating is
enforced entirely in `checkStageGate`/`advanceStage`, untouched by this plan).

## Testing / verification

No test framework exists in `web/` (scripts: dev/build/lint only). Verification is:

- `npm run lint` and `npm run build` pass.
- The pre-processing script (`scripts/build-format-index.mjs`) is spot-checked against
  known entries (e.g. `A05` "The Chosen Burden") after generating
  `web/src/data/storyFormats.json`.
- Manual interview run in the dev server: confirm Stage 2 responses reason from
  retrieved format content (spot-check that a premise heavy on "sacrifice" and "chosen
  hero" surfaces `A05` among candidates) without ever naming the format aloud, confirm
  the final Stage 8 document does name it, and confirm Stage 7's audit surfaces real
  Common Mistakes prompts (not the "skipped" message) once a format is Confirmed.

## Out of scope

- The non-linear stage-order change (see companion task above) — separate follow-up.
- Re-running the pre-processing script automatically on deploy (see pipeline-shape
  rationale above).
- Backfilling the missing `C20` format.
