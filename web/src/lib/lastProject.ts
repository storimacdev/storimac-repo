export type LastProject = "interview" | "character-bible" | "world-bible" | "story-architecture";

/** Maps a tracked last-active project to its route prefix - null/undefined
 * (never tracked, or a pre-this-feature profile) falls back to Project 1's
 * `/interview`, preserving the app's pre-existing behavior exactly. Supports
 * `/interview`, `/character-bible`, `/world-bible`, and `/story-architecture`. */
export function lastProjectPath(project: LastProject | null | undefined): "/interview" | "/character-bible" | "/world-bible" | "/story-architecture" {
  if (project === "character-bible") return "/character-bible";
  if (project === "world-bible") return "/world-bible";
  if (project === "story-architecture") return "/story-architecture";
  return "/interview";
}
