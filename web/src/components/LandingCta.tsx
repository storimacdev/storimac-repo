"use client";

import Link from "next/link";
import { useUser } from "@/components/UserProvider";

/**
 * State-aware landing CTA — issue #90. Returning users with a canvas get
 * "Continue your story" straight into it; everyone else gets onboarding
 * (which itself skips signup for authed users).
 */
export default function LandingCta() {
  const { state } = useUser();

  if (state.status === "authed" && state.lastWorkspaceId && state.lastCanvasId) {
    return (
      <div className="flex items-center gap-4">
        <Link
          href={`/interview?workspaceId=${state.lastWorkspaceId}&canvasId=${state.lastCanvasId}`}
          className="btn btn-ember"
        >
          Continue your story
        </Link>
        <span className="ob-hint">Pick up right where you left off.</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <Link href="/onboarding" className="btn btn-ember">
        Get Started
      </Link>
      <span className="ob-hint">Takes under a minute to set up your workspace.</span>
    </div>
  );
}
