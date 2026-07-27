const STEPS = [
  {
    title: "Answer one focused question at a time",
    body: "An expert development editor interviews you — 1–2 sharp questions per turn. No forms, no questionnaire dumps, no premature plotting.",
  },
  {
    title: "Watch decisions harden into canon",
    body: "Every answer is tracked as Exploring, Working, Confirmed, or Parked. Contradictions are caught and resolved — never silently overwritten.",
  },
  {
    title: "Lock your Story Foundation Document",
    body: "Finish the interview and walk away with the document your drafting depends on: premise, format, theme, and dramatic engine — settled.",
  },
];

export default function HowItWorks() {
  return (
    <section className="ld-section">
      <div className="ld-inner">
        <p className="ld-kicker">How it works</p>
        <h2 className="ld-h2">From spark to foundation, in three moves.</h2>
        <ol className="ld-grid3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="ld-step">
              <span className="ld-step-num">{i + 1}</span>
              <p className="card-title">{s.title}</p>
              <p className="card-body">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
