import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createConfig, getConfig, updateConfig } from "../api";
import type { CanaryConfig, MetricConfig } from "../types";
import { Plus, Trash2, Save, ChevronLeft } from "lucide-react";

const BLANK_METRIC: MetricConfig = {
  name: "",
  query_template: "",
  weight: 1.0,
  pass_threshold: 75.0,
  direction: "no_direction",
};

const DEFAULT_CONFIG: Omit<CanaryConfig, "id" | "created_at" | "updated_at"> = {
  name: "",
  description: "",
  metrics: [{ ...BLANK_METRIC }],
  canary_selector: { deployment: "canary" },
  baseline_selector: { deployment: "baseline" },
  analysis_duration: 300,
  step_interval: 30,
  pass_threshold: 75,
  marginal_threshold: 50,
};

export const ConfigFormPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [form, setForm] = useState(DEFAULT_CONFIG);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      getConfig(id).then((cfg) => {
        setForm({
          name: cfg.name,
          description: cfg.description ?? "",
          metrics: cfg.metrics,
          canary_selector: cfg.canary_selector,
          baseline_selector: cfg.baseline_selector,
          analysis_duration: cfg.analysis_duration,
          step_interval: cfg.step_interval,
          pass_threshold: cfg.pass_threshold,
          marginal_threshold: cfg.marginal_threshold,
        });
      });
    }
  }, [id]);

  const set = (key: keyof typeof form, value: unknown) =>
    setForm((f) => ({ ...f, [key]: value }));

  const setMetric = (i: number, key: keyof MetricConfig, value: unknown) =>
    setForm((f) => {
      const metrics = [...f.metrics];
      metrics[i] = { ...metrics[i], [key]: value };
      return { ...f, metrics };
    });

  const addMetric = () =>
    setForm((f) => ({ ...f, metrics: [...f.metrics, { ...BLANK_METRIC }] }));

  const removeMetric = (i: number) =>
    setForm((f) => ({ ...f, metrics: f.metrics.filter((_, idx) => idx !== i) }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (isEdit && id) {
        await updateConfig(id, form);
      } else {
        await createConfig(form);
      }
      navigate("/configs");
    } catch (e: any) {
      setError(e.response?.data?.detail ?? JSON.stringify(e.response?.data) ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  const selectorToString = (sel: Record<string, string>) =>
    Object.entries(sel)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");

  const stringToSelector = (s: string): Record<string, string> => {
    const result: Record<string, string> = {};
    s.split(",").forEach((part) => {
      const [k, v] = part.split("=").map((x) => x.trim());
      if (k && v) result[k] = v;
    });
    return result;
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <button
        onClick={() => navigate("/configs")}
        className="flex items-center gap-1 text-gray-400 hover:text-gray-200 text-sm mb-6"
      >
        <ChevronLeft className="w-4 h-4" /> Back to configs
      </button>

      <h1 className="text-2xl font-bold text-white mb-6">
        {isEdit ? "Edit Config" : "New Canary Config"}
      </h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic */}
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
            General
          </h2>
          <div>
            <label className="label">Config name *</label>
            <input
              className="input"
              required
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. payment-service-canary"
            />
          </div>
          <div>
            <label className="label">Description</label>
            <input
              className="input"
              value={form.description ?? ""}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Optional description"
            />
          </div>
        </div>

        {/* Selectors */}
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
            Deployment Selectors
          </h2>
          <p className="text-xs text-gray-500">
            Use key=value pairs (comma-separated) to identify the canary and baseline in Prometheus labels.
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="label">Canary selector</label>
              <input
                className="input"
                value={selectorToString(form.canary_selector)}
                onChange={(e) => set("canary_selector", stringToSelector(e.target.value))}
                placeholder="deployment=canary"
              />
            </div>
            <div>
              <label className="label">Baseline selector</label>
              <input
                className="input"
                value={selectorToString(form.baseline_selector)}
                onChange={(e) => set("baseline_selector", stringToSelector(e.target.value))}
                placeholder="deployment=baseline"
              />
            </div>
          </div>
        </div>

        {/* Timing */}
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
            Analysis Timing
          </h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="label">Analysis duration (seconds)</label>
              <input
                type="number"
                className="input"
                min={30}
                value={form.analysis_duration}
                onChange={(e) => set("analysis_duration", parseInt(e.target.value))}
              />
            </div>
            <div>
              <label className="label">Step interval (seconds)</label>
              <input
                type="number"
                className="input"
                min={5}
                value={form.step_interval}
                onChange={(e) => set("step_interval", parseInt(e.target.value))}
              />
            </div>
          </div>
        </div>

        {/* Thresholds */}
        <div className="card space-y-4">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
            Score Thresholds
          </h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="label">Pass threshold (score ≥ this → rollout)</label>
              <input
                type="number"
                className="input"
                min={0}
                max={100}
                step={0.5}
                value={form.pass_threshold}
                onChange={(e) => set("pass_threshold", parseFloat(e.target.value))}
              />
            </div>
            <div>
              <label className="label">Marginal threshold (score &lt; this → rollback)</label>
              <input
                type="number"
                className="input"
                min={0}
                max={100}
                step={0.5}
                value={form.marginal_threshold}
                onChange={(e) => set("marginal_threshold", parseFloat(e.target.value))}
              />
            </div>
          </div>
        </div>

        {/* Metrics */}
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
              Metrics ({form.metrics.length})
            </h2>
            <button type="button" className="btn-secondary text-xs py-1.5" onClick={addMetric}>
              <Plus className="w-3.5 h-3.5" /> Add Metric
            </button>
          </div>

          {form.metrics.map((metric, i) => (
            <div key={i} className="bg-gray-800/50 rounded-lg p-4 space-y-3 relative">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400 font-medium">Metric #{i + 1}</span>
                {form.metrics.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeMetric(i)}
                    className="text-red-500 hover:text-red-400"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <label className="label">Metric name *</label>
                  <input
                    className="input"
                    required
                    value={metric.name}
                    onChange={(e) => setMetric(i, "name", e.target.value)}
                    placeholder="e.g. http_latency_p99"
                  />
                </div>
                <div>
                  <label className="label">Direction</label>
                  <select
                    className="input"
                    value={metric.direction}
                    onChange={(e) => setMetric(i, "direction", e.target.value)}
                  >
                    <option value="no_direction">No direction</option>
                    <option value="lower_is_better">Lower is better</option>
                    <option value="higher_is_better">Higher is better</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="label">PromQL query template *</label>
                <input
                  className="input font-mono text-xs"
                  required
                  value={metric.query_template}
                  onChange={(e) => setMetric(i, "query_template", e.target.value)}
                  placeholder="rate(http_request_duration_seconds{deployment='{deployment}'}[1m])"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Use <code className="bg-gray-800 px-1 rounded">{"{deployment}"}</code> as
                  placeholder for the selector value
                </p>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <label className="label">Weight</label>
                  <input
                    type="number"
                    className="input"
                    min={0}
                    step={0.1}
                    value={metric.weight}
                    onChange={(e) => setMetric(i, "weight", parseFloat(e.target.value))}
                  />
                </div>
                <div>
                  <label className="label">Per-metric pass threshold</label>
                  <input
                    type="number"
                    className="input"
                    min={0}
                    max={100}
                    step={0.5}
                    value={metric.pass_threshold}
                    onChange={(e) =>
                      setMetric(i, "pass_threshold", parseFloat(e.target.value))
                    }
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {error && (
          <div className="bg-red-950 border border-red-800 text-red-300 text-sm rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => navigate("/configs")}
          >
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            <Save className="w-4 h-4" />
            {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Config"}
          </button>
        </div>
      </form>
    </div>
  );
};
