import React, { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { listJobs, listConfigs, controlJob } from "../api";
import type { AnalysisJob, CanaryConfig, JobEvent } from "../types";
import { StatusBadge } from "../components/StatusBadge";
import { onJobEvent } from "../socket";
import { Play, Pause, Square, RotateCcw, ChevronRight } from "lucide-react";

export const JobsPage: React.FC = () => {
  const [jobs, setJobs] = useState<AnalysisJob[]>([]);
  const [configs, setConfigs] = useState<CanaryConfig[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>("completed");

  const reload = useCallback(async () => {
    const [j, c] = await Promise.all([listJobs(), listConfigs()]);
    setJobs(j);
    setConfigs(c);
  }, []);

  useEffect(() => {
    reload();
    const iv = setInterval(reload, 6000);
    return () => clearInterval(iv);
  }, [reload]);

  useEffect(() => {
    const off = onJobEvent((event: JobEvent) => {
      setJobs((prev) =>
        prev.map((j) =>
          j.id === event.job_id
            ? { ...j, status: event.data.status ?? j.status, progress: event.data.progress ?? j.progress }
            : j
        )
      );
    });
    return off;
  }, []);

  const handleControl = async (
    jobId: string,
    action: "pause" | "resume" | "stop" | "rerun"
  ) => {
    try {
      const updated = await controlJob(jobId, action);
      setJobs((prev) => prev.map((j) => (j.id === jobId ? updated : j)));
    } catch {
      /* ignore */
    }
  };

  const configName = (id: string) =>
    configs.find((c) => c.id === id)?.name ?? id.slice(0, 8);

  const displayed =
    filterStatus === "all" ? jobs : jobs.filter((j) => j.status === filterStatus);

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Job History</h1>
        <Link to="/" className="btn-primary">
          <Play className="w-4 h-4" /> New Analysis
        </Link>
      </div>

      {/* Filter */}
      <div className="flex flex-wrap gap-2">
        {["all", "pending", "running", "paused", "completed", "failed", "cancelled"].map(
          (s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors capitalize ${
                filterStatus === s
                  ? "bg-blue-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              }`}
            >
              {s}
            </button>
          )
        )}
      </div>

      {/* Table */}
      <div className="card overflow-hidden p-0">
        {displayed.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-12">No jobs found.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-800/50 text-gray-400 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3">Config</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Progress</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Duration</th>
                <th className="text-left px-4 py-3 hidden lg:table-cell">Created</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {displayed.map((job) => (
                <tr key={job.id} className="hover:bg-gray-800/30 transition-colors">
                  <td className="px-4 py-3">
                    <Link
                      to={`/jobs/${job.id}`}
                      className="text-gray-200 hover:text-blue-400 font-medium"
                    >
                      {configName(job.config_id)}
                    </Link>
                    <p className="text-xs text-gray-500 font-mono">{job.id.slice(0, 8)}</p>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={job.status} />
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full"
                          style={{ width: `${Math.round(job.progress * 100)}%` }}
                        />
                      </div>
                      <span className="text-gray-400 text-xs">
                        {Math.round(job.progress * 100)}%
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell text-gray-400">
                    {job.duration}s
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-gray-400 text-xs">
                    {new Date(job.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      {job.status === "running" && (
                        <button
                          className="btn-warning py-1 px-2 text-xs"
                          onClick={() => handleControl(job.id, "pause")}
                        >
                          <Pause className="w-3 h-3" />
                        </button>
                      )}
                      {job.status === "paused" && (
                        <button
                          className="btn-primary py-1 px-2 text-xs"
                          onClick={() => handleControl(job.id, "resume")}
                        >
                          <Play className="w-3 h-3" />
                        </button>
                      )}
                      {(job.status === "running" || job.status === "paused") && (
                        <button
                          className="btn-danger py-1 px-2 text-xs"
                          onClick={() => handleControl(job.id, "stop")}
                        >
                          <Square className="w-3 h-3" />
                        </button>
                      )}
                      {["completed", "failed", "cancelled"].includes(job.status) && (
                        <button
                          className="btn-secondary py-1 px-2 text-xs"
                          onClick={() => handleControl(job.id, "rerun")}
                        >
                          <RotateCcw className="w-3 h-3" />
                        </button>
                      )}
                      <Link
                        to={`/jobs/${job.id}`}
                        className="btn-secondary py-1 px-2 text-xs"
                      >
                        <ChevronRight className="w-3 h-3" />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
