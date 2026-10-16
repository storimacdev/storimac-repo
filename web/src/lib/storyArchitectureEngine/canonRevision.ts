import { listDependents, WORLD_ELEMENTS_COLLECTION } from "@/lib/canonEngine/canonStore";
import { appendP4CanonRevisionLog, appendOutstandingQuestions, type P4PendingConflict } from "@/lib/canonEngine/storyStore";
import {
  createUnit,
  findUnit,
  upsertUnit,
  setUnitStatus,
  setUnitContent,
  addCanonRefs,
  setUnitStepNumber,
  type StructuralUnit,
} from "./stateLedger";
import { checkSceneRegisterFormat } from "./developmentLoop";

/** Issue #156: a lightweight excerpt, not the full proposed content, so
 * the log entry stays a short record rather than a second copy of the
 * unit ledger. */
const CONTENT_EXCERPT_MAX_CHARS = 200;
function excerptContent(content: string): string {
  return content.length > CONTENT_EXCERPT_MAX_CHARS
    ? `${content.slice(0, CONTENT_EXCERPT_MAX_CHARS)}…`
    : content;
}

/**
 * P4's own Canon Revision Path (issue #64) - a P4-local fork, not a
 * call-through to canonEngine/conflictResolution.ts (issue #10's
 * reference implementation) or worldEngine/conflictResolution.ts
 * (issue #47). Investigated first, following the same "reuse or fork"
 * precedent P2/P3 already established: P4's structural units live in
 * their own StructuralUnit[] array (stateLedger.ts), not in
 * canonEngine/canonStore.ts's generic `elements` collection, so
 * neither existing module's literal functions apply. See the design
 * doc (docs/superpowers/specs/2026-09-15-p4-canon-revision-path-design.md)
 * for the full reasoning, including why Option B never writes into
 * P1/P2/P3's own canon (P4 never has a structured replacement value
 * for another project's canon - only a free-text explanation).
 */

export function buildP4ConflictContextMessage(conflict: P4PendingConflict): string {
  const description =
    conflict.kind === "unit_regression"
      ? conflict.requestedStatus === "Confirmed"
        // Issue #154: isValidTransition(Confirmed, Confirmed) is true, so
        // this trigger also fires for a content-only rewrite of an
        // already-Confirmed unit that keeps requesting Confirmed - not
        // just an actual status regression. requestedStatus is always
        // "Confirmed" for that case (a genuine regression's
        // requestedStatus can only ever be Exploring or Working, since
        // Confirmed -> Parked is itself a valid, ungated transition) -
        // branch on it rather than carrying a second discriminating field.
        ? `Unit "${conflict.unitId}" is already Confirmed, and the latest proposal would rewrite its content while keeping it Confirmed - a content change to an already-Confirmed unit needs this Canon Revision Path too, not just a status change.`
        : `Unit "${conflict.unitId}" is already Confirmed, but the latest proposal would move it back to ${conflict.requestedStatus} - that is not a plain revision, it needs this Canon Revision Path.`
      : `The proposed content for unit "${conflict.unitId}" contradicts already-locked ${conflict.sourceProject} canon ("${conflict.contradictedRef}"): ${conflict.explanation}`;
  // Final whole-branch review finding I2 (issue #64), kept in sync with
  // gatesPassed's own multi-way check as later issues extended it
  // (#66 added the format check, #169 added the stepNumber check -
  // this review's own I2 was originally filed because this string had
  // fallen out of sync with the boolean it describes, naming only 2 of
  // the then-3 checks, so keep the enumeration below matching
  // gatesPassed's actual check set exactly) - disclose the waiver up
  // front rather than letting the author accept something they'd
  // reasonably assume is now Confirmed. Only ever true for
  // canon_contradiction - unit_regression's requestedStatus can never
  // be Confirmed.
  const waiverNote =
    conflict.kind === "canon_contradiction" && !conflict.gatesPassed
      ? " Note: this unit's proposed content did not pass Core-Purpose validation, the causality check, the Scene Register format check, or the structural-step requirement when this was raised - accepting it will not mark it Confirmed, it will land at Working until it separately satisfies those checks on a later turn."
      : "";
  return `\n\n[CANON REVISION PATH - internal grounding only, never narrate this raw data to the author. ${description}${waiverNote} Present the author with exactly three choices in your reply, in your own words: (A) Revert the proposal and keep things as they are, (B) Accept the new idea as the correct one going forward - note clearly that the author will need to make the matching edit on the referenced project's own screen separately, this app will not do it for them, (C) Park the idea for later, logged as an outstanding decision. Once the author clearly picks one, set resolution to "revert", "accept_and_update", or "park" on your next structured output - do not develop any other structural content until this is resolved.]`;
}

export interface P4CascadeReviewEntry {
  id: string;
  description: string;
}

