import React, { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { AnalysisSnapshot } from "../types";

interface Props {
  snapshots: AnalysisSnapshot[];
  /** Optional label prefix shown in chart tooltips when combining multi-run data */
  runLabel?: string;
}

interface MetricSeries {
  name: string;
  points: { t: string; canary?: number; baseline?: number; progress: number }[];
}

function buildSeries(snapshots: AnalysisSnapshot[]): MetricSeries[] {
  if (snapshots.length === 0) return [];

  // Collect all metric names that appear across snapshots
  const names = Array.from(
    new Set(snapshots.flatMap((s) => s.metric_scores.map((m) => m.metric_name)))
  );

  return names.map((name) => ({
    name,
    points: snapshots
      .filter((s) => s.metric_scores.some((m) => m.metric_name === name))
      .map((s) => {
        const m = s.metric_scores.find((ms) => ms.metric_name === name);
        return {
          t: new Date(s.snapshot_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
          progress: Math.round(s.progress * 100),
          canary: m?.canary_mean,
          baseline: m?.baseline_mean,
        };
      }),
  }));
}

const CANARY_COLOR = "#f97316";   // orange-500
const BASELINE_COLOR = "#60a5fa"; // blue-400

const tooltipStyle = {
  contentStyle: { backgroundColor: "#111827", border: "1px solid #374151", borderRadius: 6 },
  labelStyle: { color: "#9ca3af", fontSize: 11 },
};

function formatValue(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(2)}k`;
  return v.toFixed(4).replace(/\.?0+$/, "") || "0";
}

interface SingleChartProps {
  series: MetricSeries;
}

const SingleMetricChart: React.FC<SingleChartProps> = ({ series }) => {
  const { name, points } = series;

  if (points.length === 0) {
    return (
      <div className="card">
        <p className="text-xs font-mono text-gray-300 mb-3">{name}</p>
        <div className="h-32 flex items-center justify-center text-gray-600 text-xs">
          No data yet
        </div>
      </div>
    );
  }

  // Compute y-axis domain with 10% padding
  const vals = points.flatMap((p) => [p.canary, p.baseline]).filter((v): v is number => v !== undefined);
  const minVal = Math.min(...vals);
  const maxVal = Math.max(...vals);
  const pad = (maxVal - minVal) * 0.15 || 0.1;
  const yDomain: [number, number] = [
    parseFloat((minVal - pad).toFixed(6)),
    parseFloat((maxVal + pad).toFixed(6)),
  ];

  return (
    <div className="card">
      {/* Chart header */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-mono text-gray-200 font-semibold truncate">{name}</p>
        <div className="flex items-center gap-3 text-xs text-gray-400 shrink-0 ml-2">
          <span className="flex items-center gap-1">
            <span className="inline-block w-6 h-0.5" style={{ backgroundColor: CANARY_COLOR }} />
            canary
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-6 h-0.5" style={{ backgroundColor: BASELINE_COLOR }} />
            baseline
          </span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis
            dataKey="t"
            tick={{ fill: "#6b7280", fontSize: 10 }}
            interval="preserveStartEnd"
            minTickGap={40}
          />
          <YAxis
            domain={yDomain}
            tick={{ fill: "#6b7280", fontSize: 10 }}
            width={54}
            tickFormatter={formatValue}
          />
          <Tooltip
            {...tooltipStyle}
            formatter={(v: number, key: string) => [formatValue(v), key]}
            labelFormatter={(l) => `Time: ${l}`}
          />
          <Line
            type="monotone"
            dataKey="canary"
            stroke={CANARY_COLOR}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="baseline"
            stroke={BASELINE_COLOR}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export const MetricsPanel: React.FC<Props> = ({ snapshots }) => {
  const series = useMemo(() => buildSeries(snapshots), [snapshots]);

  if (series.length === 0) {
    return (
      <div className="card">
        <p className="text-xs text-gray-400 mb-1 font-medium uppercase tracking-wider">
          Metrics · Canary vs Baseline
        </p>
        <div className="h-24 flex items-center justify-center text-gray-600 text-sm">
          Waiting for first snapshot…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-base font-semibold text-white">Metrics · Canary vs Baseline</p>
        <span className="text-xs text-gray-500">({snapshots.length} snapshots)</span>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        {series.map((s) => (
          <SingleMetricChart key={s.name} series={s} />
        ))}
      </div>
    </div>
  );
};
