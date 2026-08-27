"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@/components/UserProvider";
import UserMenu from "@/components/UserMenu";
import { lastProjectPath } from "@/lib/lastProject";

/**
 * Persistent site header + navigation — issue #90. Guest: Sign in / Get
 * started. Authed: workspace switcher + user menu. Collapses to a hamburger
 * on mobile. The interview screen keeps its own immersive top bar (with
 * UserMenu embedded) instead of this header.
 */
export default function SiteHeader() {
  const router = useRouter();
  const { state } = useUser();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [wsOpen, setWsOpen] = useState(false);

  async function openWorkspace(workspaceId: string) {
    setWsOpen(false);
    setMobileOpen(false);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/canvases`);
      const data = await res.json();
      const first = res.ok && Array.isArray(data.canvases) ? data.canvases[0] : null;
      if (first) {
        const isLastVisited =
          state.status === "authed" && state.lastWorkspaceId === workspaceId && state.lastCanvasId === first.id;
        const path = isLastVisited ? lastProjectPath(state.lastProject) : "/interview";
        router.push(`${path}?workspaceId=${workspaceId}&canvasId=${first.id}`);
      } else {
        router.push("/onboarding");
      }
    } catch {
      router.push("/onboarding");
    }
  }

  const authedNav =
    state.status === "authed" ? (
      <>
        {state.workspaces.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setWsOpen((o) => !o)}
              className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:border-neutral-500"
              data-testid="workspace-switcher"
            >
              Workspaces ▾
            </button>
            {wsOpen && (
              <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900 shadow-xl">
                {state.workspaces.map((w) => (
                  <button
                    key={w.id}
                    onClick={() => openWorkspace(w.id)}
                    className="block w-full px-4 py-2.5 text-left text-xs text-neutral-300 hover:bg-neutral-800"
                  >
                    <span className="block truncate font-medium">{w.name}</span>
                    <span className="text-[10px] text-neutral-500">
                      {w.type} · {w.tier}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <UserMenu />
      </>
    ) : null;

  const guestNav =
    state.status === "guest" ? (
      <>
        <Link
          href="/login"
          className="rounded-lg border border-neutral-700 px-4 py-1.5 text-xs font-semibold text-neutral-300 hover:border-neutral-500 hover:text-white"
        >
          Sign in
        </Link>
        <Link
          href="/onboarding"
          className="rounded-lg bg-gradient-to-r from-red-600 to-orange-500 px-4 py-1.5 text-xs font-semibold text-white hover:from-red-500 hover:to-orange-400"
        >
          Get started
        </Link>
      </>
    ) : null;

  return (
    <header className="sticky top-0 z-40 border-b border-neutral-800 bg-neutral-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
        <Link href="/" className="text-sm font-bold tracking-wide text-neutral-100">
          Storimac
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-3 sm:flex">
          {authedNav}
          {guestNav}
        </nav>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMobileOpen((o) => !o)}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-700 text-neutral-300 sm:hidden"
          aria-label="Menu"
        >
          ☰
        </button>
      </div>

      {mobileOpen && (
        <nav className="flex flex-col gap-2 border-t border-neutral-800 px-5 py-3 sm:hidden">
          {state.status === "authed" && (
            <>
              {state.workspaces.map((w) => (
                <button
                  key={w.id}
                  onClick={() => openWorkspace(w.id)}
                  className="rounded-lg px-3 py-2 text-left text-xs text-neutral-300 hover:bg-neutral-800"
                >
                  {w.name}
                </button>
              ))}
              <div className="pt-1">
                <UserMenu />
              </div>
            </>
          )}
          {state.status === "guest" && (
            <>
              <Link href="/login" className="rounded-lg px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-800">
                Sign in
              </Link>
              <Link
                href="/onboarding"
                className="rounded-lg bg-gradient-to-r from-red-600 to-orange-500 px-3 py-2 text-center text-xs font-semibold text-white"
              >
                Get started
              </Link>
            </>
          )}
        </nav>
      )}
    </header>
  );
}
