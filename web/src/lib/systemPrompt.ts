import fs from "fs";
import path from "path";

let cached: string | null = null;

/**
 * Loads the SDOS Project 1 system prompt verbatim from system-prompts/,
 * inside this project's own root — single source of truth, do not
 * paraphrase or duplicate this text elsewhere. Kept inside web/ (rather than
 * a sibling directory) so the app's own build has no dependency on files
 * outside its project root, which App Hosting's buildpack build requires.
 */
export function getSystemPrompt(): string {
  if (cached) return cached;
  const promptPath = path.join(
    process.cwd(),
    "system-prompts",
    "sp01-sdos-systemprompt.md"
  );
  cached = fs.readFileSync(promptPath, "utf-8").trim();
  return cached;
}
