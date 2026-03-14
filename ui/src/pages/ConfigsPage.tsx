import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listConfigs, deleteConfig } from "../api";
import type { CanaryConfig } from "../types";
import { Plus, Settings, Trash2, Edit2, PlayCircle } from "lucide-react";
import { createAndStartJob } from "../api";

export const ConfigsPage: React.FC = () => {
  const [configs, setConfigs] = useState<CanaryConfig[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [launching, setLaunching] = useState<string | null>(null);

  const reload = async () => {
    setConfigs(await listConfigs());
  };

  useEffect(() => {
    reload();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this config?")) return;
    setDeleting(id);
    try {
      await deleteConfig(id);
      await reload();
    } finally {
      setDeleting(null);
    }
  };

  const handleLaunch = async (id: string) => {
    setLaunching(id);
    try {
      await createAndStartJob(id);
    } finally {
      setLaunching(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Canary Configs</h1>
          <p className="text-sm text-gray-400 mt-1">
            Define metrics, thresholds, and selectors for canary analysis
          </p>
        </div>
        <Link to="/configs/new" className="btn-primary">
          <Plus className="w-4 h-4" />
          New Config
        </Link>
      </div>

      {configs.length === 0 ? (
        <div className="card text-center py-16 text-gray-500">
          <Settings className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No configs yet</p>
          <p className="text-sm mt-1">Create one to start analysing canary deployments</p>
          <Link to="/configs/new" className="btn-primary mt-4 inline-flex">
            <Plus className="w-4 h-4" /> New Config
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {configs.map((cfg) => (
            <div key={cfg.id} className="card hover:border-gray-700 transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold text-white truncate">{cfg.name}</h2>
                  {cfg.description && (
                    <p className="text-sm text-gray-400 mt-0.5 truncate">{cfg.description}</p>
                  )}
                  <div className="flex flex-wrap gap-3 mt-3 text-xs text-gray-400">
                    <span>
                      <span className="text-gray-500">Metrics:</span> {cfg.metrics.length}
                    </span>
                    <span>
                      <span className="text-gray-500">Duration:</span> {cfg.analysis_duration}s
                    </span>
                    <span>
                      <span className="text-gray-500">Pass:</span> {cfg.pass_threshold}
                    </span>
                    <span>
                      <span className="text-gray-500">Canary:</span>{" "}
                      {Object.entries(cfg.canary_selector)
                        .map(([k, v]) => `${k}=${v}`)
                        .join(", ")}
                    </span>
                    <span>
                      <span className="text-gray-500">Baseline:</span>{" "}
                      {Object.entries(cfg.baseline_selector)
                        .map(([k, v]) => `${k}=${v}`)
                        .join(", ")}
                    </span>
                  </div>

                  {/* Metrics chips */}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {cfg.metrics.map((m) => (
                      <span
                        key={m.name}
                        className="bg-gray-800 text-gray-300 text-xs px-2 py-0.5 rounded-full"
                      >
                        {m.name}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-2 items-end">
                  <button
                    className="btn-success text-xs py-1.5"
                    onClick={() => handleLaunch(cfg.id)}
                    disabled={launching === cfg.id}
                  >
                    <PlayCircle className="w-3.5 h-3.5" />
                    {launching === cfg.id ? "Launching…" : "Run"}
                  </button>
                  <Link to={`/configs/${cfg.id}/edit`} className="btn-secondary text-xs py-1.5">
                    <Edit2 className="w-3.5 h-3.5" /> Edit
                  </Link>
                  <button
                    className="btn-danger text-xs py-1.5"
                    onClick={() => handleDelete(cfg.id)}
                    disabled={deleting === cfg.id}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {deleting === cfg.id ? "…" : "Delete"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
