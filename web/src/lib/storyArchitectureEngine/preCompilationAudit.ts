import { CRITICAL_BEAT_LOOKUP } from "./structuralFramework";
import { checkSceneRegisterFormat, CRITICAL_BEAT_TAG_PATTERN } from "./developmentLoop";
import { MIN_TARGET_SCENES, MAX_TARGET_SCENES } from "./sceneDensity";
import { getConfirmedUnits, type StructuralUnit } from "./stateLedger";

/**
 * Project 4's Pre-Compilation Audit - GitHub issue #91, Screenplay
 * Structural Architecture Framework v3.0 §6. Distinct from issue
 * #65's Thematic Anchor Audit (which checks the internal-
 * transformation arc via one model call) - all three checks here
 * are fully deterministic, reusing existing infrastructure directly
 * rather than re-implementing any of it: issue #56's scene-count
 * constants, issue #66's format checker, issue #58's Critical Beat
 * lookup. Every check operates on Confirmed units only - what will
 * actually appear in the compiled document.
 */

export interface PreCompilationCheckFinding {
  id: string;
  status: "pass" | "flag";
  detail: string;
}

/** Scale Check: total Confirmed scene count within the 75-150
 * target range. Unlike issue #56's own advisory monitor (which
 * counts Working+Confirmed and projects a trajectory mid-
 * development), this is a simple, un-projected count of Confirmed
 * units only, checked once the outline is considered complete. */
export function checkScale(units: StructuralUnit[]): PreCompilationCheckFinding {
  const count = getConfirmedUnits(units).length;
  if (count < MIN_TARGET_SCENES || count > MAX_TARGET_SCENES) {
    return {
      id: "scale",
      status: "flag",
      detail: `${count} Confirmed scene(s) - outside the ${MIN_TARGET_SCENES}-${MAX_TARGET_SCENES} scene target range.`,
    };
  }
  return {
    id: "scale",
    status: "pass",
    detail: `${count} Confirmed scenes - within the ${MIN_TARGET_SCENES}-${MAX_TARGET_SCENES} scene target range.`,
  };
}

/** Earmark Check: all 10 Critical Beat tags (issue #58) appear
 * somewhere in the Confirmed Scene Register. Reuses the exact same
 * regex checkSceneRegisterFormat already validates a tag's value
 * against, applied per-unit and collected into a set. */
export function checkEarmark(units: StructuralUnit[]): PreCompilationCheckFinding {
  const confirmed = getConfirmedUnits(units);
  const foundTags = new Set<string>();
  for (const unit of confirmed) {
    const content = typeof unit.content === "string" ? unit.content : "";
    const match = content.match(CRITICAL_BEAT_TAG_PATTERN);
    if (match) {
      const tagName = match[1].trim().toUpperCase();
      if (CRITICAL_BEAT_LOOKUP[tagName]) {
        foundTags.add(tagName);
      }
    }
  }
  const missing = Object.keys(CRITICAL_BEAT_LOOKUP).filter((tag) => !foundTags.has(tag));
  if (missing.length > 0) {
    return {
      id: "earmark",
      status: "flag",
      detail: `${missing.length} of 10 Critical Beats not yet tagged in any Confirmed scene: ${missing.join(", ")}.`,
    };
  }
  return { id: "earmark", status: "pass", detail: "All 10 Critical Beats are tagged in the Confirmed Scene Register." };
}

/** Formatting Check: every Confirmed scene has a standard slugline
 * and exactly one explanatory paragraph. In ordinary operation this
 * should nearly always pass - checkSceneRegisterFormat already
 * gates every Working/Confirmed transition before it happens - but
 * this is a genuine backstop against Confirmed content that
 * predates issue #66, matching issue #56's own precedent of
 * treating "content that predates a later-added check" as a real
 * case, not a hypothetical one. */
export function checkFormatting(units: StructuralUnit[]): PreCompilationCheckFinding {
  const confirmed = getConfirmedUnits(units);
  const failing: string[] = [];
  for (const unit of confirmed) {
    const content = typeof unit.content === "string" ? unit.content : "";
    const result = checkSceneRegisterFormat(content);
    if (!result.ok) {
      failing.push(`${unit.unitId} (${result.reason ?? "malformed"})`);
    }
  }
  if (failing.length > 0) {
    return {
      id: "formatting",
      status: "flag",
      detail: `${failing.length} Confirmed scene(s) fail formatting: ${failing.join("; ")}.`,
    };
  }
  return {
    id: "formatting",
    status: "pass",
    detail: "Every Confirmed scene has a standard slugline and exactly one explanatory paragraph.",
  };
}

export interface PreCompilationAuditResult {
  findings: PreCompilationCheckFinding[];
  failed: boolean;
}

export function runPreCompilationAudit(units: StructuralUnit[]): PreCompilationAuditResult {
  const findings = [checkScale(units), checkEarmark(units), checkFormatting(units)];
  return { findings, failed: findings.some((f) => f.status === "flag") };
}
