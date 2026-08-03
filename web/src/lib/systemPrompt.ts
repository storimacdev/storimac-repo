import fs from "fs";
import path from "path";

const cache = new Map<string, string>();

/**
 * Loads a system prompt verbatim from system-prompts/, inside this
 * project's own root — single source of truth, do not paraphrase or
 * duplicate this text elsewhere. Kept inside web/ (rather than a sibling
 * directory) so the app's own build has no dependency on files outside its
 * project root, which App Hosting's buildpack build requires. Cached
 * per-filename (issue #26/#27) so Project 1's and Project 2's prompts don't
 * evict each other from a single-slot cache.
 */
export function getSystemPrompt(fileName: string): string {
  const cached = cache.get(fileName);
  if (cached) return cached;
  const promptPath = path.join(process.cwd(), "system-prompts", fileName);
  const content = fs.readFileSync(promptPath, "utf-8").trim();
  cache.set(fileName, content);
  return content;
}
