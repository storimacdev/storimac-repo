// Copies the system-prompt files this app needs from ../system-prompts/ into
// web/generated/system-prompts/, so they ship inside Next's file-traced
// `output: 'standalone'` build (and any Docker image built from it) without
// relying on a fragile relative fs read outside the project root.
//
// Source of truth stays system-prompts/ at the repo root — this is a synced
// copy, never hand-edited. Run automatically via the predev/prebuild npm
// hooks; see package.json.

import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const destDir = join(__dirname, "..", "generated", "system-prompts");

const files = ["sp01-sdos-systemprompt.md"];

mkdirSync(destDir, { recursive: true });

for (const file of files) {
  const src = join(repoRoot, "system-prompts", file);
  const dest = join(destDir, file);
  copyFileSync(src, dest);
  console.log(`synced ${file}`);
}
