import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * The live P5 agent's structured turn output — GitHub issues #93 (Phase
 * 1 fields) and #94 (Phase 2 fields), extended incrementally by later
 * issues, mirroring how architectureTurnSchema.ts grew across issues
 * #56/#63/#64/#66. Mirrors that file's Zod-schema/Anthropic.Tool
 * pairing convention exactly: every field exists identically in both.
 *
 * QA/delivery, revision classification, and conflict-intercept fields
 * are added by their own issues' PRs.
 */

export const ScreenplayTurnSchema = z.object({
  reply: z.string().min(1),
  context: z.string().min(1),
  /** Which scene this turn's work concerns. Null only before the
   * author/model has settled on a first scene to work on. */
  scene_number: z.number().int().min(1).nullable(),
  phase: z.enum(["assignment_gate", "drafting", "qa_delivery", "revision"]).nullable(),
  /** The Phase 1 one-paragraph summary proposed this turn, or null if
   * none is being proposed (e.g. still waiting on sign-off from a prior
   * turn, or mid-drafting). */
  proposed_assignment_summary: z.string().min(1).nullable(),
  /** True only on the turn where the author's message is being
   * interpreted as explicit sign-off on the currently pending
   * assignment summary (issue #93 AC4). Never true any other turn. */
  assignment_sign_off: z.boolean(),
  /** Phase 2 (issue #94): the full scene drafted this turn, in plain-text
   * industry screenplay format, or null when no draft is being proposed
   * (e.g. still in the assignment gate, or mid-revision discussion with
   * no new full draft yet). */
  draft_text: z.string().min(1).nullable(),
  /** Phase 2: what this draft's active opposition is, and what
   * permanently shifts - the Conflict Mandate standard. Null only when
   * draft_text is also null. */
  conflict_mandate: z
    .object({
      present: z.boolean(),
      opposition_description: z.string(),
      permanent_shift_description: z.string(),
    })
    .nullable(),
  /** Phase 2: Enter Late, Leave Early compliance self-report. Null only
   * when draft_text is also null. */
  enter_late_leave_early: z
    .object({
      entered_late: z.boolean(),
      left_early: z.boolean(),
      reason: z.string(),
    })
    .nullable(),
  /** Phase 2: set when this draft requires altering a structural fact
   * from the Project 4 blueprint (not just its visual execution) -
   * triggers the Conflict Intercept protocol (issue #98) rather than
   * being silently absorbed into an ordinary draft. Null when no
   * deviation is being proposed. */
  structural_deviation: z
    .object({
      deviates: z.boolean(),
      explanation: z.string(),
    })
    .nullable(),
  /** Phase 2 / issue #97 AC5 ("checked before a new scene drafts"): the
   * continuity facts this draft's content relies on, so the app can
   * deterministically verify them against the Continuity Matrix before
   * the draft is accepted. Null when draft_text is also null. */
  continuity_requirements: z
    .object({
      required_knowledge: z.array(z.object({ character_id: z.string().min(1), fact: z.string().min(1) })),
      referenced_physical: z.array(
        z.object({
          subject: z.string().min(1),
          kind: z.enum(["injury", "costume", "prop", "weather", "time_elapsed"]),
          expected_detail: z.string().min(1),
        })
      ),
    })
    .nullable(),
  deferred_items: z.array(
    z.object({
      item: z.string().min(1),
      defer_to_project: z.enum(["Project 1", "Project 2", "Project 3", "Project 4"]).nullable(),
      notes: z.string(),
    })
  ),
});

export type ScreenplayTurn = z.infer<typeof ScreenplayTurnSchema>;

