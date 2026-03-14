import React from "react";
import type { Recommendation } from "../types";

interface Props {
  score: number;
  recommendation: Recommendation;
  size?: number;
}

const COLORS: Record<Recommendation, { stroke: string; text: string; label: string }> = {
  rollout: { stroke: "#10b981", text: "text-emerald-400", label: "ROLL OUT" },
  rollback: { stroke: "#ef4444", text: "text-red-400", label: "ROLL BACK" },
  inconclusive: { stroke: "#f59e0b", text: "text-amber-400", label: "INCONCLUSIVE" },
};

export const ScoreDial: React.FC<Props> = ({ score, recommendation, size = 160 }) => {
  const r = 54;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const filled = (score / 100) * circumference;
  const col = COLORS[recommendation];

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={size} height={size} className="-rotate-90">
        {/* Track */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="#1f2937"
          strokeWidth="10"
        />
        {/* Progress arc */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={col.stroke}
          strokeWidth="10"
          strokeDasharray={`${filled} ${circumference}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
      </svg>
      {/* Score label in center */}
      <div className="absolute flex flex-col items-center" style={{ marginTop: -size * 0.62 }}>
        <span className="text-3xl font-bold text-white">{Math.round(score)}</span>
        <span className="text-xs text-gray-400">/100</span>
      </div>
      <span className={`text-sm font-semibold tracking-wider ${col.text}`}>
        {col.label}
      </span>
    </div>
  );
};
