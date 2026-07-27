# Landing Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the minimal landing page with a full narrative marketing page (hero with animated interview demo → problem → how it works → product deep-dive → pro cards → FAQ → final CTA) in the hybrid Nocturne-plus-ember identity.

**Architecture:** Nocturne design system stays the base; new ember gradient tokens and a `.btn-ember` button become the sole action color. Seven landing section components live in `web/src/components/landing/` — only `HeroDemo` is a client component (scripted looping animation with reduced-motion fallback); the rest are stateless server components composed by `web/src/app/(nocturne)/page.tsx`. All landing CSS goes in `web/src/styles/nocturne.css` under a new `ld-` prefixed section, following the existing `ob-` convention.

**Tech Stack:** Next.js 16.2.11 (App Router), React 19, plain CSS in `nocturne.css` (Tailwind v4 utilities exist in the app but the nocturne scope uses its own class vocabulary), TypeScript.

**Spec:** `docs/superpowers/specs/2026-07-27-landing-page-design.md`

## Global Constraints

- All commands run in `web/` (`npm run lint`, `npm run build`). There is no test framework; every task's verification cycle is lint + build, plus the manual pass in the final task.
- `web/AGENTS.md` warning: this Next.js version may differ from training data — check `web/node_modules/next/dist/docs/` before using unfamiliar Next APIs. (This plan only uses `next/link` and plain components, which are stable.)
- Ember gradient (`#b91c1c` → `#ea580c`) is reserved for primary CTA buttons only. Everything else uses the existing violet `--color-accent` family.
- All new landing classes use the `ld-` prefix and must be scoped under `.nocturne-scope` in CSS, matching how `ob-` classes work.
- Copy in this plan is final approved copy — implement verbatim, don't paraphrase.
- Keep `SiteHeader`, `SiteFooter`, and `LandingCta`'s guest/returning-user logic unchanged (only `LandingCta`'s button class changes in Task 1).
- End every commit message with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Ember tokens + `.btn-ember` + LandingCta switch

**Files:**
- Modify: `web/src/styles/nocturne.css` (token block ~line 56, button section ~line 168)
- Modify: `web/src/components/LandingCta.tsx:20,30` (button class)

**Interfaces:**
- Produces: CSS custom properties `--color-ember-from`, `--color-ember-to`, `--gradient-ember` and class `.btn-ember` (used with `.btn`), consumed by Tasks 2–7.

- [ ] **Step 1: Add ember tokens to the `.nocturne-scope` token block**

In `web/src/styles/nocturne.css`, directly after the `--color-accent-2-900: #2b293a;` line, add:

```css
  --color-ember-from: #b91c1c;
  --color-ember-to: #ea580c;
  --gradient-ember: linear-gradient(
    90deg,
    var(--color-ember-from),
    var(--color-ember-to)
  );
```

- [ ] **Step 2: Add `.btn-ember` after the `.btn-ghost:active` rule**

```css
.nocturne-scope .btn-ember {
  color: #fff;
  background: var(--gradient-ember);
  border-color: transparent;
}
.nocturne-scope .btn-ember:hover {
  filter: brightness(1.12);
}
.nocturne-scope .btn-ember:active {
  filter: brightness(0.95);
}
```

- [ ] **Step 3: Switch both LandingCta buttons to ember**

In `web/src/components/LandingCta.tsx`, change both `className="btn btn-primary"` occurrences to `className="btn btn-ember"`.

- [ ] **Step 4: Verify**

Run: `npm run lint` then `npm run build` (in `web/`).
Expected: both pass with no new warnings.

- [ ] **Step 5: Commit**

```bash
git add web/src/styles/nocturne.css web/src/components/LandingCta.tsx
git commit -m "Add ember gradient tokens and btn-ember; switch landing CTA to ember

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Landing (`ld-`) CSS section

**Files:**
- Modify: `web/src/styles/nocturne.css` (append at end of file)

**Interfaces:**
- Consumes: tokens from Task 1 (`--gradient-ember` not used here — ember is buttons-only).
- Produces: every `ld-*` class used by Tasks 3–7: `ld-section`, `ld-hero`, `ld-final`, `ld-inner`, `ld-narrow`, `ld-center`, `ld-h1`, `ld-h2`, `ld-h3`, `ld-kicker`, `ld-lede`, `ld-body`, `ld-grid3`, `ld-grid4`, `ld-step`, `ld-step-num`, `ld-row`, `ld-row-flip`, `ld-row-text`, `ld-mock`, `ld-mock-title`, `ld-mock-caption`, `ld-canon-row`, `ld-canon-conflict`, `ld-state`, `ld-state-confirmed`, `ld-state-exploring`, `ld-state-conflict`, `ld-stagebar`, `ld-faq`, `ld-demo`, `ld-demo-titlebar`, `ld-demo-body`, `ld-bubble`, `ld-bubble-editor`, `ld-bubble-writer`, `ld-chip`.

- [ ] **Step 1: Append the landing section to `nocturne.css`**

```css
/* ══════════════════════════════════════════════════════════════════════
   Landing page (ld-) — full marketing page, spec 2026-07-27.
   Ember is used only via .btn-ember; everything here stays on the
   violet/neutral Nocturne palette.
   ══════════════════════════════════════════════════════════════════════ */

