"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useUser } from "@/components/UserProvider";
import UserMenu from "@/components/UserMenu";
import Link from "next/link";
import { useScrollToLatest } from "@/lib/useScrollToLatest";

type ChatMessage = { role: "user" | "assistant"; content: string };

interface SceneSummary {
  sceneNumber: number;
  status: "Exploring" | "Working" | "Confirmed" | "Parked";
  phase: "assignment_gate" | "drafting" | "qa_delivery" | "revision";
  assignmentSummary: string | null;
  signedOff: boolean;
  draftText: string | null;
  confirmedText: string | null;
}

interface TurnResponse {
  reply: string;
  context: string;
  sceneNumber: number | null;
  phase: string | null;
  scene: SceneSummary | null;
  summaryFormatIssue: string | null;
  gaps: { project: string; field: string; reason: string }[];
  deferredItems: { item: string; defer_to_project: string | null; notes: string }[];
}

/**
 * Project 5 (Screenplay Edition) chat UI — GitHub issue #93 (Phase 1
 * gate). Deliberately smaller than ArchitectureInterview.tsx/
 * WorldInterview.tsx: P5 has no compiled-document export concern
 * (issue #102 is explicitly out of scope for this build), so there is
 * no compile/.docx/.pdf panel to carry over. Extended by later issues
 * (#94 draft display, #95 split Screenplay/Compliance Report, #96
 * revision controls, #98 conflict banner, #100 resume-on-reload).
 */
export default function ScreenplayInterview() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId");
  const canvasId = searchParams.get("canvasId");
  const { setLastProject } = useUser();
  const { containerRef, endRef, handleScroll, scrollToLatest } = useScrollToLatest();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scene, setScene] = useState<SceneSummary | null>(null);
  const [gaps, setGaps] = useState<{ project: string; field: string; reason: string }[]>([]);
  const [summaryFormatIssue, setSummaryFormatIssue] = useState<string | null>(null);

  async function sendMessage(text: string) {
    if (!canvasId || !text.trim() || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/screenplay-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId: canvasId, message: text }),
      });
      const data: TurnResponse & { error?: string } = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't reach the server.");
        return;
      }
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      requestAnimationFrame(() => scrollToLatest("smooth"));
      setScene(data.scene);
      setGaps(data.gaps);
      setSummaryFormatIssue(data.summaryFormatIssue);
      setLastProject("screenplay");
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    sendMessage(input);
  }

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-neutral-400 hover:text-neutral-200">
            ← Dashboard
          </Link>
          <h1 className="text-sm font-semibold">Screenplay Edition</h1>
        </div>
        <UserMenu />
      </header>

      {gaps.length > 0 && (
        <div className="border-b border-amber-700/40 bg-amber-950/30 px-4 py-2 text-xs text-amber-200">
          {gaps.length} canon gap{gaps.length === 1 ? "" : "s"}:{" "}
          {gaps.map((g) => `${g.project} ${g.field}`).join(", ")}
        </div>
      )}

      {summaryFormatIssue && (
        <div className="border-b border-red-700/40 bg-red-950/30 px-4 py-2 text-xs text-red-200">
          Assignment summary format issue: {summaryFormatIssue}
        </div>
      )}

      {scene && (
        <div className="border-b border-neutral-800 bg-neutral-900/40 px-4 py-2 text-xs text-neutral-300">
          Scene {scene.sceneNumber} — status: {scene.status} · phase: {scene.phase} ·{" "}
          {scene.signedOff ? "signed off" : "awaiting sign-off"}
          {scene.assignmentSummary && !scene.signedOff && (
            <div className="mt-2 rounded-lg border border-neutral-700 bg-neutral-900 p-3">
              <p className="whitespace-pre-wrap text-neutral-200">{scene.assignmentSummary}</p>
              <button
                onClick={() => sendMessage("I sign off on this scene assignment. Please proceed.")}
                disabled={loading}
                className="mt-2 rounded-lg bg-gradient-to-r from-red-600 to-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:from-red-500 hover:to-orange-400 disabled:opacity-50"
              >
                Sign off on this scene
              </button>
            </div>
          )}
        </div>
      )}

      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-4">
        {!workspaceId || !canvasId ? (
          <p className="text-sm text-neutral-500">Open this screen from a Story Canvas on the dashboard.</p>
        ) : (
          <div className="space-y-3">
            {messages.map((m, i) => (
              <div
                key={i}
                className={m.role === "user" ? "text-right" : "text-left"}
              >
                <div
                  className={
                    m.role === "user"
                      ? "inline-block max-w-[80%] rounded-xl bg-red-600/80 px-3 py-2 text-sm"
                      : "inline-block max-w-[80%] rounded-xl bg-neutral-800 px-3 py-2 text-sm"
                  }
                >
                  <p className="whitespace-pre-wrap">{m.content}</p>
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-neutral-800 p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={!canvasId || loading}
          placeholder="Message the Screenwriter…"
          className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm focus:outline-none"
        />
        <button
          type="submit"
          disabled={!canvasId || loading || !input.trim()}
          className="rounded-lg bg-gradient-to-r from-red-600 to-orange-500 px-4 py-2 text-sm font-semibold text-white hover:from-red-500 hover:to-orange-400 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
