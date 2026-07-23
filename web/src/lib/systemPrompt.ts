import fs from "fs";
import path from "path";

let cached: string | null = null;

/**
 * Loads the SDOS Project 1 system prompt verbatim.
 *
 * Reads from generated/system-prompts/, a synced copy of the real source of
 * truth (../system-prompts/ at the repo root — see scripts/sync-system-prompts.mjs).
 * This indirection exists because a relative fs read outside the project root
 * isn't reliably caught by Next's output file tracing for `output: 'standalone'`
 * builds — the synced copy lives inside web/ so it's traced like any other
 * project file. Do not hand-edit the generated/ copy or paraphrase this text
 * elsewhere; edit ../system-prompts/sp01-sdos-systemprompt.md instead.
 */
export function getSystemPrompt(): string {
  if (cached) return cached;
  const promptPath = path.join(
    process.cwd(),
    "generated",
    "system-prompts",
    "sp01-sdos-systemprompt.md"
  );
  cached = fs.readFileSync(promptPath, "utf-8").trim();
  return cached;
}