.nocturne-scope .ld-section {
  padding: 72px 24px;
}
.nocturne-scope .ld-hero {
  padding-top: 88px;
}
.nocturne-scope .ld-final {
  border-top: 1px solid var(--color-divider);
}
.nocturne-scope .ld-inner {
  max-width: 980px;
  margin: 0 auto;
}
.nocturne-scope .ld-narrow {
  max-width: 720px;
}
.nocturne-scope .ld-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.nocturne-scope .ld-h1 {
  font-size: clamp(30px, 4.5vw, 46px);
  line-height: 1.1;
  max-width: 20ch;
  margin: 0 0 var(--space-4);
}
.nocturne-scope .ld-h2 {
  font-size: clamp(24px, 3.2vw, 34px);
  margin: 0 0 var(--space-6);
}
.nocturne-scope .ld-h3 {
  font-size: 20px;
  margin: 0 0 var(--space-3);
}
.nocturne-scope .ld-kicker {
  font-size: 12px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-accent);
  margin: 0 0 var(--space-3);
  font-weight: 500;
}
.nocturne-scope .ld-lede {
  font-size: 16px;
  line-height: 1.55;
  color: var(--color-neutral-400);
  max-width: 58ch;
  margin: 0 0 var(--space-6);
}
.nocturne-scope .ld-body {
  font-size: 14.5px;
  line-height: 1.6;
  color: var(--color-neutral-400);
  margin: 0;
}

/* — grids & steps — */
.nocturne-scope .ld-grid3,
.nocturne-scope .ld-grid4 {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: var(--space-4);
  grid-template-columns: repeat(3, 1fr);
  text-align: left;
}
.nocturne-scope .ld-grid4 {
  grid-template-columns: repeat(2, 1fr);
}
.nocturne-scope .ld-step {
  background: var(--color-surface);
  border-radius: var(--radius-md);
  padding: var(--space-5);
}
.nocturne-scope .ld-step-num {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid var(--color-accent);
  color: var(--color-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  margin-bottom: var(--space-3);
}

/* — deep-dive rows + product mocks — */
.nocturne-scope .ld-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-8);
  align-items: center;
  margin-bottom: 56px;
}
.nocturne-scope .ld-row:last-child {
  margin-bottom: 0;
}
.nocturne-scope .ld-row-flip > .ld-row-text {
  order: 2;
}
.nocturne-scope .ld-mock {
  border: 1px solid var(--color-neutral-800);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  padding: var(--space-5);
}
.nocturne-scope .ld-mock-title {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-neutral-500);
  margin: 0 0 var(--space-4);
}
.nocturne-scope .ld-mock-caption {
  font-size: 12px;
  color: var(--color-neutral-500);
  margin: var(--space-3) 0 0;
}
.nocturne-scope .ld-canon-row {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  font-size: 13.5px;
  color: var(--color-neutral-300);
  padding: 8px 0;
  border-bottom: 1px solid var(--color-neutral-800);
}
.nocturne-scope .ld-canon-row:last-child {
  border-bottom: none;
}
.nocturne-scope .ld-canon-conflict {
  background: color-mix(in srgb, #e59a9a 8%, transparent);
  margin-inline: calc(-1 * var(--space-3));
  padding-inline: var(--space-3);
  border-radius: var(--radius-sm);
}
.nocturne-scope .ld-state {
  font-size: 12px;
  white-space: nowrap;
}
.nocturne-scope .ld-state-confirmed {
  color: #7fd6a4;
}
.nocturne-scope .ld-state-exploring {
  color: var(--color-neutral-500);
}
.nocturne-scope .ld-state-conflict {
  color: #e59a9a;
}
.nocturne-scope .ld-stagebar {
  display: flex;
  gap: 4px;
}
.nocturne-scope .ld-stagebar span {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: var(--color-neutral-800);
}
.nocturne-scope .ld-stagebar span[data-done="true"] {
  background: var(--color-accent);
}

/* — FAQ — */
.nocturne-scope .ld-faq {
  border-bottom: 1px solid var(--color-divider);
  padding: var(--space-4) 0;
  text-align: left;
}
.nocturne-scope .ld-faq summary {
  cursor: pointer;
  font-family: var(--font-heading);
  font-weight: 500;
  font-size: 16px;
  list-style: none;
  display: flex;
  justify-content: space-between;
  gap: var(--space-4);
}
.nocturne-scope .ld-faq summary::-webkit-details-marker {
  display: none;
}
.nocturne-scope .ld-faq summary::after {
  content: "+";
  color: var(--color-accent);
}
.nocturne-scope .ld-faq[open] summary::after {
  content: "–";
}
.nocturne-scope .ld-faq p {
  margin: var(--space-3) 0 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--color-neutral-400);
}

