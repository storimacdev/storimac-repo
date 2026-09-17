import type { StructuralUnit } from "./stateLedger";

/**
 * The Dynamic Scene Density & Pacing Monitor - GitHub issue #56,
 * Screenplay Structural Architecture Framework v3.0 §2. Strictly
 * advisory: never called from anywhere near `combinedValid`/
 * `attemptStatusTransition`, and has no effect on any status
 * transition. See docs/superpowers/specs/2026-09-17-p4-scene-density-
 * monitor-design.md for why trajectory is measured by step coverage
 * rather than by `proposed_position_percent` or step-number order -
 * the framework's own recommended default routing (Blueprint Priority)
 * develops steps out of numeric order (Frame -> Final Image -> Spark ->
 * Midpoint first), so neither a linear percent nor step order is a
 * safe progress proxy.
 */

export const MIN_TARGET_SCENES = 75;
export const MAX_TARGET_SCENES = 150;

/** Below this many distinct touched steps, a projection would be
 * extrapolating off too small a sample (e.g. one unusually dense Set
 * Piece step alone isn't representative of the other nine) - no
 * alert is computed at all until this floor is met. A chosen default,
 * not a sourced one, matching this codebase's own "never invent an
 * unspecified rule silently" convention (developmentLoop.ts's
 * DEVIATION_THRESHOLD_PERCENT is the same class of choice). */
const MIN_STEPS_FOR_PROJECTION = 2;

export interface SceneDensityReading {
  count: number;
  projectedTotal: number | null;
  rawAlert: "under" | "over" | null;
}

export interface SceneDensityDismissal {
  under: boolean;
  over: boolean;
}

export interface SceneDensityResult extends SceneDensityReading {
  alert: "under" | "over" | null;
}

export const DEFAULT_SCENE_DENSITY_DISMISSAL: SceneDensityDismissal = { under: false, over: false };

/**
 * `count`: units with status Working or Confirmed. `stepsWithContent`:
 * how many distinct 1-10 stepNumbers appear among those same counted
 * units (never among Exploring/Parked ones). This assumes roughly
 * uniform scene density across the 10 steps, which isn't literally
 * true (Step 9's 5-phase finale is denser than a single Plot Point
 * step) - a disclosed approximation, same class as
 * checkPlacementDeviation's percent-parsing and
 * checkSceneRegisterFormat's sentence-counting.
 */
export function computeSceneDensity(units: StructuralUnit[]): SceneDensityReading {
  const counted = units.filter((u) => u.status === "Working" || u.status === "Confirmed");
  const count = counted.length;
  const stepsWithContent = new Set(
    counted.map((u) => u.stepNumber).filter((n): n is number => n !== null)
  ).size;

  if (stepsWithContent < MIN_STEPS_FOR_PROJECTION) {
    return { count, projectedTotal: null, rawAlert: null };
  }

  const projectedTotal = Math.round(count / (stepsWithContent / 10));
  const rawAlert: "under" | "over" | null =
    projectedTotal < MIN_TARGET_SCENES ? "under" : projectedTotal > MAX_TARGET_SCENES ? "over" : null;

  return { count, projectedTotal, rawAlert };
}

/** Display logic: a direction the author has already dismissed is
 * suppressed even though the raw condition is still true. Callable
 * from a read-only context (the canvas GET route) as well as the
 * write path (architecture-chat/route.ts), so threshold math never
 * has to be duplicated between them. */
export function applySceneDensityDismissal(
  reading: SceneDensityReading,
  dismissal: SceneDensityDismissal
): SceneDensityResult {
  const alert = reading.rawAlert !== null && dismissal[reading.rawAlert] ? null : reading.rawAlert;
  return { ...reading, alert };
}

/** The dismissal state to persist going forward: a direction stays
 * dismissed only while its own condition remains true. The moment
 * `rawAlert` is no longer "under" (whether it cleared entirely or
 * flipped to "over"), `under`'s dismissal resets to false - so a
 * later recurrence of the SAME direction surfaces fresh rather than
 * staying permanently suppressed by an old click. Only
 * architecture-chat/route.ts calls this (it is the sole writer of
 * `p4SceneDensityDismissal` besides the explicit dismiss route). */
export function nextSceneDensityDismissal(
  reading: SceneDensityReading,
  dismissal: SceneDensityDismissal
): SceneDensityDismissal {
  return {
    under: reading.rawAlert === "under" ? dismissal.under : false,
    over: reading.rawAlert === "over" ? dismissal.over : false,
  };
}
