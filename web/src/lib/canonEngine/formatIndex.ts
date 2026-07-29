import fs from "fs";
import path from "path";

/**
 * The 101 Story Formats retrieval index — issue #15. Loads the pre-processed
 * JSON (scripts/build-format-index.mjs, issue #14) once and caches it, same
 * pattern as getSystemPrompt(). Pure keyword/TF-IDF scoring, no embeddings,
 * no external API — this corpus is small enough that it doesn't need one
 * (ARCHITECTURE.md §4).
 */

export interface StoryFormat {
  code: string;
  title: string;
  tagline: string;
  coreDefinition: string;
  coreDramaticQuestion: string;
  engines: { plot: string; story: string; theme: string };
  themes: { external: string; internal: string; fear: string; desire: string };
  category: string;
  genres: string[];
  heroArchetypes: string[];
  antagonistArchetypes: string[];
  heroArc: { beginning: string; end: string; external: string };
  masterExamples: { novels: string[]; films: string[] };
  plotStructure: { actI: string; actII: string; actIII: string; templateScenes: string[] };
  commonMistakes: string[];
}

let cachedFormats: StoryFormat[] | null = null;
let cachedIdf: Map<string, number> | null = null;

function loadFormats(): StoryFormat[] {
  if (cachedFormats) return cachedFormats;
  const jsonPath = path.join(process.cwd(), "src", "data", "storyFormats.json");
  cachedFormats = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as StoryFormat[];
  return cachedFormats;
}

export function getAllFormats(): StoryFormat[] {
  return loadFormats();
}

export function getFormatByCode(code: string): StoryFormat | null {
  return loadFormats().find((f) => f.code === code) ?? null;
}

export function isValidFormatCode(code: string): boolean {
  return loadFormats().some((f) => f.code === code);
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with",
  "is", "are", "was", "were", "be", "been", "will", "would", "that", "this",
  "it", "its", "his", "her", "their", "they", "he", "she", "who", "what",
  "when", "where", "how", "why", "does", "do", "not", "no", "can", "must",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function searchableBlob(f: StoryFormat): string {
  return [
    f.title,
    f.coreDefinition,
    f.coreDramaticQuestion,
    f.engines.plot,
    f.engines.story,
    f.engines.theme,
    f.themes.external,
    f.themes.internal,
    f.themes.fear,
    f.themes.desire,
  ].join(" ");
}

/** Document frequency -> IDF per term, computed once and cached alongside the formats. */
function getIdf(): Map<string, number> {
  if (cachedIdf) return cachedIdf;
  const formats = loadFormats();
  const df = new Map<string, number>();
  for (const f of formats) {
    const seen = new Set(tokenize(searchableBlob(f)));
    for (const term of seen) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [term, count] of df) {
    idf.set(term, Math.log(formats.length / (1 + count)));
  }
  cachedIdf = idf;
  return idf;
}

/** Top-N formats by TF-IDF overlap between queryText and each format's
 * searchable blob (title/definitions/engines/themes only - Common Mistakes,
 * Master Examples, and Plot Structure are excluded as noise, not signal). */
export function retrieveTopFormats(queryText: string, limit = 10): StoryFormat[] {
  const formats = loadFormats();
  const idf = getIdf();
  const queryTerms = tokenize(queryText);

  const scored = formats.map((f) => {
    const blobTerms = tokenize(searchableBlob(f));
    const termFreq = new Map<string, number>();
    for (const t of blobTerms) termFreq.set(t, (termFreq.get(t) ?? 0) + 1);

    let score = 0;
    for (const qTerm of queryTerms) {
      const tf = termFreq.get(qTerm) ?? 0;
      if (tf === 0) continue;
      score += tf * (idf.get(qTerm) ?? 0);
    }
    return { format: f, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.format);
}
