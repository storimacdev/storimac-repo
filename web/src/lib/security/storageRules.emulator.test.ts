// Verifies storage.rules' cross-service firestore.get() ownership check
// against the real Firebase emulator (Firestore + Storage).
//
// ARCHITECTURE.md §7 flagged this as "unverified against a live/emulated
// project" since 2026-07-24 (issue #103). This test confirms the rule
// behaves as the comment in storage.rules claims: a /stories/{storyId}
// export is readable/writable only by the authenticated user whose uid
// matches that story's Firestore `ownerUid` field.
//
// Run via `npm run test:rules` (from web/), which wraps this file in
// `firebase emulators:exec --only firestore,storage` so the emulators are
// up before vitest connects. It is intentionally excluded from the default
// `npm run test` run (see vitest.config.ts) since it needs those emulators
// running; `npm run test` stays emulator-free.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { ref, uploadBytes, getBytes } from "firebase/storage";
import { afterAll, beforeAll, describe, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// web/src/lib/security -> repo root is four levels up.
const repoRoot = path.resolve(__dirname, "../../../../");

const PROJECT_ID = "demo-storimac-rules-test";
const FIRESTORE_PORT = 8080;
const STORAGE_PORT = 9199;

let testEnv: RulesTestEnvironment;

async function seedStory(storyId: string, ownerUid: string) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "stories", storyId), { ownerUid });
  });
}

const exportBytes = new Uint8Array([1, 2, 3]);

describe("storage.rules: /stories/{storyId}/** ownership via cross-service firestore.get()", () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: readFileSync(path.join(repoRoot, "firestore.rules"), "utf8"),
        host: "127.0.0.1",
        port: FIRESTORE_PORT,
      },
      storage: {
        rules: readFileSync(path.join(repoRoot, "storage.rules"), "utf8"),
        host: "127.0.0.1",
        port: STORAGE_PORT,
      },
    });
  });

  afterAll(async () => {
    await testEnv?.cleanup();
  });

  it("lets the story's owner write an export", async () => {
    await seedStory("story-owned-by-alice", "alice-uid");
    const alice = testEnv.authenticatedContext("alice-uid");

    await assertSucceeds(
      uploadBytes(ref(alice.storage(), "stories/story-owned-by-alice/exports/doc.docx"), exportBytes),
    );
  });

  it("lets the story's owner read their own export back", async () => {
    await seedStory("story-owned-by-alice-2", "alice-uid");
    const alice = testEnv.authenticatedContext("alice-uid");
    await uploadBytes(ref(alice.storage(), "stories/story-owned-by-alice-2/exports/doc.docx"), exportBytes);

    await assertSucceeds(getBytes(ref(alice.storage(), "stories/story-owned-by-alice-2/exports/doc.docx")));
  });

  it("denies a different authenticated user from writing to someone else's story", async () => {
    await seedStory("story-owned-by-alice-3", "alice-uid");
    const bob = testEnv.authenticatedContext("bob-uid");

    await assertFails(
      uploadBytes(ref(bob.storage(), "stories/story-owned-by-alice-3/exports/evil.docx"), exportBytes),
    );
  });

  it("denies a different authenticated user from reading someone else's story export", async () => {
    await seedStory("story-owned-by-alice-4", "alice-uid");
    const alice = testEnv.authenticatedContext("alice-uid");
    await uploadBytes(ref(alice.storage(), "stories/story-owned-by-alice-4/exports/doc.docx"), exportBytes);

    const bob = testEnv.authenticatedContext("bob-uid");
    await assertFails(getBytes(ref(bob.storage(), "stories/story-owned-by-alice-4/exports/doc.docx")));
  });

  it("denies an unauthenticated request entirely", async () => {
    await seedStory("story-owned-by-alice-5", "alice-uid");
    const alice = testEnv.authenticatedContext("alice-uid");
    await uploadBytes(ref(alice.storage(), "stories/story-owned-by-alice-5/exports/doc.docx"), exportBytes);

    const anon = testEnv.unauthenticatedContext();
    await assertFails(getBytes(ref(anon.storage(), "stories/story-owned-by-alice-5/exports/doc.docx")));
  });

  it("denies a user who owns a DIFFERENT story (confirms the check is per-storyId, not just 'has any story')", async () => {
    await seedStory("story-owned-by-alice-6", "alice-uid");
    await seedStory("story-owned-by-bob", "bob-uid");
    const bob = testEnv.authenticatedContext("bob-uid");

    await assertFails(
      uploadBytes(ref(bob.storage(), "stories/story-owned-by-alice-6/exports/evil.docx"), exportBytes),
    );
  });

  it("denies access to a storyId with no backing Firestore doc at all", async () => {
    const alice = testEnv.authenticatedContext("alice-uid");

    await assertFails(
      uploadBytes(ref(alice.storage(), "stories/does-not-exist/exports/doc.docx"), exportBytes),
    );
  });
});
