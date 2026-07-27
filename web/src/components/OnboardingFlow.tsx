"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/useAuth";
import { useUser } from "@/components/UserProvider";
import ScriptPreview from "@/components/ScriptPreview";

/**
 * Onboarding flow — ported from the Claude Design handoff
 * (project 7b1a417c-9c3b-4f19-bfd9-50553314e724, Onboarding.dc.html) per
 * GitHub issue #88.
 *
 * Reproduces the design's own state machine and validation rules, now wired
 * to the real backend: Google/email sign-in against Firebase Auth, a session
 * cookie via /api/auth/session, and workspace/canvas/invite creation via
 * /api/workspaces/* on the final step. The source design had no password
 * field for email sign-in; one was added here since real email/password
 * auth requires it (Google sign-in needs no such field). `enterWorkspace`
 * navigates to /interview with the new workspace/canvas ids instead of
 * resetting to step 0 (the prototype had nowhere real to go).
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

  // Auth — kept out of `answers`/autosave since it's a credential, not form data.
  const [password, setPassword] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const { busy: authBusy, error: authError, signInWithGoogle, signInWithEmail } = useAuth();
  const { state: userState, refresh: refreshUser } = useUser();

  // Issue #90: reuse an existing empty workspace instead of creating a new
  // one when a signed-in user with a workspace (but no canvas) lands here.
  const [existingWorkspaceId, setExistingWorkspaceId] = useState<string | null>(null);

  // Final workspace/canvas/invite provisioning on the "done" step.
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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

  // Issue #90 — returning-user routing. Once the user state resolves:
  // has a canvas → straight to the interview (never re-onboard); has an
  // empty workspace → resume onboarding at the canvas step reusing it;
  // authed with nothing yet → skip only the signup step.
  useEffect(() => {
    if (userState.status !== "authed") return;

    if (userState.lastWorkspaceId && userState.lastCanvasId) {
      router.replace(
        `/interview?workspaceId=${userState.lastWorkspaceId}&canvasId=${userState.lastCanvasId}`
      );
      return;
    }

    let cancelled = false;
    (async () => {
      // Deferred past the synchronous effect body (react-hooks/set-state-in-effect).
      await Promise.resolve();
      if (cancelled) return;
      setAuthenticated(true);
      setAnswers((a) => (a.email ? a : { ...a, email: userState.user.email }));

      if (userState.workspaces.length > 0) {
        const ws = userState.workspaces[0];
        try {
          const res = await fetch(`/api/workspaces/${ws.id}/canvases`);
          const data = await res.json();
          if (cancelled) return;
          if (res.ok && Array.isArray(data.canvases) && data.canvases.length > 0) {
            router.replace(`/interview?workspaceId=${ws.id}&canvasId=${data.canvases[0].id}`);
            return;
          }
        } catch {
          // fall through to onboarding with the existing workspace
        }
        if (cancelled) return;
        setExistingWorkspaceId(ws.id);
        setAnswers((a) => ({ ...a, workspaceName: ws.name }));
        setStepIndex((i) => Math.max(i, 2)); // canvas step
      } else {
        setStepIndex((i) => (i === 0 ? 1 : i)); // skip signup only
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userState.status]);

  async function handleGoogleSignIn() {
    setErrors((e) => ({ ...e, email: undefined }));
    const result = await signInWithGoogle();
    if (result) {
      setAuthenticated(true);
      updateAnswer("email", result.email);
      await refreshUser(); // keep UserProvider (header/user menu) in sync
    }
  }

  async function next() {
    if (!validateCurrent()) return;
    if (step === "signup" && !authenticated) {
      const result = await signInWithEmail(answers.email, password);
      if (!result) return;
      setAuthenticated(true);
      await refreshUser(); // keep UserProvider (header/user menu) in sync
    }
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

  async function postJson<T>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error ?? "Something went wrong. Please try again.");
    }
    return data as T;
  }

  async function enterWorkspace() {
    setSubmitBusy(true);
    setSubmitError(null);
    try {
      // Reuse the user's existing empty workspace when there is one
      // (issue #90) instead of tripping the free-tier one-workspace limit.
      const workspace = existingWorkspaceId
        ? { id: existingWorkspaceId }
        : (
            await postJson<{ workspace: { id: string } }>("/api/workspaces", {
              name: answers.workspaceName,
              tier: answers.plan || "free",
            })
          ).workspace;
      const { canvas } = await postJson<{ canvas: { id: string } }>(
        `/api/workspaces/${workspace.id}/canvases`,
        { title: answers.canvasName || "Untitled Canvas" }
      );
      if (answers.plan === "premium" && answers.invites.length) {
        await Promise.all(
          answers.invites.map((email) =>
            postJson(`/api/workspaces/${workspace.id}/invites`, { email })
          )
        );
      }
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // best-effort cleanup
      }
      await refreshUser(); // pick up the new workspace/canvas as last-visited
      router.push(`/interview?workspaceId=${workspace.id}&canvasId=${canvas.id}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setSubmitBusy(false);
    }
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
                  onClick={handleGoogleSignIn}
                  disabled={authBusy || authenticated}
                >
                  {authenticated
                    ? "Signed in with Google"
                    : authBusy
                      ? "Signing in…"
                      : "Continue with Google"}
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
                  disabled={authenticated}
                  onChange={(e) => updateAnswer("email", e.target.value)}
                />
              </div>
              {!authenticated && (
                <div className="ob-field">
                  <label className="field" htmlFor="password">
                    Password
                  </label>
                  <input
                    className="input"
                    id="password"
                    type="password"
                    placeholder="At least 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              )}
              {errors.email && <p className="ob-error">{errors.email}</p>}
              {authError && <p className="ob-error">{authError}</p>}
              <p className="ob-hint" style={{ marginTop: 12 }}>
                By continuing you agree to the{" "}
                <Link href="/terms" style={{ textDecoration: "underline" }}>
                  Terms
                </Link>{" "}
                and{" "}
                <Link href="/privacy" style={{ textDecoration: "underline" }}>
                  Privacy Policy
                </Link>
                .
              </p>
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
              {submitError && <p className="ob-error">{submitError}</p>}
              <button
                type="button"
                className="btn btn-primary"
                onClick={enterWorkspace}
                disabled={submitBusy}
              >
                {submitBusy ? "Setting up your workspace…" : "Enter your workspace"}
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
              <button
                type="button"
                className="btn btn-primary"
                onClick={next}
                disabled={step === "signup" && authBusy}
              >
                {step === "signup" && authBusy ? "Signing in…" : "Continue"}
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
