import axios from "axios";
import type {
  CanaryConfig,
  AnalysisJob,
  AnalysisResult,
  AnalysisSnapshot,
  Suite,
} from "./types";

const BASE = "/api";

const http = axios.create({ baseURL: BASE });

// ── Configs ────────────────────────────────────────────────────────────────

export const listConfigs = () =>
  http.get<CanaryConfig[]>("/configs").then((r) => r.data);

export const getConfig = (id: string) =>
  http.get<CanaryConfig>(`/configs/${id}`).then((r) => r.data);

export const createConfig = (payload: Omit<CanaryConfig, "id" | "created_at" | "updated_at">) =>
  http.post<CanaryConfig>("/configs", payload).then((r) => r.data);

export const updateConfig = (id: string, payload: Partial<CanaryConfig>) =>
  http.patch<CanaryConfig>(`/configs/${id}`, payload).then((r) => r.data);

export const deleteConfig = (id: string) => http.delete(`/configs/${id}`);

// ── Jobs ───────────────────────────────────────────────────────────────────

export const listJobs = (params?: { status?: string; config_id?: string }) =>
  http.get<AnalysisJob[]>("/jobs", { params }).then((r) => r.data);

export const getJob = (id: string) =>
  http.get<AnalysisJob>(`/jobs/${id}`).then((r) => r.data);

export const createAndStartJob = (configId: string, duration?: number) =>
  http.post<AnalysisJob>("/runs", { config_id: configId, duration }).then((r) => r.data);

export const controlJob = (
  jobId: string,
  action: "start" | "pause" | "resume" | "stop" | "cancel" | "rerun"
) =>
  http.post<AnalysisJob>(`/jobs/${jobId}/control`, { action }).then((r) => r.data);

export const getRun = (jobId: string) =>
  http
    .get<{ job: AnalysisJob; result: AnalysisResult | null; snapshots: AnalysisSnapshot[] }>(
      `/runs/${jobId}`
    )
    .then((r) => r.data);

// ── Results ────────────────────────────────────────────────────────────────

export const listResults = (params?: { config_id?: string }) =>
  http.get<AnalysisResult[]>("/results", { params }).then((r) => r.data);

export const getResultByJob = (jobId: string) =>
  http.get<AnalysisResult>(`/results/job/${jobId}`).then((r) => r.data);

// ── Snapshots ──────────────────────────────────────────────────────────────

export const getSnapshots = (jobId: string) =>
  http.get<AnalysisSnapshot[]>(`/snapshots/${jobId}`).then((r) => r.data);

// ── Suites ─────────────────────────────────────────────────────────────────

export const createSuite = (payload: {
  config_id: string;
  duration_per_run?: number;
  interval_minutes?: number;
  run_count?: number;
}) => http.post<Suite>("/suites", payload).then((r) => r.data);

export const getSuite = (id: string) =>
  http.get<Suite>(`/suites/${id}`).then((r) => r.data);
