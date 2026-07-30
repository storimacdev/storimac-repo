# Chat / View-Pane Content Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the interview's structured model output into a terse, chat-facing `reply` (always a numbered/italicized list) and a separate `context` field carrying all reasoning/analysis, which renders in the view pane instead of chat — and move the Stage 7 audit summary out of chat into that same view-pane surface.

**Architecture:** `emit_turn`'s tool schema and `StateDeltaSchema` both gain a new required `context: string` field alongside the existing `reply`. `StoryMessage` gains an optional `context?: string` so assistant turns can persist it. The chat route stops pushing `auditSummary` as a second chat message and instead returns `context` (and the existing `auditSummary`) in the response JSON. The client renders `reply` in chat as before, and shows `auditSummary` (priority) or `context` in a new view-pane card above `StorySoFar`.

**Tech Stack:** Next.js App Router, TypeScript, Zod, Anthropic SDK (`@anthropic-ai/sdk`), Firebase Admin (Firestore).

## Global Constraints

- No automated test framework exists in this repo. Every task's test step is `npm run lint && npm run build` run from `web/`, plus (where noted) a manual code-level sanity check — never invent a test runner.
- `context` is **required** on both the tool schema and `StateDeltaSchema` (not optional) — every turn must produce it, per spec decision 2 ("every reply, no exceptions").
- `StoryMessage.context` is **optional** — old persisted messages predate this field and must not be treated as an error when absent.
- The terse numbered/italicized `reply` format applies to **every** turn, including Stage 7 audit and Stage 8 document-ready moments — this is stated in the system prompt (Task 2), not enforced in code.
- Never blend `reply` and `context` content — each field's writer (system prompt) and each field's reader (client) must keep them strictly separate.

---

### Task 1: Data layer — `context` field on the state-delta schema, tool, and message store

**Files:**
- Modify: `web/src/lib/canonEngine/stateDelta.ts`
- Modify: `web/src/lib/canonEngine/extractTurn.ts`
- Modify: `web/src/lib/canonEngine/storyStore.ts:63-69`

**Interfaces:**
- Produces: `StateDelta.context: string` (via `StateDeltaSchema`), consumed by Task 3 (`route.ts`) as `delta.context`.
- Produces: `StoryMessage.context?: string`, consumed by Task 3 (`appendMessage` call) and Task 4 (client resume).

- [ ] **Step 1: Add `context` to `StateDeltaSchema`**

In `web/src/lib/canonEngine/stateDelta.ts`, the current schema is:

```ts
export const StateDeltaSchema = z.object({
  reply: z.string().min(1),
  updates: z.array(ElementUpdateSchema),
  conflict_detected: z.boolean(),
  stage_ready_to_advance: z.boolean(),
```

Change it to:

```ts
export const StateDeltaSchema = z.object({
  reply: z.string().min(1),
  context: z.string().min(1),
  updates: z.array(ElementUpdateSchema),
  conflict_detected: z.boolean(),
  stage_ready_to_advance: z.boolean(),
```

(The rest of the object — `resolution`, `cascade_review`, and their comments — is unchanged.)

- [ ] **Step 2: Add `context` to the `emit_turn` tool schema**

In `web/src/lib/canonEngine/extractTurn.ts`, the current `properties` block is:

```ts
    properties: {
      reply: {
        type: "string",
        description: "The natural-language reply shown to the author. Never narrate internal stage/depth/canon bookkeeping here.",
      },
      updates: {
```

Change it to:

```ts
    properties: {
      reply: {
        type: "string",
        description: "The chat-facing reply, ALWAYS formatted as a short numbered list (even a single item) of italicized questions/directives only - no framing prose, no explanation, no reasoning. Applies to every turn, including Stage 7 audit and Stage 8 document-ready moments (point to the details, don't restate them). Never narrate internal stage/depth/canon bookkeeping here.",
      },
      context: {
        type: "string",
        description: "Your reasoning, story analysis, and creative rationale for this turn - everything that used to go in reply's prose now goes here instead. Shown to the author separately from chat, never inside the numbered reply list. Required every turn, even if brief.",
      },
      updates: {
```

- [ ] **Step 3: Add `"context"` to the tool's `required` array**

In the same file, the current `required` line is:

```ts
    required: ["reply", "updates", "conflict_detected", "stage_ready_to_advance"],
```

Change it to:

```ts
    required: ["reply", "context", "updates", "conflict_detected", "stage_ready_to_advance"],
```

