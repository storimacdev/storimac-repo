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
  /** Issue #99 (Special Screenplay Processing Paths), layered onto
   * Phase 2's draft_text. Null only when draft_text is also null. */
  special_processing: z
    .object({
      flashback: z
        .object({
          present: z.boolean(),
          justification: z.string(),
        })
        .nullable(),
      montage: z
        .object({
          present: z.boolean(),
          shots: z.array(z.object({ description: z.string(), evolution_description: z.string() })),
        })
        .nullable(),
      /** Issue #96 extension: motifs/sound cues/setups newly planted by
       * this draft, so Phase 4's confirmation can register them in the
       * Continuity Matrix's Open Loops alongside any closed this turn. */
      loops_opened: z.array(
        z.object({
          id: z.string().min(1),
          description: z.string().min(1),
          kind: z.enum(["setup", "visual_motif", "sound_cue"]),
          payoff_scene_number: z.number().int().min(1).nullable(),
        })
      ),
      loops_to_close: z.array(z.string()),
    })
    .nullable(),
  /** Issue #96: the Continuity Matrix outcomes this draft would apply
   * if Confirmed - distinct from continuity_requirements (the
   * pre-conditions this draft relies on). Captured now, applied only
   * once the scene is actually Confirmed (issue #97 AC5). Null only
   * when draft_text is also null. */
  continuity_outcomes: z
    .object({
      knowledge_gained: z.array(
        z.object({
          character_id: z.string().min(1),
          character_name: z.string().min(1),
          fact: z.string().min(1),
          state: z.enum(["knows", "suspects", "lying"]),
        })
      ),
      physical_changes: z.array(
        z.object({
          subject: z.string().min(1),
          kind: z.enum(["injury", "costume", "prop", "weather", "time_elapsed"]),
          detail: z.string().min(1),
        })
      ),
    })
    .nullable(),
  /** Phase 4 (issue #96): the author's revision feedback classification
   * for scene_number, or null when no revision is being discussed this
   * turn. */
  revision_classification: z
    .object({
      feedback_type: z.enum(["Visuals", "Dialogue", "Pacing", "Subtext", "Continuity", "Structure"]),
      scope: z.enum(["Line", "Action Paragraph", "Full Scene"]),
      description: z.string(),
    })
    .nullable(),
  /** Phase 4: true only when the author has explicitly asked for a
   * full-scene rewrite - required for revision_classification.scope
   * to legitimately be "Full Scene". False on every other turn. */
  full_rewrite_requested: z.boolean(),
  /** Phase 4 (AC4): true only on the turn where the author gives
   * explicit approval to freeze scene_number's current text as
   * immutable Confirmed canon. False on every other turn. */
  scene_approved: z.boolean(),
  /** Phase 3 (issue #95): the Dialogue & Voice Audit self-report -
   * whether this draft's dialogue carries subtext rather than
   * on-the-nose exposition. Null only when draft_text is also null. */
  dialogue_voice_audit: z
    .object({
      subtext_present: z.boolean(),
      notes: z.string(),
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
      special_processing: {
        type: ["object", "null"],
        properties: {
          flashback: {
            type: ["object", "null"],
            properties: {
              present: { type: "boolean", description: "Whether this draft contains a BEGIN FLASHBACK:/END FLASHBACK. block." },
              justification: { type: "string", description: "How this flashback directly alters a character's present decision-making landscape. Required whenever present is true." },
            },
            required: ["present", "justification"],
          },
          montage: {
            type: ["object", "null"],
            properties: {
              present: { type: "boolean", description: "Whether this draft contains a BEGIN MONTAGE:/END MONTAGE. block." },
              shots: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    description: { type: "string", description: "What this shot shows." },
                    evolution_description: { type: "string", description: "The character/relational evolution this shot specifically advances - never filler." },
                  },
                  required: ["description", "evolution_description"],
                },
                description: "At least 2 shots required whenever present is true.",
              },
            },
            required: ["present", "shots"],
          },
          loops_opened: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "A stable id for this new Open Loop." },
                description: { type: "string", description: "What was planted." },
                kind: { type: "string", enum: ["setup", "visual_motif", "sound_cue"] },
                payoff_scene_number: { type: ["number", "null"], description: "The intended Project 4 payoff scene, if known." },
              },
              required: ["id", "description", "kind", "payoff_scene_number"],
            },
            description: "Motifs/sound cues/setups newly planted by this draft.",
          },
          loops_to_close: {
            type: "array",
            items: { type: "string" },
            description: "Open Loop ids (visual motifs, sound bridges/cues, setups) this draft pays off - must already exist as a planted Open Loop.",
          },
        },
        required: ["flashback", "montage", "loops_opened", "loops_to_close"],
        description: "Special Screenplay Processing Paths (issue #99) layered onto draft_text. Null only when draft_text is also null.",
      },
      continuity_outcomes: {
        type: ["object", "null"],
        properties: {
          knowledge_gained: {
            type: "array",
            items: {
              type: "object",
              properties: {
                character_id: { type: "string" },
                character_name: { type: "string" },
                fact: { type: "string" },
                state: { type: "string", enum: ["knows", "suspects", "lying"] },
              },
              required: ["character_id", "character_name", "fact", "state"],
            },
            description: "Facts this scene newly establishes a character knows/suspects/lies about.",
          },
          physical_changes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                subject: { type: "string" },
                kind: { type: "string", enum: ["injury", "costume", "prop", "weather", "time_elapsed"] },
                detail: { type: "string" },
              },
              required: ["subject", "kind", "detail"],
            },
            description: "Physical/timeline state this scene newly establishes.",
          },
        },
        required: ["knowledge_gained", "physical_changes"],
        description: "The Continuity Matrix outcomes this draft would apply once Confirmed (issue #96/#97 AC5). Null only when draft_text is also null.",
      },
      revision_classification: {
        type: ["object", "null"],
        properties: {
          feedback_type: { type: "string", enum: ["Visuals", "Dialogue", "Pacing", "Subtext", "Continuity", "Structure"] },
          scope: { type: "string", enum: ["Line", "Action Paragraph", "Full Scene"] },
          description: { type: "string", description: "What changed and why." },
        },
        required: ["feedback_type", "scope", "description"],
        description: "Phase 4: classification of the author's revision feedback for scene_number. Null when no revision is being discussed this turn.",
      },
      full_rewrite_requested: {
        type: "boolean",
        description: "True only when the author has explicitly asked for a full-scene rewrite this turn.",
      },
      scene_approved: {
        type: "boolean",
        description: "True only on the turn where the author gives explicit approval to freeze scene_number's current text as immutable Confirmed canon.",
      },
      dialogue_voice_audit: {
        type: ["object", "null"],
        properties: {
          subtext_present: { type: "boolean", description: "Whether this draft's dialogue carries subtext rather than on-the-nose exposition." },
          notes: { type: "string", description: "Specific notes on dialogue voice, either way." },
        },
        required: ["subtext_present", "notes"],
        description: "Phase 3 Dialogue & Voice Audit self-report. Null only when draft_text is also null.",
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
      "special_processing",
      "continuity_outcomes",
      "revision_classification",
      "full_rewrite_requested",
      "scene_approved",
      "dialogue_voice_audit",
      "deferred_items",
    ],
  },
};
