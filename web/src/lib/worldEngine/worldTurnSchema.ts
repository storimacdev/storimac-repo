import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * Project 3 turn schema/tool - GitHub issue #38 (base turn shape for
 * Stage 1) and #39 (`proposed_wcl`). Reference: Project 1's stateDelta.ts +
 * extractTurn.ts's generic StructuredDeltaExtractor (ARCHITECTURE.md §2),
 * and Project 2's characterTurnSchema.ts for the same
 * reply/context/current_stage shape. Deliberately minimal beyond that - no
 * canon-state updates, no guardrail/conflict fields yet, since the Canon
 * Registry (#41), scope guardrails (#46), and Conflict Resolution (#47)
 * haven't been built. Every later Phase 1-3 issue extends this same
 * schema, the same way Project 2's grew incrementally across issues
 * #26/#28/#30/#31/#32.
 */

const WorldDeferredItemSchema = z.object({
  item: z.string().min(1),
  defer_to_project: z.enum(["Project 2", "Project 4", "Project 5"]),
  notes: z.string().min(1),
});

export type WorldDeferredItemInput = z.infer<typeof WorldDeferredItemSchema>;

export const WORLD_STAGE_NAMES: Record<number, string> = {
  1: "Understand",
  2: "Assess & Pillar Mapping",
  3: "Prioritize & Deep Dive",
  4: "System Integration Audit",
  5: "Compile",
};

export const WorldTurnSchema = z.object({
  reply: z.string().min(1),
  context: z.string().min(1),
  current_stage: z.number().int().min(1).max(5),
  proposed_wcl: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable(),
  proposed_pillars: z.array(z.string().min(1)).nullable(),
  active_pillar: z.string().nullable(),
  cycle_phase: z.enum(["Discover", "Develop", "Validate"]).nullable(),
  proposed_entry: z
    .object({
      entry_id: z.string().nullable(),
      name: z.string().min(1),
      category: z.string().min(1),
      narrative_role: z.string().min(1),
      importance: z.enum(["Critical", "Major", "Supporting", "Minor", "Incidental"]),
      depth: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
      functional_description: z.string().min(1),
      governing_rules: z.string().min(1),
      depends_on: z.array(z.string()),
    })
    .nullable(),
  validated_status: z.enum(["Working", "Confirmed", "Deferred"]).nullable(),
  deferred_items: z.array(WorldDeferredItemSchema),
  conflict_detected: z.boolean(),
  conflict_description: z.string().nullable(),
  resolution: z.enum(["revert", "revise", "defer"]).nullable(),
  pillar_dependencies: z.array(
    z.object({
      pillar: z.string().min(1),
      depends_on: z.array(z.string()),
    })
  ),
});

export type WorldTurn = z.infer<typeof WorldTurnSchema>;

export const EMIT_WORLD_TURN_TOOL: Anthropic.Tool = {
  name: "emit_world_turn",
  description:
    "Emit your natural-language reply to the author together with your current interview position for this turn. Call this exactly once per turn.",
  input_schema: {
    type: "object",
    properties: {
      reply: {
        type: "string",
        description:
          "The chat-facing reply: your structural assessment, proposed World Complexity Level, and/or discovery questions, as natural conversational prose. Never narrate internal stage bookkeeping here.",
      },
      context: {
        type: "string",
        description:
          "Your internal reasoning for this turn - why you assessed things the way you did, what you noticed, anything relevant to the next turn. Shown to the author separately from chat, never inside reply. Required every turn, even if brief.",
      },
      current_stage: {
        type: "number",
        description:
          "The interview stage (1-5) currently in progress: 1 Understand, 2 Assess & Pillar Mapping, 3 Prioritize & Deep Dive, 4 System Integration Audit, 5 Compile.",
      },
      proposed_wcl: {
        type: ["number", "null"],
        enum: [1, 2, 3, 4, null],
        description:
          "The World Complexity Level (1-4: Minimal/Moderate/Rich/Extensive) you calculated this turn per the Adaptive World Complexity framework, so the app can offer it to the author as a real proposal to confirm or override. Report the level again on every turn you've assessed one, even if unchanged from a prior turn. Use null only if you haven't assessed a level yet this turn (e.g. still gathering the Stage 1 basics).",
      },
      proposed_pillars: {
        type: ["array", "null"],
        items: { type: "string" },
        description:
          "The ordered list of relevant World Pillars you've identified for this world (e.g. Technology, Government & Bureaucracy, Economy, Culture, Geography, Underworld, History), most important first, so the app can offer it to the author as a starting list to confirm, edit, or reorder. Report the list again on every turn you've assessed one, even if unchanged from a prior turn. Use null only if you haven't identified a pillar list yet this turn.",
      },
      active_pillar: {
        type: ["string", "null"],
        description:
          "During Stage 3 (Prioritize & Deep Dive), the single pillar you are currently deep-diving with the author, exactly matching one of the adopted pillar names. Null before Stage 3 starts, or in the gap between finishing one pillar and starting the next. Report it again every turn it's active, even if unchanged.",
      },
      cycle_phase: {
        type: ["string", "null"],
        enum: ["Discover", "Develop", "Validate", null],
        description:
          "Which phase of the Discover/Develop/Validate cycle this turn's reply belongs to, for the currently active pillar. Null when active_pillar is null.",
      },
      proposed_entry: {
        type: ["object", "null"],
        properties: {
          entry_id: {
            type: ["string", "null"],
            description:
              "The id of an existing draft entry this turn is updating (from a prior turn's created/updated entry). Null when this turn proposes a brand-new entry instead.",
          },
          name: { type: "string", description: "The entry's Name." },
          category: { type: "string", description: "The entry's Category (e.g. Location, Technology, Religion, Historical Event)." },
          narrative_role: { type: "string", description: "The entry's Narrative Role - its explicit reason for existing." },
          importance: {
            type: "string",
            enum: ["Critical", "Major", "Supporting", "Minor", "Incidental"],
            description: "The entry's Narrative Importance tag.",
          },
          depth: {
            type: "number",
            enum: [1, 2, 3, 4, 5],
            description: "The entry's Development Depth level (1 Reference - 5 Exhaustive).",
          },
          functional_description: { type: "string", description: "The entry's Functional Description, bounded by its depth level." },
          governing_rules: { type: "string", description: "The entry's Governing Rules & Constraints." },
          depends_on: {
            type: "array",
            items: { type: "string" },
            description:
              "The entry_ids of other World Entries this one references or systemically depends on (e.g. an economic system that depends on a geographic feature). Empty array if none. Use the exact entry_id shown for that entry in the [World Entries So Far...] grounding block - never its Name, and never an id for an entry that doesn't appear there yet.",
          },
        },
        required: ["entry_id", "name", "category", "narrative_role", "importance", "depth", "functional_description", "governing_rules", "depends_on"],
        description:
          "A structured draft of the World Entry currently being developed or validated, during the Develop or Validate phase of the active pillar's cycle. Null outside those phases, or when nothing concrete has been drafted yet this turn.",
      },
      validated_status: {
        type: ["string", "null"],
        enum: ["Working", "Confirmed", "Deferred", null],
        description:
          "Set only on the turn where the author has just given a clear verdict on the entry named in proposed_entry (or its entry_id): Working (provisional), Confirmed (approved as canon), or Deferred (postponed). Null on every other turn, including every Discover/Develop-phase turn.",
      },
      deferred_items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            item: {
              type: "string",
              description: "A short description of the out-of-scope thing you noticed (e.g. a character's backstory detail, a plot beat, a line of dialogue).",
            },
            defer_to_project: {
              type: "string",
              enum: ["Project 2", "Project 4", "Project 5"],
              description:
                "Which project this belongs to: Project 2 (Character Bible) for character psychology/backstory/dialogue voice, Project 4 (Story Architecture) for plot beats/scenes/timeline sequencing, Project 5 (Draft Writing) for narrative prose/dialogue generation.",
            },
            notes: { type: "string", description: "Enough context to pick this back up later." },
          },
          required: ["item", "defer_to_project", "notes"],
        },
        description:
          "Any out-of-scope items you noticed this turn but did not act on - log them here instead of developing them, so the author doesn't lose the thread. Empty array if nothing out-of-scope came up this turn.",
      },
      conflict_detected: {
        type: "boolean",
        description:
          "True only on the turn where you notice the author's new idea contradicts the immutable Story Foundation (not a Confirmed World Entry - that's detected separately by the app). False on every other turn, including every turn while a conflict is already pending your author's choice.",
      },
      conflict_description: {
        type: ["string", "null"],
        description:
          "A concise description of the Story-Foundation contradiction, set only when conflict_detected is true this turn or a Foundation-level conflict is still pending from an earlier turn. Null otherwise.",
      },
      resolution: {
        type: ["string", "null"],
        enum: ["revert", "revise", "defer", null],
        description:
          "Set only on the turn where the author has just given a clear verdict on a pending conflict (Foundation or Confirmed-canon, whichever is currently open - the app will tell you which via a [CONFLICT DETECTED...] note): revert (keep things as they are), revise (accept the new idea, updating canon), or defer (park the decision for now). Null on every other turn.",
      },
      pillar_dependencies: {
        type: "array",
        items: {
          type: "object",
          properties: {
            pillar: { type: "string", description: "The name of a pillar, exactly matching one of the adopted pillar names." },
            depends_on: {
              type: "array",
              items: { type: "string" },
              description: "The names of other pillars this one systemically depends on (e.g. Economy depends on Geography). Empty array if none.",
            },
          },
          required: ["pillar", "depends_on"],
        },
        description:
          "Causal/systemic relationships between World Pillars you've identified (e.g. Economy depends on Geography, Culture depends on Politics) - per sp03's own instruction to treat the world as a causal chain. Report a pillar's dependencies again on any turn they're still true, even if unchanged from a prior turn. Empty array if you haven't identified any pillar-level dependencies yet.",
      },
    },
    required: [
      "reply",
      "context",
      "current_stage",
      "proposed_wcl",
      "proposed_pillars",
      "active_pillar",
      "cycle_phase",
      "proposed_entry",
      "validated_status",
      "deferred_items",
      "conflict_detected",
      "conflict_description",
      "resolution",
      "pillar_dependencies",
    ],
  },
};
