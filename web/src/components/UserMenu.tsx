"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/components/UserProvider";

/**
 * Signed-in user menu — issue #90. Rendered in the site header and in the
 * interview screen's top bar. Shows the account, jumps back to the last
 * canvas, and signs out (Firebase client + session cookie + local state).
 */
export default function UserMenu() {
  const router = useRouter();
  const { state, signOut } = useUser();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  if (state.status !== "authed") return null;

  const initial = (state.user.email[0] ?? "?").toUpperCase();
  const hasCanvas = Boolean(state.lastWorkspaceId && state.lastCanvasId);

  async function handleSignOut() {
    setOpen(false);
    await signOut();
    router.push("/");
  }

  return (
    <div className="relative" ref={menuRef} data-testid="user-menu">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full border border-neutral-700 bg-neutral-900 py-1 pl-1 pr-3 text-xs text-neutral-300 hover:border-neutral-500"
        aria-label="Account menu"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-red-600 to-orange-500 text-[11px] font-bold text-white">
          {initial}
        </span>
        <span className="hidden max-w-[160px] truncate sm:inline">{state.user.email}</span>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900 shadow-xl">
          <div className="border-b border-neutral-800 px-4 py-3">
            <p className="truncate text-xs font-medium text-neutral-200">{state.user.email}</p>
            <p className="mt-0.5 text-[10px] text-neutral-500">
              {state.workspaces.length} workspace{state.workspaces.length === 1 ? "" : "s"}
            </p>
          </div>
          {hasCanvas && (
            <button
              onClick={() => {
                setOpen(false);
                router.push(`/interview?workspaceId=${state.lastWorkspaceId}&canvasId=${state.lastCanvasId}`);
              }}
              className="block w-full px-4 py-2.5 text-left text-xs text-neutral-300 hover:bg-neutral-800"
            >
              My Canvas
            </button>
          )}
          <button
            disabled
            className="block w-full cursor-not-allowed px-4 py-2.5 text-left text-xs text-neutral-600"
            title="Coming soon"
          >
            Settings
          </button>
          <button
            onClick={handleSignOut}
            data-testid="sign-out"
            className="block w-full border-t border-neutral-800 px-4 py-2.5 text-left text-xs font-semibold text-red-400 hover:bg-red-950/40"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
