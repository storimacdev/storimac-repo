const FAQS = [
  {
    q: "Does the AI write my story?",
    a: "No. Storimac never generates prose, scenes, or plot on your behalf. It interviews you, structures your answers, and locks decisions — the writing stays yours.",
  },
  {
    q: "Who owns what we make?",
    a: "You do. Your answers, your canon, and your Story Foundation Document are yours — Storimac stores them for you and claims no rights over your work.",
  },
  {
    q: "What formats does it support?",
    a: "Novels, features, one-hour dramas, limited series, and more — format is one of the first things the interview pins down, and later questions adapt to it.",
  },
  {
    q: "What happens after the foundation is locked?",
    a: "You leave with a Story Foundation Document built for drafting. Character, world, and prose development are separate projects that build on this canon.",
  },
  {
    q: "Can I change a locked decision?",
    a: "Yes. Revision is deliberate: reopen a decision and every dependent piece of canon is re-reviewed in cascade, so the change can't quietly break the rest.",
  },
];

export default function Faq() {
  return (
    <section className="ld-section">
      <div className="ld-inner ld-narrow">
        <p className="ld-kicker">Questions</p>
        <h2 className="ld-h2">Fair questions, straight answers.</h2>
        {FAQS.map((f) => (
          <details key={f.q} className="ld-faq">
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
