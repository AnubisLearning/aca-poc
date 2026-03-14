import React from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import type { AnalysisSnapshot } from "../types";

interface Props {
  snapshots: AnalysisSnapshot[];
  passThreshold?: number;
  marginalThreshold?: number;
}

export const ScoreChart: React.FC<Props> = ({
  snapshots,
  passThreshold = 75,
  marginalThreshold = 50,
}) => {
  const data = snapshots
    .filter((s) => s.score !== undefined)
    .map((s, i) => ({
      t: i + 1,
      score: s.score ?? 0,
      progress: Math.round(s.progress * 100),
    }));

  if (data.length === 0) {
    return (
      <div className="h-40 flex items-center justify-center text-gray-600 text-sm">
        No data yet…
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
        <XAxis dataKey="progress" tick={{ fill: "#6b7280", fontSize: 11 }} unit="%" />
        <YAxis domain={[0, 100]} tick={{ fill: "#6b7280", fontSize: 11 }} />
        <Tooltip
          contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151" }}
          labelStyle={{ color: "#9ca3af" }}
          itemStyle={{ color: "#60a5fa" }}
          formatter={(v: number) => [`${v.toFixed(1)}`, "Score"]}
          labelFormatter={(v) => `Progress: ${v}%`}
        />
        <ReferenceLine
          y={passThreshold}
          stroke="#10b981"
          strokeDasharray="4 2"
          label={{ value: "Pass", fill: "#10b981", fontSize: 10 }}
        />
        <ReferenceLine
          y={marginalThreshold}
          stroke="#f59e0b"
          strokeDasharray="4 2"
          label={{ value: "Marginal", fill: "#f59e0b", fontSize: 10 }}
        />
        <Area
          type="monotone"
          dataKey="score"
          stroke="#3b82f6"
          strokeWidth={2}
          fill="url(#scoreGrad)"
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
};
