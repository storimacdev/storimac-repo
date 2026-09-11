"use client";

import { useEffect, useState } from "react";
import { CANON_STATUS_BADGE_STYLES, type CanonBadgeStatus } from "@/lib/canonEngine/statusBadge";
import { WORLD_STAGE_NAMES } from "@/lib/worldEngine/worldTurnSchema";

interface ApiWorldEntryValue {
  name: string;
  category: string;
  narrativeRole: string;
  importance: string;
  depth: number;
  functionalDescription: string;
  governingRules: string;
  outstandingQuestions: { item: string; notes: string }[];
}

interface ApiWorldEntry {
  entryId: string;
  status: CanonBadgeStatus;
  value: ApiWorldEntryValue;
  dependsOn: string[];
}

export interface WorldSidePanelProps {
  storyId: string | null;
  currentStage: number | null;
  activePillar: string | null;
  refreshToken: number;
}

export default function WorldSidePanel({ storyId, currentStage, activePillar, refreshToken }: WorldSidePanelProps) {
  const [entries, setEntries] = useState<ApiWorldEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadEntries() {
    if (!storyId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/world-chat/entries?storyId=${encodeURIComponent(storyId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load the Canon Registry.");
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch {
      setLoadError("Couldn't load the Canon Registry — try refreshing.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId, refreshToken]);

  const entriesById = new Map(entries.map((e) => [e.entryId, e]));
  const outstandingQuestions = entries.flatMap((e) =>
    e.value.outstandingQuestions.map((q) => ({ entryName: e.value.name, item: q.item, notes: q.notes }))
  );
  const entriesWithDeps = entries.filter((e) => e.dependsOn.length > 0);

  return (
    <div
      data-testid="world-side-panel"
      className="mb-6 rounded-xl border border-red-500/30 bg-gradient-to-br from-red-950/40 to-neutral-900/40 px-5 py-5"
    >
      <div className="mb-4 flex items-center justify-between">
        <p className="bg-gradient-to-r from-red-400 to-orange-300 bg-clip-text text-xs font-bold uppercase tracking-widest text-transparent">
          World Bible Registry
        </p>
        <button
          onClick={loadEntries}
          disabled={loading}
          className="rounded-lg border border-red-500/50 bg-neutral-900 px-2 py-1 text-[11px] font-semibold text-red-200 disabled:opacity-40"
        >
          Refresh
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-4 text-[11px] text-neutral-400">
        <span>
          Stage: <span className="text-neutral-200">{currentStage ? `${currentStage} · ${WORLD_STAGE_NAMES[currentStage] ?? "—"}` : "—"}</span>
        </span>
        <span>
          Active Pillar: <span className="text-neutral-200">{activePillar ?? "(none yet)"}</span>
        </span>
      </div>

      {loadError && <p className="mb-3 text-[11px] text-red-400">{loadError}</p>}

      <div className="mb-4">
        <p className="mb-2 text-[11px] uppercase tracking-widest text-neutral-500">Canon Registry</p>
        {entries.length === 0 ? (
          <p className="text-xs text-neutral-500">No World Entries yet — they&apos;ll appear here as you develop each pillar.</p>
        ) : (
          <ul className="space-y-1.5">
            {entries.map((e) => (
              <li key={e.entryId} className="flex items-center justify-between gap-2 text-xs text-neutral-300">
                <span className="truncate">
                  {e.value.name} <span className="text-neutral-500">({e.value.category})</span>
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${CANON_STATUS_BADGE_STYLES[e.status]}`}>
                  {e.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mb-4">
        <p className="mb-2 text-[11px] uppercase tracking-widest text-neutral-500">Outstanding Questions</p>
        {outstandingQuestions.length === 0 ? (
          <p className="text-xs text-neutral-500">No outstanding questions right now.</p>
        ) : (
          <ul className="space-y-1.5">
            {outstandingQuestions.map((q, i) => (
              <li key={i} className="text-xs text-neutral-300">
                <span className="font-semibold text-neutral-200">{q.entryName}:</span> {q.item}
                {q.notes && <span className="text-neutral-500"> — {q.notes}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {entriesWithDeps.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] uppercase tracking-widest text-neutral-500">
            Dependency Graph (list view — full graph visualization is a future enhancement)
          </p>
          <ul className="space-y-1.5">
            {entriesWithDeps.map((e) => (
              <li key={e.entryId} className="text-xs text-neutral-300">
                <span className="font-semibold text-neutral-200">{e.value.name}</span> depends on:{" "}
                {e.dependsOn.map((depId) => entriesById.get(depId)?.value.name ?? depId).join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
