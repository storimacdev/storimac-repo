"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import UserMenu from "@/components/UserMenu";
import { useUser } from "@/components/UserProvider";
import { downloadText, downloadBlob } from "@/lib/download";
import { generateFoundationPdfBlob } from "@/lib/pdf/FoundationPdfDocument";
import type { FoundationDocument } from "@/lib/canonEngine/foundationDoc";

type Project = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  title: string;
  stageName: string;
  currentStage: number;
  updatedAt: string;
};

type VersionRow = { version: number; date: string; summary_of_changes: string };

// GET /api/projects reserves this exact string for Stories whose workspace doc
// no longer exists (deleteWorkspace doesn't cascade to Stories). Dashboard-side
// only — see route.ts's fallback.
const UNKNOWN_WORKSPACE_LABEL = "Unknown workspace";

// Same tokens as ChatInterview.tsx — the dashboard is a sibling screen, not a new visual system.
const AMBIENT_GRADIENT =
  "linear-gradient(115deg, #2a0707 0%, #7f1d1d 18%, #dc2626 38%, #ea580c 52%, #7e22ce 76%, #312e81 100%)";
const BORDER_GRADIENT =
  "linear-gradient(135deg, #f87171, #dc2626, #ea580c, #a855f7, #6366f1)";

export default function ProjectDashboard() {
  const router = useRouter();
  const { state: userState } = useUser();

  const [projects, setProjects] = useState<Project[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const [exportOpenId, setExportOpenId] = useState<string | null>(null);
  const [exportVersions, setExportVersions] = useState<Record<string, VersionRow[] | "loading" | "error">>({});

  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    if (userState.status === "guest") router.replace("/login");
  }, [userState, router]);

  useEffect(() => {
    if (userState.status !== "authed") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/projects");
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(data.error ?? "Couldn't load your Projects.");
          return;
        }
        setProjects(data.projects);
      } catch {
        if (!cancelled) setLoadError("Couldn't reach the server. Is the dev server running?");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userState.status]);

  function startRename(p: Project) {
    setRenamingId(p.id);
    setRenameValue(p.title);
  }

  async function submitRename(p: Project) {
    const title = renameValue.trim();
    if (!title || title === p.title) {
      setRenamingId(null);
      return;
    }
    setRowError(null);
    try {
      const res = await fetch(`/api/workspaces/${p.workspaceId}/canvases/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRowError(data.error ?? "Rename failed.");
        return;
      }
      setProjects(
        (prev) =>
          prev?.map((row) =>
            row.id === p.id ? { ...row, title: data.canvas.title, updatedAt: data.canvas.updatedAt } : row
          ) ?? prev
      );
    } catch {
      setRowError("Couldn't reach the server.");
    } finally {
      setRenamingId(null);
    }
  }

  function startDelete(p: Project) {
    setDeletingId(p.id);
    setDeleteConfirmText("");
  }

  async function confirmDelete(p: Project) {
    if (deleteConfirmText !== p.title) return;
    setRowError(null);
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/workspaces/${p.workspaceId}/canvases/${p.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setRowError(data.error ?? "Delete failed.");
        return;
      }
      setProjects((prev) => prev?.filter((row) => row.id !== p.id) ?? prev);
    } catch {
      setRowError("Couldn't reach the server.");
    } finally {
      setDeletingId(null);
      setDeleteBusy(false);
    }
  }

  async function toggleExport(p: Project) {
    if (exportOpenId === p.id) {
      setExportOpenId(null);
      return;
    }
    setExportOpenId(p.id);
    const existing = exportVersions[p.id];
    if (!existing || existing === "error") {
      setExportVersions((prev) => ({ ...prev, [p.id]: "loading" }));
      try {
        const res = await fetch(`/api/workspaces/${p.workspaceId}/canvases/${p.id}/document`);
        const data = await res.json();
        if (res.ok && Array.isArray(data.versions)) {
          setExportVersions((prev) => ({ ...prev, [p.id]: data.versions }));
        } else {
          setExportVersions((prev) => ({ ...prev, [p.id]: "error" }));
        }
      } catch {
        setExportVersions((prev) => ({ ...prev, [p.id]: "error" }));
      }
    }
  }

  async function exportVersion(p: Project, format: "md" | "json" | "pdf") {
    const versions = exportVersions[p.id];
    if (!versions || versions === "loading" || versions === "error" || versions.length === 0) return;
    const latest = versions[versions.length - 1].version;
    setRowError(null);
    try {
      const res = await fetch(`/api/workspaces/${p.workspaceId}/canvases/${p.id}/document/${latest}`);
      const data = await res.json();
      if (!res.ok) {
        setRowError(data.error ?? "Export failed.");
        return;
      }
      if (format === "md") {
        downloadText(`${p.title}-v${latest}.md`, data.markdown, "text/markdown");
      } else if (format === "json") {
        downloadText(`${p.title}-v${latest}.json`, JSON.stringify(data.json, null, 2), "application/json");
      } else {
        const blob = await generateFoundationPdfBlob(data.json as FoundationDocument);
        downloadBlob(`${p.title}-v${latest}.pdf`, blob);
      }
    } catch {
      setRowError("Export failed.");
    }
  }

  return (
    <div className="min-h-dvh p-2 sm:p-4" style={{ background: AMBIENT_GRADIENT }}>
      <div className="mx-auto max-w-4xl rounded-2xl p-[1.5px]" style={{ background: BORDER_GRADIENT }}>
        <div className="min-h-[calc(100dvh-2rem)] rounded-[14px] bg-neutral-950 text-neutral-100">
          <header className="flex items-center justify-between border-b border-red-900/40 px-5 py-3">
            <Link href="/" className="text-sm text-neutral-400 hover:text-neutral-200">
              ← Back
            </Link>
            <div className="text-sm font-medium tracking-wide text-neutral-300">Your Projects</div>
            <UserMenu />
          </header>

          <div className="px-5 py-6">
            {loadError && (
              <div className="mb-4 rounded-lg border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-200">
                {loadError}
              </div>
            )}
            {rowError && (
              <div className="mb-4 rounded-lg border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-200">
                {rowError}
              </div>
            )}

            {projects === null && !loadError && <p className="text-sm text-neutral-500">Loading your Projects…</p>}

            {projects !== null && projects.length === 0 && (
              <div className="flex flex-col items-center gap-4 rounded-xl border border-neutral-800 bg-neutral-900/40 px-8 py-12 text-center">
                <p className="text-sm text-neutral-300">You haven&apos;t started a Project yet.</p>
                <Link
                  href="/onboarding"
                  className="rounded-xl bg-gradient-to-r from-red-600 to-orange-500 px-5 py-2.5 text-sm font-semibold text-white hover:from-red-500 hover:to-orange-400"
                >
                  Start a Project
                </Link>
              </div>
            )}

            <div className="space-y-3">
              {projects?.map((p) => {
                const versions = exportVersions[p.id];
                const hasDoc = Array.isArray(versions) && versions.length > 0;
                return (
                  <div key={p.id} className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-5 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        {renamingId === p.id ? (
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={() => submitRename(p)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") submitRename(p);
                              if (e.key === "Escape") setRenamingId(null);
                            }}
                            className="w-full rounded-lg border border-red-500/50 bg-neutral-900 px-2 py-1 text-sm font-medium text-neutral-100 focus:outline-none"
                          />
                        ) : (
                          <button
                            onClick={() => startRename(p)}
                            className="truncate text-left text-sm font-medium text-neutral-100 hover:underline"
                            title="Click to rename"
                          >
                            {p.title}
                          </button>
                        )}
                        <p className="mt-1 text-xs text-neutral-500">
                          {p.workspaceName === UNKNOWN_WORKSPACE_LABEL ? "Workspace deleted" : p.workspaceName} ·{" "}
                          {p.stageName} · Updated {new Date(p.updatedAt).toLocaleDateString()}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <Link
                          href={`/interview?workspaceId=${p.workspaceId}&canvasId=${p.id}`}
                          className="rounded-lg bg-gradient-to-r from-red-600 to-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:from-red-500 hover:to-orange-400"
                        >
                          Resume
                        </Link>

                        <div className="relative">
                          <button
                            onClick={() => toggleExport(p)}
                            className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs font-semibold text-neutral-300 hover:border-neutral-500"
                          >
                            Export ▾
                          </button>
                          {exportOpenId === p.id && (
                            <div className="absolute right-0 z-10 mt-1 w-48 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-xl">
                              {versions === "loading" && (
                                <div className="px-3 py-2 text-xs text-neutral-500">Loading…</div>
                              )}
                              {versions === "error" && (
                                <div className="px-3 py-2 text-xs text-red-300">
                                  Couldn&apos;t load — click Export to retry
                                </div>
                              )}
                              {versions !== "loading" && versions !== "error" && !hasDoc && (
                                <div className="px-3 py-2 text-xs text-neutral-500" title="Generate a document first">
                                  No document yet
                                </div>
                              )}
                              <button
                                onClick={() => exportVersion(p, "md")}
                                disabled={!hasDoc}
                                className="block w-full px-3 py-2 text-left text-xs text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                Markdown (.md)
                              </button>
                              <button
                                onClick={() => exportVersion(p, "json")}
                                disabled={!hasDoc}
                                className="block w-full px-3 py-2 text-left text-xs text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                JSON (.json)
                              </button>
                              <button
                                onClick={() => exportVersion(p, "pdf")}
                                disabled={!hasDoc}
                                className="block w-full px-3 py-2 text-left text-xs text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                PDF (.pdf)
                              </button>
                            </div>
                          )}
                        </div>

                        <button
                          onClick={() => startDelete(p)}
                          className="rounded-lg border border-red-900/60 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-950/40"
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    {deletingId === p.id && (
                      <div className="mt-3 rounded-lg border border-red-500/40 bg-red-950/30 px-4 py-3">
                        <p className="text-xs text-red-100/90">
                          This permanently deletes <b>{p.title}</b> and everything in it. Type the title to confirm.
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <input
                            autoFocus
                            value={deleteConfirmText}
                            onChange={(e) => setDeleteConfirmText(e.target.value)}
                            placeholder={p.title}
                            className="rounded-lg border border-red-500/50 bg-neutral-900 px-2 py-1 text-xs text-neutral-100 focus:outline-none"
                          />
                          <button
                            onClick={() => confirmDelete(p)}
                            disabled={deleteConfirmText !== p.title || deleteBusy}
                            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {deleteBusy ? "Deleting…" : "Delete permanently"}
                          </button>
                          <button
                            onClick={() => setDeletingId(null)}
                            disabled={deleteBusy}
                            className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:border-neutral-500 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