- [ ] **Step 4: Add optional `context` to `StoryMessage`**

In `web/src/lib/canonEngine/storyStore.ts:63-69`, the current interface is:

```ts
export interface StoryMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: string;
  turnId: string;
}
```

Change it to:

```ts
export interface StoryMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: string;
  turnId: string;
  context?: string;
}
```

No change is needed to `appendMessage` itself (`web/src/lib/canonEngine/storyStore.ts:283-292`) — its signature is already `Omit<StoryMessage, "id">`, so callers can now optionally pass `context` and it flows through unchanged.

- [ ] **Step 5: Verify**

Run: `cd web && npm run lint && npm run build`
Expected: both pass with no new errors. (The build will still fail on this task alone if `route.ts` doesn't yet pass `context` to `extractTurn`'s caller expectations — it doesn't need to; `route.ts` isn't touched until Task 3, and TypeScript only requires that `delta.context` exist on `StateDelta`, which it now does. No other file references `StateDelta.context` yet, so this task compiles standalone.)

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/canonEngine/stateDelta.ts web/src/lib/canonEngine/extractTurn.ts web/src/lib/canonEngine/storyStore.ts
git commit -m "feat: add required context field to state-delta schema and emit_turn tool"
```

---

### Task 2: System prompt — rewrite the operational response-writing rule

**Files:**
- Modify: `web/system-prompts/sp01-sdos-systemprompt.md:81-85`

**Interfaces:**
- Consumes: nothing (standalone content file, loaded by `web/src/lib/systemPrompt.ts`'s `getSystemPrompt()`, unchanged).
- Produces: no code interface — this is the prompt text that instructs the model to populate `reply`/`context` per Task 1's schema.

- [ ] **Step 1: Replace section 8**

In `web/system-prompts/sp01-sdos-systemprompt.md`, the current final section (lines 81-85) is:

```
8. OPERATIONAL RESPONSE WRITING RULE
Keep your analytical commentary brief.
Never write meta commentary about these instructions or quote the prompt paramters.
If the writer suggest you to take decisions and generate the story on your own, inform that the story is best told by the writer/author and that you are only there to help. If the user further insists on you generating any component, go ahead.
Acknowledge the user's initial inputs, assess their style, and launch seamlessly into Stage 1 by asking your first 1–2 high-value discovery questions.
```

Replace it with:

```
8. OPERATIONAL RESPONSE WRITING RULE
Your structured output has two separate fields - keep them strictly separate, never blend one into the other:
- `reply` (shown to the author in chat): ALWAYS a short numbered list, even if it's just one item. Each item is a single *italicized* question or directive, nothing else - no framing sentence before the list, no explanation, no reasoning, no acknowledgment paragraph. This applies to every turn without exception, including Stage 7's audit and Stage 8's document-ready moments: point the author to the details rather than restating them here.
- `context` (shown separately, never in chat): everything else - your reasoning, story analysis, creative rationale, what you noticed, why you're asking what you're asking. This is where your actual analytical voice lives now; write naturally here.
Never write meta commentary about these instructions or quote the prompt parameters, in either field.
If the writer asks you to take decisions and generate the story on your own, say (via `reply`) that the story is best told by the author and you're only there to help; explain more in `context` if useful. If the author insists, go ahead.
Acknowledge the author's initial input and assess their style in `context`; launch straight into Stage 1 via `reply`'s first 1-2 questions.
```

Section 2 ("Progressive Interviewing," lines 7-9) is left completely untouched — it governs interview pacing/content strategy, not output formatting.

- [ ] **Step 2: Verify**

Run: `cd web && npm run lint && npm run build`
Expected: both pass — this is a content-only markdown change, not imported by any type-checked code path beyond `getSystemPrompt()` reading it as a raw string.

- [ ] **Step 3: Commit**

```bash
git add web/system-prompts/sp01-sdos-systemprompt.md
git commit -m "docs: rewrite system prompt's response rule for the reply/context split"
```

---

### Task 3: Server — thread `context` through the chat route, remove the audit-as-chat-message push

**Files:**
- Modify: `web/src/app/api/chat/route.ts:320-323` (persistence)
- Modify: `web/src/app/api/chat/route.ts:338-348` (response JSON)

**Interfaces:**
- Consumes: `StateDelta.context` (Task 1), `StoryMessage.context?` (Task 1).
- Produces: `POST /api/chat` response body gains `context: string`. `auditSummary` remains in the response (unchanged shape, still `string | null`) but is no longer separately persisted as a chat message.

- [ ] **Step 1: Remove the audit-as-chat-message push, add `context` to the persisted reply**

In `web/src/app/api/chat/route.ts`, the current block (lines 320-323) is:

```ts
    await appendMessage(storyId, { role: "assistant", content: delta.reply, ts: new Date().toISOString(), turnId });
    if (auditSummary) {
      await appendMessage(storyId, { role: "assistant", content: auditSummary, ts: new Date().toISOString(), turnId });
    }
