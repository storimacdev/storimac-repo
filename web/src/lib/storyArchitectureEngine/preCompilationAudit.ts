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
      // "unit(s)" not "scene(s)" - a Confirmed unit may be typed Scene,
      // Sequence, SetPiece, or PlotPoint, matching
      // compileArchitectureDocument.ts's own identical hedge on this
      // same count.
      detail: `${count} Confirmed unit(s) - outside the ${MIN_TARGET_SCENES}-${MAX_TARGET_SCENES} scene target range.`,
    };
  }
  return {
    id: "scale",
    status: "pass",
    detail: `${count} Confirmed unit(s) - within the ${MIN_TARGET_SCENES}-${MAX_TARGET_SCENES} scene target range.`,
  };
}

/** Earmark Check: all of the Critical Beat tags (issue #58) appear
 * somewhere in the Confirmed Scene Register. Reuses the exact same
 * regex checkSceneRegisterFormat already validates a tag's value
 * against, applied per-unit and collected into a set. Complementary
 * to, not in tension with, issue #66's own deliberate choice not to
 * require a beat tag on every individual scene (the app has no
 * reliable way to know a given scene SHOULD carry one) - #66 governs
 * per-scene tag VALUE at write time; this governs aggregate coverage
 * across the whole Confirmed set, once, at compile time, when the
 * author is asserting the outline is done. An author still deciding
 * gets a one-click "Compile anyway" override, not a hard block. */
export function checkEarmark(units: StructuralUnit[]): PreCompilationCheckFinding {
  const confirmed = getConfirmedUnits(units);
  const foundTags = new Set<string>();
  // Final whole-branch review finding: CRITICAL_BEAT_TAG_PATTERN is
  // non-global (checkSceneRegisterFormat needs its capture group, which
  // a global regex would drop), so a unit carrying two beat tags would
  // otherwise only contribute its first. A local global clone here
  // finds every tag per unit without touching the shared export.
  const globalBeatTagPattern = new RegExp(CRITICAL_BEAT_TAG_PATTERN.source, "gi");
  for (const unit of confirmed) {
    const content = typeof unit.content === "string" ? unit.content : "";
    for (const match of content.matchAll(globalBeatTagPattern)) {
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
      detail: `${missing.length} of ${Object.keys(CRITICAL_BEAT_LOOKUP).length} Critical Beats not yet tagged in any Confirmed scene: ${missing.join(", ")}.`,
    };
  }
  return {
    id: "earmark",
    status: "pass",
    detail: `All ${Object.keys(CRITICAL_BEAT_LOOKUP).length} Critical Beats are tagged in the Confirmed Scene Register.`,
  };
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
