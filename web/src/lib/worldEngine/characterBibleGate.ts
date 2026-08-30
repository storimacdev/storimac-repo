import { slugifyCharacterName } from "@/lib/characterEngine/characterId";
import type { CastMember } from "@/lib/characterEngine/ingestFoundation";
import type { P2State } from "@/lib/canonEngine/storyStore";

export interface CharacterBibleGateResult {
  complete: boolean;
  incompleteNames: string[];
}

/** True only when every cast member from the Story Foundation has reached
 * Character Bible's Stage 6 sign-off. A cast with zero entries is
 * trivially complete - nothing to block on (this gate exists to stop
 * World Bible progress before Character Bible is done, not to require a
 * cast that doesn't exist yet). */
export function checkCharacterBibleComplete(
  cast: CastMember[],
  p2State: P2State | null | undefined
): CharacterBibleGateResult {
  const progress = p2State?.characterProgress ?? {};
  const progressValues = Object.values(progress);
  const incompleteNames = cast
    .filter((member) => {
      if (progress[slugifyCharacterName(member.name)]?.status === "signed_off") return false;
      // A sign-off recorded under character-chat/route.ts's raw-slugify
      // fallback (resolveCharId) won't share this member's slug key, but
      // the progress entry still carries the human-readable name under
      // characterName - match on that too, so a fallback-keyed sign-off
      // can't produce a gate that no author action could ever satisfy.
      const bySignedOffName = progressValues.some(
        (entry) => entry.status === "signed_off" && entry.characterName.trim().toLowerCase() === member.name.trim().toLowerCase()
      );
      return !bySignedOffName;
    })
    .map((member) => member.name);
  return { complete: incompleteNames.length === 0, incompleteNames };
}
