"use client";

export interface StageAuditFindingView {
  id: string;
  category: string;
  status: "pass" | "flag" | "skipped";
  detail: string;
}

export interface StageAuditCardProps {
  audit: { findings: StageAuditFindingView[]; authorApproved: boolean };
  onApprove: () => void;
  disabled: boolean;
}

const STATUS_MARK: Record<StageAuditFindingView["status"], string> = {
  pass: "✅",
  flag: "⚠️",
  skipped: "⏭️",
};

export default function StageAuditCard({ audit, onApprove, disabled }: StageAuditCardProps) {
  if (audit.authorApproved) return null;

  return (
    <div
      data-testid="stage-audit-card"
      className="mt-3 rounded-xl border-2 border-orange-500 bg-orange-950/30 px-4 py-3 text-sm text-neutral-100"
    >
      <p className="mb-2 font-semibold text-orange-200">System Integration Audit</p>
      <ul className="mb-3 space-y-1.5 text-xs text-neutral-300">
        {audit.findings.map((f) => (
          <li key={f.id}>
            {STATUS_MARK[f.status]} {f.detail}
          </li>
        ))}
      </ul>
      <button
        onClick={onApprove}
        disabled={disabled}
        className="rounded-lg border border-orange-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-orange-200 hover:bg-orange-900/40 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Approve and continue to Compile
      </button>
    </div>
  );
}
