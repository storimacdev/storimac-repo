import type { StructuralUnit } from "./stateLedger";

/**
 * P4's Setup & Payoff Ledger - GitHub issue #173. Mirrors
 * developmentLoop.ts's [CRITICAL BEAT: X] tag convention (issue #66)
 * for the TAGGING mechanism only - [SETUP: name]/[PAYOFF: name] live
 * in the same StructuralUnit.content strings, parsed by regex, no new
 * storage. Unlike Critical Beats, setup/payoff names have no fixed
 * catalog to validate against (free text, author-invented per story),
 * so this module never hard-gates a transition - see
 * docs/superpowers/specs/2026-10-16-p4-setup-payoff-ledger-design.md
 * §1 for why. Standalone module (not developmentLoop.ts, which is
 * scoped to turn-level checks; not compileArchitectureDocument.ts,
 * which is scoped to the final document) - same "single-concern pure
 * module over StructuralUnit[]" shape as sceneDensity.ts.
 */

export const SETUP_TAG_PATTERN = /\[SETUP:\s*([^\]]+)\]/gi;
export const PAYOFF_TAG_PATTERN = /\[PAYOFF:\s*([^\]]+)\]/gi;

export interface ParsedSetupPayoffTags {
  setupNames: string[];
  payoffNames: string[];
}

function extractTagNames(content: string, pattern: RegExp): string[] {
  // Local clone, even though both exported patterns are already global -
  // matchAll requires a global regex, and re-using the exported one
  // directly across repeated calls risks lastIndex bugs if a future
  // caller ever switches to .exec/.test on the same shared instance.
  // Cheap insurance, same defensive posture preCompilationAudit.ts's own
  // "local global clone, never mutate the shared export" comment
  // documents for CRITICAL_BEAT_TAG_PATTERN.
  const global = new RegExp(pattern.source, pattern.flags);
  const names: string[] = [];
  for (const match of content.matchAll(global)) {
    const name = match[1].trim();
    if (name && !names.some((n) => n.toLowerCase() === name.toLowerCase())) {
      names.push(name);
    }
  }
  return names;
}

/** Extracts every [SETUP: name]/[PAYOFF: name] tag from one unit's
 * content, trimmed, original casing preserved, de-duplicated
 * case-insensitively within this single unit. Never throws - absence
 * of either tag type is the normal case for most scenes. */
export function parseSetupPayoffTags(content: string): ParsedSetupPayoffTags {
  return {
    setupNames: extractTagNames(content, SETUP_TAG_PATTERN),
    payoffNames: extractTagNames(content, PAYOFF_TAG_PATTERN),
  };
}

export interface SetupPayoffLedgerLocation {
  unitId: string;
  sceneNumber: number | null;
  slugline: string | null;
}

export interface SetupPayoffLedgerEntry {
  name: string;
  planted: SetupPayoffLedgerLocation | null;
  paidOff: SetupPayoffLedgerLocation | null;
}

export interface SetupPayoffSourceEntry {
  unitId: string;
  content: string;
  sceneNumber?: number | null;
  slugline?: string | null;
}

/**
 * Builds the ledger from an ORDERED list of entries - ledger order is
 * the caller's own concept of order (Section 4's Confirmed-only Scene
 * Register order at compile time; plain units[] order during
 * development, where no Scene Register ordering exists yet). Groups
 * by case-insensitive, trimmed name. For each distinct name, `planted`
 * is the FIRST entry carrying a [SETUP: name] tag and `paidOff` is the
 * FIRST entry carrying a [PAYOFF: name] tag for that same name -
 * "first occurrence wins" is a disclosed simplification (a setup
 * re-planted, or paid off more than once, degrades to its first
 * occurrence rather than crashing or fabricating a resolution - see
 * the design spec's "Out of scope" section), not a silently wrong
 * answer. Entries are returned in order of each name's first
 * appearance (whichever tag type - setup or payoff - names it first).
 */
export function buildSetupPayoffLedger(entries: SetupPayoffSourceEntry[]): SetupPayoffLedgerEntry[] {
  const byKey = new Map<string, SetupPayoffLedgerEntry>();
  const order: string[] = [];

  function locationOf(entry: SetupPayoffSourceEntry): SetupPayoffLedgerLocation {
    return {
      unitId: entry.unitId,
      sceneNumber: entry.sceneNumber ?? null,
      slugline: entry.slugline ?? null,
    };
  }

  function ensureEntry(name: string): SetupPayoffLedgerEntry {
    const key = name.toLowerCase();
    const existing = byKey.get(key);
    if (existing) return existing;
    const created: SetupPayoffLedgerEntry = { name, planted: null, paidOff: null };
    byKey.set(key, created);
    order.push(key);
    return created;
  }

  for (const entry of entries) {
    const { setupNames, payoffNames } = parseSetupPayoffTags(entry.content);
    for (const name of setupNames) {
      const ledgerEntry = ensureEntry(name);
      if (!ledgerEntry.planted) ledgerEntry.planted = locationOf(entry);
    }
    for (const name of payoffNames) {
      const ledgerEntry = ensureEntry(name);
      if (!ledgerEntry.paidOff) ledgerEntry.paidOff = locationOf(entry);
    }
  }

  return order.map((key) => byKey.get(key)!);
}

export interface SetupPayoffAdvisory {
  danglingSetups: string[];
  orphanedPayoffs: string[];
}

/** Pure derived summary for development-time surfacing (design spec
 * §3) - strictly advisory, computed fresh every call, nothing here is
 * persisted or dismissible: a dangling setup is normal mid-development
 * state, not an alert the author needs to acknowledge once and never
 * see again (unlike sceneDensity.ts's own dismissible pacing alert). */
export function summarizeSetupPayoffAdvisory(ledger: SetupPayoffLedgerEntry[]): SetupPayoffAdvisory {
  return {
    danglingSetups: ledger.filter((e) => e.planted && !e.paidOff).map((e) => e.name),
    orphanedPayoffs: ledger.filter((e) => !e.planted && e.paidOff).map((e) => e.name),
  };
}

/** Convenience wrapper for development-time callers
 * (architecture-chat/route.ts, the canvas resume route) - builds
 * source entries directly from a StructuralUnit[] with no scene-number
 * concept (none exists pre-compile), scanning Working+Confirmed units
 * only, matching sceneDensity.ts's own "counted" set exactly (a
 * Working scene's tags are real author intent worth surfacing early,
 * not just Confirmed ones; Exploring/Parked content is too provisional
 * to surface as a dangling setup). */
export function computeSetupPayoffAdvisory(units: StructuralUnit[]): SetupPayoffAdvisory {
  const relevant = units.filter((u) => u.status === "Working" || u.status === "Confirmed");
  const entries: SetupPayoffSourceEntry[] = relevant.map((u) => ({
    unitId: u.unitId,
    content: typeof u.content === "string" ? u.content : "",
  }));
  return summarizeSetupPayoffAdvisory(buildSetupPayoffLedger(entries));
}
