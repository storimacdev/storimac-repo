import type { CanonStatus } from "@/lib/canonEngine/types";

/**
 * The state ledger for Project 4's structural units — GitHub issue #62,
 * PRD §7.6 FR-6.1/FR-6.2, §9's `session_state.json` `units[]` shape.
 * Pure, in-memory, immutable-update functions - no Firestore, no LLM
 * call (P4 session state is in-memory only for this phase; persistence
 * is issue #69). `causalTag` exists per §9's shape but is never computed
 * or validated here - that's issue #63 (Causality Validation).
 */

export type StructuralUnitType = "Scene" | "Sequence" | "SetPiece" | "PlotPoint";
export type CausalTag = "Therefore" | "But" | "UNVALIDATED";

export interface StructuralUnit {
  unitId: string;
  type: StructuralUnitType;
  status: CanonStatus;
  content: unknown;
  causalTag: CausalTag;
  canonRefs: string[];
  lastUpdated: string;
}

function nowOrDefault(now?: string): string {
  return now ?? new Date().toISOString();
}

/** A brand-new unit starts `Exploring`, matching the same "every new
 * thing starts Exploring" convention Projects 1-3 already use. */
export function createUnit(unitId: string, type: StructuralUnitType, now?: string): StructuralUnit {
  return {
    unitId,
    type,
    status: "Exploring",
    content: null,
    causalTag: "UNVALIDATED",
    canonRefs: [],
    lastUpdated: nowOrDefault(now),
  };
}

export function setUnitStatus(unit: StructuralUnit, status: CanonStatus, now?: string): StructuralUnit {
  return { ...unit, status, lastUpdated: nowOrDefault(now) };
}

export function setUnitContent(unit: StructuralUnit, content: unknown, now?: string): StructuralUnit {
  return { ...unit, content, lastUpdated: nowOrDefault(now) };
}

/** Appends and de-duplicates - `canonRefs` is a set of justifications,
 * not a log of every time one was cited. */
export function addCanonRefs(unit: StructuralUnit, refs: string[], now?: string): StructuralUnit {
  return {
    ...unit,
    canonRefs: Array.from(new Set([...unit.canonRefs, ...refs])),
    lastUpdated: nowOrDefault(now),
  };
}

/** Replaces the array entry whose `unitId` matches, or appends if none
 * does - the one array-level operation a caller needs to maintain a
 * `StructuralUnit[]` session ledger immutably, turn by turn. */
export function upsertUnit(units: StructuralUnit[], unit: StructuralUnit): StructuralUnit[] {
  const index = units.findIndex((u) => u.unitId === unit.unitId);
  if (index === -1) {
    return [...units, unit];
  }
  return units.map((u, i) => (i === index ? unit : u));
}

export function findUnit(units: StructuralUnit[], unitId: string): StructuralUnit | null {
  return units.find((u) => u.unitId === unitId) ?? null;
}

/** AC2: only `Confirmed` units are eligible for a compiled document's
 * binding sections - a future compiler (issue #60) calls this instead
 * of re-deriving the Confirmed-only rule itself. */
export function getConfirmedUnits(units: StructuralUnit[]): StructuralUnit[] {
  return units.filter((u) => u.status === "Confirmed");
}
