/** A real entry name never needs more than this many characters once
 * slugified - same hard backstop rationale as characterEngine/
 * characterId.ts's MAX_CHAR_ID_LENGTH (issue #105's incident: an
 * unbounded derived id can become an oversized Firestore map key). */
export const MAX_ENTRY_ID_LENGTH = 60;

/** Deterministic Canon Element id for a World Entry, derived from its
 * name - same slugify pattern as worldEngine/pillarElementId.ts. */
export function slugifyEntryName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_ENTRY_ID_LENGTH);
}

/** Disambiguates a collision against the story's existing entry ids
 * with a "_2"/"_3"/... suffix, mirroring issue #105's assignCharIds -
 * re-truncates before each candidate suffix so the result never
 * exceeds MAX_ENTRY_ID_LENGTH even after a suffix is appended. */
export function deriveEntryId(name: string, existingIds: Set<string>): string {
  // Falls back to a fixed base when the name has no [a-z0-9] characters
  // at all (e.g. "東京", "...") - mirrors pillarElementId.ts's own
  // `|| "unnamed"` fallback, so an empty slug never reaches Firestore
  // as a document id (which throws).
  const base = slugifyEntryName(name) || "entry";
  let id = base;
  let occurrence = 1;
  while (existingIds.has(id)) {
    occurrence++;
    const suffix = `_${occurrence}`;
    id = `${base.slice(0, MAX_ENTRY_ID_LENGTH - suffix.length)}${suffix}`;
  }
  return id;
}
