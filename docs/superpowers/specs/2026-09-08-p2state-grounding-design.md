# Feed P2State Into System-Prompt Grounding (Issue #104) — Design

## Problem

Issue #26 made the app independently compute and persist per-character
stage/status (`Story.p2`), clamping and correcting the model's own claims
rather than trusting them (`characterFsm.ts`'s `resolveCharacterTurn`).
`character-chat/route.ts` already injects a per-turn grounding block for
other app-computed data (the Cast & Priority Matrix, issues #26/#27), but
`p2State` itself was never added to that injection, and the replayed
transcript (`recentMessages`, bounded by `CHARACTER_MESSAGE_WINDOW`) drops
the stored `current_stage` — it only carries `content`/`context`.

Concretely, from the final whole-branch review of #26: "the clamp is real
for persistence but advisory for behavior." After a clamp (the model
claims Stage 6 but the app holds it to Stage 2), the model has no signal
of the correction and keeps interviewing as if it were still at its own
claimed stage, while the UI header displays the lower, app-held stage —
nothing converges them. On session resume, the model also has no way to
know which character the app currently has locked
(`p2State.activeCharacterId`) or which characters are `deferred` vs
`signed_off`.

## Fix: a new grounding block, same convention as Cast & Priority Matrix

Add a block immediately after the existing Cast & Priority Matrix
injection (`character-chat/route.ts`, currently around line 244-245):

```ts
let system = getSystemPrompt("sp02-cdc-systemprompt.md");
system += `\n\n[Cast & Priority Matrix - computed by the app, trust this over re-deriving it. Internal grounding only, never narrate this raw data to the author - synthesize it into your own evaluation.]\n${castLines}`;
```

`p2State` is already computed earlier in the same function (used by the
Cast & Priority Matrix's sibling Relationship Graph block further down),
so no new fetch is needed — this is a pure text-construction addition:

```ts
const activeProgress = p2State.activeCharacterId
  ? p2State.characterProgress[p2State.activeCharacterId]
  : null;
const otherProgressLines = Object.entries(p2State.characterProgress)
  .filter(([id]) => id !== p2State.activeCharacterId)
  .map(([, progress]) => `- ${progress.characterName}: ${progress.status} (Stage ${progress.stage} - ${P2_STAGE_NAMES[progress.stage]})`)
  .join("\n");
system += `\n\n[Current Interview Lock - computed by the app, trust this over your own prior belief or memory of this session. Internal grounding only, never narrate this raw data to the author.]\n${
  activeProgress
    ? `Currently locked to: ${activeProgress.characterName}, Stage ${activeProgress.stage} (${P2_STAGE_NAMES[activeProgress.stage]}).`
    : "No character is currently locked - free to start or resume anyone."
}${otherProgressLines ? `\nOther characters:\n${otherProgressLines}` : ""}`;
```

`P2_STAGE_NAMES` is already imported in this file (from
`characterFsm.ts`, used elsewhere for the switch-override redirect
message), so no new import beyond what's already there.

## Why this satisfies each acceptance criterion

- **"The system prompt for each turn includes the locked character's name
  and app-held stage (not the model's last claimed stage) as internal-only
  grounding, matching the existing 'trust this over re-deriving it'
  framing"**: `activeProgress.stage` is read from `p2State`, the
  post-clamp persisted value — never from anything the model claimed this
  or any prior turn. The phrasing ("computed by the app, trust this over
  your own prior belief") mirrors the Cast & Priority Matrix block's own
  wording convention exactly.
- **"On session resume (or after a clamp), the model's own next-turn
  behavior reflects the app's actual p2State, not its own prior (possibly
  since-corrected) belief"**: this block is rebuilt fresh from `p2State`
  on every single turn (not just the first turn of a session) — a clamp
  that happened on turn N is reflected in the grounding on turn N+1
  automatically, with no separate resume-specific code path needed.
- **"Deferred/signed-off characters' status is visible to the model so it
  doesn't need to re-derive it from replayed chat history alone"**:
  `otherProgressLines` lists every non-active character's `status` (and
  stage) directly from `p2State.characterProgress`, independent of
  whether the bounded `recentMessages` window still contains any mention
  of them.

## Edge cases

- **No character locked yet** (`activeCharacterId: null` — e.g. right
  after the opening turn, or between one character's sign-off and the
  next lock): the block states this explicitly ("No character is
  currently locked...") rather than omitting the block or leaving a
  confusing gap.
- **Only one character has ever been touched, no "others" to list**:
  `otherProgressLines` is an empty string, and the trailing `${... ? ... : ""}`
  ternary means no dangling "Other characters:" header renders with
  nothing under it.
- **A signed-off character who gets re-touched later** (the FSM's
  existing behavior, unrelated to this fix — `resolveCharacterTurn`
  recomputes `status` fresh each turn, so a named signed-off character
  can flip back to `in_progress` if re-locked): the grounding always
  reflects whatever `p2State.characterProgress` currently holds, so it
  stays consistent with the FSM's actual behavior rather than caching a
  stale status.
- **Every character is `deferred` except the active one, and the active
  one's own line is intentionally excluded from `otherProgressLines`**
  (via the `.filter((...) => id !== p2State.activeCharacterId)`) so the
  active character never appears twice — once in the "Currently locked
  to" sentence and again in the "Other characters" list.

## Out of scope

- No change to `resolveCharacterTurn`'s clamp/lock logic itself (issue
  #26, already shipped) or content-based stage-gating (issue #28) — this
  is purely an additive grounding-text change, reading `p2State`, never
  writing it.
- No change to the Cast & Priority Matrix block itself, the Relationship
  Graph block, the Confirmed-facts grounding block, or any other existing
  system-prompt section — this adds one new block, in one new place,
  touching nothing else.
- No change to the switch-override redirect message (`character-chat/route.ts`'s
  existing `redirectReply` construction, which already surfaces
  `P2_STAGE_NAMES[resolution.activeProgress.stage]` to the AUTHOR when a
  turn is blocked) — that's a different, already-correct mechanism for a
  different audience (the author, not the model's internal grounding).
