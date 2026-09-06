# P1 Completion Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Once an author generates their Story Foundation Document (Project 1), the interview locks read-only until they explicitly unlock it, so downstream Character/World Bible work isn't silently invalidated by later edits.

**Architecture:** A single new boolean field (`p1Locked`) on the `Story` Firestore document. Every successful document generation sets it `true` (whether that's the very first generation or a regeneration after an unlock — same code path, no special-casing). A new `POST .../unlock` endpoint is the only way to clear it. `POST /api/chat` — Project 1's only write path for canon elements — rejects with 409 whenever `p1Locked` is true, before touching Anthropic or Firestore. The client mirrors this in the UI (disabled input, unlock banner) but the server check is what's authoritative.

**Tech Stack:** Next.js 16 App Router (TypeScript, `RouteContext<"...">` typed route params), Firebase Admin/Firestore, React 19 client components. No test runner is configured in this repo (`npm test` has no script) — verification throughout is `npm run lint` (must be clean), `npm run build` (must succeed, and regenerates the typed-route types Next.js needs for any new route file), and manual/code-trace verification, matching how every other feature in this codebase has been verified.

## Global Constraints

- `p1Locked` is `boolean | null | undefined` on the `Story` type — optional/nullable since existing stories predate this field. Every read of it is a plain truthy check (`if (story.p1Locked)` / `if (data.story?.p1Locked)`) — `undefined`/`null`/`false` are all correctly "unlocked", only `true` is "locked". Never write a stricter `=== true` check; the plain truthy check is already correct for this type and matches this codebase's existing style (e.g. `if (pendingConflict)` elsewhere in `chat/route.ts`).
- No endpoint ever accepts a client-supplied `locked: true`. Locking is only ever a side effect of successful document generation (`POST .../document`). The unlock endpoint (`POST .../unlock`) only ever sets it `false`.
- Unlock authorization matches every other canvas action in this route family: `requireUser()` + `getMembership(workspaceId, uid)` — any workspace member, no new permission tier.
- The server-side gate in `POST /api/chat` is what's authoritative; the client-side disabled textarea is UX only, not the real enforcement.
- Don't touch Stage 7/8 gating, document versioning, the PDF export, or the World/Character Bible ingestion — all out of scope per the spec.

---

### Task 1: Data model, setter, and unlock endpoint

**Files:**
- Modify: `web/src/lib/canonEngine/storyStore.ts`
- Create: `web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/unlock/route.ts`

**Interfaces:**
- Produces: `Story.p1Locked?: boolean | null` (new field on the existing `Story` interface).
- Produces: `setP1Locked(storyId: string, locked: boolean): Promise<void>` (exported from `storyStore.ts`).
- Produces: `POST /api/workspaces/[workspaceId]/canvases/[canvasId]/unlock` → `{ locked: false }` on success (200), or the existing `{ error: string }` shape on 403/404.

- [ ] **Step 1: Add the `p1Locked` field to the `Story` interface**

In `web/src/lib/canonEngine/storyStore.ts`, find the `Story` interface (it currently ends with the `p3` field, right before its closing `}` around line 137):

```ts
  /**
   * Project 3's World Complexity Level state (issue #39). Optional/
   * nullable since Stories created before this field existed won't have
   * it in Firestore.
   */
  p3?: P3State | null;
}
```

Add the new field right after `p3`, before the closing `}`:

```ts
  /**
   * Project 3's World Complexity Level state (issue #39). Optional/
   * nullable since Stories created before this field existed won't have
   * it in Firestore.
   */
  p3?: P3State | null;
  /**
   * Project 1 completion lock. Set true by every successful Story
   * Foundation Document generation (POST .../document); cleared only by
   * the explicit unlock action (POST .../unlock). Optional/nullable since
   * Stories created before this field existed won't have it in Firestore
   * — treat undefined/null the same as false (unlocked) everywhere this
   * is read.
   */
  p1Locked?: boolean | null;
}
```

- [ ] **Step 2: Add the `setP1Locked` setter**

In the same file, find `setStage7Audit` (it ends around line 307, immediately before `setP2State`):

```ts
export async function setStage7Audit(
  storyId: string,
  audit: import("./stage7Audit").Stage7AuditResult | null
): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ stage7Audit: audit, updatedAt: new Date().toISOString() });
}

/** Stores Project 2's per-character lock/progress (issue #26) - whole-object replace, same convention as setStage7Audit. */
export async function setP2State(storyId: string, p2: P2State): Promise<void> {
```

Insert a new function between them:

```ts
export async function setStage7Audit(
  storyId: string,
  audit: import("./stage7Audit").Stage7AuditResult | null
): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ stage7Audit: audit, updatedAt: new Date().toISOString() });
}

/** Project 1 completion lock (see the `p1Locked` field doc on `Story`) - same whole-value-replace convention as setPendingConflict/setStage7Audit above. */
export async function setP1Locked(storyId: string, locked: boolean): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ p1Locked: locked, updatedAt: new Date().toISOString() });
}

/** Stores Project 2's per-character lock/progress (issue #26) - whole-object replace, same convention as setStage7Audit. */
export async function setP2State(storyId: string, p2: P2State): Promise<void> {
```

- [ ] **Step 3: Create the unlock route**

Look at `web/src/app/api/workspaces/[workspaceId]/invites/[inviteId]/accept/route.ts` first — it's the existing example of this exact pattern (an action sub-route under a resource, `POST`-only, typed `RouteContext`). Create `web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/unlock/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory, setP1Locked } from "@/lib/canonEngine/storyStore";

export const runtime = "nodejs";

/**
 * Explicit unlock of a locked Story Foundation (Project 1) - the only way
 * p1Locked ever goes back to false. Generating a document is what sets it
 * true (see document/route.ts's POST handler). Any workspace member may
 * unlock, matching this route family's existing all-members-can-edit
 * authorization model - no new permission tier.
 */
export async function POST(
  _req: NextRequest,
  ctx: RouteContext<"/api/workspaces/[workspaceId]/canvases/[canvasId]/unlock">
) {
  try {
    const user = await requireUser();
    const { workspaceId, canvasId } = await ctx.params;

    const membership = await getMembership(workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }

    const story = await getStory(canvasId);
    if (!story || story.workspaceId !== workspaceId) {
      return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
    }

    await setP1Locked(canvasId, false);
    return NextResponse.json({ locked: false });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 4: Verify**

Run `npm run lint` from `web/` — must be clean (0 errors, 0 warnings). Run `npm run build` from `web/` — must succeed; this is also what regenerates Next's typed-route types so `RouteContext<"/api/workspaces/[workspaceId]/canvases/[canvasId]/unlock">` resolves without a TypeScript error. If the build complains that route type doesn't exist yet, run the build a second time — Next's typegen for a brand-new route file sometimes needs one pass to discover the file before the second pass can type-check against it.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/canonEngine/storyStore.ts web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/unlock/route.ts
git commit -m "feat: add p1Locked field, setter, and unlock endpoint"
```

---

### Task 2: Wire the lock trigger and server-side enforcement

**Files:**
- Modify: `web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/document/route.ts`
- Modify: `web/src/app/api/chat/route.ts`

**Interfaces:**
- Consumes: `setP1Locked(storyId, locked)` from Task 1.
- Produces: `POST .../document`'s success response now includes `locked: true` alongside its existing `version`/`date`/`summary_of_changes`/`markdown`/`json` fields.
- Produces: `POST /api/chat` now returns `{ error: "The Story Foundation is locked. Unlock it first to keep editing." }` with status 409 when the story is locked — this exact string is what Task 3's client surfaces verbatim via its existing generic error-handling path.

- [ ] **Step 1: Set the lock on successful document generation**

In `web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/document/route.ts`, change the import:

```ts
import { getStory } from "@/lib/canonEngine/storyStore";
```

to:

```ts
import { getStory, setP1Locked } from "@/lib/canonEngine/storyStore";
```

Then in the `POST` handler, change:

```ts
    const version = await generateFoundationDocument(canvasId);
    return NextResponse.json(
      {
        version: version.version,
        date: version.date,
        summary_of_changes: version.summary_of_changes,
        markdown: version.markdown,
        json: version.json,
      },
      { status: 201 }
    );
```

to:

```ts
    const version = await generateFoundationDocument(canvasId);
    await setP1Locked(canvasId, true);
    return NextResponse.json(
      {
        version: version.version,
        date: version.date,
        summary_of_changes: version.summary_of_changes,
        markdown: version.markdown,
        json: version.json,
        locked: true,
      },
      { status: 201 }
    );
```

This covers both the initial lock (first generation) and re-locking (any later regeneration after an unlock) — the same call, no branch needed, per the design spec.

- [ ] **Step 2: Reject chat turns while locked**

In `web/src/app/api/chat/route.ts`, find this existing block inside `POST` (currently around line 133-136):

```ts
    const membership = await getMembership(story.workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }
```

Add the lock check immediately after it, before the `turnId`/`appendMessage` lines that follow:

```ts
    const membership = await getMembership(story.workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }
    if (story.p1Locked) {
      return NextResponse.json(
        { error: "The Story Foundation is locked. Unlock it first to keep editing." },
        { status: 409 }
      );
    }
```

This must come before `await appendMessage(storyId, { role: "user", ... })` and before the Anthropic call, so a locked story never gets an appended message or a burned model call — the whole point of gating here rather than only in the client.

- [ ] **Step 3: Verify**

Run `npm run lint` from `web/` — must be clean. Run `npm run build` from `web/` — must succeed.

Manually trace both call sites against the code (no test runner in this repo, and exercising these via a real authenticated session isn't available in this environment):
- Confirm `setP1Locked(canvasId, true)` in `document/route.ts` runs only after `generateFoundationDocument` resolves successfully (not before, not in a catch path) — a failed generation must never lock the story.
- Confirm the new block in `chat/route.ts` sits after the membership check (so an unauthorized caller still gets 403, not 409) and before any Firestore write or Anthropic call in the `POST` handler.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/document/route.ts web/src/app/api/chat/route.ts
git commit -m "feat: lock Story Foundation on document generation, enforce in chat route"
```

---

### Task 3: Client UI — disabled input, unlock banner, confirmation

**Files:**
- Modify: `web/src/components/ChatInterview.tsx`

**Interfaces:**
- Consumes: `data.story?.p1Locked` from the existing resume `GET /api/workspaces/[workspaceId]/canvases/[canvasId]` response (already included automatically — that route spreads `{ ...story }` into its `story` field, so no server change was needed for this; `p1Locked` appears there the moment Task 1's field exists on the type).
- Consumes: `data.locked` (boolean) from `POST .../document`'s response (Task 2).
- Consumes: `POST /api/workspaces/[workspaceId]/canvases/[canvasId]/unlock` → `{ locked: false }` (Task 1), and its 403/404 `{ error }` shape.
- Consumes: `POST /api/chat`'s existing generic `{ error }` shape on non-OK responses — no new client-side handling needed for the 409 case specifically, since `sendMessage`'s existing `if (!res.ok) { setError(data.error ?? ...); return; }` already surfaces Task 2's exact message.

- [ ] **Step 1: Add `p1Locked` and `unlocking` state**

In `web/src/components/ChatInterview.tsx`, find this block of `useState` declarations (currently around line 100-103):

```ts
  const [doc, setDoc] = useState<GeneratedDoc | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [generating, setGenerating] = useState(false);
  const [pdfGenerating, setPdfGenerating] = useState(false);
```

Add two new lines after `pdfGenerating`:

```ts
  const [doc, setDoc] = useState<GeneratedDoc | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [generating, setGenerating] = useState(false);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [p1Locked, setP1Locked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
```

- [ ] **Step 2: Read the lock state on resume**

Find the resume effect's success branch (currently around line 139-145):

```ts
        if (data.story?.currentStage) {
          setCurrentStage(data.story.currentStage);
          setStageName(`Stage ${data.story.currentStage}`);
        }
        if (Array.isArray(data.elements)) setElements(data.elements);
        if (Array.isArray(data.guardrailFlags)) setGuardrailFlags(data.guardrailFlags);
        if (data.story?.pendingConflict) setConflict(data.story.pendingConflict);
```

Add one line:

```ts
        if (data.story?.currentStage) {
          setCurrentStage(data.story.currentStage);
          setStageName(`Stage ${data.story.currentStage}`);
        }
        if (Array.isArray(data.elements)) setElements(data.elements);
        if (Array.isArray(data.guardrailFlags)) setGuardrailFlags(data.guardrailFlags);
        if (data.story?.pendingConflict) setConflict(data.story.pendingConflict);
        if (data.story?.p1Locked) setP1Locked(true);
```

(No `else setP1Locked(false)` needed — the state already defaults to `false` from Step 1, and this effect only runs once per `workspaceId`/`canvasId` pair on mount.)

- [ ] **Step 3: Update the lock state when a document is generated**

Find `generateDocument` (currently around line 224-246):

```ts
  async function generateDocument() {
    if (!workspaceId || !canvasId || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/canvases/${canvasId}/document`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Document generation failed.");
        return;
      }
      setDoc(data);
      const listRes = await fetch(`/api/workspaces/${workspaceId}/canvases/${canvasId}/document`);
      const listData = await listRes.json();
      if (listRes.ok && Array.isArray(listData.versions)) setVersions(listData.versions);
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setGenerating(false);
    }
  }
```

Add one line right after `setDoc(data);`:

```ts
      setDoc(data);
      if (typeof data.locked === "boolean") setP1Locked(data.locked);
      const listRes = await fetch(`/api/workspaces/${workspaceId}/canvases/${canvasId}/document`);
```

- [ ] **Step 4: Add the unlock handler**

Add a new function right after `generateDocument` (before `downloadPdf`):

```ts
  async function handleUnlock() {
    if (!workspaceId || !canvasId || unlocking) return;
    const confirmed = window.confirm(
      "Editing your Story Foundation may affect Character Bible and World Bible work already built on it. Unlock anyway?"
    );
    if (!confirmed) return;
    setUnlocking(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/canvases/${canvasId}/unlock`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't unlock.");
        return;
      }
      setP1Locked(Boolean(data.locked));
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setUnlocking(false);
    }
  }
```

This reuses the exact `window.confirm` pattern already used in `web/src/components/WorldInterview.tsx` for similar "this affects downstream work, continue?" moments (its `handleWclChange` and `handleElementStatusChange` functions) — no new confirmation UI is introduced.

- [ ] **Step 5: Disable the input and change its placeholder when locked**

Find the textarea and Send button (currently around line 384-398):

```tsx
                    <textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={onKeyDown}
                      rows={2}
                      placeholder="Type your answer… (Enter to send)"
                      className="min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none"
                    />
                    <button
                      onClick={() => sendMessage()}
                      disabled={loading || resuming || !input.trim()}
                      className="shrink-0 rounded-lg bg-gradient-to-r from-red-600 to-orange-500 px-4 py-2 text-sm font-semibold text-white transition hover:from-red-500 hover:to-orange-400 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Send
                    </button>
```

Replace with:

```tsx
                    <textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={onKeyDown}
                      rows={2}
                      disabled={p1Locked}
                      placeholder={p1Locked ? "Story Foundation is locked — unlock to edit." : "Type your answer… (Enter to send)"}
                      className="min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                    />
                    <button
                      onClick={() => sendMessage()}
                      disabled={loading || resuming || !input.trim() || p1Locked}
                      className="shrink-0 rounded-lg bg-gradient-to-r from-red-600 to-orange-500 px-4 py-2 text-sm font-semibold text-white transition hover:from-red-500 hover:to-orange-400 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Send
                    </button>
```

- [ ] **Step 6: Add the unlock banner**

Find the input area's wrapping `<div>` (currently around line 381-401):

```tsx
              <div className="shrink-0 border-t border-red-900/40 p-3">
                <div className="rounded-xl p-[1px]" style={{ background: BORDER_GRADIENT }}>
                  <div className="flex items-end gap-2 rounded-[11px] bg-neutral-900 p-2">
```

Add the banner immediately before it, still inside the left panel's outer `<div>`:

```tsx
              {p1Locked && (
                <div className="flex shrink-0 items-center justify-between gap-2 border-t border-red-900/40 bg-red-950/30 px-3 py-2 text-xs text-red-200">
                  <span>Story Foundation is locked.</span>
                  <button
                    onClick={handleUnlock}
                    disabled={unlocking}
                    className="rounded-lg border border-red-500/50 px-2 py-1 text-xs font-semibold text-red-200 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {unlocking ? "Unlocking…" : "Unlock to edit"}
                  </button>
                </div>
              )}
              <div className="shrink-0 border-t border-red-900/40 p-3">
                <div className="rounded-xl p-[1px]" style={{ background: BORDER_GRADIENT }}>
                  <div className="flex items-end gap-2 rounded-[11px] bg-neutral-900 p-2">
```

Do not touch the "Story Foundation ready" next-steps card (`data-testid="next-steps-card"`, the `doc && !loading` block above this) or the "Generate document"/"Regenerate" buttons in the right panel — those stay visible and usable regardless of `p1Locked`, per the design spec.

- [ ] **Step 7: Verify**

Run `npm run lint` from `web/` — must be clean. Run `npm run build` from `web/` — must succeed.

Manual verification (no browser automation tool in this environment — trace the code path and, if a dev server is available, smoke-test what you can by hand):
- Confirm `p1Locked` starts `false` and the textarea/Send button are enabled/normal-placeholder by default (no story loaded, or a story with no `p1Locked` field).
- Confirm generating a document (via `generateDocument`) flips `p1Locked` to `true` from the response, without needing a page reload.
- Confirm clicking "Unlock to edit" while `window.confirm` would return `false` (Cancel) leaves `p1Locked` untouched — the fetch to `.../unlock` must not fire until after the confirm resolves truthy.
- Confirm the banner and disabled-input styling only appear when `p1Locked` is `true`, and that the "Story Foundation ready" card and its three links are unaffected either way.

If you start a dev server for manual verification, stop it cleanly by finding and killing only the specific process/port you started — never a blanket "kill all node processes" command.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/ChatInterview.tsx
git commit -m "feat: disable P1 chat input and add unlock banner when Story Foundation is locked"
```
