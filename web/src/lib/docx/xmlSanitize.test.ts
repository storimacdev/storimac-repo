import { describe, it, expect } from "vitest";
import { stripXmlIllegalChars } from "./xmlSanitize";

/**
 * Coverage for issue #132's shared docx sanitization helper. Both docx
 * exporters (characterBibleDocx.ts, worldBibleDocx.ts) write author-typed
 * text into .docx XML verbatim; stray XML-illegal control characters (e.g.
 * copied from a PDF or terminal) produce a file Word rejects as corrupt
 * while the app reports success. `stripXmlIllegalChars` is the pure
 * function both exporters' `docxValue` helpers funnel every field through
 * before it reaches any TextRun/Paragraph/TableCell call.
 */
describe("stripXmlIllegalChars", () => {
  it("strips every XML 1.0-illegal control character (0x00-0x08, 0x0B-0x0C, 0x0E-0x1F)", () => {
    const illegalCodepoints = [
      ...Array.from({ length: 9 }, (_, i) => i), // 0x00-0x08
      0x0b,
      0x0c,
      ...Array.from({ length: 18 }, (_, i) => 0x0e + i), // 0x0e-0x1f
    ];
    for (const cp of illegalCodepoints) {
      const input = `before${String.fromCharCode(cp)}after`;
      expect(stripXmlIllegalChars(input)).toBe("beforeafter");
    }
  });

  it("does not strip legal whitespace control characters (TAB, LF, CR)", () => {
    expect(stripXmlIllegalChars("a\tb\nc\rd")).toBe("a\tb\nc\rd");
  });

  it("leaves ordinary printable and Unicode text untouched", () => {
    expect(stripXmlIllegalChars("Hello, world! 世界 Привет")).toBe("Hello, world! 世界 Привет");
  });

  it("removes multiple stray control characters from pasted text", () => {
    // e.g. text copied from a terminal or certain word processors, carrying
    // stray C0 control characters the author never noticed.
    const pasted = "Faction\u0000 Name\u0008: the \u001FIron Pact";
    expect(stripXmlIllegalChars(pasted)).toBe("Faction Name: the Iron Pact");
  });

  it("returns an empty string unchanged", () => {
    expect(stripXmlIllegalChars("")).toBe("");
  });

  it("can strip a string down to empty when it's made entirely of illegal characters", () => {
    expect(stripXmlIllegalChars("\u0000\u0001\u0002")).toBe("");
  });
});
