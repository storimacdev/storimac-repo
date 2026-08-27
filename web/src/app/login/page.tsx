"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@/components/UserProvider";
import { useAuth } from "@/lib/useAuth";
import { lastProjectPath } from "@/lib/lastProject";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";

/**
 * Returning-user sign-in — issue #90. Shares its auth logic with
 * OnboardingFlow via useAuth. Routes by user state after sign-in:
 * has a canvas → interview; has a workspace only → onboarding (canvas
 * step comes next there); neither → onboarding. Already-authed visitors
 * are redirected away immediately.
 */
export default function LoginPage() {
  const router = useRouter();
  const { state, refresh } = useUser();
  const { busy, error, signInWithGoogle, signInWithEmail } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Already signed in → route away from /login by state.
  useEffect(() => {
    if (state.status !== "authed") return;
    if (state.lastWorkspaceId && state.lastCanvasId) {
      router.replace(
        `${lastProjectPath(state.lastProject)}?workspaceId=${state.lastWorkspaceId}&canvasId=${state.lastCanvasId}`
      );
    } else {
      router.replace("/onboarding");
    }
  }, [state, router]);

  async function afterSignIn() {
    // Pull fresh state (workspaces/last canvas) and let the effect route.
    await refresh();
  }

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-950 text-neutral-100">
      <SiteHeader />
      <main className="flex flex-1 items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <h1 className="text-xl font-bold text-white">Welcome back</h1>
          <p className="mt-1 text-sm text-neutral-400">Sign in to continue your story.</p>

          <button
            onClick={async () => {
              const r = await signInWithGoogle();
              if (r) await afterSignIn();
            }}
            disabled={busy}
            className="mt-6 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm font-semibold text-neutral-200 transition hover:border-neutral-500 disabled:opacity-40"
          >
            {busy ? "Signing in…" : "Continue with Google"}
          </button>

          <div className="my-5 flex items-center gap-3 text-[10px] uppercase tracking-widest text-neutral-600">
            <span className="h-px flex-1 bg-neutral-800" />
            or
            <span className="h-px flex-1 bg-neutral-800" />
          </div>

          <label className="block text-xs text-neutral-400" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@studio.com"
            className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
          />
          <label className="mt-4 block text-xs text-neutral-400" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
            className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
          />

          <button
            onClick={async () => {
              const r = await signInWithEmail(email, password);
              if (r) await afterSignIn();
            }}
            disabled={busy || !email || !password}
            className="mt-5 w-full rounded-xl bg-gradient-to-r from-red-600 to-orange-500 px-4 py-3 text-sm font-semibold text-white transition hover:from-red-500 hover:to-orange-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>

          {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

          <p className="mt-6 text-center text-xs text-neutral-500">
            New here?{" "}
            <Link href="/onboarding" className="text-neutral-300 underline hover:text-white">
              Get started
            </Link>
          </p>
          <p className="mt-3 text-center text-[10px] leading-relaxed text-neutral-600">
            By continuing you agree to the{" "}
            <Link href="/terms" className="underline hover:text-neutral-400">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline hover:text-neutral-400">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
