import React, { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { getRun, controlJob } from "../api";
import type { AnalysisJob, AnalysisResult, AnalysisSnapshot, JobEvent, MetricResult } from "../types";
import { StatusBadge } from "../components/StatusBadge";
import { MetricCard } from "../components/MetricCard";
import { MetricsPanel } from "../components/MetricsPanel";
import { ScoreChart } from "../components/ScoreChart";
import { ScoreDial } from "../components/ScoreDial";
import { subscribeToJob, unsubscribeFromJob, onJobEvent } from "../socket";
import {
  Play, Pause, Square, RotateCcw, ChevronLeft, Clock, Layers,
} from "lucide-react";

export const JobDetailPage: React.FC = () => {
  const { id: jobId } = useParams<{ id: string }>();
  const [job, setJob] = useState<AnalysisJob | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [snapshots, setSnapshots] = useState<AnalysisSnapshot[]>([]);
  const [liveMetrics, setLiveMetrics] = useState<MetricResult[]>([]);
  const [liveScore, setLiveScore] = useState<number | null>(null);
  const [liveRecommendation, setLiveRecommendation] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!jobId) return;
    try {
      const data = await getRun(jobId);
      setJob(data.job);
      setResult(data.result);
      setSnapshots(data.snapshots);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    reload();
    const interval = setInterval(reload, 8000);
    return () => clearInterval(interval);
  }, [reload]);

  // Real-time events
  useEffect(() => {
    if (!jobId) return;
    subscribeToJob(jobId);
    const off = onJobEvent((event: JobEvent) => {
      if (event.job_id !== jobId) return;

      if (event.event === "snapshot") {
        const { score, recommendation, metric_results, progress } = event.data;
        if (score !== undefined) setLiveScore(score);
        if (recommendation) setLiveRecommendation(recommendation);
        if (metric_results) setLiveMetrics(metric_results);
        if (progress !== undefined) {
          setJob((prev) => prev ? { ...prev, progress } : prev);
          setSnapshots((prev) => [
            ...prev,
            {
              id: Date.now().toString(),
              job_id: jobId,
              snapshot_at: new Date().toISOString(),
              score,
              metric_scores: metric_results ?? [],
              progress,
            },
          ]);
        }
      }

      if (event.event === "job_status" && event.data.status) {
        setJob((prev) =>
          prev ? { ...prev, status: event.data.status! } : prev
        );
        if (event.data.status === "completed") {
          setTimeout(reload, 500); // fetch final result
        }
      }
    });
    return () => {
      unsubscribeFromJob(jobId);
      off();
    };
  }, [jobId, reload]);

  const handleAction = async (action: "pause" | "resume" | "stop" | "rerun") => {
    if (!jobId) return;
    setActionErr(null);
    try {
      const updated = await controlJob(jobId, action);
      setJob(updated);
    } catch (e: any) {
      setActionErr(e.response?.data?.detail ?? String(e));
    }
  };

  if (loading || !job) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-12 text-center text-gray-500">
        {loading ? "Loading…" : "Job not found"}
      </div>
    );
  }

  const displayScore = liveScore ?? result?.score ?? null;
  const displayRec = (liveRecommendation ?? result?.recommendation ?? "inconclusive") as any;
  const displayMetrics = liveMetrics.length ? liveMetrics : (result?.metric_scores ?? []);

  const progressPct = Math.round(job.progress * 100);
  const isActive = job.status === "running" || job.status === "paused";

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      {/* Back */}
      <Link to="/jobs" className="flex items-center gap-1 text-gray-400 hover:text-gray-200 text-sm w-fit">
        <ChevronLeft className="w-4 h-4" /> All jobs
      </Link>

      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-white font-mono">{jobId?.slice(0, 8)}…</h1>
            <StatusBadge status={job.status} />
          </div>
          <div className="flex gap-4 text-xs text-gray-400">
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              Duration: {job.duration}s
            </span>
            {job.start_time && (
              <span>Started: {new Date(job.start_time).toLocaleString()}</span>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap gap-2">
          {job.status === "running" && (
            <button className="btn-warning" onClick={() => handleAction("pause")}>
              <Pause className="w-4 h-4" /> Pause
            </button>
          )}
          {job.status === "paused" && (
            <button className="btn-primary" onClick={() => handleAction("resume")}>
              <Play className="w-4 h-4" /> Resume
            </button>
          )}
          {isActive && (
            <button className="btn-danger" onClick={() => handleAction("stop")}>
              <Square className="w-4 h-4" /> Stop
            </button>
          )}
          {["completed", "failed", "cancelled"].includes(job.status) && (
            <button className="btn-secondary" onClick={() => handleAction("rerun")}>
              <RotateCcw className="w-4 h-4" /> Re-run
            </button>
          )}
        </div>
      </div>

      {actionErr && (
        <div className="bg-red-950 border border-red-800 text-red-300 text-sm rounded-lg px-4 py-3">
          {actionErr}
        </div>
      )}

      {/* Progress bar */}
      <div className="card space-y-2">
        <div className="flex justify-between text-xs text-gray-400">
          <span>Analysis progress</span>
          <span>{progressPct}%</span>
        </div>
        <div className="h-2.5 rounded-full bg-gray-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-blue-500 transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Score + chart */}
      <div className="grid md:grid-cols-3 gap-4">
        {/* Dial */}
        <div className="card flex items-center justify-center py-6">
          {displayScore !== null ? (
            <div className="relative flex flex-col items-center">
              <ScoreDial score={displayScore} recommendation={displayRec} />
            </div>
          ) : (
            <div className="text-gray-600 text-sm text-center">
              <Layers className="w-8 h-8 mx-auto mb-2 opacity-30" />
              Score pending…
            </div>
          )}
        </div>

        {/* Chart */}
        <div className="card md:col-span-2">
          <p className="text-xs text-gray-400 mb-3 font-medium">Score over time</p>
          <ScoreChart snapshots={snapshots} />
        </div>
      </div>

      {/* Metric breakdown */}
      {displayMetrics.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-white">Metric Breakdown</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {displayMetrics.map((m) => (
              <MetricCard key={m.metric_name} metric={m} />
            ))}
          </div>
        </div>
      )}

      {/* Grafana-style metrics panel — expand to view */}
      {snapshots.length > 0 && (
        <details className="group">
          <summary className="card cursor-pointer select-none flex items-center justify-between text-sm text-gray-400 hover:text-gray-200 transition-colors">
            <span className="font-medium">Metrics · Canary vs Baseline</span>
            <span className="text-xs text-gray-600 group-open:hidden">click to expand</span>
            <span className="text-xs text-gray-600 hidden group-open:inline">click to collapse</span>
          </summary>
          <div className="mt-3">
            <MetricsPanel snapshots={snapshots} />
          </div>
        </details>
      )}

      {/* Final recommendation banner */}
      {result && (
        <div
          className={`card flex items-center gap-4 border-2 ${
            result.recommendation === "rollout"
              ? "border-emerald-700 bg-emerald-950/40"
              : result.recommendation === "rollback"
              ? "border-red-700 bg-red-950/40"
              : "border-amber-700 bg-amber-950/40"
          }`}
        >
          <div className="flex-1">
            <p className="text-xs text-gray-400 uppercase tracking-wider">Final Recommendation</p>
            <p
              className={`text-2xl font-bold mt-1 ${
                result.recommendation === "rollout"
                  ? "text-emerald-400"
                  : result.recommendation === "rollback"
                  ? "text-red-400"
                  : "text-amber-400"
              }`}
            >
              {result.recommendation.toUpperCase()}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">Overall Score</p>
            <p className="text-4xl font-bold text-white">{Math.round(result.score)}</p>
          </div>
        </div>
      )}

      {/* Raw job info */}
      <details className="card">
        <summary className="cursor-pointer text-sm text-gray-400 select-none">
          Raw job data
        </summary>
        <pre className="mt-3 text-xs text-gray-400 overflow-auto max-h-64 bg-gray-950 rounded p-3">
          {JSON.stringify(job, null, 2)}
        </pre>
      </details>
    </div>
  );
};