export const EMIT_SCREENPLAY_TURN_TOOL: Anthropic.Tool = {
  name: "emit_screenplay_turn",
  description:
    "Report your structured turn output for the Screenplay Edition drafting conversation. Call this exactly once per turn.",
  input_schema: {
    type: "object",
    properties: {
      reply: {
        type: "string",
        description: "Your natural-language reply to the author, shown directly in the chat.",
      },
      context: {
        type: "string",
        description: "Your internal reasoning for this turn - never shown to the author in chat.",
      },
      scene_number: {
        type: ["number", "null"],
        description: "Which scene this turn's work concerns, or null if none has been settled on yet.",
      },
      phase: {
        type: ["string", "null"],
        enum: ["assignment_gate", "drafting", "qa_delivery", "revision", null],
        description: "Which of the four Progressive Drafting Workflow phases this turn's scene is currently in.",
      },
      proposed_assignment_summary: {
        type: ["string", "null"],
        description:
          'The Phase 1 one-paragraph assignment summary for scene_number, composed strictly from its Scene Register Entry grounding - exactly five pipe-delimited segments: "[Scene Number & Heading (INT./EXT., Location, Time)] | [Primary Cast Present] | [Dramatic Objective vs. Opposition] | [Turning Point] | [Expected Emotional Shift]". Null if none is being proposed this turn.',
      },
      assignment_sign_off: {
        type: "boolean",
        description:
          "True only on the turn where the author's message is explicit sign-off on the currently pending assignment summary. False on every other turn.",
      },
      draft_text: {
        type: ["string", "null"],
        description:
          "The full scene drafted this turn, in plain-text industry screenplay format (scene heading, action, character cues, dialogue) - enforcing Strict Visual Discipline, active present tense, Lean Action Paragraphs, Performable Dialogue & Subtext, and Enter Late/Leave Early. Null when no draft is being proposed this turn.",
      },
      conflict_mandate: {
        type: ["object", "null"],
        properties: {
          present: { type: "boolean", description: "Whether this scene contains active opposition." },
          opposition_description: { type: "string", description: "The competing goals, social pressure, time limit, or environmental barrier driving this scene." },
          permanent_shift_description: { type: "string", description: "What permanently shifts in plot, power dynamics, or character knowledge by the end of this scene." },
        },
        required: ["present", "opposition_description", "permanent_shift_description"],
        description: "The Conflict Mandate self-report for draft_text. Null only when draft_text is also null.",
      },
      enter_late_leave_early: {
        type: ["object", "null"],
        properties: {
          entered_late: { type: "boolean", description: "Whether the scene begins after routine preliminaries, skipping greetings/arrivals." },
          left_early: { type: "boolean", description: "Whether the scene cuts away immediately after its dramatic peak/turning point." },
          reason: { type: "string", description: "A specific justification for both flags." },
        },
        required: ["entered_late", "left_early", "reason"],
        description: "The Enter Late, Leave Early self-report for draft_text. Null only when draft_text is also null.",
      },
      structural_deviation: {
        type: ["object", "null"],
        properties: {
          deviates: { type: "boolean", description: "Whether this draft requires altering a structural fact from the Project 4 blueprint, not just its visual execution." },
          explanation: { type: "string", description: "What specifically deviates and why." },
        },
        required: ["deviates", "explanation"],
        description: "Set only when a structural (not visual-execution) deviation from the Project 4 blueprint is being proposed - triggers the Conflict Intercept protocol. Null otherwise.",
      },
      continuity_requirements: {
        type: ["object", "null"],
        properties: {
          required_knowledge: {
            type: "array",
            items: {
              type: "object",
              properties: {
                character_id: { type: "string", description: "The character this requirement is about." },
                fact: { type: "string", description: "The fact this draft requires the character to already know." },
              },
              required: ["character_id", "fact"],
            },
            description: "Facts this draft assumes a character already knows, to be checked against the Knowledge & Secrets Ledger.",
          },
          referenced_physical: {
            type: "array",
            items: {
              type: "object",
              properties: {
                subject: { type: "string", description: "The character or prop this physical state is about." },
                kind: { type: "string", enum: ["injury", "costume", "prop", "weather", "time_elapsed"] },
                expected_detail: { type: "string", description: "The physical/timeline state this draft assumes." },
              },
              required: ["subject", "kind", "expected_detail"],
            },
            description: "Physical/timeline state this draft assumes, to be checked against Physical & Timeline Tracking.",
          },
        },
        required: ["required_knowledge", "referenced_physical"],
        description: "The continuity facts this draft relies on (issue #97 AC5 - checked before a new scene drafts). Null when draft_text is also null.",
      },
      deferred_items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            item: { type: "string", description: "What was raised." },
            defer_to_project: {
              type: ["string", "null"],
              enum: ["Project 1", "Project 2", "Project 3", "Project 4", null],
              description: "Which other project this actually belongs to, if any.",
            },
            notes: { type: "string", description: "Any additional context for the deferral." },
          },
          required: ["item", "defer_to_project", "notes"],
        },
        description: "Anything raised this turn that belongs to another project. Empty array if none.",
      },
    },
    required: [
      "reply",
      "context",
      "scene_number",
      "phase",
      "proposed_assignment_summary",
      "assignment_sign_off",
      "draft_text",
      "conflict_mandate",
      "enter_late_leave_early",
      "structural_deviation",
      "continuity_requirements",
      "deferred_items",
    ],
  },
};
