import React from "react";
import type { MetricResult } from "../types";
import { CheckCircle, XCircle, MinusCircle } from "lucide-react";
import { clsx } from "clsx";

interface Props {
  metric: MetricResult;
}

const statusIcon = (status: MetricResult["status"]) => {
  if (status === "pass") return <CheckCircle className="w-5 h-5 text-emerald-400" />;
  if (status === "fail") return <XCircle className="w-5 h-5 text-red-400" />;
  return <MinusCircle className="w-5 h-5 text-gray-500" />;
};

const scoreColor = (score: number) => {
  if (score >= 75) return "text-emerald-400";
  if (score >= 50) return "text-amber-400";
  return "text-red-400";
};

export const MetricCard: React.FC<Props> = ({ metric }) => (
  <div
    className={clsx(
      "card flex flex-col gap-3",
      metric.status === "pass" && "border-emerald-800",
      metric.status === "fail" && "border-red-800",
      metric.status === "nodata" && "border-gray-700 opacity-60"
    )}
  >
    <div className="flex items-start justify-between">
      <div className="flex items-center gap-2">
        {statusIcon(metric.status)}
        <span className="font-medium text-sm text-gray-100 truncate max-w-[160px]">
          {metric.metric_name}
        </span>
      </div>
      <span className={clsx("text-2xl font-bold tabular-nums", scoreColor(metric.score))}>
        {metric.status === "nodata" ? "N/A" : Math.round(metric.score)}
      </span>
    </div>

    {metric.status !== "nodata" && (
      <>
        {/* Score bar */}
        <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
          <div
            className={clsx(
              "h-full rounded-full transition-all duration-500",
              metric.score >= 75 ? "bg-emerald-500" : metric.score >= 50 ? "bg-amber-500" : "bg-red-500"
            )}
            style={{ width: `${metric.score}%` }}
          />
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs text-gray-400">
          <div>
            <span className="text-gray-500">SAX</span>{" "}
            <span className="text-gray-200">{(metric.sax_score * 100).toFixed(0)}</span>
          </div>
          <div>
            <span className="text-gray-500">HMM</span>{" "}
            <span className="text-gray-200">{(metric.hmm_score * 100).toFixed(0)}</span>
          </div>
          {metric.canary_mean !== undefined && (
            <div>
              <span className="text-gray-500">Canary μ</span>{" "}
              <span className="text-gray-200">{metric.canary_mean.toFixed(4)}</span>
            </div>
          )}
          {metric.baseline_mean !== undefined && (
            <div>
              <span className="text-gray-500">Baseline μ</span>{" "}
              <span className="text-gray-200">{metric.baseline_mean.toFixed(4)}</span>
            </div>
          )}
          <div>
            <span className="text-gray-500">Weight</span>{" "}
            <span className="text-gray-200">{metric.weight}</span>
          </div>
          <div>
            <span className="text-gray-500">Direction</span>{" "}
            <span className="text-gray-200 capitalize">{metric.direction.replace(/_/g, " ")}</span>
          </div>
        </div>
      </>
    )}
  </div>
);
