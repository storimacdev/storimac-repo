/**
 * Shared sanitization for issue #132 - the `docx` package writes
 * author-typed text into `.docx` XML (word/document.xml) verbatim, with no
 * check for XML-illegal control characters. Word rejects a file containing
 * them as corrupt, while the app reports a successful download - a silent
 * failure the author only discovers after trying to open the file.
 *
 * Per the XML 1.0 spec's `Char` production
 * (https://www.w3.org/TR/xml/#charsets):
 *   Char ::= #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF]
 * every other codepoint below #x20 is illegal - that is, #x00-#x08,
 * #x0B-#x0C, and #x0E-#x1F (TAB #x09, LF #x0A, and CR #x0D stay legal and
 * must NOT be stripped, since authors' multi-line text relies on them).
 *
 * Both docx exporters (characterBibleDocx.ts, worldBibleDocx.ts) funnel
 * every field through their own local `docxValue`-style normalization
 * helper already - this is the one shared step both call before any
 * `TextRun`/`Paragraph`/`TableCell` call.
 */
export function stripXmlIllegalChars(v: string): string {
  return v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}