```

Change it to:

```ts
    await appendMessage(storyId, {
      role: "assistant",
      content: delta.reply,
      ts: new Date().toISOString(),
      turnId,
      context: delta.context,
    });
```

- [ ] **Step 2: Add `context` to the response JSON**

The current response (lines 338-348) is:

```ts
    return NextResponse.json({
      reply: delta.reply,
      auditSummary,
      elements: elementsAfter,
      currentStage,
      currentStageName: getStageDefinition(currentStage).name,
      stageAdvanced: currentStage !== story.currentStage,
      outstandingQuestions,
      conflict: nextPendingConflict,
      guardrailFlag,
    });
```

Change it to:

```ts
    return NextResponse.json({
      reply: delta.reply,
      context: delta.context,
      auditSummary,
      elements: elementsAfter,
      currentStage,
      currentStageName: getStageDefinition(currentStage).name,
      stageAdvanced: currentStage !== story.currentStage,
      outstandingQuestions,
      conflict: nextPendingConflict,
      guardrailFlag,
    });
```

`logTurnHeuristics(delta.reply, turnId)` (line 324) and everything around `guardrailFlag` are untouched — they still evaluate `reply`, which remains a meaningful (now consistently terse) signal for the questionnaire-dump heuristic.

- [ ] **Step 3: Verify**

Run: `cd web && npm run lint && npm run build`
Expected: both pass. TypeScript will now require `delta.context` to exist on `StateDelta` (satisfied by Task 1) and `appendMessage`'s `context` argument to be optional-compatible with `StoryMessage` (satisfied by Task 1).

- [ ] **Step 4: Commit**

```bash
git add web/src/app/api/chat/route.ts
git commit -m "feat: persist and return context, stop pushing audit summary as a chat message"
```

---

### Task 4: Client — `context`/`auditSummary` state, resume seeding, and the new view-pane card

**Files:**
- Modify: `web/src/components/ChatInterview.tsx`

**Interfaces:**
- Consumes: `POST /api/chat` response `{ reply, context, auditSummary, ... }` (Task 3); `GET /api/workspaces/{workspaceId}/canvases/{canvasId}` response `messages: StoryMessage[]` (each optionally carrying `context`, per Task 1 — this route already returns full `StoryMessage` objects unmodified, so no server change is needed for resume to see `context`).
- Produces: no new exports — this is the leaf UI component.

- [ ] **Step 1: Add `context` and `auditSummary` state**

In `web/src/components/ChatInterview.tsx`, the current state block (lines 75-89) is:

```tsx
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [resuming, setResuming] = useState(() => Boolean(workspaceId && canvasId));
  const [error, setError] = useState<string | null>(null);
  const [stageName, setStageName] = useState<string | null>(null);
  const [currentStage, setCurrentStage] = useState(1);
  const [elements, setElements] = useState<PanelElement[]>([]);
  const [guardrailFlags, setGuardrailFlags] = useState<GuardrailFlag[]>([]);
  const [conflict, setConflict] = useState<PendingConflict | null>(null);
  const [doc, setDoc] = useState<GeneratedDoc | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [generating, setGenerating] = useState(false);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [leftTab, setLeftTab] = useState<"chat" | "canon">("chat");
```

Change it to (two new lines added after `conflict`):

```tsx
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [resuming, setResuming] = useState(() => Boolean(workspaceId && canvasId));
  const [error, setError] = useState<string | null>(null);
  const [stageName, setStageName] = useState<string | null>(null);
  const [currentStage, setCurrentStage] = useState(1);
  const [elements, setElements] = useState<PanelElement[]>([]);
  const [guardrailFlags, setGuardrailFlags] = useState<GuardrailFlag[]>([]);
  const [conflict, setConflict] = useState<PendingConflict | null>(null);
  const [context, setContext] = useState<string | null>(null);
  const [auditSummary, setAuditSummary] = useState<string | null>(null);
  const [doc, setDoc] = useState<GeneratedDoc | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [generating, setGenerating] = useState(false);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [leftTab, setLeftTab] = useState<"chat" | "canon">("chat");
