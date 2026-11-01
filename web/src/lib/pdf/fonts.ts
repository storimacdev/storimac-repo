import { Font } from "@react-pdf/renderer";

/**
 * Shared Unicode-coverage font registration for @react-pdf/renderer
 * (issue #133). Both PDF exporters (FoundationPdfDocument.tsx, Project 1;
 * WorldBiblePdfDocument.tsx, Project 3) previously pinned
 * `fontFamily: "Helvetica"`, a standard-14 PDF font with Latin-1-only
 * coverage - any non-Latin glyph (CJK, Cyrillic, Devanagari, emoji) in
 * author-typed content silently rendered as a blank glyph instead of
 * erroring.
 *
 * Noto Sans Regular (OFL-licensed, vendored at public/fonts/NotoSans-Regular.ttf)
 * replaces Helvetica in both files' StyleSheet.create calls, extending
 * coverage to Latin Extended, Cyrillic, Greek, and Vietnamese. It does NOT
 * cover CJK, Devanagari, or emoji - those require separate, much larger
 * font families (Noto Sans CJK is tens of MB per weight; Noto Color Emoji
 * is a multi-MB bitmap font with uncertain @react-pdf/renderer support) that
 * would violate the "keep the file small" guidance for this fix. That
 * remaining gap is a known limitation, not a silent regression: it's the
 * same failure mode as before (blank glyphs, no thrown error) for those
 * specific scripts, just narrowed from "all non-Latin-1 text" to "CJK/
 * Devanagari/emoji specifically."
 */
export const PDF_FONT_FAMILY = "Noto Sans";

let registered = false;

export function registerPdfFonts(): void {
  if (registered) return;
  Font.register({
    family: PDF_FONT_FAMILY,
    src: "/fonts/NotoSans-Regular.ttf",
  });
  registered = true;
}
