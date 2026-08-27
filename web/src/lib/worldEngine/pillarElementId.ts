/** Deterministic Canon Element id for a Pillar, derived from its name -
 * lets both server and client compute the same id with no round trip.
 * Renaming a pillar orphans its old element (a fresh one starts at
 * Exploring under the new slug) - an accepted Phase-1 limitation, issue
 * #41. */
export function pillarElementId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `pillar-${slug || "unnamed"}`;
}
