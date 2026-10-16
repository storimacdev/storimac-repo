/**
 * Order-insensitive equality check for a `depends_on` id list - issue
 * #121. The World turn schema instructs the model to re-report a
 * pillar's dependencies on every turn they're still true, even when
 * unchanged from a prior turn (mirroring the existing
 * proposed_pillars/proposed_wcl convention), so world-chat/route.ts's
 * pillar-dependency write needs a way to tell "unchanged" apart from
 * "changed" before calling upsertElement - otherwise every turn appends
 * a fresh `history` entry per pillar even when nothing changed, growing
 * CanonElement.history unboundedly over a long campaign. Order doesn't
 * carry meaning in a dependency list, so a straight array/index compare
 * would false-positive on a same-set-different-order re-report.
 */
export function sameDependsOnSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, i) => value === sortedB[i]);
}
