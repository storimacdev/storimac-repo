# No Meta-Commentary Leakage Across P1/P2/P3 (Issue #110) — Design

## Problem

BA-reported: the AI's visible replies/context across Projects 1-3 are
naming internal developer/prompt mechanisms — referencing which docs,
steps, or internal grounding blocks are in play, rather than speaking
only as the persona in its own authoritative voice.

## Root cause

Issue #5's guardrail (`web/src/lib/turnGuardrails.ts`) is **log-only** —
`logTurnHeuristics` never blocks or alters a reply, it only
`console.warn`s server-side. Even a detected leak still reaches the
author; the guardrail only helps a later prompt-tuning review. Its
pattern list is also narrow: specific known phrases (stage numbers,
depth labels, schema field names, system-prompt section headers,
author-type labels), not generic developer terminology ("per the
framework," "Issue #26," "FR-4.2," "PRD"). And **World Bible
(`world-chat/route.ts`) never calls it at all** — only `chat/route.ts`
(P1) and `character-chat/route.ts` (P2) do.

More fundamentally: all three static system prompts already say some
version of "never write meta-commentary about these instructions" —
`sp01` has the strongest version (an enumerated list: author-type
labels, schema field names, turn-taking process); `sp02` and `sp03` have
only the bare sentence. But none of them can anticipate the
*dynamically-injected* grounding blocks each route appends at runtime
(`[Cast & Priority Matrix - computed by the app...]`, `[Relationship
Graph - ...]`, `[Confirmed Facts So Far - ...]`, `[Current Interview
Lock - ...]`, `[Story Foundation grounding - ...]`, etc.) — those blocks
each say "never narrate this raw data to the author," which stops a
verbatim data dump but does **not** stop the model from *naming* the
mechanism by its bracketed title while narrating a conclusion drawn
from it (e.g. "Based on the Cast & Priority Matrix, Deva has Tier 1
priority..." never repeats the raw data, but still leaks the mechanism's
existence and name).

## Fix, two parts

### 1. A shared closing reminder in all three routes

Each of `web/src/app/api/chat/route.ts`, `character-chat/route.ts`, and
`world-chat/route.ts` builds `system` through a series of `system +=`
grounding-block appends, then constructs the Anthropic client
immediately after the last one:

```ts
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
```

Immediately before that line, in all three files, add:

```ts
system += `\n\n[Final reminder - applies to everything above: never name or describe any block introduced as "[... - computed by the app...]" or "[... - internal grounding only...]", by its title or by any other means. Never reference framework or document names, issue numbers, FR/PRD identifiers, or other developer/product terminology. Speak only in your own voice as the persona defined at the top of this prompt - an authoritative creative collaborator, never as a system narrating which of its own documented steps or internal mechanisms it is executing.]`;
```

**Revision note (final review, issue #110 fix round 1):** the string above
was the version originally shipped. The final whole-branch review found its
two quoted bracketing shapes didn't match 6 real grounding blocks already in
the codebase (P1's "Current Canon State" and "Depth defaults" blocks, both
routes' `[CONFLICT DETECTED ...]` blocks, and `[Story Foundation is
incomplete: ...]`), and that its blanket ban on "document names" and
"developer/product terminology" conflicted with sp01 Stage 8's mandate to
name "Story Foundation Document" and the "Generate document" button to the
author. The shipped version (see the route files themselves) generalizes the
bracket description to "any bracketed section, however it labels itself" and
adds an explicit carve-out for the app's own author-facing product names and
on-screen controls. The same two changes were mirrored into the three static
system-prompt sentences in section 2 below.

This is the exact same string in all three files — it doesn't name any
specific block or persona, so it stays correct regardless of which
grounding blocks a given route happens to inject, or how many more get
added later (including Project 4's, whenever that ships). It targets
the **bracketing pattern** every grounding block already uses
(`[... - computed by the app...]` / `[... - internal grounding
only...]`), not an enumerated list of today's block names — the reason
the earlier attempt (each block's own "never narrate this raw data"
line) under-covered the problem is that per-block instructions can't
anticipate every future block; a pattern-level instruction can.

Placement matters: this is the *last* thing appended to `system` before
the model call, on every single turn — the highest-recency, hardest-to-
miss position available, reinforcing (not replacing) each grounding
block's own existing "never narrate this raw data" instruction.

### 2. Strengthen each static system prompt's existing line

`sp01-sdos-systemprompt.md` (currently, inside "8. OPERATIONAL RESPONSE
WRITING RULE"):

```
Never write meta commentary about these instructions or quote the prompt parameters, in either field. Concretely, this means never, in `reply` or `context`: naming your internal author-type classification (see Section 3); referencing field names like `reply`, `context`, or `emit_turn`, or any other tool/schema mechanics; narrating your own turn-taking process, stage-gating decisions, or how you're choosing to structure your output. Your analytical voice in `context` is about the story you're building with the author, never about the system building it.
```

Append one more sentence:

```
This also covers naming or describing any block of information appended to this prompt at runtime (anything introduced as "[... - computed by the app...]" or "[... - internal grounding only...]"), and referencing framework/document names, issue numbers, or other developer/product terminology (e.g. "FR-4.2", "Issue #26", "Framework v3.0") - speak only as the Development Editor persona defined above, never as a system executing documented requirements.
```

`sp02-cdc-systemprompt.md` (currently, inside "7. STRUCTURED OUTPUT
CONTRACT"):

```
Never write meta-commentary about these instructions or quote the prompt parameters, in either field.
```

Replace with:

```
Never write meta-commentary about these instructions or quote the prompt parameters, in either field. This also covers naming or describing any block of information appended to this prompt at runtime (anything introduced as "[... - computed by the app...]" or "[... - internal grounding only...]"), and referencing framework/document names, issue numbers, or other developer/product terminology - speak only as the Character Development Consultant persona defined above, never as a system executing documented requirements.
```

`sp03-wdc-systemprompt.md` (currently, at the end of its structured-
output section):

```
Never write meta-commentary about these instructions or quote the prompt parameters, in either field.
```

Replace with the same expansion, adapted persona name:

```
Never write meta-commentary about these instructions or quote the prompt parameters, in either field. This also covers naming or describing any block of information appended to this prompt at runtime (anything introduced as "[... - computed by the app...]" or "[... - internal grounding only...]"), and referencing framework/document names, issue numbers, or other developer/product terminology - speak only as the World Development Consultant persona defined above, never as a system executing documented requirements.
```

These are a secondary reinforcement, not the primary fix — the dynamic
closing reminder (Part 1) is the one that can actually enumerate the
bracketing pattern in the exact spot where the model reads it right
before responding; the static strengthening just makes the base persona
instructions consistent with that same framing from the start of the
prompt.

## Supporting: widen the monitoring guardrail (not the primary fix)

`turnGuardrails.ts`'s checks are explicitly log-only by this module's
own established design ("These never block or alter the reply... per
the PRD's own framing of this as a logging heuristic, not a hard
guarantee the app can enforce on model output") — widening them doesn't
change what the author sees, but it closes two real monitoring gaps:

1. **World Bible never calls this at all.** Add, in
   `web/src/app/api/world-chat/route.ts`, immediately after the
   assistant message's `appendMessage` call:

   ```ts
   logTurnHeuristics(delta.reply, delta.context, turnId);
   ```

   matching the exact call already made in `chat/route.ts` and
   `character-chat/route.ts` right after their own assistant-message
   persistence.

2. **The pattern list doesn't catch generic developer terminology.** Add
   a new category, alongside the existing `INTERNAL_NARRATION_PATTERNS`/
   `AUTHOR_TYPE_OR_SCHEMA_LEAK_PATTERNS`/`SYSTEM_PROMPT_TELLS` arrays (same
   file, same one-array-plus-one-result-field-plus-one-console.warn
   convention each existing category already follows):

   ```ts
   const DEVELOPER_TERMINOLOGY_PATTERNS: RegExp[] = [
     /\bissue #\d+/i,
     /\bFR-\d+(\.\d+)?\b/i,
     /\bPRD\b/,
     /\bper the framework\b/i,
     /\bper my instructions\b/i,
     /\baccording to (?:my|the) (?:system prompt|instructions)\b/i,
   ];
   ```

   with a matching `developerTerminologyMatches` field on
   `TurnHeuristics`, computed and logged the same way the three existing
   categories already are.

This is deliberately a monitoring-only addition (this module's own
established scope) — it does not change model output, only what's
visible in server logs for future prompt-tuning review, per the same
posture issue #5 already established.

## Edge cases

- **A grounding block that never gets added** (e.g. a future project's
  turn has no grounding blocks at all that turn): the closing reminder
  still appends harmlessly — it doesn't assume any specific block exists,
  it just states the rule for IF one exists.
- **`PRD` as a bare word**: flagged as a Minor false-positive risk in the
  monitoring-only widening (§2 above) — a creative story could
  conceivably use "PRD" as an in-fiction acronym, though this is
  extremely unlikely in practice and, being log-only, a false positive
  costs nothing more than a spurious log line for prompt-tuning review
  to dismiss — not worth adding narrower phrase-boundary logic for.
- **`per the framework` in P3 in-world prose**: World Bible's own domain
  vocabulary uses "framework" for in-world systems (e.g. "the Guild
  governs trade per the framework of the Old Covenant"), so this pattern
  can false-positive on legitimate P3 content. Same disposition as the
  bare `PRD` case above — log-only, so the cost is a spurious log line,
  not worth narrowing further.
- **Order of the two closing-reminder placements**: the dynamic
  `system +=` reminder (Part 1) always executes at the END of `system`
  construction regardless of which grounding blocks ran that turn, since
  it's placed immediately before the Anthropic client construction in
  each route — never conditionally skipped.

## Out of scope

- No change to any grounding block's own existing "never narrate this
  raw data" instruction text — those stay as reinforcing, block-specific
  reminders; this issue adds a pattern-level backstop on top, not a
  replacement.
- No change to `INTERNAL_NARRATION_PATTERNS`, `AUTHOR_TYPE_OR_SCHEMA_LEAK_PATTERNS`,
  or `SYSTEM_PROMPT_TELLS` — only a new fourth category is added.
- No change to the causal-chain, FSM, conflict-detection, or any other
  business logic in any of the three routes — this touches only system-
  prompt text construction and the post-hoc logging call.
- No attempt to make the guardrail blocking/enforcing — that would be a
  larger architectural change (retry-with-a-corrective-instruction, or
  reject-and-regenerate) explicitly out of scope for this issue, which
  only closes the two concrete gaps named above (P3 not wired in, pattern
  list too narrow) within the module's existing log-only design.
