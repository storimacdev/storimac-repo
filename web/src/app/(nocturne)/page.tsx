import Link from "next/link";

export default function Home() {
  return (
    <div className="nocturne-scope ob-root">
      <div className="ob-topbar">
        <div className="ob-brand">Storimac</div>
      </div>

      <main className="ob-stage" style={{ flexDirection: "column", textAlign: "center" }}>
        <div className="mx-auto flex max-w-2xl flex-col items-center">
          <h1 className="ob-question">
            Turn a story idea into a locked creative foundation.
          </h1>
          <p className="ob-help">
            A guided interview with an expert development editor discovers
            your premise, format, theme, and dramatic engine — one focused
            question at a time — and locks it into a Story Foundation
            Document your future drafting depends on.
          </p>

          <div className="flex items-center gap-4">
            <Link href="/onboarding" className="btn btn-primary">
              Get Started
            </Link>
            <span className="ob-hint">
              Takes under a minute to set up your workspace.
            </span>
          </div>

          <ul className="mt-16 grid w-full gap-4 text-left sm:grid-cols-3">
            <Feature
              title="Discovery, not generation"
              body="1–2 sharp questions per turn. No questionnaire dumps, no premature plotting."
            />
            <Feature
              title="Canon that can't drift"
              body="Every decision is Exploring, Working, Confirmed, or Parked — contradictions are caught, never silently overwritten."
            />
            <Feature
              title="Stays in its lane"
              body="Discovers what the story is, never how it's written — character, world, and prose live in later projects."
            />
          </ul>
        </div>
      </main>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <li className="card">
      <p className="card-title">{title}</p>
      <p className="card-body">{body}</p>
    </li>
  );
}
