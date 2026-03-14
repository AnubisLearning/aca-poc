import React, { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { getSuite, getSnapshots } from "../api";
import type { Suite, AnalysisJob, AnalysisSnapshot } from "../types";
import { StatusBadge } from "../components/StatusBadge";
import { MetricsPanel } from "../components/MetricsPanel";
import { ScoreChart } from "../components/ScoreChart";
import { ChevronLeft, Clock, Repeat, Calendar } from "lucide-react";

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function fmtDuration(s: number) {
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
}

export const SuitePage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [suite, setSuite] = useState<Suite | null>(null);
  const [snapshots, setSnapshots] = useState<Record<string, AnalysisSnapshot[]>>({});
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!id) return;
    try {
      const s = await getSuite(id);
      setSuite(s);

      // Fetch snapshots for all known jobs
      const entries = await Promise.all(
        s.job_ids.map(async (jid) => {
          try {
            const snaps = await getSnapshots(jid);
            return [jid, snaps] as [string, AnalysisSnapshot[]];
          } catch {
            return [jid, []] as [string, AnalysisSnapshot[]];
          }
        })
      );
      setSnapshots(Object.fromEntries(entries));
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    reload();
    const iv = setInterval(reload, 10_000);
    return () => clearInterval(iv);
  }, [reload]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-12 text-center text-gray-500">
        Loading suite…
      </div>
    );
  }

  if (!suite) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-12 text-center text-gray-500">
        Suite not found.
      </div>
    );
  }

  // Merge all snapshots in chronological order for the combined panel
  const allSnapshots: AnalysisSnapshot[] = Object.values(snapshots)
    .flat()
    .sort((a, b) => new Date(a.snapshot_at).getTime() - new Date(b.snapshot_at).getTime());

  const jobs: AnalysisJob[] = suite.jobs ?? [];

  const launchedCount = suite.job_ids.length;
  const doneCount = jobs.filter((j) =>
    ["completed", "failed", "cancelled"].includes(j.status)
  ).length;

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      {/* Back */}
      <Link
        to="/"
        className="flex items-center gap-1 text-gray-400 hover:text-gray-200 text-sm w-fit"
      >
        <ChevronLeft className="w-4 h-4" /> Dashboard
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Repeat className="w-5 h-5 text-blue-400" />
            Analysis Suite
          </h1>
          <p className="text-xs text-gray-500 font-mono">{suite.id}</p>
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-gray-400">
          <span className="flex items-center gap-1">
            <Repeat className="w-3.5 h-3.5" />
            {suite.run_count} runs · every {suite.interval_minutes} min
          </span>
          {suite.duration_per_run && (
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {fmtDuration(suite.duration_per_run)} per run
            </span>
          )}
          <span className="flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" />
            {fmtTime(suite.created_at)}
          </span>
        </div>
      </div>

      {/* Progress summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Scheduled", value: suite.run_count, color: "text-gray-300" },
          { label: "Launched", value: launchedCount, color: "text-blue-400" },
          { label: "Completed", value: doneCount, color: "text-emerald-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="card text-center">
            <p className="text-gray-400 text-xs uppercase tracking-wider">{label}</p>
            <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Run timeline */}
      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
          Run Timeline
        </h2>
        <div className="space-y-3">
          {Array.from({ length: suite.run_count }, (_, i) => {
            const job = jobs[i] ?? null;
            const scheduledAt = suite.scheduled_ats[i];
            const snaps = job ? (snapshots[job.id] ?? []) : [];
            const isNext = i === launchedCount && launchedCount < suite.run_count;
            const isPending = i > launchedCount;

            return (
              <div
                key={i}
                className={`rounded-lg border p-4 space-y-3 ${
                  job
                    ? "border-gray-700 bg-gray-800/50"
                    : isNext
                    ? "border-blue-800 bg-blue-950/20"
                    : "border-gray-800 bg-gray-900/30"
                }`}
              >
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center ${
                        job
                          ? "bg-blue-600 text-white"
                          : isNext
                          ? "bg-blue-900 text-blue-300 border border-blue-700"
                          : "bg-gray-800 text-gray-500"
                      }`}
                    >
                      {i + 1}
                    </span>
                    {job ? (
                      <StatusBadge status={job.status} />
                    ) : (
                      <span className="badge text-gray-500 bg-gray-800">
                        {isNext ? "up next" : "waiting"}
                      </span>
                    )}
                    {job && (
                      <Link
                        to={`/jobs/${job.id}`}
                        className="text-xs font-mono text-gray-400 hover:text-blue-400"
                      >
                        {job.id.slice(0, 8)}…
                      </Link>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span>
                      {job?.start_time
                        ? `Started ${fmtTime(job.start_time)}`
                        : `Scheduled ${fmtTime(scheduledAt)}`}
                    </span>
                    {job && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {fmtDuration(job.duration)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Per-run progress bar */}
                {job && (job.status === "running" || job.status === "paused") && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>Progress</span>
                      <span>{Math.round(job.progress * 100)}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-700 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-blue-500 transition-all"
                        style={{ width: `${Math.round(job.progress * 100)}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Per-run score chart (collapsed, only when data exists) */}
                {snaps.length > 1 && (
                  <details>
                    <summary className="text-xs text-gray-500 cursor-pointer select-none hover:text-gray-300">
                      Score chart ({snaps.length} points)
                    </summary>
                    <div className="mt-3">
                      <ScoreChart snapshots={snaps} />
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Combined metrics panel */}
      {allSnapshots.length > 0 && (
        <MetricsPanel snapshots={allSnapshots} />
      )}

      {allSnapshots.length === 0 && (
        <div className="card text-center text-gray-500 text-sm py-8">
          Metric charts will appear here once the first run starts collecting data.
        </div>
      )}
    </div>
  );
};
