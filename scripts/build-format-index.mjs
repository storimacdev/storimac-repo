#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Pre-processes project-docs/storimac-refdocs/P1-R1-101-Story-Formats.md into
 * web/src/data/storyFormats.json. Manual dev-time tool, NOT run during
 * web/'s build (see ARCHITECTURE.md §7 - a prebuild step that read outside
 * web/ broke Cloud Build once already). Re-run manually if the source
 * document changes: `node scripts/build-format-index.mjs`.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = path.join(
  __dirname,
  "..",
  "project-docs",
  "storimac-refdocs",
  "P1-R1- 101 Story Formats 3ab7acc8d303801ba963e92f3a101dd3.md"
);
const OUTPUT_PATH = path.join(__dirname, "..", "web", "src", "data", "storyFormats.json");

const VOLUME_LETTERS = ["A", "B", "C", "D", "E"];

// The source document has one confirmed misplacement: a full entry titled
// "THE TRANSFORMATIVE JOURNEY" sits at the end of Volume B's section (bare
// code "21") but is the missing C20 record - confirmed against the BA's
// spec directly (2026-07-28). This is the one explicit override; every
// other bare-numbered header (B19, C10) is fixed by the volume section
// it's physically found in, not a rename.
const CODE_OVERRIDES = {
  "THE TRANSFORMATIVE JOURNEY": "C20",
};

