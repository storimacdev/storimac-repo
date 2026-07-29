# Multi-Project Dashboard — Design Spec

**GitHub issue:** #22
**Status:** Approved for planning
**Date:** 2026-07-29

## Problem

Authors have no way to see all the Stories ("Projects") they're working on across every workspace they belong to. Today the only way to reach a Story is via a workspace's canvas switcher or a direct link with `workspaceId`/`canvasId`. There is no list view, no rename/delete UI, and no export entry point outside an active chat session.

## Terminology note

Issue #22 uses "Project" to mean one in-progress story (a `Story` document in `storyStore.ts`, called a "canvas" elsewhere in the code), **not** one of the 5 pipeline projects (Story Foundation, Character Bible, World Bible, Screenplay Architecture, Draft Writing). Resume/rename/export/delete only make sense at the Story granularity, and the data model already reflects this. This spec uses "Story" and "Project" interchangeably to mean that.

## Scope

**In scope:**
- A `/dashboard` page listing every Story owned by the current user, across all workspaces they belong to.
- Per-Story: resume (deep-link into the existing chat interview UI at saved state), rename, delete (with confirmation), export latest generated document as Markdown or JSON.
- A new `GET /api/projects` route that aggregates Stories across the user's workspaces.
- `PATCH` and `DELETE` handlers added to the existing `/api/workspaces/[workspaceId]/canvases/[canvasId]` route for rename/delete.

**Out of scope (explicitly deferred):**
- PDF export — depends on issue #21 (not yet built). The dashboard will show a PDF option in the export menu, disabled with a "Coming soon" label, so no UI rework is needed once #21 ships.
- Stories the user is a member of but does not own (shared Premium canvases) — `listStories` is owner-scoped today; broadening this is a separate concern from the dashboard itself and not required by the AC ("an author's Projects").
- Sorting/filtering/search UI beyond the default (most-recently-updated first, which `listStories` already returns).
- Pagination — out of scope until an author's Story count in practice warrants it (YAGNI).

## Data flow

1. Dashboard page loads, calls `GET /api/projects`.
2. Route handler: `requireUser()` → `listWorkspacesForUser(uid)` → for each workspace, filter `listStories(uid)` results (already a single cross-workspace query) by `workspaceId`, and attach the workspace's `name` and each Story's stage label (`getStageDefinition(story.currentStage).name`).
   - Simpler alternative considered: call `listStories(uid)` once (it already returns everything the user owns, ordered by `updatedAt desc`, regardless of workspace), then join in workspace names via `listWorkspacesForUser(uid)` for display only. This avoids N `listStoriesInWorkspace` calls. **Chosen approach.**
3. Response: `{ projects: Array<{ id, workspaceId, workspaceName, title, stageName, currentStage, updatedAt }> }`.
4. Dashboard renders a card/row per project:
   - **Resume** → `<Link href="/interview?workspaceId=${workspaceId}&canvasId=${id}">`, matching `ChatInterview.tsx`'s existing `workspaceId`/`canvasId` query-param resume mechanism.
   - **Rename** → inline edit, `PATCH /api/workspaces/${workspaceId}/canvases/${id}` with `{ title }`, calls `renameStory`.
   - **Delete** → confirmation dialog requiring the user to type the Story's title, then `DELETE /api/workspaces/${workspaceId}/canvases/${id}`, calls `deleteStory` (already does `recursiveDelete` of all subcollections).
   - **Export** → dropdown with Markdown/JSON (calls existing `GET /api/workspaces/${workspaceId}/canvases/${id}/document`, downloads the latest version's `markdown` or `json` field) and a disabled PDF item.

## API changes

### `GET /api/projects` (new file: `web/src/app/api/projects/route.ts`)

- Auth: `requireUser()`.
- No workspace-membership check needed — `listStories(ownerUid)` is already scoped to the caller's own Stories.
- Returns `{ projects: [...] }` as described above. Empty array (not an error) when the user owns no Stories.

### `PATCH /api/workspaces/[workspaceId]/canvases/[canvasId]` (add to existing route)

- Auth: `requireUser()` + `getMembership(workspaceId, uid)` (same pattern as the existing GET handler).
- Body: `{ title: string }`. Reject empty/whitespace-only title with 400.
- Calls `renameStory(canvasId, user.uid, title)`. Note `renameStory`'s `assertOwnership` check means only the Story's owner can rename, even if other members have workspace access — this matches `deleteStory`'s existing owner-only semantics and needs no change.
- Returns `{ canvas }`.

### `DELETE /api/workspaces/[workspaceId]/canvases/[canvasId]` (add to existing route)

- Auth: `requireUser()` + `getMembership(workspaceId, uid)`.
- Calls `deleteStory(canvasId, user.uid)`.
- Returns `204 No Content`.

## UI

New route: `web/src/app/dashboard/page.tsx` (client component, follows the existing pattern of `ChatInterview.tsx` for data fetching/loading states).

- Empty state: "You haven't started a Project yet" with a CTA back to onboarding/workspace creation.
- Each row: title (editable inline on click), workspace name, stage name badge, "Updated <relative time>", and an actions menu (Resume / Rename / Export ▾ / Delete).
- Delete confirmation: modal requiring the exact title typed to enable the confirm button — matches the weight of an irreversible, cascading action (`recursiveDelete`).
- Loading/error states follow existing patterns in `ChatInterview.tsx` (spinner + inline error text, no toast library in use elsewhere in the app).

## Error handling

- `GET /api/projects`: 401 if unauthenticated (via `requireUser()`'s existing behavior). No other error paths — a user with zero Stories is a valid, non-error response.
- `PATCH`/`DELETE`: 403 if not a workspace member; `renameStory`/`deleteStory` throw if the caller isn't the Story's owner (propagates as an error response via existing `errorResponse()` helper) — surfaced in the UI as "You don't have permission to modify this Project."
- Export: reuse existing `document` route's behavior unchanged; if no document version exists yet (Stage 8 never reached), the export menu's Markdown/JSON items are disabled with a tooltip "Generate a document first."

## Testing

- Route tests for `GET /api/projects` (empty list, single workspace, multiple workspaces, stage-name mapping).
- Route tests for `PATCH`/`DELETE` on the canvas route (success, non-member 403, non-owner rejection, empty-title 400).
- Component-level test or manual Playwright pass for the dashboard: list renders, resume link is correct, rename round-trips, delete requires confirmation and removes the row, export downloads the right content type.
