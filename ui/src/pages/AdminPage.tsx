import React, { useEffect, useState, useCallback } from "react";
import { listJobs, listConfigs } from "../api";
import type { AnalysisJob, CanaryConfig } from "../types";
import { Settings } from "lucide-react";

export const AdminPage: React.FC = () => {
  const [jobs, setJobs] = useState<AnalysisJob[]>([]);
  const [configs, setConfigs] = useState<CanaryConfig[]>([]);

  const reload = useCallback(async () => {
    const [j, c] = await Promise.all([listJobs(), listConfigs()]);
    setJobs(j);
    setConfigs(c);
  }, []);

  useEffect(() => {
    reload();
    const iv = setInterval(reload, 5000);
    return () => clearInterval(iv);
  }, [reload]);

  const running = jobs.filter((j) => j.status === "running").length;
  const completed = jobs.filter((j) => j.status === "completed").length;
  const failed = jobs.filter((j) => j.status === "failed").length;

  const stats = [
    { label: "Configs", value: configs.length, color: "text-blue-400" },
    { label: "Running", value: running, color: "text-blue-400" },
    { label: "Completed", value: completed, color: "text-emerald-400" },
    { label: "Failed", value: failed, color: "text-red-400" },
  ];

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
      <div className="flex items-center gap-3">
        <Settings className="w-6 h-6 text-gray-400" />
        <h1 className="text-2xl font-bold text-white">Admin</h1>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map(({ label, value, color }) => (
          <div key={label} className="card text-center">
            <p className="text-gray-400 text-xs uppercase tracking-wider">{label}</p>
            <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
