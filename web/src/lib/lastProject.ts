export type LastProject = "interview" | "character-bible" | "world-bible";

/** Maps a tracked last-active project to its route prefix - null/undefined
 * (never tracked, or a pre-this-feature profile) falls back to Project 1's
 * `/interview`, preserving the app's pre-existing behavior exactly. */
export function lastProjectPath(project: LastProject | null | undefined): string {
  if (project === "character-bible") return "/character-bible";
  if (project === "world-bible") return "/world-bible";
  return "/interview";
}
