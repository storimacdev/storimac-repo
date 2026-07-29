# Multi-Project Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give authors a `/dashboard` page listing every Story ("Project") they own across all workspaces, with resume, rename, delete, and Markdown/JSON export — matching GitHub issue #22's acceptance criteria (PDF deferred to issue #21).

**Architecture:** A new `GET /api/projects` route aggregates the caller's Stories across workspaces (via existing `listStories`/`listWorkspacesForUser`). Rename/delete are added as `PATCH`/`DELETE` on the existing per-canvas route, reusing `renameStory`/`deleteStory` from `storyStore.ts`. The existing document route gains an optional `?version=N` query param to serve one version's full content (needed for export; today it only lists lightweight version metadata). A new client component renders the list and wires these together, following the exact visual language and data-fetching patterns already used by `ChatInterview.tsx`.

**Tech Stack:** Next.js App Router (route handlers + client components), TypeScript, Firebase Admin SDK (Firestore) via existing `storyStore.ts`/`workspaceStore.ts`/`foundationDoc.ts`. No test framework exists in this repo (`web/package.json` has no test runner) — verification is `npm run lint && npm run build` per task plus one manual end-to-end walkthrough at the end, matching the convention already used in `docs/superpowers/plans/2026-07-28-m3-format-retrieval.md`.

## Global Constraints