/* — hero interview demo — */
.nocturne-scope .ld-demo {
  width: 100%;
  max-width: 560px;
  margin: var(--space-8) auto 0;
  border: 1px solid var(--color-neutral-800);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
  text-align: left;
}
.nocturne-scope .ld-demo-titlebar {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-neutral-500);
  padding: var(--space-3) var(--space-5);
  border-bottom: 1px solid var(--color-neutral-800);
}
.nocturne-scope .ld-demo-body {
  padding: var(--space-5);
  min-height: 240px;
}
.nocturne-scope .ld-bubble {
  border-radius: var(--radius-md);
  padding: var(--space-3) var(--space-4);
  font-size: 14px;
  line-height: 1.5;
  margin: 0 0 var(--space-3);
  max-width: 85%;
  opacity: 0;
  transform: translateY(6px);
  transition: opacity 0.4s ease, transform 0.4s ease;
}
.nocturne-scope .ld-bubble[data-shown="true"] {
  opacity: 1;
  transform: none;
}
.nocturne-scope .ld-bubble-editor {
  background: var(--color-neutral-900);
  border: 1px solid var(--color-neutral-800);
  color: var(--color-neutral-200);
}
.nocturne-scope .ld-bubble-writer {
  background: var(--color-accent-900);
  color: var(--color-accent-200);
  margin-left: auto;
}
.nocturne-scope .ld-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--color-neutral-700);
  background: var(--color-neutral-900);
  color: var(--color-neutral-400);
  margin: 0;
  transition: color 0.35s ease, border-color 0.35s ease,
    background 0.35s ease, transform 0.35s ease;
}
.nocturne-scope .ld-chip[data-locked="true"] {
  border-color: var(--color-accent);
  background: var(--color-accent-900);
  color: var(--color-accent-200);
  transform: scale(1.04);
}

/* — responsive — */
@media (max-width: 760px) {
  .nocturne-scope .ld-section {
    padding: 48px 20px;
  }
  .nocturne-scope .ld-grid3,
  .nocturne-scope .ld-grid4 {
    grid-template-columns: 1fr;
  }
  .nocturne-scope .ld-row {
    grid-template-columns: 1fr;
    gap: var(--space-5);
    margin-bottom: 40px;
  }
  /* visual above text on mobile, both rows */
  .nocturne-scope .ld-row > .ld-mock {
    order: -1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .nocturne-scope .ld-bubble,
  .nocturne-scope .ld-chip {
    transition: none;
  }
  .nocturne-scope .ld-bubble {
    opacity: 1;
    transform: none;
  }
}
```

- [ ] **Step 2: Verify**

Run: `npm run lint` then `npm run build` (in `web/`).
Expected: both pass (CSS is unused so far — that's fine).

- [ ] **Step 3: Commit**

```bash
git add web/src/styles/nocturne.css
git commit -m "Add ld- landing page styles to nocturne.css

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: HeroDemo client component

**Files:**
- Create: `web/src/components/landing/HeroDemo.tsx`

**Interfaces:**
- Consumes: `ld-demo`, `ld-demo-titlebar`, `ld-demo-body`, `ld-bubble`, `ld-bubble-editor`, `ld-bubble-writer`, `ld-chip` classes from Task 2.
- Produces: `export default function HeroDemo(): JSX.Element` — no props. Used by Task 7.

Behavior contract: server-renders the **final frame** of pair 0 (all bubbles + locked chip) so the hero is never blank without JS. On mount: if `prefers-reduced-motion: reduce`, stay static; otherwise restart from step 0 and loop through both Q&A pairs forever (bubbles appear one per ~1.7s, chip locks, holds ~2.6s, next pair).

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useEffect, useState } from "react";