export interface ResolveP4ConflictParams {
  storyId: string;
  conflict: P4PendingConflict;
  resolution: "revert" | "accept_and_update" | "park";
  turnId: string;
  resolvedBy: string;
  units: StructuralUnit[];
  /** The resolving turn's active_step_number (issue #56 final review) -
   * only ever tags the unit when non-null, same rule the ordinary-
   * processing path in architecture-chat/route.ts already follows.
   * Without this, every unit resolved through this path counted
   * toward the Scene Density Monitor's numerator with no
   * representation in its step-coverage denominator, biasing every
   * projection upward. */
  activeStepNumber: number | null;
}

export interface ResolveP4ConflictResult {
  units: StructuralUnit[];
  cascadeReview: P4CascadeReviewEntry[] | null;
}

/**
 * Applies the author's resolution choice. "accept_and_update" bypasses
 * attemptStatusTransition/evaluateCausalGate entirely and writes the
 * unit directly via stateLedger.ts's plain updaters - the author has
 * now explicitly authorized this, past the point of the automatic
 * gates, mirroring canonStore.ts's own allowConfirmedOverride
 * precedent. Never writes into P1/P2/P3's own canon for any source -
 * the log entry is the durable record. For a Project-3-sourced
 * contradiction only, surfaces an informational (never written)
 * dependents list via canonStore.ts's existing listDependents, whose
 * own comment already names this exact future use. Also scans P4's
 * OWN units for any other unit citing the same contradicted
 * reference - a cheap, P4-internal cascade check; a full cross-project
 * cascade is issue #72's scope, not this one's.
 */
