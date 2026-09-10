/**
 * The Universal World Entry Model's structured value shape and the
 * Importance x Development Depth soft-warning matrix - GitHub issues
 * #42, #44, sp03 §3/§7 (Universal World Entry Model / Priority
 * Framework). None of the three mismatch rules below are invented:
 * "Level 5 is reserved for Critical items only" is sp03 §3's own stated
 * rule verbatim. "A Minor element at Level 4/5" and "a Critical element
 * stuck at Level 1" are issue #44's own explicit AC examples (not
 * stated in sp03 §3 itself) - "Incidental" is this module's own
 * extension of the Minor rule (it sits below Minor on sp03's Importance
 * scale), not literally in the AC text either.
 */

export type EntryImportance = "Critical" | "Major" | "Supporting" | "Minor" | "Incidental";
export type EntryDepth = 1 | 2 | 3 | 4 | 5;

export interface OutstandingQuestion {
  item: string;
  notes: string;
}

export interface WorldEntryValue {
  name: string;
  category: string;
  narrativeRole: string;
  importance: EntryImportance;
  depth: EntryDepth;
  functionalDescription: string;
  governingRules: string;
  outstandingQuestions: OutstandingQuestion[];
}

export interface ImportanceDepthCheck {
  warning: boolean;
  message: string | null;
}

const DEPTH_LABELS: Record<EntryDepth, string> = {
  1: "Level 1 Reference",
  2: "Level 2 Basic",
  3: "Level 3 Standard",
  4: "Level 4 Comprehensive",
  5: "Level 5 Exhaustive",
};

export function checkImportanceDepthMismatch(
  importance: EntryImportance,
  depth: EntryDepth
): ImportanceDepthCheck {
  if (depth === 5 && importance !== "Critical") {
    return {
      warning: true,
      message: `Level 5 Exhaustive depth is reserved for Critical elements - this entry is tagged "${importance}".`,
    };
  }
  if ((importance === "Minor" || importance === "Incidental") && depth >= 4) {
    return {
      warning: true,
      message: `"${importance}" elements are usually developed at Level 1-2 depth - ${DEPTH_LABELS[depth]} may be more detail than this element needs.`,
    };
  }
  if (importance === "Critical" && depth === 1) {
    return {
      warning: true,
      message: `"Critical" elements usually need more than ${DEPTH_LABELS[1]} depth - consider developing this further.`,
    };
  }
  return { warning: false, message: null };
}
