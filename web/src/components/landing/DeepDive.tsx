export default function DeepDive() {
  return (
    <section className="ld-section">
      <div className="ld-inner">
        <p className="ld-kicker">Under the hood</p>
        <h2 className="ld-h2">Built like a development process, not a chat window.</h2>

        <div className="ld-row">
          <div className="ld-row-text">
            <h3 className="ld-h3">Conflicts are surfaced, never silently overwritten</h3>
            <p className="ld-body">
              When a new answer contradicts locked canon, the interview stops and
              shows you exactly what clashes. You decide what wins — and every
              decision that depended on it is re-reviewed in cascade.
            </p>
          </div>
          <div className="ld-mock" aria-hidden="true">
            <div className="ld-mock-title">Canon</div>
            <div className="ld-canon-row">
              <span>Premise</span>
              <span className="ld-state ld-state-confirmed">● Confirmed</span>
            </div>
            <div className="ld-canon-row">
              <span>Format — one-hour drama</span>
              <span className="ld-state ld-state-confirmed">● Confirmed</span>
            </div>
            <div className="ld-canon-row ld-canon-conflict">
              <span>Timeline — &ldquo;the fire was ten years ago&rdquo;</span>
              <span className="ld-state ld-state-conflict">▲ Conflict</span>
            </div>
            <div className="ld-canon-row">
              <span>Theme</span>
              <span className="ld-state ld-state-exploring">○ Exploring</span>
            </div>
          </div>
        </div>

        <div className="ld-row ld-row-flip">
          <div className="ld-row-text">
            <h3 className="ld-h3">Eight stages, gated on purpose</h3>
            <p className="ld-body">
              Premise before plot. Theme before scenes. The interview moves through
              eight development stages and won&apos;t skip ahead until the
              foundations hold — and it never drifts into writing your prose.
            </p>
          </div>
          <div className="ld-mock" aria-hidden="true">
            <div className="ld-mock-title">Development stages</div>
            <div className="ld-stagebar">
              {Array.from({ length: 8 }, (_, i) => (
                <span key={i} data-done={i < 3} />
              ))}
            </div>
            <p className="ld-mock-caption">Stage 3 of 8 — Dramatic engine</p>
          </div>
        </div>
      </div>
    </section>
  );
}
