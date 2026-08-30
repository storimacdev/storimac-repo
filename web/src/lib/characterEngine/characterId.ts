/** A real character name never needs more than this many characters once
 * slugified. Caps every derived charId - both the exact/prefix-matched
 * cast-list path and the raw-slugify fallback in character-chat/route.ts
 * - as a hard backstop against ever writing an oversized Firestore map
 * key, independent of whatever validation current_character's schema
 * enforces upstream (a live incident: a pre-fix schema had no max-length
 * bound on current_character, the model emitted a multi-thousand-character
 * value, and the resulting charId became a Firestore map key too large to
 * write, permanently corrupting that Story's p2 state). */
export const MAX_CHAR_ID_LENGTH = 60;

/** Deterministic Canon Element id (and P2State.characterProgress key) for
 * a character, derived from its name. Extracted from character-chat/
 * route.ts (issue #26) into its own shared file so the Character Bible
 * completion gate (worldEngine/characterBibleGate.ts) can key
 * characterProgress the exact same way character-chat/route.ts itself
 * does, with no risk of the two derivations drifting apart. */
export function slugifyCharacterName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_CHAR_ID_LENGTH);
}
