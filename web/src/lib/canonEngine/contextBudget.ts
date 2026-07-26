import type { CanonElement } from "./types";
import type { Story, StoryMessage } from "./storyStore";
import { getStageDefinition, getDefaultDepthMode } from "./stageFsm";

/**
 * Token/context budget management — GitHub issue #13, PRD §6.5. Once a
 * Project grows past LONG_TRANSCRIPT_TURNS, stop replaying the transcript
 * and ground the model with a compact state summary (all Confirmed values +
 * current stage + depth) plus only the last few raw turns for conversational
 * continuity. Resume (storyStore.resumeStory) already bounds its own replay;
 * this covers the per-turn path in /api/chat.
 */

/** Past this many total messages, switch to summary + short window. */
export const LONG_TRANSCRIPT_TURNS = 16;
/** Raw turns kept for continuity in long-transcript mode (PRD: "last 4-6"). */
export const LONG_TRANSCRIPT_WINDOW = 6;
/** Raw turns sent while the transcript is still short. */
export const SHORT_TRANSCRIPT_WINDOW = 20;

export interface TurnContext {
  /** Raw messages to send as the conversation window. */
  window: StoryMessage[];
  /**
   * State-summary block to append to the system prompt, or null while the
   * transcript is short enough that the raw window alone suffices. (The
   * Confirmed-canon snapshot is included in the summary; callers should not
   * duplicate it.)
   */
  stateSummary: string | null;
}

export function buildTurnContext(
  story: Story,
  elements: CanonElement[],
  allMessages: StoryMessage[]
): TurnContext {
  const isLong = allMessages.length > LONG_TRANSCRIPT_TURNS;
  const window = allMessages.slice(-(isLong ? LONG_TRANSCRIPT_WINDOW : SHORT_TRANSCRIPT_WINDOW));

  if (!isLong) {
    return { window, stateSummary: null };
  }

  const stageDef = getStageDefinition(story.currentStage);
  const confirmed = elements.filter((e) => e.status === "Confirmed");
  const working = elements.filter((e) => e.status === "Working");
  const parked = elements.filter((e) => e.status === "Parked");

  const lines: string[] = [
    `[State Summary — the conversation above is truncated; this is the authoritative state. Internal grounding only, never narrate it to the author.]`,
    `Current stage: ${story.currentStage} (${stageDef.name})`,
  ];

  if (confirmed.length) {
    lines.push("Confirmed canon:");
    for (const e of confirmed) lines.push(`- ${e.element_id}: ${JSON.stringify(e.value)}`);
  }
  if (working.length) {
    lines.push("Working (not yet confirmed):");
    for (const e of working) lines.push(`- ${e.element_id}: ${JSON.stringify(e.value)}`);
  }
  if (parked.length) {
    lines.push(`Parked: ${parked.map((e) => e.element_id).join(", ")}`);
  }
  if (stageDef.requiredElementIds.length) {
    lines.push("Current-stage depth defaults:");
    for (const id of stageDef.requiredElementIds) {
      lines.push(`- ${id}: ${getDefaultDepthMode(story.currentStage, id)}`);
    }
  }

  return { window, stateSummary: lines.join("\n") };
}
