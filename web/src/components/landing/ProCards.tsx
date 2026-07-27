const CARDS = [
  {
    kicker: "Craft",
    title: "Discovery, not generation",
    body: "1–2 sharp questions per turn. No questionnaire dumps, no premature plotting.",
  },
  {
    kicker: "Canon",
    title: "Canon that can't drift",
    body: "Every decision is Exploring, Working, Confirmed, or Parked — contradictions are caught, never silently overwritten.",
  },
  {
    kicker: "Scope",
    title: "Stays in its lane",
    body: "Discovers what the story is, never how it's written — character, world, and prose live in later projects.",
  },
  {
    kicker: "Method",
    title: "A structural spine",
    body: "Eight gated stages take a premise to a dramatic engine in order, with deliberate non-linear revision when a foundation shifts.",
  },
];

export default function ProCards() {
  return (
    <section className="ld-section">
      <div className="ld-inner">
        <p className="ld-kicker">For serious writers</p>
        <h2 className="ld-h2">Rigor you can feel in the questions.</h2>
        <ul className="ld-grid4">
          {CARDS.map((c) => (
            <li key={c.title} className="card">
              <p className="card-kicker">{c.kicker}</p>
              <p className="card-title">{c.title}</p>
              <p className="card-body">{c.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
