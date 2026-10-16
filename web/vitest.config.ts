import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Emulator-backed security-rules tests need the Firebase emulator
    // (firestore + storage) running first — see vitest.rules.config.ts and
    // the `test:rules` script. They don't belong in the default `npm run
    // test` run, which must stay mock-free and emulator-free.
    exclude: ["**/node_modules/**", "**/*.emulator.test.ts"],
  },
});
