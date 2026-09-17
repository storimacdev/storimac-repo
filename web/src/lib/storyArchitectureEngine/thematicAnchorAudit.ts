import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { extractTurn } from "@/lib/canonEngine/extractTurn";
import { STRUCTURAL_STEPS } from "./structuralFramework";
import { getConfirmedUnits, type StructuralUnit } from "./stateLedger";

/**
 * Project 4's Thematic Anchor Audit - GitHub issue #65, PRD §7.6
 * FR-6.5. Mirrors the *pattern* Project 3's Stage 4 System
 * Integration Audit established (worldEngine/stage4Audit.ts, issue
 * #49): deterministic checks + one model-driven semantic judgment,
 * both returned as a findings[] array with a pass/flag status per
 * finding. Not that file's code - P4 has its own data model
 * (StructuralUnit, not CanonElement) and this audit isn't persisted
 * (see the design doc's §4: it resolves within one button-click
 * interaction, not a multi-turn conversational stage that needs to
 * survive a reload).
 */

/** The 6 steps FR-6.5 names as carrying the internal-transformation
 * arc: Step 2 (Thematic Core), 5 (B Story Intro), 6 (Midpoint), 7
 * (All Is Lost), 8 (Break Into 3), 9 (Dig Deep Down/finale).
 * Hardcoded, not derived from STRUCTURAL_STEPS's `type` field - the
 * PRD names these 6 specifically, not "every Set Piece step" (Step 6
 * is a Plot Point, not a Set Piece). */
export const THEMATIC_ANCHOR_STEPS = [2, 5, 6, 7, 8, 9] as const;

export interface ThematicAnchorFinding {
  id: string;
  status: "pass" | "flag";
  detail: string;
}

/**
 * Deterministic half: does each of the 6 anchor steps have at least
 * one Confirmed unit tagged with that stepNumber (issue #56's
 * field)? A step with zero Confirmed content has no internal-
 * transformation beat to contribute - caught for free, no model
 * call needed.
 */
export function checkThematicAnchorCoverage(units: StructuralUnit[]): ThematicAnchorFinding[] {
  const confirmed = getConfirmedUnits(units);
  const findings: ThematicAnchorFinding[] = [];
  for (const stepNumber of THEMATIC_ANCHOR_STEPS) {
    const step = STRUCTURAL_STEPS.find((s) => s.stepNumber === stepNumber);
    const covered = confirmed.some((u) => u.stepNumber === stepNumber);
    if (!covered) {
      findings.push({
        id: `coverage-step-${stepNumber}`,
        status: "flag",
        detail: `Step ${stepNumber} (${step?.title ?? "?"}) has no Confirmed content currently tagged to it - the internal-transformation arc can't be complete without it.`,
      });
    }
  }
  if (findings.length === 0) {
    findings.push({
      id: "coverage-complete",
      status: "pass",
      detail: "Every anchor step (2, 5, 6, 7, 8, 9) has Confirmed content.",
    });
  }
  return findings;
}

const ThematicAnchorConsistencySchema = z.object({
  gap_found: z.boolean(),
  detail: z.string().min(1),
});

const EMIT_THEMATIC_ANCHOR_CONSISTENCY_TOOL: Anthropic.Tool = {
  name: "emit_thematic_anchor_consistency",
  description:
    "Report whether the Confirmed content across Steps 2, 5, 6, 7, 8, and 9 forms a genuinely unbroken internal-transformation arc. Call this exactly once.",
  input_schema: {
    type: "object",
    properties: {
      gap_found: {
        type: "boolean",
        description: "true if there is a genuine thematic/emotional gap in the arc, false if it reads as unbroken.",
      },
      detail: {
        type: "string",
        description: "A specific, concrete explanation either way, naming the steps involved.",
      },
    },
    required: ["gap_found", "detail"],
  },
};

