import React, { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { listJobs, listConfigs, createAndStartJob, createSuite } from "../api";
import type { AnalysisJob, CanaryConfig, JobEvent } from "../types";
import { StatusBadge } from "../components/StatusBadge";
import { onJobEvent } from "../socket";
import { Activity, Plus, PlayCircle, Repeat } from "lucide-react";

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<AnalysisJob[]>([]);
  const [configs, setConfigs] = useState<CanaryConfig[]>([]);
  const [selectedConfig, setSelectedConfig] = useState<string>("");
  const [duration, setDuration] = useState<string>("");
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Suite state
  const [suiteConfig, setSuiteConfig] = useState<string>("");
  const [suiteDuration, setSuiteDuration] = useState<string>("");
  const [suiteInterval, setSuiteInterval] = useState<string>("10");
  const [launchingSuite, setLaunchingSuite] = useState(false);
  const [suiteError, setSuiteError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [j, c] = await Promise.all([listJobs(), listConfigs()]);
    setJobs(j);
    setConfigs(c);
    if (!selectedConfig && c.length) setSelectedConfig(c[0].id);
    if (!suiteConfig && c.length) setSuiteConfig(c[0].id);
  }, [selectedConfig, suiteConfig]);

  useEffect(() => {
    reload();
    const interval = setInterval(reload, 5000);
    return () => clearInterval(interval);
  }, [reload]);

  // Listen for real-time job events to refresh statuses
  useEffect(() => {
    const off = onJobEvent((event: JobEvent) => {
      setJobs((prev) =>
        prev.map((j) =>
          j.id === event.job_id
            ? {
                ...j,
                status: event.data.status ?? j.status,
                progress: event.data.progress ?? j.progress,
              }
            : j
        )
      );
    });
    return off;
  }, []);

  const handleSuiteLaunch = async () => {
    if (!suiteConfig) return;
    setLaunchingSuite(true);
    setSuiteError(null);
    try {
      const suite = await createSuite({
        config_id: suiteConfig,
        duration_per_run: suiteDuration ? parseInt(suiteDuration) : undefined,
        interval_minutes: suiteInterval ? parseInt(suiteInterval) : 10,
        run_count: 3,
      });
      navigate(`/suites/${suite.id}`);
    } catch (e: any) {
      setSuiteError(e.response?.data?.error ?? String(e));
    } finally {
      setLaunchingSuite(false);
    }
  };

  const handleLaunch = async () => {
    if (!selectedConfig) return;
    setLaunching(true);
    setError(null);
    try {
      await createAndStartJob(selectedConfig, duration ? parseInt(duration) : undefined);
      await reload();
    } catch (e: any) {
      setError(e.response?.data?.detail ?? String(e));
    } finally {
      setLaunching(false);
    }
  };

  const running = jobs.filter((j) => j.status === "running").length;
  const completed = jobs.filter((j) => j.status === "completed").length;
  const failed = jobs.filter((j) => j.status === "failed").length;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-400 text-sm mt-1">
            Monitor and control canary analysis jobs in real time
          </p>
        </div>
        <Link to="/configs/new" className="btn-primary">
          <Plus className="w-4 h-4" />
          New Config
        </Link>
      </div>

      {/* Quick Launch */}
      <div className="card space-y-4">
        <h2 className="text-base font-semibold text-white flex items-center gap-2">
          <PlayCircle className="w-5 h-5 text-blue-400" />
          Quick Launch
        </h2>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="label">Canary Config</label>
            <select
              className="input"
              value={selectedConfig}
              onChange={(e) => setSelectedConfig(e.target.value)}
            >
              {configs.length === 0 && (
                <option value="">No configs – create one first</option>
              )}
              {configs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="w-36">
            <label className="label">Duration (s) – optional</label>
            <input
              type="number"
              className="input"
              placeholder="default from config"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              min={30}
            />
          </div>
          <button
            className="btn-primary"
            onClick={handleLaunch}
            disabled={!selectedConfig || launching}
          >
            {launching ? "Launching…" : "Start Analysis"}
          </button>
        </div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
      </div>

      {/* Schedule Suite */}
      <div className="card space-y-4">
        <h2 className="text-base font-semibold text-white flex items-center gap-2">
          <Repeat className="w-5 h-5 text-purple-400" />
          Schedule Suite
          <span className="text-xs font-normal text-gray-500">
            — 3 runs, 1 per interval
          </span>
        </h2>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="label">Canary Config</label>
            <select
              className="input"
              value={suiteConfig}
              onChange={(e) => setSuiteConfig(e.target.value)}
            >
              {configs.length === 0 && (
                <option value="">No configs – create one first</option>
              )}
              {configs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="w-36">
            <label className="label">Span per run (s)</label>
            <input
              type="number"
              className="input"
              placeholder="default from config"
              value={suiteDuration}
              onChange={(e) => setSuiteDuration(e.target.value)}
              min={30}
            />
          </div>
          <div className="w-36">
            <label className="label">Interval (min)</label>
            <input
              type="number"
              className="input"
              value={suiteInterval}
              onChange={(e) => setSuiteInterval(e.target.value)}
              min={1}
            />
          </div>
          <button
            className="btn-primary bg-purple-700 hover:bg-purple-600 border-purple-600"
            onClick={handleSuiteLaunch}
            disabled={!suiteConfig || launchingSuite}
          >
            {launchingSuite ? "Scheduling…" : "Schedule 3 Runs"}
          </button>
        </div>
        {suiteError && <p className="text-red-400 text-sm">{suiteError}</p>}
      </div>

      {/* Active Jobs */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Activity className="w-5 h-5 text-gray-400" />
            Active Jobs
          </h2>
          <Link to="/jobs" className="text-blue-400 text-sm hover:text-blue-300">
            Job History →
          </Link>
        </div>

        {jobs.filter((j) => ["pending", "running", "paused"].includes(j.status)).length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-8">
            No active jobs. Launch an analysis above.
          </p>
        ) : (
          <div className="divide-y divide-gray-800">
            {jobs.filter((j) => ["pending", "running", "paused"].includes(j.status)).map((job) => {
              const cfg = configs.find((c) => c.id === job.config_id);
              return (
                <div key={job.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <StatusBadge status={job.status} />
                    <div className="min-w-0">
                      <Link
                        to={`/jobs/${job.id}`}
                        className="text-sm font-medium text-gray-200 hover:text-blue-400 truncate block"
                      >
                        {cfg?.name ?? job.config_id.slice(0, 8)}
                      </Link>
                      <p className="text-xs text-gray-500">
                        {new Date(job.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 ml-4">
                    {/* Progress bar */}
                    {(job.status === "running" || job.status === "paused") && (
                      <div className="w-24 h-1.5 bg-gray-800 rounded-full overflow-hidden hidden md:block">
                        <div
                          className="h-full bg-blue-500 rounded-full transition-all"
                          style={{ width: `${Math.round(job.progress * 100)}%` }}
                        />
                      </div>
                    )}
                    <Link
                      to={`/jobs/${job.id}`}
                      className="text-xs text-blue-400 hover:text-blue-300 whitespace-nowrap"
                    >
                      Details →
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
