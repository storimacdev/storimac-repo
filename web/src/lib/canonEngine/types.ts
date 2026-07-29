/**
 * Canon State element schema — GitHub issue #6, PRD §10.1.
 * Generic across Projects 1-4 per ARCHITECTURE.md §2: no field here is
 * Project-1-specific. Each project supplies its own element_id vocabulary
 * and stage numbering.
 */

export type CanonStatus = "Exploring" | "Working" | "Confirmed" | "Parked";

export type DepthMode = "Confirm" | "Refine" | "Develop" | "Defer";

export interface CanonHistoryEntry {
  status: CanonStatus;
  value: unknown;
  ts: string; // ISO 8601
  turn_id: string;
}

export interface CanonElement {
  project_id: string; // Story ID this element belongs to
  element_id: string;
  stage: number;
  status: CanonStatus;
  depth_mode: DepthMode;
  value: unknown;
  rationale: string;
  depends_on: string[];
  /** 101 Story Formats catalog code(s) this element cites - single string for
   * primary_format, string array for supporting_formats. Internal
   * retrieval-grounding metadata only; never crosses the export boundary
   * (see ARCHITECTURE.md §3). */
  retrieval_code: string | string[] | null;
  history: CanonHistoryEntry[];
}

/** Partial update — only the fields a turn actually changed. */
export interface CanonElementPatch {
  status?: CanonStatus;
  depth_mode?: DepthMode;
  value?: unknown;
  rationale?: string;
  depends_on?: string[];
  retrieval_code?: string | string[] | null;
  stage?: number;
}
