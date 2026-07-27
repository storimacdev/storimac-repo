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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
