import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Unit tests for saveNextWorldBibleVersion - issue #129's fix. The rest of
 * storyStore.ts (and the real Firebase Admin SDK) is out of scope for this
 * suite; this is a minimal fake Firestore sufficient to exercise the one
 * function whose transaction logic issue #129 actually changed - the
 * "read latest + compute next + write" race that used to let two
 * concurrent compiles clobber each other.
 */

vi.mock("@/lib/firebaseAdmin", () => ({ getDb: vi.fn() }));

import { getDb } from "@/lib/firebaseAdmin";
import { saveNextWorldBibleVersion, type StoredWorldBibleVersion } from "./storyStore";

class FakeQuery {
  constructor(
    private readonly docs: Map<string, StoredWorldBibleVersion>,
    private readonly dir: "asc" | "desc",
    private readonly lim: number | null = null
  ) {}

  limit(n: number): FakeQuery {
    return new FakeQuery(this.docs, this.dir, n);
  }

  async get(): Promise<{ empty: boolean; docs: { id: string; data: () => StoredWorldBibleVersion }[] }> {
    const sorted = Array.from(this.docs.entries())
      .map(([id, data]) => ({ id, data }))
      .sort((a, b) => (this.dir === "asc" ? a.data.version - b.data.version : b.data.version - a.data.version));
    const limited = this.lim != null ? sorted.slice(0, this.lim) : sorted;
    return { empty: limited.length === 0, docs: limited.map((d) => ({ id: d.id, data: () => d.data })) };
  }
}

/** A fake Firestore strict enough to exercise worldBibleVersionsCollection's
 * actual call chain (storiesCollection().doc(storyId).collection(...)) plus
 * tx.get/tx.create - nothing more. `runTransaction` here does NOT retry on
 * contention (unlike the real Admin SDK); each test instead drives the two
 * "concurrent" transaction bodies by hand to assert what happens when both
 * commit anyway. */
function createFakeDb() {
  const versions = new Map<string, StoredWorldBibleVersion>();

  const worldBibleVersionsCollection = {
    doc(id: string) {
      return { id };
    },
    orderBy(_field: string, dir: "asc" | "desc") {
      return new FakeQuery(versions, dir);
    },
  };

  const db = {
    collection(name: string) {
      if (name !== "stories") throw new Error(`fake db: unexpected top-level collection "${name}"`);
      return {
        doc() {
          return {
            collection(subName: string) {
              if (subName !== "worldBibleVersions") throw new Error(`fake db: unexpected subcollection "${subName}"`);
              return worldBibleVersionsCollection;
            },
          };
        },
      };
    },
    async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const tx = {
        get(target: FakeQuery) {
          return target.get();
        },
        create(ref: { id: string }, data: StoredWorldBibleVersion) {
          if (versions.has(ref.id)) {
            const err = new Error(`fake db: document "${ref.id}" already exists (ALREADY_EXISTS)`);
            throw err;
          }
          versions.set(ref.id, data);
        },
      };
      return fn(tx);
    },
  };

  return { db, versions };
}

function minimalVersion(version: number): StoredWorldBibleVersion {
  return {
    version,
    date: "2026-10-16",
    summary_of_changes: "test",
    json: {} as StoredWorldBibleVersion["json"],
    markdown: "",
    elementsSnapshot: {},
    confirmed: false,
    confirmedAt: null,
  };
}

describe("saveNextWorldBibleVersion", () => {
  let fake: ReturnType<typeof createFakeDb>;

  beforeEach(() => {
    fake = createFakeDb();
    vi.mocked(getDb).mockReturnValue(fake.db as unknown as ReturnType<typeof getDb>);
  });

  it("assigns version 1 and empty priorHistory when no version exists yet", async () => {
    const stored = await saveNextWorldBibleVersion("story-1", (prior, priorHistory) => {
      expect(prior).toBeNull();
      expect(priorHistory).toEqual([]);
      return minimalVersion((prior?.version ?? 0) + 1);
    });
    expect(stored.version).toBe(1);
    expect(fake.versions.get("1")).toEqual(stored);
  });

  it("reads the latest prior version and the full ascending history when one exists", async () => {
    fake.versions.set("1", { ...minimalVersion(1), summary_of_changes: "Initial generation." });

    const stored = await saveNextWorldBibleVersion("story-1", (prior, priorHistory) => {
      expect(prior?.version).toBe(1);
      expect(priorHistory).toEqual([{ version: "v1", date: "2026-10-16", summary_of_changes: "Initial generation." }]);
      return minimalVersion((prior?.version ?? 0) + 1);
    });
    expect(stored.version).toBe(2);
    expect(fake.versions.size).toBe(2);
  });

  it("issue #129: a lost race throws instead of silently clobbering the winner's write", async () => {
    // Simulate two concurrent compiles for the same empty story: both
    // "read" prior = null and both compute version 1, exactly the
    // scenario issue #129 describes. The real Admin SDK would retry one
    // of these transactions automatically on read-set contention; this
    // fake does not retry, so it instead proves the second line of
    // defense - tx.create - rejects the loser outright rather than
    // overwriting the winner.
    const winnerResult = minimalVersion(1);
    const loserResult = minimalVersion(1);

    const winner = saveNextWorldBibleVersion("story-1", () => winnerResult);
    await expect(winner).resolves.toEqual(winnerResult);

    const loser = saveNextWorldBibleVersion("story-1", () => loserResult);
    await expect(loser).rejects.toThrow(/already exists/i);

    // The winner's write must still be the one on record - never clobbered.
    expect(fake.versions.get("1")).toEqual(winnerResult);
    expect(fake.versions.size).toBe(1);
  });
});
