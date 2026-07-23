"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ScriptPreview from "@/components/ScriptPreview";

/**
 * Onboarding flow — ported from the Claude Design handoff
 * (project 7b1a417c-9c3b-4f19-bfd9-50553314e724, Onboarding.dc.html) per
 * GitHub issue #88.
 *
 * This reproduces the design's own state machine and validation rules
 * faithfully, including its mocked social sign-in (sets a placeholder email,
 * no real OAuth) and localStorage autosave. Real auth (Firebase Auth),
 * workspace/canvas provisioning, tier enforcement, and invite delivery are
 * NOT wired up here — the source design is itself a frontend-only prototype
 * with no backend, and none of issue #88's AuthN/AuthZ/data-model/API
 * deliverables are in scope for "implement this file." One deliberate
 * deviation from the source: `enterWorkspace` navigates to /interview
 * (a real destination) instead of resetting back to step 0 (the prototype
 * had nowhere real to go).
 */

const STORAGE_KEY = "storimac_onboarding_v1";

type Plan = "" | "free" | "premium";

type Answers = {
  email: string;
  workspaceName: string;
  canvasName: string;
  plan: Plan;
  invites: string[];
};

type Errors = Partial<Record<"email" | "workspaceName", string>>;

const EMAIL_RE = /^\S+@\S+\.\S+$/;

const initialAnswers: Answers = {
  email: "",
  workspaceName: "",
  canvasName: "",
  plan: "",
  invites: [],
};

function getSteps(plan: Plan): string[] {
  const steps = ["signup", "workspace", "canvas", "plan"];
  if (plan === "premium") steps.push("invite");
  steps.push("done");
  return steps;
}

