import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Separate config for the Firebase security-rules tests (see
// src/lib/security/storageRules.emulator.test.ts). These need the Firebase
// emulator (firestore + storage) already running — run them via
// `npm run test:rules`, which wraps this in `firebase emulators:exec`.
// Kept out of vitest.config.ts / `npm run test` so the default suite stays
// emulator-free and fast.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.emulator.test.ts"],
    // Rules-unit-testing opens real sockets to the emulator; give it room.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