function toTitleCase(allCaps) {
  const SMALL = new Set(["a", "an", "the", "of", "in", "on", "vs", "and", "or", "to", "at", "for"]);
  return allCaps
    .toLowerCase()
    .split(" ")
    .map((word, i) => {
      if (i > 0 && SMALL.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanText(raw) {
  return raw
    .replace(/\|/g, " ")
    .replace(/^[:\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Extracts text between a **Label** marker and the next **Label** marker (or
// end of block). The source uses a loose pipe-table format where a "cell"
// can span multiple physical lines, so this treats the block as a linear
// sequence of bold labels rather than trying to parse strict table rows.
function extractField(block, label, nextLabels) {
  const startRe = new RegExp(`\\*\\*${escapeRegex(label)}\\*\\*`);
  const startMatch = block.match(startRe);
  if (!startMatch) return "";
  const afterStart = block.slice(startMatch.index + startMatch[0].length);
  let end = afterStart.length;
  for (const next of nextLabels) {
    const nextRe = new RegExp(`\\*\\*${escapeRegex(next)}\\*\\*`);
    const nextMatch = afterStart.match(nextRe);
    if (nextMatch && nextMatch.index < end) end = nextMatch.index;
  }
  return cleanText(afterStart.slice(0, end));
}

function splitList(text) {
  return text
    .split(/[•,]/)
    .map((s) => cleanText(s))
    .filter(Boolean);
}

// Hero/Antagonist Archetypes are a header row ("**Hero Archetypes**")
// followed by two value rows of up to 3 pipe-separated items each.
function extractArchetypeRows(block, label) {
  const startRe = new RegExp(`\\*\\*${escapeRegex(label)}\\*\\*[^\\n]*\\n`);
  const m = block.match(startRe);
  if (!m) return [];
  const after = block.slice(m.index + m[0].length);
  const rows = after.split("\n").slice(0, 2);
  const items = [];
  for (const row of rows) {
    if (row.trim().startsWith("**")) break;
    for (const cell of row.split("|")) {
      const cleaned = cleanText(cell);
      if (cleaned) items.push(cleaned);
    }
  }
  return items;
}

function parseEntry(code, title, block) {
  const coreDefinition = extractField(block, "Core Definition", ["Core Dramatic Question"]);
  const coreDramaticQuestion = extractField(block, "Core Dramatic Question", ["Engines", "Plot Engine"]);

  // Engines: a 3-column header row ("**Plot Engine** | **Story Engine** |
  // **Theme Engine**") followed immediately by a 3-cell value row - not a
  // "**Label**: value" pair like every other field. Filter out empty cells
  // before taking positions 0/1/2: one source entry (B13) has a stray extra
  // empty pipe cell between Story and Theme Engine.
  const enginesRow = block.match(/\*\*Plot Engine\*\*[^\n]*\n\|([^\n]+)\|/);
  const engineCellsRaw = enginesRow ? enginesRow[1].split("|").map((s) => cleanText(s)).filter(Boolean) : [];
  const engineCells = [engineCellsRaw[0] || "", engineCellsRaw[1] || "", engineCellsRaw[2] || ""];

  const externalTheme = extractField(block, "External Theme:", ["Internal Theme:"]);
  const internalTheme = extractField(block, "Internal Theme:", ["Universal Human Fear:"]);
  const fear = extractField(block, "Universal Human Fear:", ["Universal Human Desire:"]);
  const desire = extractField(block, "Universal Human Desire:", ["Category"]);
  // "Category" boundary must try the plural "Probable Genres" FIRST - a
  // boundary regex for the singular "Probable Genre" does not match the
  // plural label text, so Category would otherwise swallow everything to
  // the end of the block.
  const category = extractField(block, "Category", ["Probable Genres", "Probable Genre", "Possible Genres"]);
  const genresRaw =
    extractField(block, "Probable Genres", ["Hero Archetypes"]) ||
    extractField(block, "Probable Genre", ["Hero Archetypes"]) ||
    extractField(block, "Possible Genres", ["Hero Archetypes"]);
  const genres = splitList(genresRaw);

  const heroArchetypes = extractArchetypeRows(block, "Hero Archetypes");
  const antagonistArchetypes = extractArchetypeRows(block, "Antagonist Archetypes");

  const arcBeginning = extractField(block, "Internal (Beginning):", ["Internal Arc (End):"]);
  const arcEnd = extractField(block, "Internal Arc (End):", ["External Arc:"]);
  const arcExternal = extractField(block, "External Arc:", ["Antagonist Archetypes"]);

  const novelsRaw = extractField(block, "Novels", ["Films"]);
  const filmsRaw = extractField(block, "Films", ["TYPICAL PLOT STRUCTURE"]);

  const actI = extractField(block, "ACT I", ["ACT II"]);
  const actII = extractField(block, "ACT II", ["ACT III"]);
  const actIII = extractField(block, "ACT III", ["Template Scenes"]);
  const templateScenesRaw = extractField(block, "Template Scenes", ["Common Mistakes"]);
  const commonMistakesRaw = extractField(block, "(Cross Check)", []);

  const firstSentenceMatch = coreDefinition.match(/^[^.]+\./);
  const tagline = firstSentenceMatch ? firstSentenceMatch[0].trim() : coreDefinition.slice(0, 80);

  return {
    code,
    title,
    tagline,
    coreDefinition,
    coreDramaticQuestion,
    engines: { plot: engineCells[0], story: engineCells[1], theme: engineCells[2] },
    themes: { external: externalTheme, internal: internalTheme, fear, desire },
    category,
    genres,
    heroArchetypes,
    antagonistArchetypes,
    heroArc: { beginning: arcBeginning, end: arcEnd, external: arcExternal },
    masterExamples: {
      novels: novelsRaw.split(",").map((s) => cleanText(s)).filter(Boolean),
      films: filmsRaw.split(",").map((s) => cleanText(s)).filter(Boolean),
    },
    plotStructure: {
      actI,
      actII,
      actIII,
      templateScenes: templateScenesRaw.split("•").map((s) => cleanText(s)).filter(Boolean),
    },
    commonMistakes: commonMistakesRaw.split("•").map((s) => cleanText(s)).filter(Boolean),
  };
}

export function parseFormats(text) {
  const lines = text.split(/\r?\n/);
  const headers = [];
  const volumeMarkerLines = [];
  let volumeIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    // "**MASTER STORY DESIGN ENCYCLOPEDIA**" is repeated immediately before
    // every "**Volume N**" marker - both mark the same section boundary and
    // must stop the preceding entry's block, or its last field (Common
    // Mistakes) swallows this heading text.
    if (/^\*\*Volume \d+\*\*/.test(lines[i]) || /^\*\*MASTER STORY DESIGN ENCYCLOPEDIA\*\*/.test(lines[i])) {
      if (/^\*\*Volume \d+\*\*/.test(lines[i])) volumeIndex++;
      volumeMarkerLines.push(i);
      continue;
    }
    const m = lines[i].match(/^\|\s*\*\*\s*([A-E]?)(\d{1,2})\.\s*(.+?)\*\*\s*\|/);
    if (m) {
      const [, letterPrefix, num, rawTitle] = m;
      const title = toTitleCase(rawTitle.trim());
      const override = CODE_OVERRIDES[rawTitle.trim().toUpperCase()];
      const code = override ?? `${letterPrefix || VOLUME_LETTERS[volumeIndex]}${num.padStart(2, "0")}`;
      headers.push({ lineIndex: i, code, title });
    }
  }

  return headers.map((h, idx) => {
    const start = h.lineIndex + 1;
    // A block ends at whichever comes first: the next detail-table header,
    // or the next volume/encyclopedia-heading marker. Without the second
    // check, an entry physically last in its section (e.g. the misplaced
    // C20 override) would swallow the following volume's intro material
    // into its own Common Mistakes field.
    const nextHeaderLine = idx + 1 < headers.length ? headers[idx + 1].lineIndex : lines.length;
    const nextVolumeLine = volumeMarkerLines.find((v) => v > h.lineIndex) ?? lines.length;
    const end = Math.min(nextHeaderLine, nextVolumeLine);
    const block = lines.slice(start, end).join("\n");
    return parseEntry(h.code, h.title, block);
  });
}

function main() {
  const sourceText = fs.readFileSync(SOURCE_PATH, "utf8");
  const formats = parseFormats(sourceText);

  const vols = { A: 20, B: 20, C: 20, D: 20, E: 21 };
  const expected = [];
  for (const [v, n] of Object.entries(vols)) {
    for (let k = 1; k <= n; k++) expected.push(v + String(k).padStart(2, "0"));
  }
  const codes = formats.map((f) => f.code);
  const codeSet = new Set(codes);
  const missing = expected.filter((c) => !codeSet.has(c));
  const dupes = codes.filter((c, i) => codes.indexOf(c) !== i);

  if (formats.length !== 101 || missing.length > 0 || dupes.length > 0) {
    console.error("Format index verification FAILED:");
    console.error("  total:", formats.length, "(expected 101)");
    console.error("  missing:", JSON.stringify(missing));
    console.error("  duplicates:", JSON.stringify(dupes));
    process.exit(1);
  }

  const REQUIRED_STRING_FIELDS = [
    "title", "tagline", "coreDefinition", "coreDramaticQuestion", "category",
  ];
  let incomplete = 0;
  for (const f of formats) {
    const missingFields = REQUIRED_STRING_FIELDS.filter((k) => !f[k]);
    if (!f.engines.plot || !f.engines.story || !f.engines.theme) missingFields.push("engines");
    if (!f.themes.external || !f.themes.internal || !f.themes.fear || !f.themes.desire) missingFields.push("themes");
    if (f.genres.length === 0) missingFields.push("genres");
    if (f.heroArchetypes.length === 0) missingFields.push("heroArchetypes");
    if (f.antagonistArchetypes.length === 0) missingFields.push("antagonistArchetypes");
    if (!f.heroArc.beginning || !f.heroArc.end || !f.heroArc.external) missingFields.push("heroArc");
    if (f.masterExamples.novels.length === 0 || f.masterExamples.films.length === 0) missingFields.push("masterExamples");
    if (!f.plotStructure.actI || !f.plotStructure.actII || !f.plotStructure.actIII) missingFields.push("plotStructure.act");
    if (f.plotStructure.templateScenes.length === 0) missingFields.push("plotStructure.templateScenes");
    if (f.commonMistakes.length === 0) missingFields.push("commonMistakes");
    if (missingFields.length > 0) {
      incomplete++;
      console.error(`Incomplete entry ${f.code} (${f.title}): missing ${missingFields.join(", ")}`);
    }
  }
  if (incomplete > 0) {
    console.error(`${incomplete} incomplete entries.`);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(formats, null, 2) + "\n");
  console.log(`Wrote ${formats.length} formats to ${OUTPUT_PATH}`);
}

main();