export default function OnboardingFlow() {
  const router = useRouter();

  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [inviteDraft, setInviteDraft] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [showAutosave, setShowAutosave] = useState(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Restore from localStorage on mount. This reads an external system
  // (browser storage, unavailable during SSR) rather than deriving from
  // props/state, so it can't move to render or a lazy useState initializer
  // without risking a server/client hydration mismatch — the sanctioned
  // exception the rule's own message describes ("subscribe to an external
  // system"), just without a natural subscription callback to defer into.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (typeof saved.stepIndex === "number") setStepIndex(saved.stepIndex);
        if (saved.answers) {
          setAnswers((a) => ({ ...a, ...saved.answers }));
        }
      }
    } catch {
      // corrupt/unavailable storage — start fresh
    }
    // Match the source's keyboard behavior: Enter advances to the next step.
    rootRef.current?.focus();
  }, []);

  const steps = getSteps(answers.plan);
  const step = steps[stepIndex] ?? steps[steps.length - 1];
  const stepPosition = stepIndex + 1;
  const stepTotal = steps.length;

  function autosave(nextStepIndex: number, nextAnswers: Answers) {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ stepIndex: nextStepIndex, answers: nextAnswers })
      );
    } catch {
      // storage unavailable — autosave is best-effort
    }
    setShowAutosave(true);
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => setShowAutosave(false), 1400);
  }

  function updateAnswer<K extends keyof Answers>(key: K, value: Answers[K]) {
    setAnswers((a) => {
      const next = { ...a, [key]: value };
      autosave(stepIndex, next);
      return next;
    });
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function validateCurrent(): boolean {
    if (step === "signup") {
      if (!answers.email || !EMAIL_RE.test(answers.email)) {
        setErrors({ email: "Enter a valid email to continue." });
        return false;
      }
    }
    if (step === "workspace") {
      if (!answers.workspaceName || !answers.workspaceName.trim()) {
        setErrors({ workspaceName: "Give your workspace a name." });
        return false;
      }
    }
    if (step === "plan") {
      if (!answers.plan) return false;
    }
    return true;
  }

  function goToStep(idx: number) {
    const clamped = Math.max(0, Math.min(steps.length - 1, idx));
    setStepIndex(clamped);
    autosave(clamped, answers);
  }

  function next() {
    if (!validateCurrent()) return;
    goToStep(stepIndex + 1);
  }

  function back() {
    goToStep(stepIndex - 1);
  }

  function skip() {
    goToStep(stepIndex + 1);
  }

  function addInvite() {
    const email = inviteDraft.trim();
    if (!email || !EMAIL_RE.test(email)) return;
    setAnswers((a) => {
      const next = { ...a, invites: [...a.invites, email] };
      autosave(stepIndex, next);
      return next;
    });
    setInviteDraft("");
  }

  function enterWorkspace() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // best-effort cleanup
    }
    router.push("/interview");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" && step !== "invite" && step !== "done") {
      next();
    }
  }

  const showNav = step !== "done";
  const canGoBack = stepIndex > 0;
  const canSkip = step === "canvas" || step === "invite";
  const displayCanvasName =
    answers.canvasName && answers.canvasName.trim()
      ? answers.canvasName
      : "Untitled Canvas";
  const displayPlan = answers.plan === "premium" ? "Premium" : "Free";
  const inviteSummary = answers.invites.length
    ? `${answers.invites.length} teammate${answers.invites.length > 1 ? "s" : ""}`
    : "None yet";

  return (
    <div
      ref={rootRef}
      className="nocturne-scope ob-root"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="ob-topbar">
        <div className="ob-brand">Storimac</div>
        <div className="ob-stepcount">
          Step <b>{stepPosition}</b> of {stepTotal}
        </div>
      </div>

      <div className="ob-stage">
        <div className="ob-panel">
          {step === "signup" && (
            <>
              <p className="ob-kicker">Welcome</p>
              <h1 className="ob-question">Let&apos;s get your workspace set up.</h1>
              <p className="ob-help">
                First, how should we reach you? You&apos;ll be the Workspace
                Admin — first one in always is.
              </p>
              <div className="ob-socials">
                <button
                  type="button"
                  className="btn btn-secondary btn-block"
                  onClick={() => updateAnswer("email", "you@gmail.com")}
                >
                  Continue with Google
                </button>
              </div>
              <div className="ob-field">
                <label className="field" htmlFor="email">
                  Or use your email
                </label>
                <input
                  className="input"
                  id="email"
                  type="email"
                  placeholder="you@studio.com"
                  value={answers.email}
                  onChange={(e) => updateAnswer("email", e.target.value)}
                />
              </div>
              {errors.email && <p className="ob-error">{errors.email}</p>}
            </>
          )}

          {step === "workspace" && (
            <>
              <p className="ob-kicker">Step {stepPosition}</p>
              <h1 className="ob-question">What&apos;s your Story Workspace called?</h1>
              <p className="ob-help">
                This is home base for your team and canvases. You can rename
                it later.
              </p>
              <div className="ob-field">
                <input
                  className="input"
                  type="text"
                  placeholder="e.g. Midnight Studio"
                  value={answers.workspaceName}
                  onChange={(e) => updateAnswer("workspaceName", e.target.value)}
                />
              </div>
              {errors.workspaceName && (
                <p className="ob-error">{errors.workspaceName}</p>
              )}
              <p className="ob-hint">
                Built as a Story Workspace today — the same engine will power
                Novel and Web Series workspaces later.
              </p>
            </>
          )}

          {step === "canvas" && (
            <>
              <p className="ob-kicker">Step {stepPosition} · Optional</p>
              <h1 className="ob-question">Give your first Story Canvas a name.</h1>
              <p className="ob-help">
                This is where you&apos;ll start mapping your story. Skip it
                and we&apos;ll call it &quot;Untitled Canvas&quot; for now.
              </p>
              <div className="ob-field">
                <input
                  className="input"
                  type="text"
                  placeholder="e.g. Season One"
                  value={answers.canvasName}
                  onChange={(e) => updateAnswer("canvasName", e.target.value)}
                />
              </div>
            </>
          )}

          {step === "plan" && (
            <>
              <p className="ob-kicker">Step {stepPosition}</p>
              <h1 className="ob-question">Choose how you&apos;ll work.</h1>
              <p className="ob-help">
                You can switch plans anytime from workspace settings.
              </p>
              <div className="ob-choices">
                <button
                  type="button"
                  className="ob-choice"
                  data-selected={answers.plan === "free"}
                  onClick={() => updateAnswer("plan", "free")}
                >
                  <div>
                    <p className="ob-choice-title">Free</p>
                    <p className="ob-choice-desc">
                      1 user · 1 Story Workspace · 1 Story Canvas
                    </p>
                    <div className="ob-choice-tags">
                      <span className="tag tag-neutral">Solo</span>
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  className="ob-choice"
                  data-selected={answers.plan === "premium"}
                  onClick={() => updateAnswer("plan", "premium")}
                >
                  <div>
                    <p className="ob-choice-title">Premium</p>
                    <p className="ob-choice-desc">
                      Multiple users · multiple canvases · multiple admins
                    </p>
                    <div className="ob-choice-tags">
                      <span className="tag tag-accent">Team</span>
                    </div>
                  </div>
                </button>
              </div>
            </>
          )}

          {step === "invite" && (
            <>
              <p className="ob-kicker">Step {stepPosition} · Optional</p>
              <h1 className="ob-question">Invite your team.</h1>
              <p className="ob-help">
                They&apos;ll join as Members — you can promote them to Admin
                anytime.
              </p>
              <div className="ob-invite-row">
                <input
                  className="input"
                  type="email"
                  placeholder="teammate@studio.com"
                  value={inviteDraft}
                  onChange={(e) => setInviteDraft(e.target.value)}
                />
                <button type="button" className="btn btn-secondary" onClick={addInvite}>
                  Add
                </button>
              </div>
              <div className="ob-invite-list">
                {answers.invites.map((inv) => (
                  <div className="ob-invite-chip" key={inv}>
                    <span>{inv}</span>
                    <span className="tag tag-outline">Member</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {step === "done" && (
            <>
              <div className="ob-done-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5 12l5 5L19 7"
                    stroke="var(--color-accent)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <p className="ob-kicker">All set</p>
              <h1 className="ob-question">Your workspace is ready.</h1>
              <p className="ob-help">
                Here&apos;s what we set up — you can change any of it later.
              </p>
              <div className="ob-summary">
                <div className="ob-summary-row">
                  <span>Admin</span>
                  <span>{answers.email}</span>
                </div>
                <div className="ob-summary-row">
                  <span>Workspace</span>
                  <span>{answers.workspaceName}</span>
                </div>
                <div className="ob-summary-row">
                  <span>Story Canvas</span>
                  <span>{displayCanvasName}</span>
                </div>
                <div className="ob-summary-row">
                  <span>Plan</span>
                  <span>{displayPlan}</span>
                </div>
                <div className="ob-summary-row">
                  <span>Invited</span>
                  <span>{inviteSummary}</span>
                </div>
              </div>
              <button type="button" className="btn btn-primary" onClick={enterWorkspace}>
                Enter your workspace
              </button>
            </>
          )}

          {showNav && (
            <div className="ob-nav">
              {canGoBack && (
                <button type="button" className="btn btn-ghost" onClick={back}>
                  Back
                </button>
              )}
              <button type="button" className="btn btn-primary" onClick={next}>
                Continue
              </button>
              {canSkip && (
                <button type="button" className="btn btn-ghost" onClick={skip}>
                  Skip
                </button>
              )}
            </div>
          )}
        </div>

        <ScriptPreview />
      </div>

      <div className="ob-autosave" data-show={showAutosave}>
        <span className="ob-dot" />
        Saved
      </div>
    </div>
  );
}
