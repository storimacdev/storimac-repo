# P2 Causal Chain Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce GitHub issue #28's AC1 — a Critical/Major character's Core Flaw or Dominant Fear can't reach `Confirmed` status unless it's traceable (via `depends_on`) to an already-`Confirmed` Core Wound or False Belief for that same character.

**Architecture:** A new pure-plus-one-I/O module (`causalChain.ts`, mirroring `characterFsm.ts`'s split) provides a cheap claim-only filter and one Firestore-backed verification call. The route looks up the character's tier from the already-computed priority matrix and, for qualifying updates only, downgrades an untraceable `Confirmed` proposal to `Working` in-place before it reaches `toFactUpdate`/`applyStateDelta` — everything else in the turn is unaffected.

**Tech Stack:** TypeScript, Firestore (via `firebase-admin`), Zod (unchanged in this plan — no schema changes needed).

## Global Constraints

- Enforcement is scoped to exactly `CHAIN_ENFORCED_FIELDS = ["core_flaw", "dominant_fear"]` tracing to `CHAIN_ROOT_FIELDS = ["core_wound", "false_belief"]` — not the full conceptual 7-field chain. Per the design spec's decision 1, this is the AC's actual testable requirement; enforcing intermediate links isn't stated anywhere as a rejection condition.
- Enforcement only applies when tier is in `ENFORCED_TIERS = ["Critical", "Major"]`. An unmatched/unknown tier (charId doesn't resolve to a classified cast member) skips enforcement rather than blocking, matching the codebase's existing posture of failing open on classification uncertainty.
- Failure mode is a silent downgrade (`Confirmed` → `Working`) plus a server-side log — never a dropped fact, never a redirect reply, never an interruption to the turn's `reply`/`context`.
- "Traceable" requires both a claim (`depends_on` mentions a root field) and a verified fact (that root field's `CanonElement.status` is actually `"Confirmed"` in the store) — a claim alone is not sufficient.
- No changes to `characterTurnSchema.ts`, `factRegistry.ts`, `canonStore.ts`, `characterFsm.ts`, or any Project 1 file. This plan touches only a new file plus `character-chat/route.ts`.

---

### Task 1: Causal chain traceability module

**Files:**
- Create: `web/src/lib/characterEngine/causalChain.ts`

**Interfaces:**
- Produces: `CHAIN_ENFORCED_FIELDS: string[]`, `CHAIN_ROOT_FIELDS: string[]`, `ENFORCED_TIERS: string[]`, `claimsTraceability(dependsOn: string[] | undefined): boolean`, `isTraceable(storyId: string, charId: string, dependsOn: string[] | undefined): Promise<boolean>` — all consumed by Task 2.

- [ ] **Step 1: Create the file**

```ts
import { getElement, CHARACTER_FACTS_COLLECTION } from "@/lib/canonEngine/canonStore";

/**
 * P2 causal chain traceability enforcement — GitHub issue #28, design:
 * docs/superpowers/specs/2026-08-07-p2-causal-chain-enforcement-design.md.
 * Scoped to exactly the AC's testable requirement, not the full
 * conceptual Life Experience -> Behavioral Trajectory chain: a Confirmed
 * Core Flaw or Dominant Fear must be traceable to an already-Confirmed
 * Core Wound or False Belief, for Critical/Major-tier characters only.
 */

export const CHAIN_ENFORCED_FIELDS = ["core_flaw", "dominant_fear"];
export const CHAIN_ROOT_FIELDS = ["core_wound", "false_belief"];
export const ENFORCED_TIERS = ["Critical", "Major"];

/** Cheap, I/O-free filter: does this proposal even claim a chain dependency? */
export function claimsTraceability(dependsOn: string[] | undefined): boolean {
  return (dependsOn ?? []).some((f) => CHAIN_ROOT_FIELDS.includes(f));
}

/**
 * Only call once claimsTraceability is true - confirms at least one
 * claimed root field is actually Confirmed in the store, not just named.
 * Checks every claimed root (a proposal might name both); any one being
 * Confirmed is sufficient, matching "traceable to a stated Wound/Belief"
 * (either suffices).
 */
export async function isTraceable(
  storyId: string,
  charId: string,
  dependsOn: string[] | undefined
): Promise<boolean> {
  const claimedRoots = (dependsOn ?? []).filter((f) => CHAIN_ROOT_FIELDS.includes(f));
  for (const root of claimedRoots) {
    const element = await getElement(storyId, `${charId}.${root}`, CHARACTER_FACTS_COLLECTION);
    if (element?.status === "Confirmed") return true;
  }
  return false;
}
```

- [ ] **Step 2: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass (this file isn't imported anywhere yet, so it just needs to compile cleanly on its own).

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/characterEngine/causalChain.ts
git commit -m "feat: add P2 causal chain traceability module (#28)"
```

---

### Task 2: Wire causal chain enforcement into the Character Bible chat route

**Files:**
- Modify: `web/src/app/api/character-chat/route.ts`

**Interfaces:**
- Consumes: `claimsTraceability`, `isTraceable`, `CHAIN_ENFORCED_FIELDS`, `ENFORCED_TIERS` from `@/lib/characterEngine/causalChain` (Task 1).

- [ ] **Step 1: Add the import**

Find:
```ts
import { isKnownFieldId } from "@/lib/characterEngine/factRegistry";
import { resolveCharacterTurn, P2_STAGE_NAMES } from "@/lib/characterEngine/characterFsm";
```
Replace:
```ts
import { isKnownFieldId } from "@/lib/characterEngine/factRegistry";
import { resolveCharacterTurn, P2_STAGE_NAMES } from "@/lib/characterEngine/characterFsm";
import { claimsTraceability, isTraceable, CHAIN_ENFORCED_FIELDS, ENFORCED_TIERS } from "@/lib/characterEngine/causalChain";
```

- [ ] **Step 2: Look up tier and enforce traceability before building fact updates**

Find:
```ts
    for (const u of delta.updates) {
      if (!isKnownFieldId(u.field)) {
        console.warn(
          `[character-chat] unknown field "${u.field}" on turn ${turnId} - not in the Project 2 canonical registry, writing as-is`
        );
      }
    }
    const factUpdates = delta.updates.map((u) => toFactUpdate(u, charId));
```
Replace:
```ts
    const castIndex = foundation.cast.findIndex((m) => slugifyCharacterName(m.name) === charId);
    const tier = castIndex >= 0 ? matrix[castIndex].tier : null;

    const enforcedUpdates: FactUpdateInput[] = [];
    for (const u of delta.updates) {
      if (!isKnownFieldId(u.field)) {
        console.warn(
          `[character-chat] unknown field "${u.field}" on turn ${turnId} - not in the Project 2 canonical registry, writing as-is`
        );
      }

      const enforceChain =
        tier !== null &&
        ENFORCED_TIERS.includes(tier) &&
        CHAIN_ENFORCED_FIELDS.includes(u.field) &&
        u.state === "Confirmed";
      if (enforceChain && !(claimsTraceability(u.depends_on) && (await isTraceable(storyId, charId, u.depends_on)))) {
        console.warn(
          `[character-chat] ${u.field} for ${charId} not traceable to a Confirmed Wound/Belief on turn ${turnId} - downgraded Confirmed->Working`
        );
        enforcedUpdates.push({ ...u, state: "Working" });
      } else {
        enforcedUpdates.push(u);
      }
    }
    const factUpdates = enforcedUpdates.map((u) => toFactUpdate(u, charId));
```
Note: `matrix` (computed earlier in the handler for the system-prompt cast injection) and `slugifyCharacterName` (the module-level helper already defined at the top of this file) are both already in scope here — no new computation or import needed for either.

- [ ] **Step 3: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 4: Manual read-through check**

Confirm by reading the edited function:
- A Critical-tier character's `core_flaw` proposed with `state: "Confirmed"` and `depends_on: []` (or the field omitted): `claimsTraceability` returns `false` immediately (no Firestore read happens), so `enforceChain && !false` is true, and the pushed update has `state: "Working"`.
- The same proposal with `depends_on: ["core_wound"]`, where `deva.core_wound` doesn't exist yet in `characterFacts` (or exists but isn't `Confirmed`): `claimsTraceability` is `true`, `isTraceable` fetches the element, finds it missing/not-Confirmed, returns `false` — downgraded to `Working`.
- The same proposal where `deva.core_wound` *is* `Confirmed`: `isTraceable` returns `true` — the update is pushed unchanged, still `Confirmed`.
- A Supporting-tier character's `core_flaw` proposed `Confirmed` with no `depends_on`: `tier !== null && ENFORCED_TIERS.includes(tier)` is `false` (`"Supporting"` isn't in `ENFORCED_TIERS`) — `enforceChain` is `false`, update passes through unchanged regardless of traceability.
- A `want` field proposed `Confirmed` for a Critical-tier character: `CHAIN_ENFORCED_FIELDS.includes("want")` is `false` — `enforceChain` is `false`, unaffected.
- `factUpdates` is now built from `enforcedUpdates` (not `delta.updates` directly) — confirm nothing later in the function still reads `delta.updates` for anything other than fields untouched by this change (`delta.reply`, `delta.context`, `delta.current_character`, `delta.current_stage`, `delta.character_signed_off`, `delta.switch_override` — none of which are `updates`).

- [ ] **Step 5: Commit**

```bash
git add web/src/app/api/character-chat/route.ts
git commit -m "feat: enforce P2 causal chain traceability on Confirmed Core Flaw/Fear (#28)"
```