- `web/` must have zero build-time dependency on files outside itself (ARCHITECTURE.md §7) — not implicated here since every file touched already lives under `web/`.
- Follow the existing error-mapping convention: throw/let propagate `UnauthenticatedError`, `WorkspaceAuthorizationError`, `StoryAccessError`, `TierLimitError` and let each route's `catch (err) { return errorResponse(err); }` map them (401/403/403/402 respectively) — never hand-roll a status code for an error `errorResponse` already handles.
- Match the existing dark/red-orange gradient visual language from `web/src/components/ChatInterview.tsx` (`AMBIENT_GRADIENT`, `BORDER_GRADIENT`, `neutral-950`/`neutral-900` panels) — the dashboard is a sibling screen to the interview, not a new visual system.
- PDF export is out of scope (blocked on issue #21): the export UI must show a disabled PDF option, not omit it or build PDF generation.
- No test framework exists — do not add one as part of this plan. Verify with `cd web && npm run lint && npm run build` after every task, and with the manual walkthrough in the final task.

---

### Task 1: `GET /api/projects` — cross-workspace Story listing

**Files:**
- Create: `web/src/app/api/projects/route.ts`

**Interfaces:**
- Consumes: `requireUser()` from `@/lib/session` (returns `{uid, email}`, throws `UnauthenticatedError`); `errorResponse(err)` from `@/lib/apiErrors`; `listWorkspacesForUser(uid): Promise<Workspace[]>` from `@/lib/workspace/workspaceStore` (`Workspace` has `id`, `name`, `tier`, `type`, `ownerUid`, `createdAt`, `updatedAt`); `listStories(ownerUid): Promise<Story[]>` from `@/lib/canonEngine/storyStore` (`Story` has `id`, `ownerUid`, `workspaceId`, `title`, `createdAt`, `updatedAt`, `currentStage`, ordered by `updatedAt desc`); `getStageDefinition(stage: number): StageDefinition` from `@/lib/canonEngine/stageDefinitions` (`StageDefinition` has `stage: number; name: string; ...`, throws if `stage` isn't 1-8 — every `Story.currentStage` is always in that range so this never throws in practice).
- Produces: `GET /api/projects` → `200 { projects: Array<{ id: string; workspaceId: string; workspaceName: string; title: string; stageName: string; currentStage: number; updatedAt: string }> }`, ordered by `updatedAt` descending (inherited from `listStories`'s own ordering — do not re-sort). `401` if unauthenticated. A user who owns zero Stories gets `200 { projects: [] }`, not an error.

- [ ] **Step 1: Write the route handler**

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { listWorkspacesForUser } from "@/lib/workspace/workspaceStore";
import { listStories } from "@/lib/canonEngine/storyStore";
import { getStageDefinition } from "@/lib/canonEngine/stageDefinitions";

export const runtime = "nodejs";

/**
 * Lists every Story ("Project") the caller owns, across every workspace
 * they belong to — issue #22's dashboard. `listStories` is already
 * ownerUid-scoped and sorted by updatedAt desc; workspace names are joined
 * in here purely for display.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const [workspaces, stories] = await Promise.all([
      listWorkspacesForUser(user.uid),
      listStories(user.uid),
    ]);
    const workspaceNames = new Map(workspaces.map((w) => [w.id, w.name]));

    const projects = stories.map((story) => ({
      id: story.id,
      workspaceId: story.workspaceId,
      workspaceName: workspaceNames.get(story.workspaceId) ?? "Unknown workspace",
      title: story.title,
      stageName: getStageDefinition(story.currentStage).name,
      currentStage: story.currentStage,
      updatedAt: story.updatedAt,
    }));

    return NextResponse.json({ projects });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 2: Lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass (proves the new route compiles and its imports resolve correctly; behavior is exercised end-to-end in Task 5).

- [ ] **Step 3: Commit**

```bash
git add web/src/app/api/projects/route.ts
git commit -m "Add GET /api/projects for the multi-project dashboard (#22)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Rename and delete a Project

**Files:**
- Modify: `web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/route.ts`

**Interfaces:**
- Consumes: `renameStory(storyId, ownerUid, title): Promise<Story>` and `deleteStory(storyId, ownerUid): Promise<void>` from `@/lib/canonEngine/storyStore` (both throw `StoryAccessError` — mapped to 403 by `errorResponse` — if the Story doesn't exist or `ownerUid` isn't its owner); `getMembership(workspaceId, uid)` from `@/lib/workspace/workspaceStore` (already imported in this file).
- Produces: `PATCH .../canvases/[canvasId]` with body `{ title: string }` → `200 { canvas: Story }`, `400` if `title` is missing/blank, `403` if not a workspace member or not the Story's owner. `DELETE .../canvases/[canvasId]` → `204` (empty body) on success, `403` if not a workspace member or not the Story's owner.

- [ ] **Step 1: Add the `PATCH` and `DELETE` handlers**

Modify the imports at the top of the file (add `renameStory, deleteStory` to the existing `storyStore` import):

```ts
import { getStory, listMessages, renameStory, deleteStory } from "@/lib/canonEngine/storyStore";
```

Append these two handlers after the existing `GET`:

```ts
/** Rename a Project — issue #22. Only the Story's owner may rename (renameStory's own check). */
export async function PATCH(
  req: NextRequest,
  ctx: RouteContext<"/api/workspaces/[workspaceId]/canvases/[canvasId]">
) {
  try {
    const user = await requireUser();
    const { workspaceId, canvasId } = await ctx.params;

    const membership = await getMembership(workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    if (!title) {
      return NextResponse.json({ error: "Title is required." }, { status: 400 });
    }

    const canvas = await renameStory(canvasId, user.uid, title);
    return NextResponse.json({ canvas });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Delete a Project and everything under it — issue #22. Only the Story's owner may delete (deleteStory's own check). */
export async function DELETE(
  _req: NextRequest,
  ctx: RouteContext<"/api/workspaces/[workspaceId]/canvases/[canvasId]">
) {
  try {
    const user = await requireUser();
    const { workspaceId, canvasId } = await ctx.params;

    const membership = await getMembership(workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }

    await deleteStory(canvasId, user.uid);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 2: Lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add web/src/app/api/workspaces/\[workspaceId\]/canvases/\[canvasId\]/route.ts
git commit -m "Add rename/delete handlers to the canvas route (#22)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: SKIPPED — single-version document endpoint already exists

**Discovery during Task 1's build verification (2026-07-29):** `web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/document/[version]/route.ts` already exists on `main` (committed 2026-07-26, issue #19 — predates this plan; missed during this plan's brainstorming exploration, which only read `document/route.ts` and never listed its subdirectory). It already does exactly what this task set out to add:

```ts
// GET /api/workspaces/{workspaceId}/canvases/{canvasId}/document/{version}
// -> 200 { version, date, summary_of_changes, markdown, json }
// -> 400 invalid version, 404 not found, 403 not a member
```

Same auth pattern (`getMembership` + `getStory`/workspace check), same `getDocumentVersion` call, same response shape. No new code is needed — this task is a no-op.

**Consequence for Task 4:** the dashboard's export feature calls `GET .../document/{version}` (path segment), **not** `.../document?version={version}` (query param) as originally planned. Task 4 below has been updated to use the path-segment form.

---

### Task 4: Dashboard page UI

**Files:**
- Create: `web/src/app/dashboard/page.tsx`
- Create: `web/src/components/ProjectDashboard.tsx`
- Modify: `web/src/components/UserMenu.tsx`

**Interfaces:**
- Consumes: `GET /api/projects` (Task 1's shape), `PATCH`/`DELETE /api/workspaces/{workspaceId}/canvases/{canvasId}` (Task 2's shapes), `GET /api/workspaces/{workspaceId}/canvases/{canvasId}/document` (lightweight version list) and `GET .../document/{version}` (full content of one version — pre-existing route, see Task 3); `useUser()` from `@/components/UserProvider` (`UserState` — `{status:"guest"}` / `{status:"loading"}` / `{status:"authed", user, workspaces, lastWorkspaceId, lastCanvasId}`).
- Produces: route `/dashboard`, reachable directly and via a new "Dashboard" link in `UserMenu`.

- [ ] **Step 1: Create the thin page wrapper**

`web/src/app/dashboard/page.tsx` — follows the exact pattern of `web/src/app/interview/page.tsx`:

```tsx
import { Suspense } from "react";
import ProjectDashboard from "@/components/ProjectDashboard";

export const metadata = {
  title: "Your Projects — Storimac",
};

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <ProjectDashboard />
    </Suspense>
  );
}
```

- [ ] **Step 2: Create the dashboard client component**

`web/src/components/ProjectDashboard.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import UserMenu from "@/components/UserMenu";
import { useUser } from "@/components/UserProvider";

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

// Same tokens as ChatInterview.tsx — the dashboard is a sibling screen, not a new visual system.
const AMBIENT_GRADIENT =
  "linear-gradient(115deg, #2a0707 0%, #7f1d1d 18%, #dc2626 38%, #ea580c 52%, #7e22ce 76%, #312e81 100%)";
const BORDER_GRADIENT =
  "linear-gradient(135deg, #f87171, #dc2626, #ea580c, #a855f7, #6366f1)";

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

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
  const [exportVersions, setExportVersions] = useState<Record<string, VersionRow[] | "loading">>({});

  useEffect(() => {
    if (userState.status === "guest") router.replace("/login");
  }, [userState, router]);

  useEffect(() => {
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
  }, []);

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
      setProjects((prev) => prev?.map((row) => (row.id === p.id ? { ...row, title } : row)) ?? prev);
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
    }
  }

  async function toggleExport(p: Project) {
    if (exportOpenId === p.id) {
      setExportOpenId(null);
      return;
    }
    setExportOpenId(p.id);
    if (!exportVersions[p.id]) {
      setExportVersions((prev) => ({ ...prev, [p.id]: "loading" }));
      try {
        const res = await fetch(`/api/workspaces/${p.workspaceId}/canvases/${p.id}/document`);
        const data = await res.json();
        setExportVersions((prev) => ({ ...prev, [p.id]: res.ok && Array.isArray(data.versions) ? data.versions : [] }));
      } catch {
        setExportVersions((prev) => ({ ...prev, [p.id]: [] }));
      }
    }
  }

  async function exportVersion(p: Project, format: "md" | "json") {
    const versions = exportVersions[p.id];
    if (!versions || versions === "loading" || versions.length === 0) return;
    const latest = versions[versions.length - 1].version;
    try {
      const res = await fetch(`/api/workspaces/${p.workspaceId}/canvases/${p.id}/document/${latest}`);
      const data = await res.json();
      if (!res.ok) {
        setRowError(data.error ?? "Export failed.");
        return;
      }
      if (format === "md") {
        download(`${p.title}-v${latest}.md`, data.markdown, "text/markdown");
      } else {
        download(`${p.title}-v${latest}.json`, JSON.stringify(data.json, null, 2), "application/json");
      }
    } catch {
      setRowError("Couldn't reach the server.");
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
                          {p.workspaceName} · {p.stageName} · Updated {new Date(p.updatedAt).toLocaleDateString()}
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
                              {versions !== "loading" && !hasDoc && (
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
                                disabled
                                title="Coming soon"
                                className="block w-full cursor-not-allowed border-t border-neutral-800 px-3 py-2 text-left text-xs text-neutral-600"
                              >
                                PDF (Coming soon)
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
                            disabled={deleteConfirmText !== p.title}
                            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Delete permanently
                          </button>
                          <button
                            onClick={() => setDeletingId(null)}
                            className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:border-neutral-500"
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
```

- [ ] **Step 3: Add a "Dashboard" link to `UserMenu`**

In `web/src/components/UserMenu.tsx`, add a link above the existing "My Canvas" button (which stays as-is) so the dashboard has a discoverable entry point. Insert this block immediately after the `<div className="border-b border-neutral-800 px-4 py-3">...</div>` block (i.e. as the first menu item, before the `{hasCanvas && (...)}` block):

```tsx
          <button
            onClick={() => {
              setOpen(false);
              router.push("/dashboard");
            }}
            className="block w-full px-4 py-2.5 text-left text-xs text-neutral-300 hover:bg-neutral-800"
          >
            My Projects
          </button>
```

- [ ] **Step 4: Lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/dashboard/page.tsx web/src/components/ProjectDashboard.tsx web/src/components/UserMenu.tsx
git commit -m "Add multi-project dashboard UI (#22)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Manual end-to-end verification

**Files:** none (verification only; fix-ups amend the relevant file(s) plus a follow-up commit)

- [ ] **Step 1: Start the dev server**

Run in `web/`: `npm run dev`.

- [ ] **Step 2: Verify listing across workspaces**

- Sign in as a test author. If they own only one workspace/Story, create a second workspace (or use an existing Premium-tier test account) with a second Story so the dashboard has more than one row to show.
- Visit `/dashboard` (or open it via the account menu's new "My Projects" item). Confirm every Story you own appears, each showing the correct workspace name, stage name, and a plausible "Updated" date, ordered most-recently-updated first.
- Sign in as a different author with zero Stories (or a fresh account). Confirm the empty state ("You haven't started a Project yet") renders instead of an error.

- [ ] **Step 3: Verify resume**

- Click "Resume" on a Project. Confirm it lands on `/interview?workspaceId=...&canvasId=...` and the chat/canon state loads exactly as it was left (matches the existing resume behavior already used elsewhere in the app).

- [ ] **Step 4: Verify rename**

- Click a Project's title, change it, press Enter. Confirm the row updates immediately and the change survives a page reload (i.e. it round-tripped through `PATCH` into Firestore, not just local state).
- Try renaming to an empty/whitespace-only value — confirm it's rejected (rename is cancelled, title unchanged) rather than saving a blank title.

- [ ] **Step 5: Verify export**

- On a Story that has NOT reached Stage 8 yet (no document generated), open its Export menu — confirm "No document yet" shows and the Markdown/JSON items are disabled.
- On a Story that HAS a generated document, open Export, click "Markdown (.md)" — confirm a `.md` file downloads containing the document body. Click "JSON (.json)" — confirm a `.json` file downloads and is valid JSON.
- Confirm the PDF item is visible but disabled with a "Coming soon" tooltip on every row.

- [ ] **Step 6: Verify delete**

- Click "Delete" on a disposable test Project. Confirm the confirm-by-typing-the-title control appears, the confirm button stays disabled until the typed text matches exactly, and clicking it removes the row and the Story is actually gone (reload `/dashboard` and confirm it no longer appears; also confirm the workspace's own canvas list no longer shows it, proving the delete reached Firestore).

- [ ] **Step 7: Verify cross-account isolation**

- Confirm a second author's `/dashboard` never shows the first author's Projects (the `GET /api/projects` route is ownerUid-scoped by construction, but confirm it in practice, not just by reading the code).

- [ ] **Step 8: Fix anything that fails, re-run lint + build, commit fixes**

```bash
cd web && npm run lint && npm run build
git add -A
git commit -m "Multi-project dashboard verification fixes (#22)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

(Skip this commit if nothing needed fixing.)