/**
 * Model's job - the same class of judgment Core-Purpose validation
 * and Stage 4's own consistency check already own
 * (developmentLoop.ts's header comment gives the same reasoning for
 * why a deterministic function can't honestly make this call). A
 * single one-shot extractTurn call, not a conversational turn - runs
 * once per compile attempt, not per chat turn, exactly
 * stage4Audit.ts's runConsistencyCheck shape.
 */
export async function runThematicAnchorConsistencyCheck(
  anthropic: Anthropic,
  unitsByStep: Map<number, StructuralUnit[]>
): Promise<ThematicAnchorFinding[]> {
  const stepDescriptions = THEMATIC_ANCHOR_STEPS.map((stepNumber) => {
    const step = STRUCTURAL_STEPS.find((s) => s.stepNumber === stepNumber);
    const stepUnits = unitsByStep.get(stepNumber) ?? [];
    const contentLines = stepUnits.map((u) => `  - ${JSON.stringify(u.content)}`).join("\n");
    return `Step ${stepNumber} (${step?.title ?? "?"}) - Core Purpose: ${step?.corePurpose ?? "?"}\n${contentLines}`;
  }).join("\n\n");

  const result = await extractTurn({
    anthropic,
    model: "claude-sonnet-5",
    system:
      "You are auditing a screenplay's structural outline for its protagonist's internal-transformation arc. Review the Confirmed content across the 6 steps below (in story order) and judge whether it forms a genuinely unbroken emotional/thematic through-line, or whether there's a real gap - not a stylistic opinion, only a genuine break in the arc's logic.",
    messages: [{ role: "user", content: `Confirmed content at each anchor step:\n\n${stepDescriptions}` }],
    tool: EMIT_THEMATIC_ANCHOR_CONSISTENCY_TOOL,
    schema: ThematicAnchorConsistencySchema,
  });

  if (!result.gap_found) {
    return [
      {
        id: "consistency-clean",
        status: "pass",
        detail: "The internal-transformation arc across Steps 2, 5, 6, 7, 8, and 9 reads as unbroken.",
      },
    ];
  }
  return [
    {
      id: "consistency-gap",
      status: "flag",
      detail: result.detail,
    },
  ];
}

export interface ThematicAnchorAuditResult {
  findings: ThematicAnchorFinding[];
  gapFound: boolean;
  generatedAt: string;
}

/**
 * Orchestrator: runs the coverage check first: if it flags anything,
 * returns immediately (gapFound: true, no model call) - a still-
 * incomplete arc has nothing further for the model to usefully
 * judge. Only when coverage is fully clean does it spend the one
 * model call.
 */
export async function runThematicAnchorAudit(
  anthropic: Anthropic,
  units: StructuralUnit[]
): Promise<ThematicAnchorAuditResult> {
  const coverageFindings = checkThematicAnchorCoverage(units);
  const hasCoverageGap = coverageFindings.some((f) => f.status === "flag");

  if (hasCoverageGap) {
    return { findings: coverageFindings, gapFound: true, generatedAt: new Date().toISOString() };
  }

  const confirmed = getConfirmedUnits(units);
  const unitsByStep = new Map<number, StructuralUnit[]>();
  for (const stepNumber of THEMATIC_ANCHOR_STEPS) {
    unitsByStep.set(stepNumber, confirmed.filter((u) => u.stepNumber === stepNumber));
  }

  const consistencyFindings = await runThematicAnchorConsistencyCheck(anthropic, unitsByStep);
  const findings = [...coverageFindings, ...consistencyFindings];
  return {
    findings,
    gapFound: consistencyFindings.some((f) => f.status === "flag"),
    generatedAt: new Date().toISOString(),
  };
}

/** Renders the audit as author-facing summary text - mirrors Stage
 * 4's formatStage4AuditSummary rendering convention. */
export function formatThematicAnchorAuditSummary(audit: ThematicAnchorAuditResult): string {
  const lines: string[] = ["Thematic Anchor Audit:", ""];
  for (const f of audit.findings) {
    lines.push(`${f.status === "pass" ? "✅" : "⚠️"} ${f.detail}`);
  }
  return lines.join("\n");
}
