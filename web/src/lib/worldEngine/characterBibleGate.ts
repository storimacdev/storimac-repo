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
  const incompleteNames = cast
    .filter((member) => progress[slugifyCharacterName(member.name)]?.status !== "signed_off")
    .map((member) => member.name);
  return { complete: incompleteNames.length === 0, incompleteNames };
}