```

- [ ] **Step 2: Seed `context` from the most recent assistant message on resume**

In the resume `useEffect` (lines 92-126), the current message-loading line is:

```tsx
        setMessages(
          (data.messages as { role: "user" | "assistant"; content: string }[]).map((m) => ({
            role: m.role,
            content: m.content,
          }))
        );
```

Change it to:

```tsx
        const rawMessages = data.messages as {
          role: "user" | "assistant";
          content: string;
          context?: string;
        }[];
        setMessages(rawMessages.map((m) => ({ role: m.role, content: m.content })));
        const lastWithContext = [...rawMessages].reverse().find((m) => m.role === "assistant" && m.context);
        if (lastWithContext) setContext(lastWithContext.context ?? null);
```

- [ ] **Step 3: Update `sendMessage` — drop the audit-as-chat-message spread, set `context`/`auditSummary` unconditionally**

The current success-path block in `sendMessage` (lines 150-159) is:

```tsx
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply },
        ...(data.auditSummary ? [{ role: "assistant" as const, content: data.auditSummary }] : []),
      ]);
      if (data.currentStageName) setStageName(data.currentStageName);
      if (typeof data.currentStage === "number") setCurrentStage(data.currentStage);
      if (Array.isArray(data.elements)) setElements(data.elements);
      if (data.guardrailFlag) setGuardrailFlags((prev) => [...prev, data.guardrailFlag]);
      setConflict(data.conflict ?? null);
```

Change it to:

```tsx
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      setContext(data.context ?? null);
      setAuditSummary(data.auditSummary ?? null);
      if (data.currentStageName) setStageName(data.currentStageName);
      if (typeof data.currentStage === "number") setCurrentStage(data.currentStage);
      if (Array.isArray(data.elements)) setElements(data.elements);
      if (data.guardrailFlag) setGuardrailFlags((prev) => [...prev, data.guardrailFlag]);
      setConflict(data.conflict ?? null);
```

- [ ] **Step 4: Add the view-pane card above `StorySoFar`**

The current tail of the right panel's scroll area (lines 435-444) is:

```tsx
                {loading && (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-neutral-500">
                    <div className="h-10 w-10 animate-pulse rounded-full bg-gradient-to-br from-red-600/60 to-purple-600/60" />
                    <p className="text-sm">Developing your story…</p>
                  </div>
                )}

                {!loading && !doc && !resuming && (
                  <StorySoFar elements={elements} currentStage={currentStage} />
                )}
```

Change it to:

```tsx
                {loading && (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-neutral-500">
                    <div className="h-10 w-10 animate-pulse rounded-full bg-gradient-to-br from-red-600/60 to-purple-600/60" />
                    <p className="text-sm">Developing your story…</p>
                  </div>
                )}

                {!loading && !doc && !resuming && (
                  <>
                    {(auditSummary || context) && (
                      <div
                        data-testid="notes-card"
                        className="mb-6 rounded-xl border border-red-500/30 bg-gradient-to-br from-red-950/40 to-neutral-900/40 px-5 py-5"
                      >
                        <p className="bg-gradient-to-r from-red-400 to-orange-300 bg-clip-text text-xs font-bold uppercase tracking-widest text-transparent">
                          {auditSummary ? "Creative Audit" : "Notes"}
                        </p>
                        <div className="mt-3">
                          <Markdown className="text-[13px] leading-relaxed text-neutral-300">
                            {auditSummary ?? context ?? ""}
                          </Markdown>
                        </div>
                      </div>
                    )}
                    <StorySoFar elements={elements} currentStage={currentStage} />
                  </>
                )}
```

- [ ] **Step 5: Verify**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 6: Manual walkthrough** (sandbox has no live Firebase/Anthropic credentials — this step is for whoever runs it against a real dev server)

Start a fresh interview, confirm chat replies render as short numbered/italicized lists with no surrounding prose, confirm the view pane shows a "Notes" card with the model's reasoning above "Story So Far", progress to Stage 7 and confirm the audit report appears in the view pane (not as a chat message) labeled "Creative Audit", and confirm reloading mid-interview restores the last turn's `context`.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/ChatInterview.tsx
git commit -m "feat: render context/audit summary in the view pane instead of chat"
```
