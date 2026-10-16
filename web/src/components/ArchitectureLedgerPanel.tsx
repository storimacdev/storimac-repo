"use client";

import { useEffect, useRef, useState } from "react";

type LedgerEntry =
  | { kind: "confirmed_transition"; unitId: string; description: string; resolvedBy: string; ts: string }
  | {
      kind: "canon_revision";
      unitId: string;
      description: string;
      resolution: "revert" | "accept_and_update" | "park";
      sourceProject?: "Project 1" | "Project 2" | "Project 3";
      contradictedRef?: string;
      downstreamUnits?: { id: string; description: string }[];
      resolvedBy: string;
      ts: string;
    };

export interface ArchitectureLedgerPanelProps {
  storyId: string | null;
  refreshToken: number;
}

/**
 * Renders Project 4's Dependency & Continuity Ledger (issue #72) -
 * mirrors WorldSidePanel.tsx's own fetch/refresh/list shape exactly,
 * trimmed to this panel's narrower need (one flat chronological list,
 * no graph view - the ledger has no dependency-graph structure of its
 * own to visualize; downstreamUnits is already a flat flagged list).
 */
export default function ArchitectureLedgerPanel({ storyId, refreshToken }: ArchitectureLedgerPanelProps) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Same "last request started wins" guard WorldSidePanel.tsx already
  // uses, for the same reason: refreshToken can bump more than once per
  // turn, so two requests are routinely in flight at once.
  const requestIdRef = useRef(0);

  async function loadEntries() {
    if (!storyId) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/architecture-chat/ledger?storyId=${encodeURIComponent(storyId)}`);
      const data = await res.json();
      if (requestId !== requestIdRef.current) return;
      if (!res.ok) throw new Error(data?.error || "Failed to load the Continuity Ledger.");
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch {
      if (requestId === requestIdRef.current) setLoadError("Couldn't load the Continuity Ledger — try refreshing.");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId, refreshToken]);

  return (
    <div
      data-testid="architecture-ledger-panel"
      className="mb-6 rounded-xl border border-orange-500/30 bg-gradient-to-br from-orange-950/40 to-neutral-900/40 px-5 py-5"
    >
      <div className="mb-4 flex items-center justify-between">
        <p className="bg-gradient-to-r from-orange-400 to-amber-300 bg-clip-text text-xs font-bold uppercase tracking-widest text-transparent">
          Dependency &amp; Continuity Ledger
        </p>
        <button
          onClick={loadEntries}
          disabled={loading}
          className="rounded-lg border border-orange-500/50 bg-neutral-900 px-2 py-1 text-[11px] font-semibold text-orange-200 disabled:opacity-40"
        >
          Refresh
        </button>
      </div>

      {loadError && <p className="mb-3 text-[11px] text-red-400">{loadError}</p>}

      {entries.length > 0 ? (
        <ul className="space-y-2">
          {entries
            .slice()
            .reverse()
            .map((e, i) => (
              <li key={`${e.unitId}-${e.ts}-${i}`} className="text-xs text-neutral-300">
                <span className="text-neutral-500">{new Date(e.ts).toLocaleString()}</span>{" "}
                <span className="font-semibold text-neutral-200">{e.unitId}</span> — {e.description}
                {e.kind === "canon_revision" && <span className="text-neutral-500"> ({e.resolution})</span>}
                {e.kind === "canon_revision" && e.downstreamUnits && e.downstreamUnits.length > 0 && (
                  <ul className="ml-4 mt-1 list-disc pl-2 text-neutral-500">
                    {e.downstreamUnits.map((d) => (
                      <li key={d.id}>
                        {d.id} - {d.description}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
        </ul>
      ) : loading ? (
        <p className="text-xs text-neutral-500">Loading…</p>
      ) : loadError ? null : (
        <p className="text-xs text-neutral-500">
          No ledger entries yet — they&apos;ll appear here as units are confirmed or Canon Revision conflicts are
          resolved.
        </p>
      )}
    </div>
  );
}
