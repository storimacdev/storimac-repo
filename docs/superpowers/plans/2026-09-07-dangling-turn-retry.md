# Dangling-Turn Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix issue #108 — a Project 2 (Character Bible) or Project 3 (World Bible) session whose last turn's model call failed (leaving the user's message persisted with no reply) is silently stuck forever; on reload it should instead automatically retry that turn.

**Architecture:** Both `POST /api/character-chat` and `POST /api/world-chat` gain a `{ storyId, retry: true }` request mode that skips re-persisting the user message (it's already there) and re-runs the model call against the existing history. Both `CharacterInterview.tsx` and `WorldInterview.tsx` generalize their existing "auto-fire the opening turn on an empty session" effect into a three-way check: empty history fires the opening turn (unchanged), a history ending in an assistant reply does nothing (healthy), a history ending in a user message calls a new `retryLastTurn()`.

**Tech Stack:** Next.js 16 App Router (TypeScript), Firebase Admin/Firestore, React 19 client components. No test runner is configured in this repo (`npm test` has no script) — verification is `npm run lint` (must be clean), `npm run build` (must succeed), and manual/code-trace verification, matching every other feature in this codebase.

## Global Constraints

- The retry request shape is exactly `{ storyId: string, retry: true }` — no `message` field. Do not accept or read a `message` value when `retry` is set.
- A retry request that finds the last persisted message is NOT role `"user"` (or there is no last message) must return `{ error: "Nothing to retry." }` with status 409, and must not call the model or write anything.
- Every existing gate that runs before the append-user step (auth via `requireUser()`, membership via `getMembership`, the Character Bible completion gate in `world-chat/route.ts`, the Story Foundation ingestion checks) must run unchanged for a retry request — only the `message` validation and the `appendMessage(user, ...)` call become conditional on `!retry`.
- Client-side: `retryLastTurn()` must NOT optimistically append a user bubble to `messages` state (the dangling message is already there from the resume fetch) and must NOT send a `message` field in its request body.
- Client-side: the three-way resume check (empty → opening turn, ends in assistant → no-op, ends in user → retry) must be mutually exclusive — never call both `sendMessage("Let's begin.")` and `retryLastTurn()` from the same effect run.
- `WorldInterview.tsx`'s opening-turn effect has two extra guards `CharacterInterview.tsx`'s doesn't: `|| error` (don't re-fire while a previous attempt's error is still showing) and `characterBibleGate && !characterBibleGate.complete` (don't fire until the Character Bible gate clears). Both must be preserved unchanged in the generalized version.
- No retry-count cap, no backoff, no change to `ChatInterview.tsx` (Project 1 has no equivalent auto-fired opening turn and isn't affected) — all explicitly out of scope per the spec.

---

### Task 1: Retry mode in `character-chat/route.ts`

**Files:**
- Modify: `web/src/app/api/character-chat/route.ts`

**Interfaces:**
- Produces: `POST /api/character-chat` now also accepts `{ storyId: string, retry: true }` (no `message`), returning the same success shape as a normal turn on success, or `{ error: "Nothing to retry." }` with status 409 when there's nothing dangling to retry.

- [ ] **Step 1: Read `body?.retry` and make the `message` validation conditional**

Find this block (currently around line 126-137):

```ts
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const storyId: unknown = body?.storyId;
    const message: unknown = body?.message;

    if (typeof storyId !== "string" || !storyId) {
      return NextResponse.json({ error: "Request must include `storyId`." }, { status: 400 });
    }
    if (typeof message !== "string" || !message.trim()) {
      return NextResponse.json({ error: "Request must include a non-empty `message`." }, { status: 400 });
    }
```

Replace with:

```ts
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const storyId: unknown = body?.storyId;
    const message: unknown = body?.message;
    const retry = body?.retry === true;

    if (typeof storyId !== "string" || !storyId) {
      return NextResponse.json({ error: "Request must include `storyId`." }, { status: 400 });
    }
    let userMessage = "";
    if (!retry) {
      if (typeof message !== "string" || !message.trim()) {
        return NextResponse.json({ error: "Request must include a non-empty `message`." }, { status: 400 });
      }
      userMessage = message.trim();
    }
```

(`userMessage` is declared here, outside the `if`, so TypeScript's narrowing of `message` to `string` — which only holds inside that `if` block — has somewhere to escape to. Using `message.trim()` anywhere outside that block would be a type error since `message` stays typed `unknown` there.)

- [ ] **Step 2: Make the append-user step conditional on `!retry`**

Find this block (currently around line 184-190):

```ts
    const turnId = randomUUID();
    const now = new Date().toISOString();
    await appendMessage(
      storyId,
      { role: "user", content: message.trim(), ts: now, turnId },
      CHARACTER_MESSAGES_COLLECTION
    );
```

Replace with:

```ts
    const turnId = randomUUID();
    const now = new Date().toISOString();
    if (retry) {
      const lastMessages = await listMessages(storyId, 1, CHARACTER_MESSAGES_COLLECTION);
      if (lastMessages[0]?.role !== "user") {
        return NextResponse.json({ error: "Nothing to retry." }, { status: 409 });
      }
    } else {
      await appendMessage(
        storyId,
        { role: "user", content: userMessage, ts: now, turnId },
        CHARACTER_MESSAGES_COLLECTION
      );
    }
```

`listMessages(storyId, 1, CHARACTER_MESSAGES_COLLECTION)` (already imported in this file) returns an array with just the most recent message (ascending-ordered, sliced to the last N) — empty if there are no messages yet, which correctly falls through to the 409 since `undefined?.role !== "user"` is `true`.

Everything below this block (`const recentMessages = await listMessages(storyId, CHARACTER_MESSAGE_WINDOW, CHARACTER_MESSAGES_COLLECTION);` and everything after) is unchanged — a retry request continues through the exact same context-building, model call, and reply-persisting logic as a normal turn, using whatever history (including the dangling user message) is already in Firestore.

- [ ] **Step 3: Verify**

Run `npm run lint` from `web/` — must be clean. Run `npm run build` from `web/` — must succeed (this also confirms the `userMessage`/`message` type narrowing compiles correctly).

Manually trace the code (no test runner in this repo, and exercising this via a real authenticated session isn't available in this environment):
- Confirm a normal request (`{ storyId, message: "hello" }`, no `retry` field) takes the exact same code path as before this change — `retry` evaluates to `false`, `userMessage` gets set inside the `if (!retry)` block, and the `else` branch appends it exactly as the original code did.
- Confirm a `{ storyId, retry: true }` request with no prior messages returns 409 `"Nothing to retry."` before reaching any Anthropic call.
- Confirm a `{ storyId, retry: true }` request whose last persisted message IS role `"user"` skips the append and falls through to the unchanged context-building/model-call logic.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/api/character-chat/route.ts
git commit -m "feat: add retry mode to character-chat route for dangling turns"
```

---

### Task 2: Retry mode in `world-chat/route.ts`

**Files:**
- Modify: `web/src/app/api/world-chat/route.ts`

**Interfaces:**
- Produces: `POST /api/world-chat` now also accepts `{ storyId: string, retry: true }` (no `message`), same success/409 contract as Task 1's `character-chat` change.

This route is structurally simpler than `character-chat/route.ts` (no character-lock/self-heal logic) but follows the identical pattern.

- [ ] **Step 1: Read `body?.retry` and make the `message` validation conditional**

Find this block (currently around line 55-65):

```ts
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const storyId: unknown = body?.storyId;
    const message: unknown = body?.message;

    if (typeof storyId !== "string" || !storyId) {
      return NextResponse.json({ error: "Request must include `storyId`." }, { status: 400 });
    }
    if (typeof message !== "string" || !message.trim()) {
      return NextResponse.json({ error: "Request must include a non-empty `message`." }, { status: 400 });
    }
```

Replace with:

```ts
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const storyId: unknown = body?.storyId;
    const message: unknown = body?.message;
    const retry = body?.retry === true;

    if (typeof storyId !== "string" || !storyId) {
      return NextResponse.json({ error: "Request must include `storyId`." }, { status: 400 });
    }
    let userMessage = "";
    if (!retry) {
      if (typeof message !== "string" || !message.trim()) {
        return NextResponse.json({ error: "Request must include a non-empty `message`." }, { status: 400 });
      }
      userMessage = message.trim();
    }
```

- [ ] **Step 2: Make the append-user step conditional on `!retry`**

Find this block (currently around line 115-121):

```ts
    const turnId = randomUUID();
    const now = new Date().toISOString();
    await appendMessage(
      storyId,
      { role: "user", content: message.trim(), ts: now, turnId },
      WORLD_MESSAGES_COLLECTION
    );
```

Replace with:

```ts
    const turnId = randomUUID();
    const now = new Date().toISOString();
    if (retry) {
      const lastMessages = await listMessages(storyId, 1, WORLD_MESSAGES_COLLECTION);
      if (lastMessages[0]?.role !== "user") {
        return NextResponse.json({ error: "Nothing to retry." }, { status: 409 });
      }
    } else {
      await appendMessage(
        storyId,
        { role: "user", content: userMessage, ts: now, turnId },
        WORLD_MESSAGES_COLLECTION
      );
    }
```

Everything below (`const recentMessages = await listMessages(storyId, WORLD_MESSAGE_WINDOW, WORLD_MESSAGES_COLLECTION);` and onward, including the Story Foundation grounding block and the model call) is unchanged.

Note: this route's Character Bible completion gate (`checkCharacterBibleComplete`, currently around line 76-98) and Story Foundation ingestion checks (currently around line 100-113) both run BEFORE this block, so they're unaffected and still apply to a retry request exactly as they do to a normal one — no change needed there.

- [ ] **Step 3: Verify**

Run `npm run lint` from `web/` — must be clean. Run `npm run build` from `web/` — must succeed.

Manually trace the code the same way as Task 1's Step 3, for this route.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/api/world-chat/route.ts
git commit -m "feat: add retry mode to world-chat route for dangling turns"
```

---

### Task 3: Client wiring in `CharacterInterview.tsx`

**Files:**
- Modify: `web/src/components/CharacterInterview.tsx`

**Interfaces:**
- Consumes: `POST /api/character-chat`'s `{ storyId, retry: true }` mode from Task 1.
- Produces: `retryLastTurn(): Promise<void>` (new function, same shape/signature style as the existing `sendMessage`), and a shared `applyTurnResponse(data)` helper both functions call.

- [ ] **Step 1: Extract the shared success-handling tail into `applyTurnResponse`**

Find `sendMessage` (currently around line 147-183):

```ts
  async function sendMessage(preset?: string) {
    const text = (preset ?? input).trim();
    if (!text || loading || !canvasId) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    if (!preset) setInput("");
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/character-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId: canvasId, message: text }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }

      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      setContext(data.context ?? null);
      setCurrentCharacter(data.current_character ?? null);
      setCurrentStage(typeof data.current_stage === "number" ? data.current_stage : null);
      setCharacterSignedOff(Boolean(data.character_signed_off));
      if (data.character_signed_off) {
        fetchBibleEntries();
      }
    } catch {
      setError("Couldn't reach the server. Is the dev server running?");
    } finally {
      setLoading(false);
      requestAnimationFrame(() => scrollToLatest("smooth"));
    }
  }
```

Replace with (splits the response-handling into `applyTurnResponse`, adds `retryLastTurn` as a sibling function using it, and slims `sendMessage` down to call it):

```ts
  function applyTurnResponse(data: {
    reply: string;
    context?: string | null;
    current_character?: string | null;
    current_stage?: number;
    character_signed_off?: boolean;
  }) {
    setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
    setContext(data.context ?? null);
    setCurrentCharacter(data.current_character ?? null);
    setCurrentStage(typeof data.current_stage === "number" ? data.current_stage : null);
    setCharacterSignedOff(Boolean(data.character_signed_off));
    if (data.character_signed_off) {
      fetchBibleEntries();
    }
  }

  async function sendMessage(preset?: string) {
    const text = (preset ?? input).trim();
    if (!text || loading || !canvasId) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    if (!preset) setInput("");
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/character-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId: canvasId, message: text }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }

      applyTurnResponse(data);
    } catch {
      setError("Couldn't reach the server. Is the dev server running?");
    } finally {
      setLoading(false);
      requestAnimationFrame(() => scrollToLatest("smooth"));
    }
  }

  // Recovers a "dangling" turn (issue #108): if a prior turn's model call
  // failed after the user's message was already persisted, the resumed
  // history ends in a user message with no reply. Unlike sendMessage, this
  // does not optimistically append a user bubble (it's already in
  // `messages` from the resume fetch) and sends no `message` field - the
  // server re-runs the turn against the already-persisted history.
  async function retryLastTurn() {
    if (loading || !canvasId) return;
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/character-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId: canvasId, retry: true }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }

      applyTurnResponse(data);
    } catch {
      setError("Couldn't reach the server. Is the dev server running?");
    } finally {
      setLoading(false);
      requestAnimationFrame(() => scrollToLatest("smooth"));
    }
  }
```

- [ ] **Step 2: Generalize the opening-turn effect**

Find this block (currently around line 111-119):

```ts
  // Fires the opening turn (sp02 §8: structural cast/priority-matrix
  // evaluation + first Protagonist questions) automatically, once, the
  // first time a genuinely new session loads - otherwise the session sits
  // waiting for the author to type something before the model ever speaks.
  useEffect(() => {
    if (resuming || messages.length > 0 || !canvasId) return;
    sendMessage("Let's begin.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resuming, canvasId]);
```

Replace with:

```ts
  // Fires the opening turn (sp02 §8: structural cast/priority-matrix
  // evaluation + first Protagonist questions) automatically, once, the
  // first time a genuinely new session loads - otherwise the session sits
  // waiting for the author to type something before the model ever speaks.
  // Also recovers a "dangling" turn (issue #108): if the model call for
  // some prior message failed after that message was already persisted,
  // the resumed history ends in a user message with no reply - retry it
  // instead of leaving the session silently stuck.
  useEffect(() => {
    if (resuming || !canvasId) return;
    if (messages.length === 0) {
      sendMessage("Let's begin.");
      return;
    }
    if (messages[messages.length - 1].role === "user") {
      retryLastTurn();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resuming, canvasId]);
```

`sendMessage` and `retryLastTurn` are both `async function` declarations, which are hoisted — the effect already calls `sendMessage` before its own textual definition further down in the file (unchanged from before this task), so calling `retryLastTurn` the same way here is consistent with the file's existing pattern.

- [ ] **Step 3: Verify**

Run `npm run lint` from `web/` — must be clean. Run `npm run build` from `web/` — must succeed.

Manual verification (no browser automation tool in this environment — trace the code path):
- Confirm an empty session (`messages.length === 0` on resume) still calls `sendMessage("Let's begin.")` exactly as before.
- Confirm a resumed session whose last message is role `"assistant"` calls neither function (healthy state, effect does nothing).
- Confirm a resumed session whose last message is role `"user"` calls `retryLastTurn()`, which does NOT add a duplicate user bubble to `messages` (grep to confirm `retryLastTurn`'s body has no `setMessages((prev) => [...prev, { role: "user", ...`).
- Confirm `applyTurnResponse` is called from both `sendMessage`'s and `retryLastTurn`'s success path with the exact same shape of updates as `sendMessage` applied before this task (context, current character, current stage, sign-off, bible-entries refetch).

- [ ] **Step 4: Commit**

```bash
git add web/src/components/CharacterInterview.tsx
git commit -m "feat: retry dangling turns on resume in Character Bible interview"
```

---

### Task 4: Client wiring in `WorldInterview.tsx`

**Files:**
- Modify: `web/src/components/WorldInterview.tsx`

**Interfaces:**
- Consumes: `POST /api/world-chat`'s `{ storyId, retry: true }` mode from Task 2.
- Produces: `retryLastTurn(): Promise<void>` and a shared `applyTurnResponse(data)` helper, same pattern as Task 3 but for this file — including this file's two extra opening-effect guards (`|| error`, the Character Bible gate check) which Task 3's file doesn't have.

- [ ] **Step 1: Extract the shared success-handling tail into `applyTurnResponse`**

Find `sendMessage` (currently around line 159-199):

```ts
  async function sendMessage(preset?: string) {
    const text = (preset ?? input).trim();
    if (!text || loading || !canvasId) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    if (!preset) setInput("");
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/world-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId: canvasId, message: text }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }

      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      setContext(data.context ?? null);
      setCurrentStage(typeof data.current_stage === "number" ? data.current_stage : null);
      if (data.p3) {
        const incoming = data.p3 as P3State;
        setWclState((prev) => ({
          proposedWorldComplexityLevel: incoming.proposedWorldComplexityLevel,
          worldComplexityLevel: prev?.worldComplexityLevel ?? null,
          proposedPillars: incoming.proposedPillars,
          pillars: prev?.pillars ?? null,
        }));
      }
    } catch {
      setError("Couldn't reach the server. Is the dev server running?");
    } finally {
      setLoading(false);
      requestAnimationFrame(() => scrollToLatest("smooth"));
    }
  }
```

Replace with:

```ts
  function applyTurnResponse(data: { reply: string; context?: string | null; current_stage?: number; p3?: P3State }) {
    setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
    setContext(data.context ?? null);
    setCurrentStage(typeof data.current_stage === "number" ? data.current_stage : null);
    if (data.p3) {
      const incoming = data.p3;
      setWclState((prev) => ({
        proposedWorldComplexityLevel: incoming.proposedWorldComplexityLevel,
        worldComplexityLevel: prev?.worldComplexityLevel ?? null,
        proposedPillars: incoming.proposedPillars,
        pillars: prev?.pillars ?? null,
      }));
    }
  }

  async function sendMessage(preset?: string) {
    const text = (preset ?? input).trim();
    if (!text || loading || !canvasId) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    if (!preset) setInput("");
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/world-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId: canvasId, message: text }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }

      applyTurnResponse(data);
    } catch {
      setError("Couldn't reach the server. Is the dev server running?");
    } finally {
      setLoading(false);
      requestAnimationFrame(() => scrollToLatest("smooth"));
    }
  }

  // Recovers a "dangling" turn (issue #108): if a prior turn's model call
  // failed after the user's message was already persisted, the resumed
  // history ends in a user message with no reply. Unlike sendMessage, this
  // does not optimistically append a user bubble (it's already in
  // `messages` from the resume fetch) and sends no `message` field - the
  // server re-runs the turn against the already-persisted history.
  async function retryLastTurn() {
    if (loading || !canvasId) return;
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/world-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId: canvasId, retry: true }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }

      applyTurnResponse(data);
    } catch {
      setError("Couldn't reach the server. Is the dev server running?");
    } finally {
      setLoading(false);
      requestAnimationFrame(() => scrollToLatest("smooth"));
    }
  }
```

Note the parameter type on `applyTurnResponse` uses `p3?: P3State` directly (not `unknown`), matching the original code's `data.p3 as P3State` cast — `data` at the call sites is still the untyped `await res.json()` result, so this is the same trust boundary the original code already had, just named as a parameter type instead of an inline cast.

- [ ] **Step 2: Generalize the opening-turn effect**

Find this block (currently around line 148-157):

```ts
  // Fires the opening turn (sp03 §10: structural assessment + WCL proposal
  // + first discovery questions) automatically, once, the first time a
  // genuinely new session loads - otherwise the session sits waiting for
  // the author to type something before the model ever speaks.
  useEffect(() => {
    if (resuming || messages.length > 0 || !canvasId || error) return;
    if (characterBibleGate && !characterBibleGate.complete) return;
    sendMessage("Let's begin.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resuming, canvasId, characterBibleGate, error]);
```

Replace with:

```ts
  // Fires the opening turn (sp03 §10: structural assessment + WCL proposal
  // + first discovery questions) automatically, once, the first time a
  // genuinely new session loads - otherwise the session sits waiting for
  // the author to type something before the model ever speaks. Also
  // recovers a "dangling" turn (issue #108): if the model call for some
  // prior message failed after that message was already persisted, the
  // resumed history ends in a user message with no reply - retry it
  // instead of leaving the session silently stuck.
  useEffect(() => {
    if (resuming || !canvasId || error) return;
    if (characterBibleGate && !characterBibleGate.complete) return;
    if (messages.length === 0) {
      sendMessage("Let's begin.");
      return;
    }
    if (messages[messages.length - 1].role === "user") {
      retryLastTurn();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resuming, canvasId, characterBibleGate, error]);
```

Both extra guards from the original (`|| error` and the Character Bible gate check) are preserved unchanged, still ahead of the new three-way branch.

- [ ] **Step 3: Verify**

Run `npm run lint` from `web/` — must be clean. Run `npm run build` from `web/` — must succeed.

Manual verification (same shape as Task 3's Step 3, for this file):
- Confirm the two preserved guards (`error`, incomplete `characterBibleGate`) still short-circuit the whole effect before either the opening-turn or retry branch can run.
- Confirm a resumed session whose last message is role `"user"` calls `retryLastTurn()` without appending a duplicate user bubble.
- Confirm `applyTurnResponse` is called from both `sendMessage` and `retryLastTurn`'s success path with the same `p3`/context/stage handling `sendMessage` applied before this task.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/WorldInterview.tsx
git commit -m "feat: retry dangling turns on resume in World Bible interview"
```