/**
 * Animated interview exchange for the landing hero. A staged Q&A types out,
 * then a canon chip locks in (Exploring→Working, then Working→Confirmed),
 * holds, and loops. Server-renders the final frame of pair 0 so the hero is
 * never blank without JS; prefers-reduced-motion keeps that static frame.
 */
const PAIRS = [
  {
    bubbles: [
      { role: "editor", text: "What does your protagonist want that she can't simply take?" },
      { role: "writer", text: "Her brother's forgiveness — but he vanished the night of the fire." },
      { role: "editor", text: "Good. So the engine is pursuit of someone who doesn't want to be found." },
    ],
    chip: { label: "Dramatic engine", from: "Exploring", to: "Working" },
  },
  {
    bubbles: [
      { role: "editor", text: "Is this a novel, a feature, or a series — what does the shape feel like?" },
      { role: "writer", text: "A one-hour drama. It needs room to breathe across a season." },
      { role: "editor", text: "Then we hold format as one-hour drama and test every choice against it." },
    ],
    chip: { label: "Format", from: "Working", to: "Confirmed" },
  },
] as const;

const STEP_MS = 1700;
const HOLD_MS = 2600;
const FINAL_STEP = 4; // steps 1-3 reveal bubbles, step 4 locks the chip

export default function HeroDemo() {
  const [pair, setPair] = useState(0);
  const [step, setStep] = useState(FINAL_STEP);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setPair(0);
    setStep(0);
    setPlaying(true);
  }, []);

  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(
      () => {
        if (step < FINAL_STEP) {
          setStep(step + 1);
        } else {
          setPair((pair + 1) % PAIRS.length);
          setStep(0);
        }
      },
      step < FINAL_STEP ? STEP_MS : HOLD_MS,
    );
    return () => clearTimeout(t);
  }, [playing, step, pair]);

  const { bubbles, chip } = PAIRS[pair];
  const locked = step >= FINAL_STEP;

  return (
    <div className="ld-demo" aria-hidden="true">
      <div className="ld-demo-titlebar">Interview · Stage 3 of 8</div>
      <div className="ld-demo-body">
        {bubbles.map((b, i) => (
          <p
            key={`${pair}-${i}`}
            className={`ld-bubble ld-bubble-${b.role}`}
            data-shown={step > i}
          >
            {b.text}
          </p>
        ))}
        <p className="ld-chip" data-locked={locked}>
          ◆ {chip.label} — {locked ? chip.to : chip.from}
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npm run lint` then `npm run build` (in `web/`).
Expected: both pass. (Component is not yet rendered anywhere; visual check happens in Tasks 7–8.)

- [ ] **Step 3: Commit**

```bash
git add web/src/components/landing/HeroDemo.tsx
git commit -m "Add HeroDemo animated interview exchange for landing hero

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: ProblemSection + HowItWorks

**Files:**
- Create: `web/src/components/landing/ProblemSection.tsx`
- Create: `web/src/components/landing/HowItWorks.tsx`

**Interfaces:**
- Consumes: `ld-section`, `ld-inner`, `ld-kicker`, `ld-h2`, `ld-grid3`, `ld-step`, `ld-step-num`, `card`, `card-title`, `card-body` classes.
- Produces: `export default function ProblemSection(): JSX.Element` and `export default function HowItWorks(): JSX.Element` — no props. Used by Task 7.

- [ ] **Step 1: Write ProblemSection**

```tsx
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
```

- [ ] **Step 2: Write HowItWorks**

```tsx
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
```

- [ ] **Step 3: Verify**

Run: `npm run lint` then `npm run build` (in `web/`).
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/landing/ProblemSection.tsx web/src/components/landing/HowItWorks.tsx
git commit -m "Add landing Problem and HowItWorks sections

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: DeepDive + ProCards

**Files:**
- Create: `web/src/components/landing/DeepDive.tsx`
- Create: `web/src/components/landing/ProCards.tsx`

**Interfaces:**
- Consumes: `ld-section`, `ld-inner`, `ld-kicker`, `ld-h2`, `ld-h3`, `ld-body`, `ld-row`, `ld-row-flip`, `ld-row-text`, `ld-mock`, `ld-mock-title`, `ld-mock-caption`, `ld-canon-row`, `ld-canon-conflict`, `ld-state`, `ld-state-confirmed`, `ld-state-exploring`, `ld-state-conflict`, `ld-stagebar`, `ld-grid4`, `card`, `card-kicker`, `card-title`, `card-body` classes.
- Produces: `export default function DeepDive(): JSX.Element` and `export default function ProCards(): JSX.Element` — no props. Used by Task 7.

- [ ] **Step 1: Write DeepDive**

```tsx
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
```

- [ ] **Step 2: Write ProCards**

```tsx
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
```

- [ ] **Step 3: Verify**

Run: `npm run lint` then `npm run build` (in `web/`).
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/landing/DeepDive.tsx web/src/components/landing/ProCards.tsx
git commit -m "Add landing DeepDive and ProCards sections

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Faq + FinalCta

**Files:**
- Create: `web/src/components/landing/Faq.tsx`
- Create: `web/src/components/landing/FinalCta.tsx`

**Interfaces:**
- Consumes: `ld-section`, `ld-final`, `ld-inner`, `ld-narrow`, `ld-center`, `ld-kicker`, `ld-h2`, `ld-lede`, `ld-faq` classes; `LandingCta` from `@/components/LandingCta`.
- Produces: `export default function Faq(): JSX.Element` and `export default function FinalCta(): JSX.Element` — no props. Used by Task 7.

- [ ] **Step 1: Write Faq (native `<details>`, no JS)**

```tsx
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
```

- [ ] **Step 2: Write FinalCta**

Note: `LandingCta` already renders its own reassurance hint ("Takes under a minute to set up your workspace." / "Pick up right where you left off."), so the lede here stays short and doesn't duplicate it.

```tsx
import LandingCta from "@/components/LandingCta";

export default function FinalCta() {
  return (
    <section className="ld-section ld-final">
      <div className="ld-inner ld-center">
        <h2 className="ld-h2">Start your foundation.</h2>
        <p className="ld-lede">Your first question is waiting.</p>
        <LandingCta />
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npm run lint` then `npm run build` (in `web/`).
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/landing/Faq.tsx web/src/components/landing/FinalCta.tsx
git commit -m "Add landing FAQ and FinalCta sections

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Assemble the page

**Files:**
- Modify: `web/src/app/(nocturne)/page.tsx` (full rewrite; delete the old `Feature` helper)

**Interfaces:**
- Consumes: all seven landing components (Tasks 3–6), `SiteHeader`, `SiteFooter`, `LandingCta`, and `ld-` hero classes from Task 2.

- [ ] **Step 1: Rewrite `page.tsx`**

```tsx
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import LandingCta from "@/components/LandingCta";
import HeroDemo from "@/components/landing/HeroDemo";
import ProblemSection from "@/components/landing/ProblemSection";
import HowItWorks from "@/components/landing/HowItWorks";
import DeepDive from "@/components/landing/DeepDive";
import ProCards from "@/components/landing/ProCards";
import Faq from "@/components/landing/Faq";
import FinalCta from "@/components/landing/FinalCta";

export default function Home() {
  return (
    <div className="nocturne-scope ob-root">
      <SiteHeader />
      <main>
        <section className="ld-section ld-hero">
          <div className="ld-inner ld-center">
            <h1 className="ld-h1">
              Turn a story idea into a locked creative foundation.
            </h1>
            <p className="ld-lede">
              A guided interview with an expert development editor — one focused
              question at a time — that hardens your premise, format, theme, and
              dramatic engine into a Story Foundation Document your drafting
              depends on.
            </p>
            <LandingCta />
            <HeroDemo />
          </div>
        </section>
        <ProblemSection />
        <HowItWorks />
        <DeepDive />
        <ProCards />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npm run lint` then `npm run build` (in `web/`).
Expected: both pass; the old `Feature` helper is gone.

- [ ] **Step 3: Commit**

```bash
git add "web/src/app/(nocturne)/page.tsx"
git commit -m "Assemble full narrative landing page (spec 2026-07-27)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Manual verification pass

**Files:** none (verification only; fix-ups amend the relevant file + a follow-up commit)

- [ ] **Step 1: Start the dev server**

Run in `web/`: `npm run dev`, open `http://localhost:3000/`.

- [ ] **Step 2: Walk the checklist**

- Hero animation plays: bubbles appear one at a time, chip flips to "Working", pair 2 follows, loops.
- DevTools → Rendering → "prefers-reduced-motion: reduce" → reload: static final frame, no animation.
- Guest state: both CTAs read "Get Started" with ember gradient; header "Get started" matches visually.
- Signed-in state with an existing canvas: CTA reads "Continue your story".
- FAQ items expand/collapse; +/– indicator flips.
- Responsive at ~375px, ~768px, ~1280px: grids collapse to one column, deep-dive mocks sit above their text on mobile, no horizontal scroll.
- Keyboard: tab reaches header links, both CTAs, and FAQ summaries; focus ring visible.

- [ ] **Step 3: Fix anything that fails, re-run lint + build, commit fixes**

```bash
git add -A
git commit -m "Landing page verification fixes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Skip this commit if nothing needed fixing.)
