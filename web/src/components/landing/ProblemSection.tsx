const PROBLEMS = [
  {
    title: "Ideas stall mid-draft",
    body: "The premise that felt alive in your head runs out of road at chapter twelve, because the foundations were never tested.",
  },
  {
    title: "Notes that contradict each other",
    body: "Three documents, four timelines, two versions of the same backstory. Nobody is keeping score — so the story quietly falls apart.",
  },
  {
    title: "AI that writes instead of thinks",
    body: "Most tools rush to generate pages. What a story needs first is someone asking the hard questions — and remembering your answers.",
  },
];

export default function ProblemSection() {
  return (
    <section className="ld-section">
      <div className="ld-inner">
        <p className="ld-kicker">Why stories stall</p>
        <h2 className="ld-h2">Most story ideas don&apos;t fail. They drift.</h2>
        <ul className="ld-grid3">
          {PROBLEMS.map((p) => (
            <li key={p.title} className="card">
              <p className="card-title">{p.title}</p>
              <p className="card-body">{p.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