export async function resolveP4Conflict(params: ResolveP4ConflictParams): Promise<ResolveP4ConflictResult> {
  const { storyId, conflict, resolution, turnId, resolvedBy, units, activeStepNumber } = params;
  const existing = findUnit(units, conflict.unitId);
  let updatedUnits = units;
  let cascadeReview: P4CascadeReviewEntry[] | null = null;

  if (resolution === "park") {
    // Same existing-or-create fallback as accept_and_update below - a
    // canon_contradiction can fire on a unit that never existed in the
    // ledger before (Task 1 review's own finding: the brief's first
    // draft only handled `existing`, silently no-opping "park" for a
    // brand-new idea and leaving no Parked unit for the author to see,
    // even though the issue's own AC literally requires one - "(C) Park
    // the idea (Parked status, logged to Outstanding Decisions)").
    // Final whole-branch review finding M2: the idea being parked has
    // real content (conflict.requestedContent) - a Parked unit with no
    // content behind it would show up in the compiled document as an
    // empty shell, and the original proposal would survive nowhere.
    const base = existing ?? createUnit(conflict.unitId, conflict.type);
    const contentApplied = setUnitContent(base, conflict.requestedContent);
    const withContent = activeStepNumber !== null ? setUnitStepNumber(contentApplied, activeStepNumber) : contentApplied;
    updatedUnits = upsertUnit(units, setUnitStatus(withContent, "Parked"));
  } else if (resolution === "accept_and_update") {
    const base = existing ?? createUnit(conflict.unitId, conflict.type);
    const contentApplied = addCanonRefs(setUnitContent(base, conflict.requestedContent), conflict.requestedCanonRefs);
    const withContent = activeStepNumber !== null ? setUnitStepNumber(contentApplied, activeStepNumber) : contentApplied;
    // Final whole-branch review finding I2: the author's "accept the new
    // idea" authorizes overriding the OTHER project's canon (via the log
    // below) and this app's own lifecycle guard - it does not waive
    // #63's causal gate or #111's Core-Purpose gate. Clamp down to
    // Working when the triggering turn never actually passed those,
    // rather than letting a coincidence-driven or Core-Purpose-failing
    // proposal reach Confirmed canon just because the author accepted
    // the CANON side of the conflict. Only applies to canon_contradiction,
    // which is the only kind that carries a gatesPassed snapshot - plain
    // unit_regression conflicts (status regression, or issue #154's
    // content-only Confirmed rewrite) carry no such snapshot, since
    // accept_and_update is accepted as author-authorized override
    // territory for those, same as this codebase's own allowConfirmedOverride
    // precedent (canonStore.ts) takes no independent re-validation either.
    let finalStatus: typeof conflict.requestedStatus =
      conflict.kind === "canon_contradiction" && !conflict.gatesPassed && conflict.requestedStatus === "Confirmed"
        ? "Working"
        : conflict.requestedStatus;
    // Issue #164: Scene Register format is a baseline bar for Working as
    // well as Confirmed ("a Working (provisional) entry should already
    // look like a real, formatted scene," per the design spec) - the
    // clamp above only ever looks at format when requestedStatus is
    // Confirmed (folded into gatesPassed), so a canon_contradiction with
    // gatesPassed: false requesting Working directly, or any
    // unit_regression (a genuine Confirmed -> Working regression, or
    // issue #154's Confirmed content rewrite) previously reached Working
    // with no format check of its own. Re-checked fresh against the
    // actual content being written here - not reused from
    // conflict.gatesPassed, which only exists for canon_contradiction and
    // combines causal/core/format into one boolean - so this covers
    // unit_regression too. Cascades Confirmed -> Working -> Exploring
    // (two sequential checks, not mutually exclusive) so a
    // still-malformed Working candidate keeps falling back rather than
    // resting one level above where the ordinary processing path would
    // ever allow it.
    const formatCheck = checkSceneRegisterFormat(conflict.requestedContent);
    if (!formatCheck.ok && finalStatus === "Confirmed") finalStatus = "Working";
    if (!formatCheck.ok && finalStatus === "Working") finalStatus = "Exploring";
    const finalUnit = setUnitStatus(withContent, finalStatus);
    updatedUnits = upsertUnit(units, finalUnit);

    if (conflict.kind === "canon_contradiction") {
      const p4Entries: P4CascadeReviewEntry[] = updatedUnits
        .filter((u) => u.unitId !== conflict.unitId && u.canonRefs.includes(conflict.contradictedRef))
        .map((u) => ({ id: u.unitId, description: `Another structural unit (${u.type}) in this screenplay that also cites this reference.` }));

      let p3Entries: P4CascadeReviewEntry[] = [];
      if (conflict.sourceProject === "Project 3") {
        const dependents = await listDependents(storyId, conflict.contradictedRef, WORLD_ELEMENTS_COLLECTION);
        p3Entries = dependents
          .filter((e) => e.status === "Confirmed")
          .map((e) => ({ id: e.element_id, description: "Confirmed World Bible element that currently depends on this pillar." }));
      }

      cascadeReview = [...p3Entries, ...p4Entries];
    }
  }
  // "revert" needs no unit write beyond the log below - it keeps existing state untouched by definition.

  // Final whole-branch review finding I3: the design spec and the
  // grounding text both promise a "park" is "logged as an outstanding
  // decision" - appendP4CanonRevisionLog alone has no reader anywhere,
  // so without this the promise was never kept. Also covers
  // accept_and_update, mirroring worldEngine/conflictResolution.ts's
  // own precedent (issue #47's "revise" on a foundation-kind conflict
  // gets the same treatment, for the same reason: the referenced canon
  // is unchanged, so a durable, visible record matters most here too).
  // Same disclosed limitation that module's own header comment already
  // states: this doesn't by itself stop the model from re-flagging the
  // same already-resolved contradiction on a later turn (the grounding
  // block doesn't carry prior resolutions) - full re-trigger prevention
  // is a follow-up, not this issue's scope. "revert" gets no entry -
  // it keeps existing state untouched by definition, nothing to record.
  if (resolution === "park" || resolution === "accept_and_update") {
    await appendOutstandingQuestions(storyId, [
      {
        item:
          conflict.kind === "unit_regression"
            ? conflict.requestedStatus === "Confirmed"
              ? `Unit "${conflict.unitId}" - a content rewrite of this already-Confirmed unit was ${resolution === "park" ? "parked" : "accepted"} via the Canon Revision Path`
              : `Unit "${conflict.unitId}" - status regression ${resolution === "park" ? "parked" : "accepted"} via the Canon Revision Path`
            : `Unit "${conflict.unitId}" - canon contradiction with ${conflict.sourceProject} ${resolution === "park" ? "parked" : "accepted"} via the Canon Revision Path: ${conflict.explanation}`,
        defer_to: null,
        notes:
          resolution === "accept_and_update"
            ? "The referenced canon is unchanged - the author must make the matching edit on that project's own screen."
            : "Parked for later.",
      },
    ]);
  }

  await appendP4CanonRevisionLog(storyId, {
    kind: conflict.kind,
    unitId: conflict.unitId,
    description:
      conflict.kind === "unit_regression"
        ? conflict.requestedStatus === "Confirmed"
          // Issue #154's content-only rewrite case - see
          // buildP4ConflictContextMessage's own comment on why
          // requestedStatus === "Confirmed" uniquely identifies it.
          ? `Unit "${conflict.unitId}" - a content rewrite was proposed for this already-Confirmed unit`
          : `Unit "${conflict.unitId}" attempted regression to ${conflict.requestedStatus}`
        : `Unit "${conflict.unitId}" contradicted ${conflict.sourceProject} canon "${conflict.contradictedRef}"`,
    // Firestore rejects an explicit `undefined` field value unless
    // ignoreUndefinedProperties is set (it isn't, repo-wide) - a
    // conditional spread, matching worldEngine/conflictResolution.ts's
    // own fix for the exact same hazard (final whole-branch review
    // finding C1 there).
    ...(conflict.kind === "canon_contradiction"
      ? { sourceProject: conflict.sourceProject, contradictedRef: conflict.contradictedRef, explanation: conflict.explanation }
      : {}),
    // Issue #156: the AC asks for "resolution choice AND rationale" -
    // requestedStatus/contentExcerpt give a future reader enough to see
    // what was actually being proposed, not just which of the three
    // choices the author picked.
    requestedStatus: conflict.requestedStatus,
    contentExcerpt: excerptContent(conflict.requestedContent),
    resolution,
    resolvedBy,
    ts: new Date().toISOString(),
    turnId,
  });

  return { units: updatedUnits, cascadeReview };
}
