/**
 * Mocked preview of a pipeline end-product, shown alongside onboarding to
 * give a concrete sense of what the Story Foundation -> ... -> Draft Writing
 * pipeline eventually produces. Static, hand-authored content — not a real
 * generated document, and not wired to the actual interview/canon engine.
 *
 * Grounded in the reference story used across the GitHub issues/PRDs for
 * Projects 3-4 ("Identity Swap" — satirical sci-fi dramedy, 2085, a Digital
 * Identity Profile / "the Grid" system standing in for physical identity;
 * protagonist Rhea, referenced in Project 4's Canon Revision test case).
 */

type Line =
  | { type: "heading"; text: string }
  | { type: "action"; text: string }
  | { type: "character"; text: string }
  | { type: "paren"; text: string }
  | { type: "dialogue"; text: string };

const SCRIPT: Line[] = [
  { type: "heading", text: "INT. GRID REGISTRY OFFICE — DAY" },
  {
    type: "action",
    text: "A waiting room built for people who don't queue anymore — except here, they do. RHEA (30s, sharp-eyed, badge crooked) grips an honest-to-god paper form. Real ink. No profile attached.",
  },
  { type: "character", text: "CLERK (O.S.)" },
  { type: "dialogue", text: "Next." },
  {
    type: "action",
    text: "Rhea steps up. The CLERK doesn't look up from her terminal, where a DIP hovers over every other head in the room like a glitching halo.",
  },
  { type: "character", text: "RHEA" },
  { type: "dialogue", text: "I'd like to un-sync. Permanently." },
  { type: "character", text: "CLERK" },
  { type: "paren", text: "(flat, rehearsed)" },
  { type: "dialogue", text: "Nobody un-syncs, ma'am. The Grid doesn't expire. It adapts." },
  { type: "action", text: "Rhea sets the form down between them. Her own birth certificate." },
  { type: "character", text: "RHEA" },
  { type: "dialogue", text: "Then adapt it to somebody else." },
];

export default function ScriptPreview() {
  return (
    <div className="ob-preview">
      <div className="ob-preview-inner">
        <p className="ob-preview-eyebrow">Where this leads</p>
        <div className="ob-preview-card">
          <div className="ob-preview-titlebar">
            <span className="ob-preview-title">IDENTITY SWAP — Draft, Sc. 14</span>
            <span className="tag tag-neutral">Preview</span>
          </div>
          <div className="ob-script">
            {SCRIPT.map((line, i) => {
              switch (line.type) {
                case "heading":
                  return (
                    <p className="ob-script-heading" key={i}>
                      {line.text}
                    </p>
                  );
                case "action":
                  return (
                    <p className="ob-script-action" key={i}>
                      {line.text}
                    </p>
                  );
                case "character":
                  return (
                    <p className="ob-script-character" key={i}>
                      {line.text}
                    </p>
                  );
                case "paren":
                  return (
                    <p className="ob-script-paren" key={i}>
                      {line.text}
                    </p>
                  );
                case "dialogue":
                  return (
                    <p className="ob-script-dialogue" key={i}>
                      {line.text}
                    </p>
                  );
              }
            })}
          </div>
        </div>
        <p className="ob-preview-caption">
          A mocked look at the finished pipeline — your Story Foundation,
          Character Bible, and Story Architecture eventually draft out to
          this. Nothing here is generated yet.
        </p>
      </div>
    </div>
  );
}
