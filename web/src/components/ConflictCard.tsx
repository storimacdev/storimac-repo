"use client";

export interface ConflictCardConflict {
  kind: "confirmed_entry" | "foundation";
  entryName?: string;
  description?: string;
}

export interface ConflictCardProps {
  conflict: ConflictCardConflict;
  onChoose: (choice: "revert" | "revise" | "defer") => void;
  disabled: boolean;
}

const CHOICES: { letter: string; label: string; choice: "revert" | "revise" | "defer" }[] = [
  { letter: "A", label: "Revert", choice: "revert" },
  { letter: "B", label: "Revise", choice: "revise" },
  { letter: "C", label: "Defer", choice: "defer" },
];

export default function ConflictCard({ conflict, onChoose, disabled }: ConflictCardProps) {
  const description =
    conflict.kind === "confirmed_entry"
      ? `This contradicts the Confirmed canon for "${conflict.entryName}".`
      : conflict.description ?? "This contradicts the Story Foundation.";

  return (
    <div
      data-testid="conflict-card"
      className="mt-3 rounded-xl border-2 border-red-500 bg-red-950/40 px-4 py-3 text-sm text-neutral-100"
    >
      <p className="mb-2 font-semibold text-red-200">Conflict detected</p>
      <p className="mb-3 text-neutral-300">{description}</p>
      <div className="flex flex-wrap gap-2">
        {CHOICES.map((c) => (
          <button
            key={c.choice}
            onClick={() => onChoose(c.choice)}
            disabled={disabled}
            className="rounded-lg border border-red-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-900/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {c.letter} — {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
